import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import {
  Prisma,
  StatusProposta,
  ModalidadeContrato,
  PapelTitular,
} from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { limparDocumento, reaisParaCentavos, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { TitularService } from '../titular/titular.service';
import { ContaService } from '../conta/conta.service';
import {
  CriarPropostaDto,
  AdicionarVinculoDto,
  AnexarDocumentoDto,
  RegistrarParecerDto,
} from './dto/proposta.dto';
import {
  TipoDocumentoProposta,
  ResultadoParecer,
} from '@prisma/client';

const cent = (d: Prisma.Decimal): number => reaisParaCentavos(d.toString());
// Diretório de uploads (documentos da proposta) — dev/local.
const UPLOADS_DIR = join(process.cwd(), 'uploads', 'documentos');

// Cadastro pleno é igual ao CriarTitularDto (validação de CPF embutida no service).
type Cadastro = NonNullable<CriarPropostaDto['comprador']>;

// Transições permitidas no Kanban via PATCH (movimentos livres). APROVADA/REPROVADA
// só vêm do parecer (7.8); CONVERTIDA só da formalização (7.10) — Doc 2 §4-A.4.
const TRANSICOES: Record<string, StatusProposta[]> = {
  PENDENTE: ['EM_ANALISE', 'CANCELADA'],
  EM_ANALISE: ['CANCELADA'],
  APROVADA: ['EM_FORMALIZACAO', 'CANCELADA'],
  EM_FORMALIZACAO: ['CANCELADA'],
  REPROVADA: [],
  CONVERTIDA: [],
  CANCELADA: [],
};

// Documentos obrigatórios por papel (Doc 2 §4-A.5). Principal e secundário exigem
// o conjunto completo; garantidor não é exigido aqui (entra por ressalva da análise).
export const DOCS_OBRIGATORIOS: TipoDocumentoProposta[] = [
  'CNH',
  'COMPROVANTE_ENDERECO',
  'COMPROVANTE_RENDA',
  'RELATORIO_BRICK',
];
const PAPEIS_QUE_EXIGEM_DOCS: PapelTitular[] = ['COMPRADOR_PRINCIPAL', 'COMPRADOR_SECUNDARIO'];

export interface PendenciaDoc {
  titularId: string;
  papel: string;
  nome: string;
  faltando: string[];
}

// 7.5/7.6/7.7 — Proposta: converte a oferta escolhida em pedido de crédito,
// promove Lead→Titular (reconciliação por CPF) e vincula papéis.
@Injectable()
export class PropostaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly titular: TitularService,
    private readonly conta: ContaService,
  ) {}

  async criar(dto: CriarPropostaDto) {
    const simulacao = await this.prisma.db.simulacao.findFirst({
      where: { id: dto.simulacaoId },
      include: { ofertas: true, proposta: true },
    });
    if (!simulacao) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Simulação não encontrada' });
    }
    if (simulacao.proposta) {
      throw new ConflictException({ erro: 'ja_convertida', mensagem: 'Simulação já tem proposta' });
    }
    const oferta = simulacao.ofertas.find((o) => o.selecionada);
    if (!oferta) {
      throw new UnprocessableEntityException({
        erro: 'sem_oferta',
        mensagem: 'Selecione uma oferta antes de criar a proposta',
      });
    }
    // Bloqueio (Doc 2 §4-A.2): simulação expirada não converte sem recálculo.
    if (
      simulacao.validaAte &&
      simulacao.validaAte < new Date() &&
      (simulacao.status === 'CALCULADA' || simulacao.status === 'APRESENTADA')
    ) {
      throw new UnprocessableEntityException({
        erro: 'simulacao_expirada',
        mensagem: 'Simulação expirada — recalcule antes de converter em proposta',
      });
    }
    // Proposta precisa de um ativo (o veículo da venda). Simulação por valor manual
    // deve ser refeita com o ativo definido antes de virar proposta.
    if (!simulacao.ativoId) {
      throw new UnprocessableEntityException({
        erro: 'sem_ativo',
        mensagem: 'Vincule um veículo/ativo à simulação antes de converter em proposta',
      });
    }

    // Resolve o comprador principal (promoção do lead, se necessário).
    const titularId = await this.resolverTitular(simulacao.id, simulacao.titularId, simulacao.leadId, dto.comprador);

    const proposta = await this.prisma.db.proposta.create({
      data: {
        simulacaoId: simulacao.id,
        titularId,
        ativoId: simulacao.ativoId,
        modalidade: dto.modalidade.toUpperCase() as ModalidadeContrato,
        valorEntrada: oferta.valorEntrada,
        // V3: prazo em meses + frequência (a conversão em contrato deriva daqui).
        // prazoSemanas preservado por compat (NOT NULL): recebe o nº de parcelas.
        prazoSemanas: oferta.prazoSemanas ?? oferta.numeroParcelas,
        prazoMeses: oferta.prazoMeses,
        frequencia: oferta.frequencia,
        valorParcela: oferta.valorParcela,
        numeroParcelas: oferta.numeroParcelas,
        status: 'PENDENTE',
        vinculos: {
          create: { titularId, papel: 'COMPRADOR_PRINCIPAL' },
        },
      },
    });
    // Rastreabilidade (Doc 2 §4-A.2): simulação convertida vira imutável.
    await this.prisma.db.simulacao.update({
      where: { id: simulacao.id },
      data: { status: 'CONVERTIDA' },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        acao: 'simulacao_convertida',
        entidade: 'simulacao',
        entidadeId: simulacao.id,
        depois: { propostaId: proposta.id, ofertaId: oferta.id },
      },
    });
    return this.detalhe(proposta.id);
  }

  // 7.6 — promoção/reconciliação por CPF; garante Conta; vincula lead e simulação.
  private async resolverTitular(
    simulacaoId: string,
    titularIdExistente: string | null,
    leadId: string | null,
    cadastro?: Cadastro,
  ): Promise<string> {
    if (titularIdExistente) return titularIdExistente;
    if (!cadastro) {
      throw new UnprocessableEntityException({
        erro: 'cadastro_obrigatorio',
        mensagem: 'Cadastro completo do comprador é obrigatório para criar a proposta',
      });
    }
    const cpf = limparDocumento(cadastro.cpfCnpj);
    const existente = await this.prisma.db.titular.findFirst({ where: { cpfCnpj: cpf } });
    const titularId = existente ? existente.id : (await this.titular.criar(cadastro)).id;

    const conta = await this.prisma.db.conta.findFirst({ where: { titularId } });
    if (!conta) await this.conta.criar({ titularId });

    if (leadId) {
      await this.prisma.db.lead.update({ where: { id: leadId }, data: { titularId } });
    }
    await this.prisma.db.simulacao.update({ where: { id: simulacaoId }, data: { titularId } });
    return titularId;
  }

  // 7.7 — adiciona comprador secundário ou garantidor (papel de Titular).
  async adicionarVinculo(propostaId: string, dto: AdicionarVinculoDto) {
    const proposta = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: { vinculos: { include: { titular: { select: { cpfCnpj: true } } } } },
    });
    if (!proposta) throw this.naoEncontrada();

    const cpf = limparDocumento(dto.titular.cpfCnpj);
    const existente = await this.prisma.db.titular.findFirst({ where: { cpfCnpj: cpf } });
    const titularId = existente ? existente.id : (await this.titular.criar(dto.titular)).id;

    // CPF único entre papéis no mesmo contrato/proposta (Doc 2 §4-A.7).
    if (proposta.vinculos.some((v) => v.titularId === titularId)) {
      throw new ConflictException({
        erro: 'papel_duplicado',
        mensagem: 'Este titular já ocupa um papel nesta proposta',
      });
    }
    await this.prisma.db.vinculoPapel.create({
      data: { propostaId, titularId, papel: dto.papel.toUpperCase() as PapelTitular },
    });
    return this.detalhe(propostaId);
  }

  // Carrinho: adiciona um produto do catálogo à proposta (snapshot do produto).
  async adicionarProduto(propostaId: string, produtoId: string, valorOverride?: number) {
    const proposta = await this.prisma.db.proposta.findFirst({ where: { id: propostaId }, select: { status: true } });
    if (!proposta) throw this.naoEncontrada();
    if (proposta.status === 'convertida'.toUpperCase()) {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Proposta já convertida' });
    }
    const produto = await this.prisma.db.produto.findFirst({ where: { id: produtoId } });
    if (!produto) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Produto não encontrado' });
    const valorCent = valorOverride ?? (produto.valorPadrao ? reaisParaCentavos(produto.valorPadrao.toString()) : 0);
    await this.prisma.db.itemProposta.create({
      data: {
        propostaId,
        produtoId: produto.id,
        nome: produto.nome,
        natureza: produto.natureza,
        apartado: produto.apartado,
        credor: produto.credorPadrao,
        valor: centavosParaReaisString(valorCent),
        periodicidade: produto.periodicidade,
      },
    });
    return this.detalhe(propostaId);
  }

  async removerProduto(propostaId: string, itemId: string) {
    await this.prisma.db.itemProposta.deleteMany({ where: { id: itemId, propostaId } });
    return this.detalhe(propostaId);
  }

  // 7.8 — anexa documento digital a um titular que tem papel na proposta.
  async anexarDocumento(propostaId: string, dto: AnexarDocumentoDto) {
    const proposta = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: { vinculos: { select: { titularId: true } } },
    });
    if (!proposta) throw this.naoEncontrada();
    if (!proposta.vinculos.some((v) => v.titularId === dto.titularId)) {
      throw new UnprocessableEntityException({
        erro: 'titular_sem_papel',
        mensagem: 'O documento deve pertencer a um titular com papel na proposta',
      });
    }
    const doc = await this.prisma.db.documentoProposta.create({
      data: {
        propostaId,
        titularId: dto.titularId,
        tipo: dto.tipo.toUpperCase() as TipoDocumentoProposta,
        arquivoRef: dto.arquivoNome ?? 'documento',
      },
    });
    // Upload real: grava o conteúdo (base64) em disco, indexado pelo id do documento.
    if (dto.arquivoConteudo) {
      const base64 = dto.arquivoConteudo.includes(',') ? dto.arquivoConteudo.split(',')[1] : dto.arquivoConteudo;
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      await fs.writeFile(join(UPLOADS_DIR, doc.id), Buffer.from(base64, 'base64'));
    }
    return this.detalhe(propostaId);
  }

  // Lê o arquivo salvo de um documento (para download).
  async arquivoDocumento(docId: string): Promise<{ nome: string; buffer: Buffer }> {
    const doc = await this.prisma.db.documentoProposta.findFirst({ where: { id: docId } });
    if (!doc) throw this.naoEncontrada();
    const caminho = join(UPLOADS_DIR, doc.id);
    try {
      const buffer = await fs.readFile(caminho);
      return { nome: doc.arquivoRef, buffer };
    } catch {
      throw new NotFoundException({ erro: 'arquivo_ausente', mensagem: 'Arquivo não encontrado em disco' });
    }
  }

  // 7.8 — registra o parecer; decide o status da proposta (decisão de crédito).
  async registrarParecer(propostaId: string, dto: RegistrarParecerDto, analistaId: string) {
    const proposta = await this.prisma.db.proposta.findFirst({ where: { id: propostaId }, select: { status: true } });
    if (!proposta) throw this.naoEncontrada();
    if (!['PENDENTE', 'EM_ANALISE'].includes(proposta.status)) {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Parecer só pode ser emitido em proposta Pendente ou Em Análise',
      });
    }
    if (dto.resultado === 'reprovado' && !dto.motivoReprovacao) {
      throw new UnprocessableEntityException({
        erro: 'motivo_obrigatorio',
        mensagem: 'Reprovação exige motivo',
      });
    }
    if (dto.resultado === 'aprovado_com_ressalvas' && !dto.motivosRessalva?.length) {
      throw new UnprocessableEntityException({
        erro: 'motivo_obrigatorio',
        mensagem: 'Aprovação com ressalvas exige ao menos um motivo',
      });
    }
    // Ressalvas: todos os motivos requerem garantidor (referência da análise).
    const exigeGarantidor = dto.resultado === 'aprovado_com_ressalvas' ? true : dto.exigeGarantidor;
    const motivosRessalva = dto.motivosRessalva?.length ? dto.motivosRessalva.join(',') : null;
    // Gate: documentos obrigatórios completos antes do parecer (Doc 2 §4-A.5 / §8-A.5).
    const pendencias = await this.pendenciasProposta(propostaId);
    if (pendencias.length) {
      throw new UnprocessableEntityException({
        erro: 'documentos_pendentes',
        mensagem: `Documentos obrigatórios pendentes: ${pendencias
          .map((p) => `${p.nome} (${p.faltando.join(', ')})`)
          .join('; ')}`,
      });
    }
    const aprovada = dto.resultado !== 'reprovado';
    await this.prisma.db.$transaction(async (tx) => {
      await tx.parecer.upsert({
        where: { propostaId },
        create: {
          propostaId,
          resultado: dto.resultado.toUpperCase() as ResultadoParecer,
          motivoReprovacao: dto.motivoReprovacao,
          motivosRessalva,
          observacao: dto.observacao,
          exigeGarantidor,
          analistaId,
        },
        update: {
          resultado: dto.resultado.toUpperCase() as ResultadoParecer,
          motivoReprovacao: dto.motivoReprovacao,
          motivosRessalva,
          observacao: dto.observacao,
          exigeGarantidor,
          analistaId,
        },
      });
      await tx.proposta.update({
        where: { id: propostaId },
        data: { status: aprovada ? 'APROVADA' : 'REPROVADA' },
      });
    });
    return this.detalhe(propostaId);
  }

  async patchStatus(propostaId: string, novo: string) {
    const proposta = await this.prisma.db.proposta.findFirst({ where: { id: propostaId }, select: { status: true } });
    if (!proposta) throw this.naoEncontrada();
    const alvo = novo.toUpperCase() as StatusProposta;
    if (!TRANSICOES[proposta.status]?.includes(alvo)) {
      throw new UnprocessableEntityException({
        erro: 'transicao_invalida',
        mensagem: `Transição ${proposta.status} → ${alvo} não é permitida`,
      });
    }
    await this.prisma.db.proposta.update({ where: { id: propostaId }, data: { status: alvo } });
    return this.detalhe(propostaId);
  }

  async listar() {
    const propostas = await this.prisma.db.proposta.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        titular: { select: { nome: true } },
        ativo: { select: { descricao: true } },
      },
    });
    return propostas.map((p) => ({
      id: p.id,
      status: p.status.toLowerCase(),
      modalidade: p.modalidade.toLowerCase(),
      titular: p.titular.nome,
      ativo: p.ativo.descricao,
      valorEntrada: cent(p.valorEntrada),
      valorParcela: cent(p.valorParcela),
      numeroParcelas: p.numeroParcelas,
      prazoSemanas: p.prazoSemanas,
      contratoGeradoId: p.contratoGeradoId,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  async detalhe(id: string) {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id },
      include: {
        titular: { select: { id: true, nome: true, cpfCnpj: true, whatsapp: true } },
        ativo: { select: { id: true, descricao: true, valorVenda: true } },
        vinculos: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true } } } },
        documentos: true,
        parecer: true,
        itens: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!p) throw this.naoEncontrada();
    const pendencias = this.calcPendencias(p.vinculos, p.documentos);
    return {
      id: p.id,
      status: p.status.toLowerCase(),
      modalidade: p.modalidade.toLowerCase(),
      ativo: { id: p.ativo.id, descricao: p.ativo.descricao },
      titular: p.titular,
      valorEntrada: cent(p.valorEntrada),
      valorParcela: cent(p.valorParcela),
      numeroParcelas: p.numeroParcelas,
      prazoSemanas: p.prazoSemanas,
      contratoGeradoId: p.contratoGeradoId,
      // Documentos obrigatórios (Doc 2 §4-A.5) — para a UI exibir pendência e travar avanço.
      documentosObrigatorios: DOCS_OBRIGATORIOS.map((t) => t.toLowerCase()),
      pendenciasDocumentos: pendencias,
      documentosCompletos: pendencias.length === 0,
      papeis: p.vinculos.map((v) => ({
        id: v.id,
        papel: v.papel.toLowerCase(),
        titular: v.titular,
      })),
      documentos: p.documentos.map((d) => ({
        id: d.id,
        tipo: d.tipo.toLowerCase(),
        titularId: d.titularId,
        arquivoRef: d.arquivoRef,
      })),
      parecer: p.parecer
        ? {
            resultado: p.parecer.resultado.toLowerCase(),
            exigeGarantidor: p.parecer.exigeGarantidor,
            motivoReprovacao: p.parecer.motivoReprovacao,
            motivosRessalva: p.parecer.motivosRessalva ? p.parecer.motivosRessalva.split(',') : [],
            observacao: p.parecer.observacao,
          }
        : null,
      // Carrinho: produtos adicionados à proposta (além do âncora financiamento).
      itens: p.itens.map((it) => ({
        id: it.id,
        produtoId: it.produtoId,
        nome: it.nome,
        natureza: it.natureza.toLowerCase(),
        apartado: it.apartado,
        credor: it.credor.toLowerCase(),
        valor: cent(it.valor),
        periodicidade: it.periodicidade ? it.periodicidade.toLowerCase() : null,
      })),
    };
  }

  // Pendências de documentos obrigatórios por papel (principal/secundário).
  private calcPendencias(
    vinculos: { titularId: string; papel: PapelTitular; titular: { nome: string } }[],
    documentos: { titularId: string; tipo: TipoDocumentoProposta }[],
  ): PendenciaDoc[] {
    const pend: PendenciaDoc[] = [];
    for (const v of vinculos.filter((x) => PAPEIS_QUE_EXIGEM_DOCS.includes(x.papel))) {
      const tipos = new Set(documentos.filter((d) => d.titularId === v.titularId).map((d) => d.tipo));
      const faltando = DOCS_OBRIGATORIOS.filter((t) => !tipos.has(t));
      if (faltando.length) {
        pend.push({
          titularId: v.titularId,
          papel: v.papel.toLowerCase(),
          nome: v.titular.nome,
          faltando: faltando.map((t) => t.toLowerCase()),
        });
      }
    }
    return pend;
  }

  // Carrega e verifica pendências — usado nos gates (parecer/formalização).
  async pendenciasProposta(propostaId: string): Promise<PendenciaDoc[]> {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: { vinculos: { include: { titular: { select: { nome: true } } } }, documentos: true },
    });
    if (!p) throw this.naoEncontrada();
    return this.calcPendencias(p.vinculos, p.documentos);
  }

  private naoEncontrada() {
    return new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Proposta não encontrada' });
  }
}
