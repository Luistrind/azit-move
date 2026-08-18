import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { gerarCronograma, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasService } from '../asaas/asaas.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';

const DIA_MS = 24 * 60 * 60 * 1000;
const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

export interface CriarRenegociacaoDto {
  valorEntrada: number; // centavos
  numeroParcelasNovas: number;
  valorParcelaNova: number; // centavos
  periodicidade?: 'semanal' | 'quinzenal' | 'mensal';
  // Seleção por FATURA (doc Acordo de Pagamento V1.0 RAP006).
  faturasExcluidas?: { faturaId: string; justificativa: string }[];
}

// Renegociação (Acordo) CONTA-CÊNTRICA — Doc 2 §7.7 (Decisão 2026-07-03): a fatura
// agrega todos os contratos, então a inadimplência é da conta. O acordo cobre as
// parcelas em atraso de TODOS os contratos numa única negociação, e internamente
// explode em ItemContratado ACORDO por contrato (preserva credor/recebível).
// Fluxo: propor (RASCUNHO) → motor de aprovação (§7.9-A) → cobrança da entrada
// (AGUARDANDO_ENTRADA) → pagamento via webhook (acordo:) → efetivar (ATIVO).
@Injectable()
export class RenegociacaoService implements OnModuleInit {
  private readonly logger = new Logger(RenegociacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
    private readonly aprovacao: AprovacaoService,
  ) {}

  onModuleInit() {
    this.aprovacao.registrarEfetivador('acordo', {
      aprovada: async (a) => this.cobrarEntrada(a.referenciaId),
      reprovada: async (a) => {
        await this.cancelar(a.referenciaId);
      },
    });
  }

  private hojeUTC(): Date {
    return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  }

  // Diagnóstico do atraso da CONTA: parcelas vencidas não cobertas, por contrato.
  async elegiveisConta(contaId: string) {
    const conta = await this.prisma.db.conta.findFirst({
      where: { id: contaId },
      select: {
        id: true,
        titularId: true,
        contratosCredito: {
          select: { id: true, numero: true, taxaMultaAtraso: true, taxaJurosAtraso: true, ativo: { select: { descricao: true } } },
        },
      },
    });
    if (!conta) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Conta não encontrada' });
    }

    const hoje = this.hojeUTC();
    const contratos = [];
    let valorTotal = 0;
    let valorNominalTotal = 0;
    for (const c of conta.contratosCredito) {
      const parcelas = await this.prisma.db.parcela.findMany({
        where: { contratoId: c.id, status: null, dataVencimento: { lt: hoje }, acordoId: null },
        orderBy: { numero: 'asc' },
        select: { id: true, display: true, dataVencimento: true, valorNominal: true, faturaId: true },
      });
      if (parcelas.length === 0) continue;
      // RAP007 (Acordo de Pagamento V1.0, regra fechada): o saldo do acordo é o
      // valor ATUALIZADO na data-base — multa e juros de mora herdados da regra
      // geral de cobrança do contrato (antes somávamos o nominal cru e
      // subestimávamos a dívida em toda simulação).
      const multaPct = Number(c.taxaMultaAtraso.toString()) / 100;
      const jurosMensalPct = Number(c.taxaJurosAtraso.toString()) / 100;
      const comMora = parcelas.map((p) => {
        const nominal = cent(p.valorNominal);
        const diasAtraso = Math.max(0, Math.floor((hoje.getTime() - p.dataVencimento.getTime()) / DIA_MS));
        const encargo = Math.round(nominal * multaPct + nominal * jurosMensalPct * (diasAtraso / 30));
        return { ...p, nominal, diasAtraso, encargo, atualizado: nominal + encargo };
      });
      const valorNominal = comMora.reduce((s, p) => s + p.nominal, 0);
      const valor = comMora.reduce((s, p) => s + p.atualizado, 0);
      valorTotal += valor;
      valorNominalTotal += valorNominal;
      contratos.push({
        contratoId: c.id,
        numero: c.numero,
        descricao: c.ativo.descricao,
        valor,
        valorNominal,
        encargosMora: valor - valorNominal,
        parcelas: comMora.map((p) => ({
          id: p.id,
          display: p.display,
          faturaId: p.faturaId,
          dataVencimento: p.dataVencimento.toISOString(),
          valorNominal: p.nominal,
          diasAtraso: p.diasAtraso,
          encargoMora: p.encargo,
          valorAtualizado: p.atualizado,
        })),
      });
    }

