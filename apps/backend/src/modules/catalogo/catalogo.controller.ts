import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, UnprocessableEntityException } from '@nestjs/common';
import { CicloProduto, Prisma, RoleUsuario } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';
import { contribuicaoProtecaoVeicular } from '@azit/utils';
import { CatalogoFonteService } from './catalogo-fonte.service';

// Catálogo de Produtos F1 (doc 02 §17): Produto → Variante → Versão.
// Alteração MATERIAL cria versão nova (numeração sequencial, fecha a anterior);
// alteração cadastral edita direto. Governança sem workflow: Diretoria/Admin
// editam com auditoria antes/depois. Dinheiro em CENTAVOS nos parâmetros.

const cadastralSchema = z.object({
  nome: z.string().min(2).optional(),
  finalidade: z.string().optional(),
  classificacao: z.string().optional(),
  descricao: z.string().optional(),
});

const criarProdutoSchema = cadastralSchema.extend({
  chave: z.string().regex(/^[a-z0-9_]+$/, 'chave em snake_case'),
  nome: z.string().min(2),
});

const statusSchema = z.object({ status: z.nativeEnum(CicloProduto) });

const varianteSchema = z.object({
  chave: z.string().regex(/^[a-z0-9_]+$/),
  nome: z.string().min(2),
  ordem: z.number().int().optional(),
});

const simularProtecaoSchema = z.object({
  variante: z.string().min(2),
  fipe: z.coerce.number().int().min(1), // centavos
  oferta: z.enum(['essencial', 'protecao', 'completa']),
  frequencia: z.enum(['mensal', 'quinzenal', 'semanal']),
  acrescimoPerfil: z.coerce.number().int().min(0).optional(),
});

const versaoSchema = z.object({
  varianteId: z.string().nullable().optional(), // null/ausente = nível produto
  parametros: z.record(z.union([z.string(), z.number(), z.boolean()])),
  observacao: z.string().optional(),
});

// Ciclo de vida: Rascunho → Ativo ⇄ Suspenso → Encerrado (RF-G04).
const CICLO: Record<CicloProduto, CicloProduto[]> = {
  RASCUNHO: ['ATIVO'],
  ATIVO: ['SUSPENSO', 'ENCERRADO'],
  SUSPENSO: ['ATIVO', 'ENCERRADO'],
  ENCERRADO: [],
};

type Parametros = Record<string, string | number | boolean>;

