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
import { limparDocumento, reaisParaCentavos } from '@azit/utils';
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

    // Resolve o comprador principal (promoção do lead, se necessário).
    const titularId = await this.resolverTitular(simulacao.id, simulacao.titularId, simulacao.leadId, dto.comprador);

    const proposta = await this.prisma.db.proposta.create({
      data: {
        simulacaoId: simulacao.id,
        titularId,
        ativoId: simulacao.ativoId,
        modalidade: dto.modalidade.toUpperCase() as ModalidadeContrato,
        valorEntrada: oferta.valorEntrada,
        prazoSemanas: oferta.prazoSemanas,
        valorParcela: oferta.valorParcela,
        numeroParcelas: oferta.numeroParcelas,
        status: 'PENDENTE',
        vinculos: {
          create: { titularId, papel: 'COMPRADOR_PRINCIPAL' },
        },
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
    await this.prisma.db.documentoProposta.create({
      data: {
        propostaId,
        titularId: dto.titularId,
        tipo: dto.tipo.toUpperCase() as TipoDocumentoProposta,
        arquivoRef: dto.arquivoRef,
      },
    });
    return this.detalhe(propostaId);
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
    const aprovada = dto.resultado !== 'reprovado';
    await this.prisma.db.$transaction(async (tx) => {
      await tx.parecer.upsert({
        where: { propostaId },
        create: {
          propostaId,
          resultado: dto.resultado.toUpperCase() as ResultadoParecer,
          motivoReprovacao: dto.motivoReprovacao,
          exigeGarantidor: dto.exigeGarantidor,
          analistaId,
        },
        update: {
          resultado: dto.resultado.toUpperCase() as ResultadoParecer,
          motivoReprovacao: dto.motivoReprovacao,
          exigeGarantidor: dto.exigeGarantidor,
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
      },
    });
    if (!p) throw this.naoEncontrada();
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
          }
        : null,
    };
  }

  private naoEncontrada() {
    return new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Proposta não encontrada' });
  }
}