    // Visão por FATURA (doc Acordo de Pagamento V1.0 §2.3/RAP003-005): a unidade
    // de negociação é a fatura vencida — todas pré-selecionadas na tela.
    const porFatura = new Map<string, { valorNominal: number; encargosMora: number; valorAtualizado: number; itens: { display: string; contratoNumero: string; valorAtualizado: number }[] }>();
    for (const c of contratos) {
      for (const p of c.parcelas) {
        const chave = p.faturaId ?? 'sem_fatura';
        const f = porFatura.get(chave) ?? { valorNominal: 0, encargosMora: 0, valorAtualizado: 0, itens: [] };
        f.valorNominal += p.valorNominal;
        f.encargosMora += p.encargoMora;
        f.valorAtualizado += p.valorAtualizado;
        f.itens.push({ display: p.display, contratoNumero: c.numero, valorAtualizado: p.valorAtualizado });
        porFatura.set(chave, f);
      }
    }
    const faturaIds = [...porFatura.keys()].filter((k) => k !== 'sem_fatura');
    const metaFaturas = faturaIds.length
      ? await this.prisma.db.fatura.findMany({ where: { id: { in: faturaIds } }, select: { id: true, numero: true, dataVencimento: true } })
      : [];
    const faturas = [...porFatura.entries()]
      .map(([faturaId, f]) => {
        const meta = metaFaturas.find((m) => m.id === faturaId);
        return {
          faturaId,
          numero: meta?.numero ?? null,
          dataVencimento: meta?.dataVencimento?.toISOString() ?? null,
          ...f,
        };
      })
      .sort((a, b) => (a.dataVencimento ?? '').localeCompare(b.dataVencimento ?? ''));

    const faturasVencidas = await this.prisma.db.fatura.count({
      where: {
        contaId,
        dataVencimento: { lt: hoje },
        status: { in: ['ABERTA', 'FECHADA', 'VENCIDA'] },
      },
    });

