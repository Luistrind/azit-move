import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, StatusContratoCredito } from '@prisma/client';
import { centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { ContratoService } from '../contrato/contrato.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { NovacaoBody } from './dto/novacao.dto';

const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

const TERMINAIS: StatusContratoCredito[] = [
  'LIQUIDADO_POR_NOVACAO',
  'CANCELADO',
  'RESCINDIDO',
  'QUITADO_AGUARDANDO_TRANSFERENCIA',
  'QUITADO_TRANSFERENCIA_EFETIVADA',
];

// 6.6 — Novação (recuperação RADICAL): liquida o ContratoCredito origem inteiro
// (LIQUIDADO_POR_NOVACAO) e gera um ContratoCredito novo completo. Passa pelo motor
// de aprovação (Doc 2 §7.9-A) — operação mais sensível: exige 2 aprovações (config).
// Os termos ficam no payload da solicitação e são executados na efetivação.
@Injectable()
export class NovacaoService implements OnModuleInit {
  private readonly logger = new Logger(NovacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contrato: ContratoService,
    private readonly aprovacao: AprovacaoService,
  ) {}

  onModuleInit() {
    this.aprovacao.registrarEfetivador('novacao', {
      aprovada: async (a) => {
        const payload = a.payload as NovacaoBody & {
          dataAssinatura?: string;
          dataPrimeiraParcela: string;
        };
        const r = await this.executar(
          a.referenciaId,
          {
            ...payload,
            dataAssinatura: payload.dataAssinatura ? new Date(payload.dataAssinatura) : undefined,
            dataPrimeiraParcela: new Date(payload.dataPrimeiraParcela),
          } as NovacaoBody,
          a.decisorId,
        );
        return `Novação efetivada: contrato ${r.contratoOrigem} liquidado → novo ${r.contratoNovo}.`;
      },
    });
  }

  // Propõe a novação: valida e abre a solicitação (termos no payload). Nada é
  // liquidado aqui — propor e aprovar são atos distintos (§7.9-A).
  async solicitar(contratoOrigemId: string, dto: NovacaoBody, operadorId: string) {
    const origem = await this.validarOrigem(contratoOrigemId);
    const saldoLiquidado = await this.saldoALiquidar(origem.id);

    const conta = await this.prisma.db.conta.findFirst({
      where: { id: origem.contaId },
      select: { titularId: true },
    });

    await this.aprovacao.criar({
      tipoOperacao: 'novacao',
      referenciaTipo: 'contrato_credito',
      referenciaId: origem.id,
      titularId: conta?.titularId,
      valorCentavos: saldoLiquidado,
      resumo: `Novação do contrato ${origem.numero} — novo plano de ${dto.numeroParcelas}× R$ ${reais(dto.valorParcelaInicial)}`,
      payload: dto,
      solicitanteId: operadorId,
    });

    return {
      contratoOrigem: origem.numero,
      status: 'aguardando_aprovacao',
      saldoLiquidado,
    };
  }

  // Execução (chamada pelo motor ao completar as aprovações).
  private async executar(contratoOrigemId: string, dto: NovacaoBody, operadorId: string) {
    const origem = await this.validarOrigem(contratoOrigemId);
    const saldoLiquidado = await this.saldoALiquidar(origem.id);

    // 1. Liquida o contrato origem (terminal). Feito ANTES de criar o novo para
    //    liberar o ativo na regra "1 ativo = 1 contrato ATIVO".
    await this.prisma.db.contratoCredito.update({
      where: { id: origem.id },
      data: { status: 'LIQUIDADO_POR_NOVACAO', dataEncerramento: new Date() },
    });

    // 2. Cria o contrato novo (mesmo titular/conta e ativo) reusando o núcleo.
    const novo = await this.contrato.criar({
      contaId: origem.contaId,
      ativoId: origem.ativoId,
      numero: undefined,
      dataAssinatura: dto.dataAssinatura ?? new Date(),
      dataPrimeiraParcela: dto.dataPrimeiraParcela,
      valorTotal: dto.valorTotal,
      valorEntrada: dto.valorEntrada,
      numeroParcelas: dto.numeroParcelas,
      valorParcelaInicial: dto.valorParcelaInicial,
      periodicidade: dto.periodicidade,
      descricaoFinanciamento: 'Parcelamento do veículo (novação)',
      credor: 'azit',
    });

    // 3. Registro de Novação vinculando origem e novo.
    const novacao = await this.prisma.db.novacao.create({
      data: {
        contratoOrigemId: origem.id,
        contratoNovoId: novo.id,
        operadorId,
        saldoLiquidado: reais(saldoLiquidado),
        status: 'ATIVO',
        dataEfetivacao: new Date(),
        observacao: dto.observacao,
      },
    });

    this.logger.warn(
      `Novação ${novacao.id}: contrato ${origem.numero} liquidado -> novo ${novo.numero} (saldo liquidado ${saldoLiquidado}c)`,
    );
    return {
      id: novacao.id,
      contratoOrigem: origem.numero,
      contratoNovo: novo.numero,
      contratoNovoId: novo.id,
      saldoLiquidado,
    };
  }

  private async validarOrigem(contratoOrigemId: string) {
    const origem = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoOrigemId },
      select: { id: true, numero: true, contaId: true, ativoId: true, status: true },
    });
    if (!origem) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    }
    if (TERMINAIS.includes(origem.status)) {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: `Contrato em estado terminal (${origem.status}) não pode ser novado`,
      });
    }
    return origem;
  }

  // Saldo a liquidar = parcelas em aberto não cobertas por acordo.
  private async saldoALiquidar(contratoId: string): Promise<number> {
    const saldo = await this.prisma.db.parcela.aggregate({
      where: { contratoId, status: null, acordoId: null },
      _sum: { valorNominal: true },
    });
    return cent(saldo._sum.valorNominal);
  }

  async listar() {
    const novacoes = await this.prisma.db.novacao.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        contratoOrigem: { select: { numero: true } },
        contratoNovo: { select: { numero: true } },
      },
    });
    return novacoes.map((n) => ({
      id: n.id,
      status: n.status.toLowerCase(),
      contratoOrigem: n.contratoOrigem.numero,
      contratoNovo: n.contratoNovo.numero,
      saldoLiquidado: cent(n.saldoLiquidado),
      dataEfetivacao: n.dataEfetivacao ? n.dataEfetivacao.toISOString() : null,
    }));
  }
}
