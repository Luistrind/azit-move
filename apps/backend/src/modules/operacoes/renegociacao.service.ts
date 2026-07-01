import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Periodicidade } from '@azit/types';
import { gerarCronograma, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasService } from '../asaas/asaas.service';
import { AlcadaService } from '../alcada/alcada.service';

const DIA_MS = 24 * 60 * 60 * 1000;
const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

export interface CriarRenegociacaoDto {
  valorEntrada: number; // centavos
  numeroParcelasNovas: number;
  valorParcelaNova: number; // centavos
}

@Injectable()
export class RenegociacaoService {
  private readonly logger = new Logger(RenegociacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
    private readonly alcada: AlcadaService,
  ) {}

  private hojeUTC(): Date {
    return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  }

  // 6.2 — Obrigações EM ATRASO elegíveis para acordo (não cobertas por outro acordo).
  // O Acordo dilui o que está vencido; parcelas futuras não entram.
  async elegiveis(contratoId: string) {
    const parcelas = await this.prisma.db.parcela.findMany({
      where: {
        contratoId,
        status: null,
        dataVencimento: { lt: this.hojeUTC() },
        acordoId: null,
      },
      orderBy: { numero: 'asc' },
      select: { id: true, display: true, dataVencimento: true, valorNominal: true },
    });
    const total = parcelas.reduce((s, p) => s + cent(p.valorNominal), 0);
    return {
      parcelas: parcelas.map((p) => ({
        id: p.id,
        display: p.display,
        dataVencimento: p.dataVencimento.toISOString(),
        valorNominal: cent(p.valorNominal),
      })),
      valorTotal: total,
    };
  }