    return { contaId, titularId: conta.titularId, contratos, faturas, valorTotal, valorNominalTotal, encargosMoraTotal: valorTotal - valorNominalTotal, faturasVencidas };
  }

  // Propõe o acordo da conta → solicitação no motor de aprovação (sem gate de alçada
  // na criação: propor e aprovar são atos distintos — Doc 2 §7.9-A).
  async criarPorConta(contaId: string, dto: CriarRenegociacaoDto, operadorId: string) {
    const eleg = await this.elegiveisConta(contaId);

    // Seleção por FATURA (doc V1.0 RAP005/006): todas as vencidas entram por
    // padrão; excluir exige justificativa auditável. A seleção fica congelada
    // no snapshot e vale na efetivação.
    const exclusoes = dto.faturasExcluidas ?? [];
    const idsElegiveis = new Set(eleg.faturas.map((f) => f.faturaId));
    for (const ex of exclusoes) {
      if (!idsElegiveis.has(ex.faturaId)) {
        throw new UnprocessableEntityException({
          erro: 'fatura_invalida',
          mensagem: 'Uma das faturas excluídas não está entre as faturas vencidas elegíveis desta conta',
        });
      }
    }
    const excluidas = new Set(exclusoes.map((e) => e.faturaId));
    if (excluidas.size > 0 && excluidas.size >= eleg.faturas.length) {
      throw new UnprocessableEntityException({
        erro: 'selecao_vazia',
        mensagem: 'Todas as faturas foram excluídas — não há o que renegociar',
      });
    }
    const faturasSelecionadas = eleg.faturas.filter((f) => !excluidas.has(f.faturaId));
    const valorTotal = faturasSelecionadas.reduce((s, f) => s + f.valorAtualizado, 0);

    if (valorTotal <= 0) {
      throw new UnprocessableEntityException({
        erro: 'nada_a_renegociar',
        mensagem: 'Não há obrigações em atraso para renegociar nesta conta',
      });
    }
    if (dto.valorEntrada >= valorTotal) {
      throw new UnprocessableEntityException({
        erro: 'validacao',
        mensagem: 'A entrada não pode cobrir o total — quite as faturas em vez de renegociar',
      });
    }
    // Trava anti-parcela-negativa (E2E 17/08; interim até o motor Price do doc
    // Acordo de Pagamento V1.0/RAP031): o resíduo cai na ÚLTIMA parcela e ela
    // não pode ficar <= 0 quando o plano informado excede a dívida.
    const saldoAParcelar = valorTotal - dto.valorEntrada;
    const ultimaParcela = saldoAParcelar - (dto.numeroParcelasNovas - 1) * dto.valorParcelaNova;
    if (ultimaParcela <= 0) {
      const sugerida = Math.floor(saldoAParcelar / dto.numeroParcelasNovas);
      throw new UnprocessableEntityException({
        erro: 'plano_excede_divida',
        mensagem: `O plano informado excede a dívida: com ${dto.numeroParcelasNovas} parcelas de R$ ${reais(dto.valorParcelaNova)}, a última ficaria negativa. Para ${dto.numeroParcelasNovas} parcelas, use até ~R$ ${reais(sugerida)} por parcela (o resíduo ajusta na última).`,
      });
    }

    const periodicidade = (
      { semanal: 'SEMANAL', quinzenal: 'QUINZENAL', mensal: 'MENSAL' } as const
    )[dto.periodicidade ?? 'semanal'];

    // Fotografia da proposta (RAP034): saldos na data-base, seleção e exclusões.
    const snapshot = {
      dataBase: new Date().toISOString(),
      faturasSelecionadas: faturasSelecionadas.map((f) => f.faturaId),
      exclusoes,
      totais: {
        valorNominal: faturasSelecionadas.reduce((s, f) => s + f.valorNominal, 0),
        encargosMora: faturasSelecionadas.reduce((s, f) => s + f.encargosMora, 0),
        valorAtualizado: valorTotal,
      },
      moraHerdada: 'multa e juros da regra geral do contrato na data-base (RAP007)',
    };

    const acordo = await this.prisma.db.acordo.create({
      data: {
        contaId,
        operadorId,
        valorTotalRenegociado: reais(valorTotal),
        valorEntrada: reais(dto.valorEntrada),
        numeroParcelasNovas: dto.numeroParcelasNovas,
        valorParcelaNova: reais(dto.valorParcelaNova),
        periodicidade,
        snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    await this.aprovacao.criar({
      tipoOperacao: 'acordo',
      referenciaTipo: 'acordo',
      referenciaId: acordo.id,
      titularId: eleg.titularId,
      valorCentavos: eleg.valorTotal,
      resumo: `Renegociação de ${eleg.contratos.length} contrato(s) — entrada R$ ${reais(dto.valorEntrada)} + ${dto.numeroParcelasNovas}× R$ ${reais(dto.valorParcelaNova)}`,
      solicitanteId: operadorId,
    });

    return {
      id: acordo.id,
      status: 'aguardando_aprovacao',
      valorTotalRenegociado: valorTotal,
      faturasSelecionadas: faturasSelecionadas.length,
      contratosAfetados: eleg.contratos.length,
    };
  }

  // Efetivação da APROVAÇÃO: gera a cobrança da entrada (aceite formal = pagamento).
  private async cobrarEntrada(acordoId: string): Promise<string> {
    const acordo = await this.prisma.db.acordo.findFirst({
      where: { id: acordoId },
      include: {
        conta: {
          select: {
            titular: { select: { nome: true, asaasCustomerId: true } },
          },
        },
      },
    });
    if (!acordo || acordo.status !== 'RASCUNHO') {
      return 'Acordo não está aguardando aprovação.';
    }
    const cobranca = await this.asaas.criarCobranca({
      externalReference: `acordo:${acordo.id}`,
      valor: cent(acordo.valorEntrada),
      vencimento: new Date(Date.now() + 3 * DIA_MS),
      descricao: `Entrada renegociação — ${acordo.conta.titular.nome}`,
      customerId: acordo.conta.titular.asaasCustomerId ?? undefined,
    });
    await this.prisma.db.acordo.update({
      where: { id: acordo.id },
      data: { status: 'AGUARDANDO_ENTRADA', asaasChargeIdEntrada: cobranca.id },
    });
    return 'Acordo aprovado — cobrança da entrada gerada; o pagamento efetiva o plano.';
  }

  private async cancelar(acordoId: string) {
    await this.prisma.db.acordo.updateMany({
      where: { id: acordoId, status: 'RASCUNHO' },
      data: { status: 'CANCELADO' },
    });
  }

  // Efetivação via webhook da entrada (Gatilho 6). Conta-cêntrico: cobre as parcelas
  // vencidas de TODOS os contratos e explode o plano novo por contrato.
  async efetivar(acordoId: string, paymentDateISO: string) {
    const acordo = await this.prisma.db.acordo.findFirst({
      where: { id: acordoId },
      select: {
        id: true,
        contaId: true,
        status: true,
        valorTotalRenegociado: true,
        valorEntrada: true,
        numeroParcelasNovas: true,
        valorParcelaNova: true,
        periodicidade: true,
        snapshotJson: true,
      },
    });
    if (!acordo) return { resultado: 'acordo_nao_encontrado' };
    // RASCUNHO aceito por compat (acordos antigos cobravam a entrada na criação).
    if (acordo.status !== 'AGUARDANDO_ENTRADA' && acordo.status !== 'RASCUNHO') {
      return { resultado: 'ja_efetivado' };
    }

    const hoje = this.hojeUTC();
    // Seleção por fatura congelada no snapshot (RAP005/034): quando existir, a
    // cobertura fica restrita às faturas selecionadas; acordos antigos (sem
    // snapshot) mantêm o comportamento de cobrir todas as vencidas.
    const snap = acordo.snapshotJson as null | { faturasSelecionadas?: string[] };
    const filtroFatura = snap?.faturasSelecionadas?.length
      ? { faturaId: { in: snap.faturasSelecionadas } }
      : {};
    // Parcelas vencidas não cobertas, agrupadas por contrato da conta.
    const contratos = await this.prisma.db.contratoCredito.findMany({
      where: { contaId: acordo.contaId },
      select: { id: true, numero: true, ativoId: true },
    });
    const porContrato: {
      contratoId: string;
      atraso: number;
      origemCapitalId: string;
      faturaIds: string[];
    }[] = [];
    for (const c of contratos) {
      const parcelas = await this.prisma.db.parcela.findMany({
        where: { contratoId: c.id, status: null, dataVencimento: { lt: hoje }, acordoId: null, ...filtroFatura },
        select: { valorNominal: true, faturaId: true },
      });
      if (parcelas.length === 0) continue;
      const origem = await this.prisma.db.origemCapital.findFirst({
        where: { ativoId: c.ativoId },
        select: { id: true },
      });
      if (!origem) return { resultado: 'origem_capital_ausente', contrato: c.numero };
      porContrato.push({
        contratoId: c.id,
        atraso: parcelas.reduce((s, p) => s + cent(p.valorNominal), 0),
        origemCapitalId: origem.id,
        faturaIds: parcelas.map((p) => p.faturaId).filter((x): x is string => !!x),
      });
    }
    if (porContrato.length === 0) return { resultado: 'nada_a_renegociar' };

    const totalAtraso = porContrato.reduce((s, c) => s + c.atraso, 0);
    const saldoNovo = cent(acordo.valorTotalRenegociado) - cent(acordo.valorEntrada);
    const periodicidadeApi = (
      { SEMANAL: 'semanal', QUINZENAL: 'quinzenal', MENSAL: 'mensal' } as const
    )[acordo.periodicidade];
    const passo = periodicidadeApi === 'mensal' ? 30 : periodicidadeApi === 'quinzenal' ? 14 : 7;
    const dataEfetivacao = new Date(paymentDateISO || new Date().toISOString());
    const dataPrimeira = new Date(dataEfetivacao.getTime() + passo * DIA_MS);

    // Rateio proporcional ao atraso de cada contrato; o último absorve o resíduo.
    let acumuladoSaldo = 0;
    let acumuladoParcela = 0;
    const planos = porContrato.map((c, i) => {
      const ultimo = i === porContrato.length - 1;
      const share = c.atraso / totalAtraso;
      const valorItem = ultimo ? saldoNovo - acumuladoSaldo : Math.round(saldoNovo * share);
      const valorParcela = ultimo
        ? cent(acordo.valorParcelaNova) - acumuladoParcela
        : Math.round(cent(acordo.valorParcelaNova) * share);
      acumuladoSaldo += valorItem;
      acumuladoParcela += valorParcela;
      return {
        ...c,
        valorItem,
        cronograma: gerarCronograma({
          numeroParcelas: acordo.numeroParcelasNovas,
          valorParcela,
          valorTotal: valorItem,
          dataPrimeiraParcela: dataPrimeira,
          periodicidade: periodicidadeApi,
        }),
      };
    });

    await this.prisma.db.$transaction(async (tx) => {
      // 1. Vínculo de acordo nas parcelas cobertas + faturas antigas RENEGOCIADAS.
      for (const c of porContrato) {
        await tx.parcela.updateMany({
          where: { contratoId: c.contratoId, status: null, dataVencimento: { lt: hoje }, acordoId: null, ...filtroFatura },
          data: { acordoId: acordo.id },
        });
      }
      const faturaIds = [...new Set(porContrato.flatMap((c) => c.faturaIds))];
      if (faturaIds.length) {
        await tx.fatura.updateMany({
          where: { id: { in: faturaIds }, status: { notIn: ['PAGA', 'PAGA_EM_ATRASO'] } },
          data: { status: 'RENEGOCIADA', acordoId: acordo.id },
        });
      }

      // 2. Explosão por contrato: item ACORDO + parcelas novas + recebíveis.
      const parcelasPorVencimento = new Map<
        number,
        { parcelaId: string; display: string; valor: number }[]
      >();
      for (const plano of planos) {
        const item = await tx.itemContratado.create({
          data: {
            contratoId: plano.contratoId,
            descricao: 'Crédito de acordo',
            natureza: 'PARCELADO',
            origem: 'ACORDO',
            acordoOrigemId: acordo.id,
            credor: 'AZIT',
            valor: reais(plano.valorItem),
            numeroParcelas: acordo.numeroParcelasNovas,
            periodicidade: acordo.periodicidade,
            dataInicio: dataPrimeira,
          },
        });
        for (const cron of plano.cronograma) {
          const parcela = await tx.parcela.create({
            data: {
              contratoId: plano.contratoId,
              itemContratadoId: item.id,
              numero: cron.numero,
              totalParcelas: cron.totalParcelas,
              display: cron.display,
              valorNominal: reais(cron.valorNominal),
              dataVencimento: cron.dataVencimento,
            },
          });
          await tx.recebivel.create({
            data: {
              contratoId: plano.contratoId,
              parcelaId: parcela.id,
              origemCapitalId: plano.origemCapitalId,
              dataPrevista: cron.dataVencimento,
              valorPrevisto: reais(cron.valorNominal),
            },
          });
          const chave = cron.dataVencimento.getTime();
          const grupo = parcelasPorVencimento.get(chave) ?? [];
          grupo.push({ parcelaId: parcela.id, display: cron.display, valor: cron.valorNominal });
          parcelasPorVencimento.set(chave, grupo);
        }
      }

      // 3. Consolidação (Doc 2 §7.7 + reunião 04/07): cada grupo de parcelas entra na
      //    PRÓXIMA fatura ABERTA da conta (venc >= parcela, janela 35d) — renegociação
      //    NÃO gera fatura paralela; só cria quando não há ciclo aberto à frente.
      let seqFatura = await tx.fatura.count({ where: { contaId: acordo.contaId } });
      const vencimentos = [...parcelasPorVencimento.keys()].sort((a, b) => a - b);
      for (const venc of vencimentos) {
        const grupo = parcelasPorVencimento.get(venc)!;
        const dataVenc = new Date(venc);
        const valorFatura = grupo.reduce((s, g) => s + g.valor, 0);
        let fatura = await tx.fatura.findFirst({
          where: {
            contaId: acordo.contaId,
            status: 'ABERTA',
            dataVencimento: { gte: dataVenc, lt: new Date(venc + 35 * DIA_MS) },
          },
          orderBy: { dataVencimento: 'asc' },
          select: { id: true, valorTotal: true },
        });
        if (fatura) {
          await tx.fatura.update({
            where: { id: fatura.id },
            data: { valorTotal: reais(cent(fatura.valorTotal as Prisma.Decimal) + valorFatura) },
          });
        } else {
          seqFatura += 1;
          fatura = await tx.fatura.create({
            data: {
              contaId: acordo.contaId,
              numero: seqFatura,
              periodoReferencia: dataVenc,
              dataFechamento: new Date(venc - 5 * DIA_MS),
              dataVencimento: dataVenc,
              valorTotal: reais(valorFatura),
              status: 'ABERTA',
            },
            select: { id: true, valorTotal: true },
          });
        }
        for (const g of grupo) {
          await tx.itemFatura.create({
            data: {
              faturaId: fatura.id,
              parcelaId: g.parcelaId,
              tipo: 'PRINCIPAL',
              descricao: `Renegociação parcela ${g.display}`,
              valor: reais(g.valor),
              credor: 'AZIT',
            },
          });
          await tx.parcela.update({ where: { id: g.parcelaId }, data: { faturaId: fatura.id } });
        }
      }

      // 4. Acordo -> ATIVO. Contratos NÃO são liquidados (recuperação branda); o
      //    cliente segue inadimplente (contábil) até cumprir o acordo (Doc 2 §7.7).
      await tx.acordo.update({
        where: { id: acordo.id },
        data: { status: 'ATIVO', dataEfetivacao },
      });
    });

    this.logger.log(
      `Acordo ${acordoId} efetivado: ${planos.length} contrato(s), ${acordo.numeroParcelasNovas} parcela(s) nova(s)`,
    );
    return { resultado: 'efetivado', contratos: planos.length, parcelasNovas: acordo.numeroParcelasNovas };
  }

  // Lista de acordos (acompanhamento).
  async listar() {
    const acordos = await this.prisma.db.acordo.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        conta: { select: { titular: { select: { id: true, nome: true } } } },
        contrato: { select: { numero: true } },
        itensGerados: { select: { contratoId: true } },
      },
    });
    return acordos.map((a) => ({
      id: a.id,
      status: a.status.toLowerCase(),
      contratoNumero: a.contrato?.numero ?? `Conta (${new Set(a.itensGerados.map((i) => i.contratoId)).size || '—'} contratos)`,
      titularId: a.conta.titular.id,
      titular: a.conta.titular.nome,
      valorTotalRenegociado: cent(a.valorTotalRenegociado),
      valorEntrada: cent(a.valorEntrada),
      numeroParcelasNovas: a.numeroParcelasNovas,
      valorParcelaNova: cent(a.valorParcelaNova),
      dataCriacao: a.dataCriacao.toISOString(),
      dataEfetivacao: a.dataEfetivacao ? a.dataEfetivacao.toISOString() : null,
    }));
  }
}
