import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ClassificacaoTitular, Prisma, RoleUsuario, TipoEstruturaJuridica } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioAutenticado } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../database/prisma.service';

// Pessoas/classificações + camada de capital (doc 02 §15, reunião 18/07).
// Estrutura jurídica = placeholder funcional (jurídico com Cláudio/Sebastião).

const estruturaSchema = z.object({
  nome: z.string().min(2),
  tipo: z.nativeEnum(TipoEstruturaJuridica).optional(),
  cnpj: z.string().optional(),
  rodada: z.string().optional(),
  observacoes: z.string().optional(),
  ativo: z.boolean().optional(),
});

const aporteSchema = z.object({
  titularId: z.string().min(1),
  valorAportado: z.number().int().min(0).optional(), // centavos
  tipoInstrumento: z.string().optional(),
  dataAporte: z.string().optional(),
  observacao: z.string().optional(),
});

const classificacaoSchema = z.object({
  classificacao: z.nativeEnum(ClassificacaoTitular),
  observacao: z.string().optional(),
});

const cent = (d: Prisma.Decimal | null): number | null => (d !== null ? Math.round(Number(d.toString()) * 100) : null);

@Controller()
export class CapitalController {
  constructor(private readonly prisma: PrismaService) {}

  // --- Classificações do titular (visões filtradas do cadastro único) ---
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post('titulares/:id/classificacoes')
  @HttpCode(201)
  async classificar(
    @Param('id') titularId: string,
    @Body(new ZodValidationPipe(classificacaoSchema)) dto: z.infer<typeof classificacaoSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    const c = await this.prisma.db.titularClassificacao.upsert({
      where: { titularId_classificacao: { titularId, classificacao: dto.classificacao } },
      update: { observacao: dto.observacao },
      create: { titularId, classificacao: dto.classificacao, observacao: dto.observacao },
    });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId: user.id, acao: 'titular_classificado', entidade: 'titular', entidadeId: titularId, depois: { classificacao: dto.classificacao } },
    });
    return c;
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Delete('titulares/:id/classificacoes/:classificacao')
  @HttpCode(204)
  async desclassificar(
    @Param('id') titularId: string,
    @Param('classificacao') classificacao: string,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    await this.prisma.db.titularClassificacao.deleteMany({
      where: { titularId, classificacao: classificacao.toUpperCase() as ClassificacaoTitular },
    });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId: user.id, acao: 'titular_desclassificado', entidade: 'titular', entidadeId: titularId, depois: { classificacao } },
    });
  }

  @Get('titulares/:id/classificacoes')
  listarClassificacoes(@Param('id') titularId: string) {
    return this.prisma.db.titularClassificacao.findMany({ where: { titularId } });
  }

  // Visão filtrada: titulares por classificação (aba Investidores/Fornecedores/Parceiros).
  @Get('pessoas')
  async pessoas(@Query('classificacao') classificacao?: string) {
    const where = classificacao
      ? { classificacoes: { some: { classificacao: classificacao.toUpperCase() as ClassificacaoTitular } }, deletedAt: null }
      : { classificacoes: { some: {} }, deletedAt: null };
    const titulares = await this.prisma.db.titular.findMany({
      where,
      include: { classificacoes: true, investimentosEstrutura: { include: { estrutura: true } } },
      orderBy: { nome: 'asc' },
    });
    return titulares.map((t) => ({
      id: t.id,
      nome: t.nome,
      cpfCnpj: t.cpfCnpj,
      whatsapp: t.whatsapp,
      classificacoes: t.classificacoes.map((c) => c.classificacao),
      estruturas: t.investimentosEstrutura.map((v) => ({ id: v.estruturaId, nome: v.estrutura.nome, valorAportado: cent(v.valorAportado) })),
    }));
  }

  // --- Estruturas jurídicas (SPE/fundo por rodada) ---
  @Get('estruturas')
  async listarEstruturas() {
    const es = await this.prisma.db.estruturaJuridica.findMany({
      where: { deletedAt: null },
      include: {
        investidores: { include: { titular: { select: { nome: true, cpfCnpj: true } } } },
        origensCapital: { include: { ativo: { select: { id: true, descricao: true, placa: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return es.map((e) => ({
      id: e.id, nome: e.nome, tipo: e.tipo, cnpj: e.cnpj, rodada: e.rodada, ativo: e.ativo, observacoes: e.observacoes,
      investidores: e.investidores.map((i) => ({
        titularId: i.titularId, nome: i.titular.nome, cpfCnpj: i.titular.cpfCnpj,
        valorAportado: cent(i.valorAportado), tipoInstrumento: i.tipoInstrumento, dataAporte: i.dataAporte,
      })),
      ativos: e.origensCapital.map((o) => ({ ativoId: o.ativo?.id, descricao: o.ativo?.descricao, placa: o.ativo?.placa })),
      totalAportado: e.investidores.reduce((s, i) => s + (cent(i.valorAportado) ?? 0), 0),
    }));
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.DIRETOR)
  @Post('estruturas')
  @HttpCode(201)
  criarEstrutura(@Body(new ZodValidationPipe(estruturaSchema)) dto: z.infer<typeof estruturaSchema>) {
    return this.prisma.db.estruturaJuridica.create({ data: dto });
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.DIRETOR)
  @Patch('estruturas/:id')
  atualizarEstrutura(@Param('id') id: string, @Body(new ZodValidationPipe(estruturaSchema.partial())) dto: Partial<z.infer<typeof estruturaSchema>>) {
    return this.prisma.db.estruturaJuridica.update({ where: { id }, data: dto });
  }

  // Vincular investidor (N↔N; instrumento padrão mútuo).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.DIRETOR)
  @Post('estruturas/:id/investidores')
  @HttpCode(201)
  async vincularInvestidor(
    @Param('id') estruturaId: string,
    @Body(new ZodValidationPipe(aporteSchema)) dto: z.infer<typeof aporteSchema>,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    // garante a classificação INVESTIDOR no titular
    await this.prisma.db.titularClassificacao.upsert({
      where: { titularId_classificacao: { titularId: dto.titularId, classificacao: 'INVESTIDOR' } },
      update: {},
      create: { titularId: dto.titularId, classificacao: 'INVESTIDOR' },
    });
    const v = await this.prisma.db.investidorEstrutura.upsert({
      where: { titularId_estruturaId: { titularId: dto.titularId, estruturaId } },
      update: {
        valorAportado: dto.valorAportado !== undefined ? (dto.valorAportado / 100).toFixed(2) : undefined,
        tipoInstrumento: dto.tipoInstrumento,
        dataAporte: dto.dataAporte ? new Date(dto.dataAporte) : undefined,
        observacao: dto.observacao,
      },
      create: {
        titularId: dto.titularId,
        estruturaId,
        valorAportado: dto.valorAportado !== undefined ? (dto.valorAportado / 100).toFixed(2) : undefined,
        tipoInstrumento: dto.tipoInstrumento ?? 'MUTUO',
        dataAporte: dto.dataAporte ? new Date(dto.dataAporte) : undefined,
        observacao: dto.observacao,
      },
    });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId: user.id, acao: 'investidor_vinculado_estrutura', entidade: 'estrutura_juridica', entidadeId: estruturaId, depois: { titularId: dto.titularId, valorAportado: dto.valorAportado } },
    });
    return v;
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.DIRETOR)
  @Delete('estruturas/:id/investidores/:titularId')
  @HttpCode(204)
  async desvincularInvestidor(@Param('id') estruturaId: string, @Param('titularId') titularId: string) {
    await this.prisma.db.investidorEstrutura.deleteMany({ where: { estruturaId, titularId } });
  }

  // Apontar a origem de capital de um ativo para a estrutura (dona do capital).
  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR, RoleUsuario.DIRETOR)
  @Post('estruturas/:id/ativos/:ativoId')
  @HttpCode(200)
  async vincularAtivo(@Param('id') estruturaId: string, @Param('ativoId') ativoId: string, @CurrentUser() user: UsuarioAutenticado) {
    const oc = await this.prisma.db.origemCapital.findFirst({ where: { ativoId } });
    if (!oc) {
      return { erro: 'sem_origem_capital', mensagem: 'Defina a origem de capital do ativo antes (cadastro do ativo)' };
    }
    await this.prisma.db.origemCapital.update({ where: { id: oc.id }, data: { estruturaId } });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId: user.id, acao: 'ativo_vinculado_estrutura', entidade: 'estrutura_juridica', entidadeId: estruturaId, depois: { ativoId } },
    });
    return { resultado: 'vinculado' };
  }
}