  // 6.3 — Cria o acordo em RASCUNHO e gera a cobrança da entrada no Asaas.
  // Passa pela alçada (placeholder configurável).
  async criar(contratoId: string, dto: CriarRenegociacaoDto, operadorId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: {
        id: true, numero: true, taxaMultaAtraso: true, taxaJurosAtraso: true,
        conta: { select: { titular: { select: { asaasCustomerId: true } } } },
      },
    });
    if (!contrato) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    }

    const { valorTotal } = await this.elegiveis(contratoId);
    if (valorTotal <= 0) {
      throw new UnprocessableEntityException({
        erro: 'nada_a_renegociar',
        mensagem: 'Não há obrigações em aberto para renegociar',
      });
    }

    // Gate de alçada (Doc 6 §6 — estrutura configurável).
    const alcada = await this.alcada.verificar(operadorId, 'acordo', valorTotal);
    if (!alcada.aprovado) {
      throw new ForbiddenException({ erro: 'fora_da_alcada', mensagem: alcada.motivo });
    }

    const acordo = await this.prisma.db.acordo.create({
      data: {
        contratoId,
        operadorId,
        valorTotalRenegociado: reais(valorTotal),
        valorEntrada: reais(dto.valorEntrada),
        numeroParcelasNovas: dto.numeroParcelasNovas,
        valorParcelaNova: reais(dto.valorParcelaNova),
      },
    });

    // Cobrança da entrada (externalReference com prefixo acordo: roteia no webhook).
    const cobranca = await this.asaas.criarCobranca({
      externalReference: `acordo:${acordo.id}`,
      valor: dto.valorEntrada,
      vencimento: new Date(Date.now() + 3 * DIA_MS),
      descricao: `Entrada renegociação ${contrato.numero}`,
      customerId: contrato.conta?.titular?.asaasCustomerId ?? undefined,
      multaPct: Number(contrato.taxaMultaAtraso.toString()),
      jurosPct: Number(contrato.taxaJurosAtraso.toString()),
    });
    await this.prisma.db.acordo.update({
      where: { id: acordo.id },
      data: { asaasChargeIdEntrada: cobranca.id },
    });

    return { id: acordo.id, status: 'rascunho', valorTotalRenegociado: valorTotal, limiteAlcada: alcada.limiteMaximo };
  }

  // 6.4 — Efetivação via webhook da entrada (Gatilho 6): NOVAÇÃO.
  async efetivar(acordoId: string, paymentDateISO: string) {
    const acordo = await this.prisma.db.acordo.findFirst({
      where: { id: acordoId },
      include: {
        contrato: { select: { id: true, contaId: true, ativoId: true, periodicidade: true } },
      },
    });
    if (!acordo) return { resultado: 'acordo_nao_encontrado' };
    if (acordo.status !== 'RASCUNHO') return { resultado: 'ja_efetivado' };

    const origemCapital = await this.prisma.db.origemCapital.findFirst({
      where: { ativoId: acordo.contrato.ativoId },
      select: { id: true },
    });
    if (!origemCapital) return { resultado: 'origem_capital_ausente' };

    const dataEfetivacao = new Date(paymentDateISO || new Date().toISOString());
    const periodicidadeApi = Periodicidade[acordo.contrato.periodicidade];
    const saldoNovo = cent(acordo.valorTotalRenegociado) - cent(acordo.valorEntrada);
    const passo = periodicidadeApi === 'mensal' ? 30 : periodicidadeApi === 'quinzenal' ? 14 : 7;
    const dataPrimeira = new Date(dataEfetivacao.getTime() + passo * DIA_MS);

    const cronograma = gerarCronograma({
      numeroParcelas: acordo.numeroParcelasNovas,
      valorParcela: cent(acordo.valorParcelaNova),
      valorTotal: saldoNovo,
      dataPrimeiraParcela: dataPrimeira,
      periodicidade: periodicidadeApi,
    });

    const hoje = this.hojeUTC();
    await this.prisma.db.$transaction(async (tx) => {
      // 1. Parcelas EM ATRASO cobertas recebem VÍNCULO de acordo (acordoId) —
      //    NÃO o status RENEGOCIADA (Doc 2 §4.14). Ficam excluídas da cobrança
      //    pelo filtro acordoId. As faturas correspondentes vão a RENEGOCIADA.
      const cobertas = await tx.parcela.findMany({
        where: { contratoId: acordo.contrato.id, status: null, dataVencimento: { lt: hoje }, acordoId: null },
        select: { faturaId: true },
      });
      await tx.parcela.updateMany({
        where: { contratoId: acordo.contrato.id, status: null, dataVencimento: { lt: hoje }, acordoId: null },
        data: { acordoId: acordo.id },
      });
      const faturaIds = [...new Set(cobertas.map((p) => p.faturaId).filter((x): x is string => !!x))];
      if (faturaIds.length) {
        await tx.fatura.updateMany({
          where: { id: { in: faturaIds }, status: { notIn: ['PAGA', 'PAGA_EM_ATRASO'] } },
          data: { status: 'RENEGOCIADA', acordoId: acordo.id },
        });
      }

      // 2. ItemContratado NOVO de origem ACORDO (dono das parcelas novas).
      const item = await tx.itemContratado.create({
        data: {
          contratoId: acordo.contrato.id,
          descricao: 'Crédito de acordo',
          natureza: 'PARCELADO',
          origem: 'ACORDO',
          acordoOrigemId: acordo.id,
          credor: 'AZIT',
          valor: reais(saldoNovo),
          numeroParcelas: acordo.numeroParcelasNovas,
          periodicidade: acordo.contrato.periodicidade,
          dataInicio: dataPrimeira,
        },
      });

      // 3. Parcelas novas + faturas (dia zero) + recebíveis.
      await tx.parcela.createMany({
        data: cronograma.map((p) => ({
          contratoId: acordo.contrato.id,
          itemContratadoId: item.id,
          numero: p.numero,
          totalParcelas: p.totalParcelas,
          display: p.display,
          valorNominal: reais(p.valorNominal),
          dataVencimento: p.dataVencimento,
        })),
      });
      const novas = await tx.parcela.findMany({
        where: { itemContratadoId: item.id },
        select: { id: true, numero: true },
      });
      const porNumero = new Map(cronograma.map((p) => [p.numero, p]));
      await tx.recebivel.createMany({
        data: novas.map((pc) => {
          const cron = porNumero.get(pc.numero)!;
          return {
            contratoId: acordo.contrato.id,
            parcelaId: pc.id,
            origemCapitalId: origemCapital.id,
            dataPrevista: cron.dataVencimento,
            valorPrevisto: reais(cron.valorNominal),
          };
        }),
      });
      let seqFatura = await tx.fatura.count({ where: { contaId: acordo.contrato.contaId } });
      for (const pc of novas) {
        const cron = porNumero.get(pc.numero)!;
        seqFatura += 1;
        const fatura = await tx.fatura.create({
          data: {
            contaId: acordo.contrato.contaId,
            numero: seqFatura,
            periodoReferencia: cron.dataVencimento,
            dataFechamento: new Date(cron.dataVencimento.getTime() - 5 * DIA_MS),
            dataVencimento: cron.dataVencimento,
            valorTotal: reais(cron.valorNominal),
            status: 'ABERTA',
          },
        });
        await tx.itemFatura.create({
          data: {
            faturaId: fatura.id,
            parcelaId: pc.id,
            tipo: 'PRINCIPAL',
            descricao: `Renegociação parcela ${cron.display}`,
            valor: reais(cron.valorNominal),
            credor: 'AZIT',
          },
        });
        await tx.parcela.update({ where: { id: pc.id }, data: { faturaId: fatura.id } });
      }

      // 4. Acordo -> ATIVO. O contrato NÃO é liquidado nem volta a Ativo: o Acordo
      //    é recuperação branda; o cliente segue inadimplente (contábil) até cumprir
      //    o acordo (Doc 2 §4.14, §7.7).
      await tx.acordo.update({
        where: { id: acordo.id },
        data: { status: 'ATIVO', dataEfetivacao },
      });
    });

    this.logger.log(`Acordo ${acordoId} efetivado: ${cronograma.length} parcelas novas (contrato segue inadimplente)`);
    return { resultado: 'efetivado', parcelasNovas: cronograma.length };
  }

  // 6.5 — Lista de acordos.
  async listar() {
    const acordos = await this.prisma.db.acordo.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        contrato: {
          select: {
            numero: true,
            conta: { select: { titular: { select: { nome: true } } } },
          },
        },
      },
    });
    return acordos.map((a) => ({
      id: a.id,
      status: a.status.toLowerCase(),
      contratoNumero: a.contrato.numero,
      titular: a.contrato.conta.titular.nome,
      valorTotalRenegociado: cent(a.valorTotalRenegociado),
      valorEntrada: cent(a.valorEntrada),
      numeroParcelasNovas: a.numeroParcelasNovas,
      valorParcelaNova: cent(a.valorParcelaNova),
      dataCriacao: a.dataCriacao.toISOString(),
      dataEfetivacao: a.dataEfetivacao ? a.dataEfetivacao.toISOString() : null,
    }));
  }
}