@Controller('catalogo')
export class CatalogoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fonte: CatalogoFonteService,
  ) {}

  @Get()
  async listar() {
    const produtos = await this.prisma.db.produtoCatalogo.findMany({
      where: { deletedAt: null },
      include: { variantes: { where: { deletedAt: null }, orderBy: { ordem: 'asc' } }, versoes: true },
      orderBy: { createdAt: 'asc' },
    });
    return produtos.map((p) => ({
      id: p.id,
      chave: p.chave,
      nome: p.nome,
      finalidade: p.finalidade,
      classificacao: p.classificacao,
      status: p.status,
      variantes: p.variantes.map((v) => ({ id: v.id, chave: v.chave, nome: v.nome, status: v.status })),
      totalVersoes: p.versoes.length,
      versaoVigenteProduto: this.numeroVigente(p.versoes.filter((x) => !x.varianteId)),
    }));
  }

  @Get(':id')
  async detalhe(@Param('id') id: string) {
    const p = await this.carregar(id);
    const vigenteProduto = this.vigente(p.versoes.filter((x) => !x.varianteId));
    return {
      id: p.id,
      chave: p.chave,
      nome: p.nome,
      finalidade: p.finalidade,
      classificacao: p.classificacao,
      descricao: p.descricao,
      status: p.status,
      parametrosProduto: (vigenteProduto?.parametros as Parametros) ?? {},
      versaoProduto: vigenteProduto?.numero ?? null,
      variantes: p.variantes.map((v) => {
        const vigenteVar = this.vigente(p.versoes.filter((x) => x.varianteId === v.id));
        return {
          id: v.id,
          chave: v.chave,
          nome: v.nome,
          status: v.status,
          versao: vigenteVar?.numero ?? null,
          parametros: (vigenteVar?.parametros as Parametros) ?? {},
          // Efetivo = herança do produto sobrescrita pela variante (RF-G02).
          parametrosEfetivos: {
            ...((vigenteProduto?.parametros as Parametros) ?? {}),
            ...((vigenteVar?.parametros as Parametros) ?? {}),
          },
        };
      }),
      versoes: p.versoes
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((x) => ({
          id: x.id,
          numero: x.numero,
          nivel: x.varianteId ? (p.variantes.find((v) => v.id === x.varianteId)?.nome ?? 'variante') : 'produto',
          vigenteDesde: x.vigenteDesde,
          vigenteAte: x.vigenteAte,
          observacao: x.observacao,
          parametros: x.parametros as Parametros,
        })),
    };
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post()
  @HttpCode(201)
  async criar(
    @Body(new ZodValidationPipe(criarProdutoSchema)) dto: z.infer<typeof criarProdutoSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const criado = await this.prisma.db.produtoCatalogo.create({ data: dto });
    await this.auditar(user.id, 'catalogo_produto_criado', criado.id, undefined, dto);
    return { id: criado.id };
  }

  // Alteração CADASTRAL: edita direto, não versiona (RF-G03).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Patch(':id')
  async atualizarCadastral(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cadastralSchema)) dto: z.infer<typeof cadastralSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const antes = await this.carregar(id);
    await this.prisma.db.produtoCatalogo.update({ where: { id }, data: dto });
    await this.auditar(user.id, 'catalogo_produto_alterado_cadastral', id,
      { nome: antes.nome, finalidade: antes.finalidade, descricao: antes.descricao }, dto);
    return { resultado: 'ok' };
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post(':id/status')
  @HttpCode(200)
  async mudarStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(statusSchema)) dto: z.infer<typeof statusSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const p = await this.carregar(id);
    if (!CICLO[p.status].includes(dto.status)) {
      throw new UnprocessableEntityException({
        erro: 'transicao_invalida',
        mensagem: `Produto ${p.status} não pode ir para ${dto.status}`,
      });
    }
    await this.prisma.db.produtoCatalogo.update({ where: { id }, data: { status: dto.status } });
    await this.auditar(user.id, 'catalogo_produto_status', id, { status: p.status }, { status: dto.status });
    return { resultado: 'ok' };
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post(':id/variantes')
  @HttpCode(201)
  async criarVariante(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(varianteSchema)) dto: z.infer<typeof varianteSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    await this.carregar(id);
    const criada = await this.prisma.db.varianteProduto.create({ data: { produtoId: id, ...dto } });
    await this.auditar(user.id, 'catalogo_variante_criada', id, undefined, dto);
    return { id: criada.id };
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post(':id/variantes/:varianteId/status')
  @HttpCode(200)
  async statusVariante(
    @Param('id') id: string,
    @Param('varianteId') varianteId: string,
    @Body(new ZodValidationPipe(statusSchema)) dto: z.infer<typeof statusSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const v = await this.prisma.db.varianteProduto.findFirst({ where: { id: varianteId, produtoId: id } });
    if (!v) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Variante não encontrada' });
    if (!CICLO[v.status].includes(dto.status)) {
      throw new UnprocessableEntityException({
        erro: 'transicao_invalida',
        mensagem: `Variante ${v.status} não pode ir para ${dto.status}`,
      });
    }
    await this.prisma.db.varianteProduto.update({ where: { id: varianteId }, data: { status: dto.status } });
    await this.auditar(user.id, 'catalogo_variante_status', id, { varianteId, status: v.status }, { varianteId, status: dto.status });
    return { resultado: 'ok' };
  }

  // Alteração MATERIAL: cria versão nova no nível indicado e fecha a vigente.
  @Roles(RoleUsuario.ADMIN, RoleUsuario.DIRETOR)
  @Post(':id/versoes')
  @HttpCode(201)
  async criarVersao(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(versaoSchema)) dto: z.infer<typeof versaoSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const p = await this.carregar(id);
    const varianteId = dto.varianteId ?? null;
    if (varianteId && !p.variantes.some((v) => v.id === varianteId)) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Variante não pertence a este produto' });
    }
    const doNivel = p.versoes.filter((x) => (x.varianteId ?? null) === varianteId);
    const anterior = this.vigente(doNivel);
    const numero = doNivel.reduce((m, x) => Math.max(m, x.numero), 0) + 1;

    const nova = await this.prisma.db.$transaction(async (tx) => {
      if (anterior) {
        await tx.versaoProduto.update({ where: { id: anterior.id }, data: { vigenteAte: new Date() } });
      }
      return tx.versaoProduto.create({
        data: {
          produtoId: id,
          varianteId,
          numero,
          parametros: dto.parametros as Prisma.InputJsonValue,
          observacao: dto.observacao,
          criadaPor: user.id,
        },
      });
    });
    await this.auditar(user.id, 'catalogo_versao_criada', id,
      anterior ? { numero: anterior.numero, parametros: anterior.parametros } : undefined,
      { numero, varianteId, parametros: dto.parametros, observacao: dto.observacao });
    return { id: nova.id, numero };
  }

  // --- Proteção Veicular (F5): simulação interna da contribuição ---
  // Funciona mesmo com o produto em Rascunho (valores em homologação) — a
  // resposta carrega o status para a tela avisar que não é comercializável.
  @Post('protecao/simular')
  @HttpCode(200)
  async simularProtecao(
    @Body(new ZodValidationPipe(simularProtecaoSchema)) dto: z.infer<typeof simularProtecaoSchema>,
  ) {
    const pv = await this.fonte.protecaoVeicular();
    if (!pv) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Produto Proteção Veicular não cadastrado' });
    const variante = pv.variantes.find((v) => v.chave === dto.variante);
    if (!variante) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Variante não encontrada' });
    const num = (v: unknown, padrao = 0) => (typeof v === 'number' ? v : padrao);
    const oferta = dto.oferta; // essencial | protecao | completa
    const prefixo = oferta === 'essencial' ? 'ofertaEssencial' : oferta === 'protecao' ? 'ofertaProtecao' : 'ofertaCompleta';
    const r = contribuicaoProtecaoVeicular({
      fipe: dto.fipe,
      contribuicaoMinimaMensal: num(variante.parametros.contribuicaoMinimaMensal),
      taxaFipeMensal: num(pv.parametros[`${prefixo}TaxaFipe`]),
      taxaAdministracaoMensal: num(pv.parametros.taxaAdministracaoMensal),
      custoAssistenciaMensal: num(pv.parametros[`${prefixo}Assistencia`]),
      acrescimoPerfilMensal: dto.acrescimoPerfil ?? 0,
      frequencia: dto.frequencia,
    });
    return {
      statusProduto: pv.status,
      comercializavel: pv.status === 'ATIVO',
      statusValores: pv.parametros.statusValores ?? null,
      cobertura: pv.parametros[`${prefixo}Cobertura`] ?? null,
      vigenciaMeses: num(pv.parametros.vigenciaPadraoMeses, 12),
      ...r,
    };
  }

  // --- internos ---

  private async carregar(id: string) {
    const p = await this.prisma.db.produtoCatalogo.findFirst({
      where: { id, deletedAt: null },
      include: { variantes: { where: { deletedAt: null }, orderBy: { ordem: 'asc' } }, versoes: true },
    });
    if (!p) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Produto do catálogo não encontrado' });
    return p;
  }

  private vigente<T extends { vigenteAte: Date | null; numero: number }>(versoes: T[]): T | null {
    return versoes.filter((v) => !v.vigenteAte).sort((a, b) => b.numero - a.numero)[0] ?? null;
  }

  private numeroVigente(versoes: { vigenteAte: Date | null; numero: number }[]): number | null {
    return this.vigente(versoes)?.numero ?? null;
  }

  private async auditar(usuarioId: string, acao: string, entidadeId: string, antes?: unknown, depois?: unknown) {
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao,
        entidade: 'produto_catalogo',
        entidadeId,
        antes: antes ? (JSON.parse(JSON.stringify(antes)) as Prisma.InputJsonValue) : undefined,
        depois: depois ? (JSON.parse(JSON.stringify(depois)) as Prisma.InputJsonValue) : undefined,
      },
    });
  }
}
