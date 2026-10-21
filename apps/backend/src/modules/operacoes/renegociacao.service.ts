import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  gerarCronograma,
  centavosParaReaisString,
  formatCurrency,
  precificarAcordoPagamento,
  diasAtrasoCalendario,
  inicioHojeBrasilUTC,
  calcularEncargoAtraso,
  dataCalendarioUTC,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasService } from '../asaas/asaas.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { CatalogoFonteService } from '../catalogo/catalogo-fonte.service';
import { parcelaParaApi } from '../contrato/contrato.mapper';

const DIA_MS = 24 * 60 * 60 * 1000;
const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

// Fotografia gravada na proposta (RAP034) — acordos nativos. Os de origem LEGADO
// (migração declarada, doc 02 §26.15) gravam só `legado`.
type SnapshotAcordo = {
  dataBase?: string;
  faturasSelecionadas?: string[];
  exclusoes?: { faturaId: string; justificativa: string }[];
  vincendasIncluidas?: string[];
  totais?: { valorNominal: number; encargosMora: number; valorAtualizado: number };
  moraHerdada?: string;
  calculo?: {
    motor: 'catalogo' | 'placeholder';
    periodicidade: string;
    saldoNegociado: number;
    entradaMinima: number;
    taxaInicial: number;
    tpFinanciada?: number;
    amortizacaoEntrada?: number;
    taxaPeriodo: number;
    encargoMensal?: number;
    saldoAParcelar: number;
    valorParcela: number;
    valorMinimoParcela?: number;
    totalAPagar: number;
    excecoes: string[];
  };
  dataLimiteEntrada?: string;
  dataPagamentoEntrada?: string; // retrocompat (acordos antigos)
  aceiteWhatsapp?: { confirmadoPeloOperadorEm: string };
  termo?: string; // termo de confissão dos acordos anteriores a 09/09 (histórico)
  legado?: { casoId: string; parcelasCobertas: number[]; primeiraEm: string; ultimaEm: string; declarado?: boolean };
};

// Evento da trilha do acordo (tela Renegociações, 21/10): texto humano, sem id.
export interface EventoTrilha {
  em: string | null; // ISO do instante (null = sem data registrada)
  titulo: string;
  por: string | null;
  detalhe: string | null;
}

const LABEL_PERIODICIDADE = { SEMANAL: 'semanal', QUINZENAL: 'quinzenal', MENSAL: 'mensal' } as const;
const PARCELA_PAGA_LABELS = new Set(['Paga', 'Paga em atraso', 'Paga antecipada']);

const ordenarTrilha = (t: EventoTrilha[]) =>
  [...t].sort((a, b) => (a.em ?? '9999').localeCompare(b.em ?? '9999'));

export interface CriarRenegociacaoDto {
  valorEntrada: number; // centavos
  numeroParcelasNovas: number;
  valorParcelaNova?: number; // centavos — ignorado com motor do Catálogo ativo (RAP031)
  periodicidade?: 'semanal' | 'quinzenal' | 'mensal'; // ignorada com motor ativo (herdada)
  dataLimiteEntrada?: string; // 'YYYY-MM-DD' — data-LIMITE dura da entrada (Vocabulário 07/09: é vencimento, não pagamento)
  // Seleção por FATURA (doc Acordo de Pagamento V1.0 RAP006).
  faturasExcluidas?: { faturaId: string; justificativa: string }[];
  // Faturas VINCENDAS incluídas por opção do operador (decisão Luís 2026-08-30):
  // divergência consciente com o RAP003 (somente vencidas) — aumenta a entrada
  // mínima e antecipa a segurança do pagamento. Opt-in, nunca automático.
  faturasVincendasIncluidas?: string[];
  // De acordo do cliente via WhatsApp (doc 02 §7.7, 2026-09-09) — obrigatório.
  aceiteWhatsapp?: boolean;
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
    private readonly catalogoFonte: CatalogoFonteService,
  ) {}

  // Frequência HERDADA do contrato principal da conta (doc 02 §7.7, 2026-08-18):
  // o acordo pega o ritmo das faturas — o operador não escolhe mais.
  private async frequenciaHerdada(contaId: string): Promise<'semanal' | 'quinzenal' | 'mensal'> {
    const principal = await this.prisma.db.contratoCredito.findFirst({
      where: { contaId, status: 'ATIVO' },
      orderBy: { createdAt: 'asc' },
      select: { periodicidade: true },
    });
    return principal?.periodicidade === 'MENSAL' ? 'mensal' : principal?.periodicidade === 'QUINZENAL' ? 'quinzenal' : 'semanal';
  }

  // Seleção por fatura aplicada ao elegível (RAP005/006) — comum a simular/criar.
  // Vincendas incluídas (opt-in, 2026-08-30) entram sem mora, pelo nominal.
  private aplicarSelecao(
    eleg: Awaited<ReturnType<RenegociacaoService['elegiveisConta']>>,
    exclusoes: { faturaId: string; justificativa: string }[],
    vincendasIncluidas: string[] = [],
  ) {
    const idsElegiveis = new Set(eleg.faturas.map((f) => f.faturaId));
    for (const ex of exclusoes) {
      if (!idsElegiveis.has(ex.faturaId)) {
        throw new UnprocessableEntityException({
          erro: 'fatura_invalida',
          mensagem: 'Uma das faturas excluídas não está entre as faturas vencidas elegíveis desta conta',
        });
      }
    }
    const idsProximas = new Set(eleg.faturasProximas.map((f) => f.faturaId));
    for (const id of vincendasIncluidas) {
      if (!idsProximas.has(id)) {
        throw new UnprocessableEntityException({
          erro: 'fatura_invalida',
          mensagem: 'Uma das faturas vincendas incluídas não está entre as próximas faturas da conta',
        });
      }
    }
    const excluidas = new Set(exclusoes.map((e) => e.faturaId));
    const vencidasSel = eleg.faturas.filter((f) => !excluidas.has(f.faturaId));
    const vincendasSel = eleg.faturasProximas.filter((f) => vincendasIncluidas.includes(f.faturaId));
    const faturasSelecionadas = [...vencidasSel, ...vincendasSel];
    if (faturasSelecionadas.length === 0) {
      throw new UnprocessableEntityException({
        erro: 'selecao_vazia',
        mensagem: 'Todas as faturas foram excluídas — não há o que renegociar',
      });
    }
    const valorTotal = faturasSelecionadas.reduce((s, f) => s + f.valorAtualizado, 0);
    return { faturasSelecionadas, valorTotal };
  }

  // Prévia do acordo (RAP031: o servidor é a fonte de verdade dos números).
  // Motor do Catálogo (produto acordo_pagamento ATIVO): TP + TR Price + entrada
  // mínima + frequência herdada. Em RASCUNHO: placeholder (divisão simples).
  async simularConta(
    contaId: string,
    dto: { valorEntrada: number; numeroParcelas: number; faturasExcluidas?: { faturaId: string; justificativa: string }[]; faturasVincendasIncluidas?: string[] },
  ) {
    const eleg = await this.elegiveisConta(contaId);
    const { valorTotal } = this.aplicarSelecao(eleg, dto.faturasExcluidas ?? [], dto.faturasVincendasIncluidas ?? []);
    const periodicidade = await this.frequenciaHerdada(contaId);
    const params = await this.catalogoFonte.acordoPagamento();
    if (!params) {
      const saldo = Math.max(0, valorTotal - dto.valorEntrada);
      const parcela = dto.numeroParcelas > 0 ? Math.round(saldo / dto.numeroParcelas) : 0;
      return {
        motor: 'placeholder' as const,
        periodicidade,
        saldoNegociado: valorTotal,
        entradaMinima: 0,
        taxaInicial: 0,
        taxaPeriodo: 0,
        saldoAParcelar: saldo,
        valorParcela: parcela,
        totalAPagar: dto.valorEntrada + parcela * dto.numeroParcelas,
        excecoes: [] as string[],
      };
    }
    const r = precificarAcordoPagamento({
      saldoNegociado: valorTotal,
      valorEntrada: dto.valorEntrada,
      numeroParcelas: dto.numeroParcelas,
      frequencia: periodicidade,
      encargoMensal: params.encargoMensal,
      taxaInicialPct: params.taxaInicialPct,
      entradaMinimaPct: params.entradaMinimaPct,
    });
    const maxParcelasPadrao = this.catalogoFonte.maxParcelasReembolso(params.prazoMaximoPadraoMeses, periodicidade);
    const excecoes: string[] = [];
    if (dto.valorEntrada < r.entradaMinima) excecoes.push(`entrada abaixo do mínimo de ${(params.entradaMinimaPct * 100).toFixed(0)}% (R$ ${reais(r.entradaMinima)})`);
    if (dto.numeroParcelas > maxParcelasPadrao) excecoes.push(`prazo acima do padrão de ${params.prazoMaximoPadraoMeses} meses (${maxParcelasPadrao} parcelas ${periodicidade}s)`);
    return {
      motor: 'catalogo' as const,
      periodicidade,
      saldoNegociado: valorTotal,
      entradaMinima: r.entradaMinima,
      taxaInicial: r.taxaInicial,
      tpFinanciada: r.tpFinanciada,
      amortizacaoEntrada: r.amortizacaoEntrada,
      taxaPeriodo: r.taxaPeriodo,
      encargoMensal: params.encargoMensal,
      saldoAParcelar: r.saldoAParcelar,
      valorParcela: r.valorParcela,
      valorMinimoParcela: params.valorMinimoParcela,
      totalAPagar: r.totalAPagar,
      excecoes,
    };
  }

  onModuleInit() {
    this.aprovacao.registrarEfetivador('acordo', {
      aprovada: async (a) => this.cobrarEntrada(a.referenciaId),
      reprovada: async (a) => {
        await this.cancelar(a.referenciaId);
      },
    });
  }

  private hojeUTC(): Date {
    return inicioHojeBrasilUTC(); // fuso do negócio (correção 30/08)
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
        // Dias de CALENDÁRIO (correção 31/08) — venceu ontem = 1 dia de mora.
        const diasAtraso = diasAtrasoCalendario(p.dataVencimento);
        // Fonte ÚNICA da fórmula (Bloco C da auditoria, P2-16): mesmo cálculo
        // da fatura/novação — antes era reimplementada aqui.
        const encargo = Math.round(
          calcularEncargoAtraso(nominal, diasAtraso, multaPct * 100, jurosMensalPct * 100),
        );
        return { ...p, nominal, diasAtraso, encargo, atualizado: nominal + encargo };
      });
      const valorNominal = comMora.reduce((s, p) => s + p.nominal, 0);
      const valor = comMora.reduce((s, p) => s + p.atualizado, 0);
      valorTotal += valor;
      valorNominalTotal += valorNominal;
      contratos.push({
        contratoId: c.id,
        numero: c.numero,
        descricao: c.ativo?.descricao ?? 'Reembolso Parcelado', // sem ativo = RP (12/09)
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
        status: { in: ['ABERTA', 'FECHADA'] },
      },
    });

    // Fatura VINCENDA: só a PRÓXIMA a vencer pode entrar (revisão 09/09 — a
    // janela de 35 dias pegava ~5 faturas no ritmo semanal). Opt-in na tela,
    // desmarcada por padrão; entra pelo nominal, sem mora. Divergência
    // consciente com o RAP003 do doc V1.0, registrada no doc 02 §7.7.
    const contratoIds = conta.contratosCredito.map((c) => c.id);
    const proximas = await this.prisma.db.fatura.findMany({
      where: {
        contaId,
        status: { in: ['ABERTA', 'FECHADA'] },
        dataVencimento: { gte: hoje, lt: new Date(hoje.getTime() + 35 * DIA_MS) },
        acordoId: null,
      },
      orderBy: { dataVencimento: 'asc' },
      select: {
        id: true,
        numero: true,
        dataVencimento: true,
        parcelas: {
          where: { status: null, acordoId: null, contratoId: { in: contratoIds } },
          select: { display: true, valorNominal: true, contrato: { select: { numero: true } } },
        },
      },
    });
    const faturasProximas = proximas
      .filter((f) => f.parcelas.length > 0)
      .slice(0, 1) // só a próxima fatura (doc 02 §7.7, 09/09)
      .map((f) => {
        const nominal = f.parcelas.reduce((s, p) => s + cent(p.valorNominal), 0);
        return {
          faturaId: f.id,
          numero: f.numero as number | null,
          dataVencimento: f.dataVencimento.toISOString() as string | null,
          valorNominal: nominal,
          encargosMora: 0,
          valorAtualizado: nominal,
          itens: f.parcelas.map((p) => ({
            display: p.display,
            contratoNumero: p.contrato.numero,
            valorAtualizado: cent(p.valorNominal),
          })),
        };
      });

    // Acordos EM ABERTO da conta (doc 02 §7.7, 09/09): máximo 2 — a tela alerta
    // a partir do 1º e o criarPorConta recusa o 3º.
    const acordosAbertos = await this.prisma.db.acordo.count({
      where: { contaId, status: { in: ['RASCUNHO', 'AGUARDANDO_ENTRADA', 'ATIVO'] } },
    });

    return { contaId, titularId: conta.titularId, contratos, faturas, faturasProximas, valorTotal, valorNominalTotal, encargosMoraTotal: valorTotal - valorNominalTotal, faturasVencidas, acordosAbertos };
  }

  // Propõe o acordo da conta → solicitação no motor de aprovação (sem gate de alçada
  // na criação: propor e aprovar são atos distintos — Doc 2 §7.9-A).
  async criarPorConta(contaId: string, dto: CriarRenegociacaoDto, operadorId: string) {
    // De acordo do cliente via WhatsApp (doc 02 §7.7, decisão 2026-09-09):
    // substitui o termo de confissão — sem a confirmação, a proposta não sobe.
    if (dto.aceiteWhatsapp !== true) {
      throw new UnprocessableEntityException({
        erro: 'sem_aceite_cliente',
        mensagem: 'Registre o "de acordo" do cliente (mensagem enviada pelo WhatsApp na revisão) antes de enviar para aprovação',
      });
    }
    const eleg = await this.elegiveisConta(contaId);

    // Máximo 2 acordos em aberto por conta (doc 02 §7.7, 09/09).
    if (eleg.acordosAbertos >= 2) {
      throw new UnprocessableEntityException({
        erro: 'limite_acordos',
        mensagem: `A conta já possui ${eleg.acordosAbertos} acordos em aberto — o limite são 2. Regularize (ou cancele) um acordo antes de propor outro.`,
      });
    }

    // Seleção por FATURA (doc V1.0 RAP005/006): todas as vencidas entram por
    // padrão; excluir exige justificativa auditável. A seleção fica congelada
    // no snapshot e vale na efetivação.
    const exclusoes = dto.faturasExcluidas ?? [];
    const vincendasIncluidas = dto.faturasVincendasIncluidas ?? [];
    const { faturasSelecionadas, valorTotal } = this.aplicarSelecao(eleg, exclusoes, vincendasIncluidas);

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
    // Motor do Catálogo (doc 02 §7.7, 2026-08-18): produto acordo_pagamento
    // ATIVO liga TP/TR/Price + frequência herdada; RASCUNHO = placeholder.
    const previa = await this.simularConta(contaId, {
      valorEntrada: dto.valorEntrada,
      numeroParcelas: dto.numeroParcelasNovas,
      faturasExcluidas: exclusoes,
      faturasVincendasIncluidas: vincendasIncluidas,
    });
    const freqApi = previa.periodicidade;
    let valorParcela: number;
    if (previa.motor === 'catalogo') {
      // RAP031: o número do servidor é a verdade — o dto não dita a parcela.
      valorParcela = previa.valorParcela;
      if ('valorMinimoParcela' in previa && valorParcela < (previa.valorMinimoParcela ?? 0)) {
        throw new UnprocessableEntityException({
          erro: 'parcela_minima',
          mensagem: `A parcela ficou abaixo da mínima do produto (R$ ${reais(previa.valorMinimoParcela ?? 0)}) — reduza o número de parcelas`,
        });
      }
    } else {
      // Placeholder: divisão simples com trava anti-parcela-negativa.
      valorParcela = dto.valorParcelaNova || Math.round((valorTotal - dto.valorEntrada) / dto.numeroParcelasNovas);
      const saldoPh = valorTotal - dto.valorEntrada;
      const ultimaParcela = saldoPh - (dto.numeroParcelasNovas - 1) * valorParcela;
      if (ultimaParcela <= 0) {
        const sugerida = Math.floor(saldoPh / dto.numeroParcelasNovas);
        throw new UnprocessableEntityException({
          erro: 'plano_excede_divida',
          mensagem: `O plano informado excede a dívida: com ${dto.numeroParcelasNovas} parcelas de R$ ${reais(valorParcela)}, a última ficaria negativa. Para ${dto.numeroParcelasNovas} parcelas, use até ~R$ ${reais(sugerida)} por parcela (o resíduo ajusta na última).`,
        });
      }
    }

    const periodicidade = (
      { semanal: 'SEMANAL', quinzenal: 'QUINZENAL', mensal: 'MENSAL' } as const
    )[freqApi];

    // Entrada com data-limite DURA (decisão 2026-08-18): o operador informa a
    // data; a cobrança não aceita pagamento depois dela.
    const prazoDias = previa.motor === 'catalogo' ? 5 : 3;
    const dataLimiteEntrada = dto.dataLimiteEntrada
      ? new Date(`${dto.dataLimiteEntrada}T12:00:00-03:00`)
      : new Date(Date.now() + prazoDias * DIA_MS);
    if (dataLimiteEntrada.getTime() < Date.now() - DIA_MS) {
      throw new UnprocessableEntityException({ erro: 'data_invalida', mensagem: 'A data de pagamento da entrada não pode estar no passado' });
    }

    // Fotografia da proposta (RAP034): saldos na data-base, seleção, exclusões e cálculo.
    const snapshot = {
      dataBase: new Date().toISOString(),
      faturasSelecionadas: faturasSelecionadas.map((f) => f.faturaId),
      exclusoes,
      vincendasIncluidas,
      totais: {
        valorNominal: faturasSelecionadas.reduce((s, f) => s + f.valorNominal, 0),
        encargosMora: faturasSelecionadas.reduce((s, f) => s + f.encargosMora, 0),
        valorAtualizado: valorTotal,
      },
      moraHerdada: 'multa e juros da regra geral do contrato na data-base (RAP007)',
      calculo: previa,
      dataLimiteEntrada: dataLimiteEntrada.toISOString(),
      // De acordo do cliente pelo WhatsApp (doc 02 §7.7, decisão 2026-09-09):
      // substitui o termo de confissão; a flag é obrigatória e fica auditada.
      aceiteWhatsapp: { confirmadoPeloOperadorEm: new Date().toISOString() },
    };

    const acordo = await this.prisma.db.acordo.create({
      data: {
        contaId,
        operadorId,
        valorTotalRenegociado: reais(valorTotal),
        valorEntrada: reais(dto.valorEntrada),
        numeroParcelasNovas: dto.numeroParcelasNovas,
        valorParcelaNova: reais(valorParcela),
        periodicidade,
        snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    const flagExcecoes = previa.excecoes.length ? ` · ⚠ EXCEÇÕES: ${previa.excecoes.join('; ')}` : '';
    await this.aprovacao.criar({
      tipoOperacao: 'acordo',
      referenciaTipo: 'acordo',
      referenciaId: acordo.id,
      titularId: eleg.titularId,
      valorCentavos: valorTotal,
      resumo: `Renegociação de ${faturasSelecionadas.length} fatura(s) — entrada ${formatCurrency(dto.valorEntrada)} + ${dto.numeroParcelasNovas}× ${formatCurrency(valorParcela)} (${freqApi})${flagExcecoes}`,
      payload: { excecoes: previa.excecoes, motor: previa.motor },
      solicitanteId: operadorId,
    });

    return {
      id: acordo.id,
      status: 'aguardando_aprovacao',
      valorTotalRenegociado: valorTotal,
      valorParcela,
      periodicidade: freqApi,
      motor: previa.motor,
      excecoes: previa.excecoes,
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
            titular: { select: { id: true, nome: true, cpfCnpj: true, email: true, whatsapp: true, asaasCustomerId: true } },
          },
        },
      },
    });
    if (!acordo || acordo.status !== 'RASCUNHO') {
      return 'Acordo não está aguardando aprovação.';
    }
    // Garante o cliente no Asaas (correção 08/09: cobrança sem customer — ou com
    // id simulado reaproveitado em modo real — era rejeitada com 400 em silêncio).
    const titular = acordo.conta.titular;
    let customerId = this.asaas.clienteReutilizavel(titular.asaasCustomerId);
    if (!customerId) {
      customerId = await this.asaas.criarCliente({
        titularId: titular.id, nome: titular.nome, cpfCnpj: titular.cpfCnpj, email: titular.email, telefone: titular.whatsapp,
      });
      await this.prisma.db.titular.update({ where: { id: titular.id }, data: { asaasCustomerId: customerId } });
    }
    // Data-limite DURA da entrada (decisão 2026-08-18): vence na data informada
    // pelo operador e o Asaas cancela o registro após o vencimento — pagamento
    // tardio não entra; sem pagamento, a proposta expira.
    // Retrocompat: acordos antigos gravaram 'dataPagamentoEntrada' no snapshot.
    const snap = acordo.snapshotJson as null | { dataLimiteEntrada?: string; dataPagamentoEntrada?: string };
    const limiteSnap = snap?.dataLimiteEntrada ?? snap?.dataPagamentoEntrada;
    const vencimento = limiteSnap ? new Date(limiteSnap) : new Date(Date.now() + 3 * DIA_MS);
    const cobranca = await this.asaas.criarCobranca({
      externalReference: `acordo:${acordo.id}`,
      valor: cent(acordo.valorEntrada),
      vencimento,
      cancelarRegistroAposVencimento: true,
      descricao: `Entrada renegociação — ${acordo.conta.titular.nome}`,
      customerId,
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

  // Entrada venceu sem pagamento (webhook PAYMENT_OVERDUE com ref acordo:):
  // a proposta EXPIRA — recálculo obrigatório antes de nova ativação, porque o
  // saldo de origem seguiu acumulando mora (decisão 2026-08-18).
  async expirarPorEntradaVencida(acordoId: string) {
    const r = await this.prisma.db.acordo.updateMany({
      where: { id: acordoId, status: 'AGUARDANDO_ENTRADA' },
      data: { status: 'EXPIRADO' },
    });
    if (r.count > 0) {
      this.logger.warn(`Acordo ${acordoId} EXPIRADO: entrada venceu sem pagamento`);
      const a = await this.prisma.db.acordo.findFirst({
        where: { id: acordoId },
        select: { conta: { select: { titular: { select: { nome: true } } } } },
      });
      await this.prisma.db.notificacao.create({
        data: {
          titulo: `Acordo expirado — ${a?.conta.titular.nome ?? ''}`,
          corpo: 'A entrada venceu sem pagamento; a proposta expirou. Simule novamente (o saldo seguiu acumulando mora).',
          rota: '/acordos',
          tipo: 'COBRANCA',
          area: 'CARTEIRA_COBRANCA',
        },
      });
    }
    return { resultado: r.count > 0 ? 'expirado' : 'ignorado' };
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
    // SELEÇÃO define o escopo da cobertura — inclusive faturas vincendas
    // incluídas por opção do operador (2026-08-30), por isso sem trava de
    // vencimento. Acordos antigos (sem snapshot) cobrem todas as vencidas.
    const snap = acordo.snapshotJson as null | { faturasSelecionadas?: string[] };
    const filtroCobertura: Prisma.ParcelaWhereInput = snap?.faturasSelecionadas?.length
      ? { faturaId: { in: snap.faturasSelecionadas } }
      : { dataVencimento: { lt: hoje } };
    // Parcelas vencidas não cobertas, agrupadas por contrato da conta.
    const contratos = await this.prisma.db.contratoCredito.findMany({
      where: { contaId: acordo.contaId },
      select: { id: true, numero: true, ativoId: true },
    });
    const porContrato: {
      contratoId: string;
      atraso: number;
      origemCapitalId: string | null; // null = contrato sem ativo (RP — 12/09)
      faturaIds: string[];
    }[] = [];
    for (const c of contratos) {
      const parcelas = await this.prisma.db.parcela.findMany({
        where: { contratoId: c.id, status: null, acordoId: null, ...filtroCobertura },
        select: { valorNominal: true, faturaId: true },
      });
      if (parcelas.length === 0) continue;
      // Recebível do acordo nasce sem origem de capital (doc 02 §19, 20/09): o
      // lastro é a estrutura jurídica — do ativo, quando há veículo, ou do
      // produto (RP). O vínculo antigo segue preenchido quando existe (legados).
      const origem = c.ativoId
        ? await this.prisma.db.origemCapital.findFirst({
            where: { ativoId: c.ativoId },
            select: { id: true },
          })
        : null;
      porContrato.push({
        contratoId: c.id,
        atraso: parcelas.reduce((s, p) => s + cent(p.valorNominal), 0),
        origemCapitalId: origem?.id ?? null,
        faturaIds: parcelas.map((p) => p.faturaId).filter((x): x is string => !!x),
      });
    }
    if (porContrato.length === 0) return { resultado: 'nada_a_renegociar' };

    const totalAtraso = porContrato.reduce((s, c) => s + c.atraso, 0);
    // O plano cobrado é o do MOTOR: PMT × N — encargos (TR, TP financiada)
    // embutidos no valor do item, mesmo padrão do contrato de veículo. Antes
    // distribuíamos o saldo NOMINAL (SN − E): as parcelas de PMT comiam o total
    // antes da última, que encolhia, e a TR nunca era cobrada (bug 31/08 —
    // caso real: 3× R$ 407,94 + R$ 162,00 em vez de 4× R$ 407,94).
    const saldoNovo = cent(acordo.valorParcelaNova) * acordo.numeroParcelasNovas;
    const periodicidadeApi = (
      { SEMANAL: 'semanal', QUINZENAL: 'quinzenal', MENSAL: 'mensal' } as const
    )[acordo.periodicidade];
    const passo = periodicidadeApi === 'mensal' ? 30 : periodicidadeApi === 'quinzenal' ? 14 : 7;
    const dataEfetivacao = new Date(paymentDateISO || new Date().toISOString());
    // Parcelas do acordo caem NAS DATAS das faturas futuras da conta (doc 02
    // §7.7, 2026-08-18 — conceito de fatura/cartão): 1ª parcela = próxima fatura
    // ABERTA futura; a consolidação encaixa as demais nas faturas seguintes e,
    // além do fim do cronograma original, CRIA faturas novas no mesmo passo
    // (extensão do calendário — as faturas extras carregam só o acordo).
    const proximaFatura = await this.prisma.db.fatura.findFirst({
      // Fatura coberta pelo acordo vira RENEGOCIADA — não pode receber o plano.
      where: {
        contaId: acordo.contaId,
        status: 'ABERTA',
        dataVencimento: { gt: dataEfetivacao },
        id: { notIn: snap?.faturasSelecionadas ?? [] },
      },
      orderBy: { dataVencimento: 'asc' },
      select: { dataVencimento: true },
    });
    const dataPrimeira = proximaFatura?.dataVencimento ?? new Date(dataEfetivacao.getTime() + passo * DIA_MS);

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
          where: { contratoId: c.contratoId, status: null, acordoId: null, ...filtroCobertura },
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
      // max+1 (não count+1): numeração sobrevive a remoções (doc 02, 2026-08-30).
      let seqFatura = (await tx.fatura.aggregate({ where: { contaId: acordo.contaId }, _max: { numero: true } }))._max.numero ?? 0;
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

      // 4. Entrada do acordo materializa como LANÇAMENTO da conta (doc 02
      //    §4-A.3, revisão 2026-08-30) — reflete no histórico e no valorPago.
      if (cent(acordo.valorEntrada) > 0) {
        await tx.lancamentoConta.create({
          data: {
            contaId: acordo.contaId,
            acordoId: acordo.id,
            tipo: 'ENTRADA_ACORDO',
            descricao: 'Entrada do acordo de renegociação',
            valor: reais(cent(acordo.valorEntrada)),
            dataPagamento: dataEfetivacao,
            asaasChargeId: (await tx.acordo.findFirst({ where: { id: acordo.id }, select: { asaasChargeIdEntrada: true } }))?.asaasChargeIdEntrada,
          },
        });
      }

      // 5. Acordo -> ATIVO. Contratos NÃO são liquidados (recuperação branda); o
      //    cliente segue inadimplente (contábil) até cumprir o acordo (Doc 2 §7.7).
      await tx.acordo.update({
        where: { id: acordo.id },
        data: { status: 'ATIVO', dataEfetivacao },
      });
      // Mesma proteção da ativação do contrato: plano longo excede o timeout
      // default de 5s do Prisma (P2028) em banco mais lento.
    }, { timeout: 120_000, maxWait: 10_000 });

    // Cobranças Asaas das faturas cobertas saem do ar (a dívida agora vive no
    // acordo) — vale para vencidas e para vincendas incluídas (2026-08-30).
    const cobertasComCobranca = await this.prisma.db.fatura.findMany({
      where: { acordoId: acordo.id, status: 'RENEGOCIADA', asaasChargeId: { not: null } },
      select: { asaasChargeId: true },
    });
    for (const f of cobertasComCobranca) {
      if (f.asaasChargeId) await this.asaas.removerCobranca(f.asaasChargeId);
    }

    this.logger.log(
      `Acordo ${acordoId} efetivado: ${planos.length} contrato(s), ${acordo.numeroParcelasNovas} parcela(s) nova(s)`,
    );
    return { resultado: 'efetivado', contratos: planos.length, parcelasNovas: acordo.numeroParcelasNovas };
  }

  // Lista de acordos (acompanhamento). Desde 21/10 traz o que a tela precisa
  // para o card ser legível sem abrir o detalhe: contratos com placa, ritmo do
  // plano, origem (nativo × importado do legado) e quem propôs.
  async listar() {
    const acordos = await this.prisma.db.acordo.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        conta: { select: { id: true, titular: { select: { id: true, nome: true } } } },
        operador: { select: { nome: true } },
        contrato: { select: { id: true, numero: true, ativo: { select: { descricao: true, placa: true } } } },
        itensGerados: { select: { contrato: { select: { id: true, numero: true, ativo: { select: { descricao: true, placa: true } } } } } },
        parcelasCobertas: { select: { contrato: { select: { id: true, numero: true, ativo: { select: { descricao: true, placa: true } } } } } },
      },
    });
    return acordos.map((a) => {
      const contratos = this.contratosDoAcordo(a);
      return {
        id: a.id,
        status: a.status.toLowerCase(),
        origem: this.origemAcordo(a.snapshotJson),
        contratoNumero: contratos.length === 1 ? contratos[0].numero : `Conta (${contratos.length || '—'} contratos)`,
        contratos,
        contaId: a.conta.id,
        titularId: a.conta.titular.id,
        titular: a.conta.titular.nome,
        criadoPor: a.operador.nome,
        valorTotalRenegociado: cent(a.valorTotalRenegociado),
        valorEntrada: cent(a.valorEntrada),
        numeroParcelasNovas: a.numeroParcelasNovas,
        valorParcelaNova: cent(a.valorParcelaNova),
        periodicidade: LABEL_PERIODICIDADE[a.periodicidade],
        dataCriacao: a.dataCriacao.toISOString(),
        dataEfetivacao: a.dataEfetivacao ? a.dataEfetivacao.toISOString() : null,
      };
    });
  }

  private origemAcordo(snapshotJson: Prisma.JsonValue | null): 'nativo' | 'legado' {
    return (snapshotJson as SnapshotAcordo | null)?.legado ? 'legado' : 'nativo';
  }

  // Contratos tocados pelo acordo: o do legado (contratoId), os que receberam
  // item ACORDO e os donos das parcelas cobertas — sem repetição.
  private contratosDoAcordo(a: {
    contrato: { id: string; numero: string; ativo: { descricao: string; placa: string | null } | null } | null;
    itensGerados: { contrato: { id: string; numero: string; ativo: { descricao: string; placa: string | null } | null } }[];
    parcelasCobertas: { contrato: { id: string; numero: string; ativo: { descricao: string; placa: string | null } | null } }[];
  }) {
    const mapa = new Map<string, { id: string; numero: string; descricao: string; placa: string | null }>();
    const por = (c: { id: string; numero: string; ativo: { descricao: string; placa: string | null } | null } | null) => {
      if (!c || mapa.has(c.id)) return;
      // Sem ativo = Reembolso Parcelado (doc 02 §19, 12/09).
      mapa.set(c.id, { id: c.id, numero: c.numero, descricao: c.ativo?.descricao ?? 'Reembolso Parcelado', placa: c.ativo?.placa ?? null });
    };
    por(a.contrato);
    for (const i of a.itensGerados) por(i.contrato);
    for (const p of a.parcelasCobertas) por(p.contrato);
    return [...mapa.values()].sort((x, y) => x.numero.localeCompare(y.numero));
  }

  // Detalhe do acordo (feedback Luís 21/10 — a tela Renegociações só listava):
  // parcelas cobertas com o que a fatura delas carregava, entrada, cotas novas
  // com situação, exclusões e saldos da data-base do snapshot, e a trilha
  // (proposta → Central de Aprovações → entrada → efetivação → cumprimento).
  // Acordos importados do legado (§26.15) saem com o MESMO detalhe: o que a
  // migração gravou está nas parcelas (vínculo acordoId), nas faturas
  // RENEGOCIADAS e nos lançamentos — nada é lido do caso de migração.
  async detalhar(acordoId: string) {
    const a = await this.prisma.db.acordo.findFirst({
      where: { id: acordoId, deletedAt: null },
      include: {
        conta: { select: { id: true, titular: { select: { id: true, nome: true } } } },
        operador: { select: { nome: true } },
        contrato: { select: { id: true, numero: true, ativo: { select: { descricao: true, placa: true } } } },
        parcelasCobertas: {
          orderBy: [{ dataVencimento: 'asc' }, { numero: 'asc' }],
          include: {
            contrato: { select: { id: true, numero: true, taxaMultaAtraso: true, taxaJurosAtraso: true, ativo: { select: { descricao: true, placa: true } } } },
            fatura: { include: { itensFatura: { orderBy: { tipo: 'asc' } } } },
          },
        },
        itensGerados: {
          include: {
            contrato: { select: { id: true, numero: true, ativo: { select: { descricao: true, placa: true } } } },
            parcelas: {
              where: { deletedAt: null },
              orderBy: { numero: 'asc' },
              include: { fatura: { select: { id: true, numero: true, dataVencimento: true, status: true, dataPagamento: true } } },
            },
          },
        },
        lancamentos: { orderBy: { dataPagamento: 'asc' } },
      },
    });
    if (!a) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Acordo não encontrado' });

    const snap = (a.snapshotJson as SnapshotAcordo | null) ?? {};
    const origem = this.origemAcordo(a.snapshotJson);
    const periodicidade = LABEL_PERIODICIDADE[a.periodicidade];
    // Data-base do atraso: a do snapshot (nativo) ou a do acordo (legado: dia da entrada).
    const dataBase = snap.dataBase ? new Date(snap.dataBase) : a.dataCriacao;

    // Antes da efetivação (rascunho / aguardando entrada — e proposta cancelada ou
    // expirada), nenhuma parcela tem o vínculo ainda: a seleção aprovada vive no
    // snapshot (`faturasSelecionadas`). Mostramos a MESMA visão (fatura → itens →
    // parcelas) a partir dessas faturas, marcada como cobertura PREVISTA
    // (achado homolog 21/10: "0 parcela(s) em 0 fatura(s)" num acordo com 8
    // faturas selecionadas).
    let coberturaPrevista = false;
    let parcelasBase = a.parcelasCobertas;
    if (parcelasBase.length === 0 && snap.faturasSelecionadas?.length) {
      const faturasSel = await this.prisma.db.fatura.findMany({
        where: { id: { in: snap.faturasSelecionadas } },
        include: {
          itensFatura: { orderBy: { tipo: 'asc' } },
          parcelas: {
            where: { deletedAt: null },
            orderBy: { numero: 'asc' },
            include: { contrato: { select: { id: true, numero: true, taxaMultaAtraso: true, taxaJurosAtraso: true, ativo: { select: { descricao: true, placa: true } } } } },
          },
        },
      });
      coberturaPrevista = faturasSel.length > 0;
      parcelasBase = faturasSel.flatMap((f) => f.parcelas.map((p) => ({ ...p, fatura: { ...f, parcelas: undefined } }))) as typeof a.parcelasCobertas;
    }
    // Ordem de leitura: vencimento → contrato → nº da parcela (igual nos dois casos).
    parcelasBase = [...parcelasBase].sort(
      (x, y) => x.dataVencimento.getTime() - y.dataVencimento.getTime() || x.contrato.numero.localeCompare(y.contrato.numero) || x.numero - y.numero,
    );
    const contratos = this.contratosDoAcordo({ ...a, parcelasCobertas: parcelasBase });

    // --- Parcelas cobertas, agrupadas pela fatura em que estavam -------------
    // Mora na data-base pela MESMA fórmula da elegibilidade (RAP007): multa e
    // juros da regra geral do contrato — o que o snapshot soma em `totais`.
    const encargoNaDataBase = (p: (typeof parcelasBase)[number], diasAtraso: number) =>
      Math.round(calcularEncargoAtraso(cent(p.valorNominal), diasAtraso, Number(p.contrato.taxaMultaAtraso.toString()), Number(p.contrato.taxaJurosAtraso.toString())));
    const cobertas = parcelasBase.map((p) => {
      const diasAtraso = diasAtrasoCalendario(p.dataVencimento, dataBase);
      return {
        parcelaId: p.id,
        contratoId: p.contrato.id,
        contratoNumero: p.contrato.numero,
        produto: p.contrato.ativo?.descricao ?? 'Reembolso Parcelado',
        display: p.display,
        numero: p.numero,
        dataVencimento: dataCalendarioUTC(p.dataVencimento),
        valorNominal: cent(p.valorNominal),
        diasAtrasoNaDataBase: diasAtraso,
        encargoMoraNaDataBase: encargoNaDataBase(p, diasAtraso),
        status: parcelaParaApi(p).status, // 'Em acordo' enquanto coberta; muda se a parcela for paga/novada
        faturaId: p.faturaId,
      };
    });
    const porFatura = new Map<string, {
      id: string; numero: number; dataVencimento: string; status: string; valorTotal: number; valorPago: number;
      dataPagamento: string | null; diasAtrasoNaDataBase: number;
      itens: { descricao: string; tipo: string; valor: number; credor: string; coberto: boolean }[];
      parcelas: typeof cobertas;
    }>();
    const idsCobertas = new Set(cobertas.map((c) => c.parcelaId));
    for (const p of parcelasBase) {
      if (!p.fatura) continue;
      const f = p.fatura;
      let g = porFatura.get(f.id);
      if (!g) {
        g = {
          id: f.id,
          numero: f.numero,
          dataVencimento: dataCalendarioUTC(f.dataVencimento),
          status: f.status.toLowerCase(),
          valorTotal: cent(f.valorTotal),
          valorPago: cent(f.valorPago),
          dataPagamento: f.dataPagamento ? dataCalendarioUTC(f.dataPagamento) : null,
          diasAtrasoNaDataBase: diasAtrasoCalendario(f.dataVencimento, dataBase),
          itens: f.itensFatura.map((it) => ({
            descricao: it.descricao,
            tipo: it.tipo.toLowerCase(),
            valor: cent(it.valor),
            credor: it.credor.toLowerCase(),
            coberto: !!it.parcelaId && idsCobertas.has(it.parcelaId),
          })),
          parcelas: [],
        };
        porFatura.set(f.id, g);
      }
      g.parcelas.push(cobertas.find((c) => c.parcelaId === p.id)!);
    }
    const faturasCobertas = [...porFatura.values()].sort((x, y) => x.dataVencimento.localeCompare(y.dataVencimento));
    const cobertasSemFatura = cobertas.filter((c) => !c.faturaId);
    const nominalCoberto = cobertas.reduce((s, c) => s + c.valorNominal, 0);

    // --- Cotas novas (parcelas dos itens de origem ACORDO) --------------------
    const cotas = a.itensGerados
      .flatMap((item) =>
        item.parcelas.map((p) => {
          const api = parcelaParaApi(p);
          return {
            parcelaId: p.id,
            contratoId: item.contrato.id,
            contratoNumero: item.contrato.numero,
            numero: p.numero,
            totalParcelas: p.totalParcelas,
            display: p.display,
            dataVencimento: dataCalendarioUTC(p.dataVencimento),
            valorNominal: cent(p.valorNominal),
            status: api.status,
            dataPagamento: p.dataPagamento ? dataCalendarioUTC(p.dataPagamento) : null,
            valorPago: cent(p.valorPago),
            valorEncargo: cent(p.valorEncargo),
            fatura: p.fatura
              ? { id: p.fatura.id, numero: p.fatura.numero, dataVencimento: dataCalendarioUTC(p.fatura.dataVencimento), status: p.fatura.status.toLowerCase() }
              : null,
          };
        }),
      )
      .sort((x, y) => x.numero - y.numero || x.contratoNumero.localeCompare(y.contratoNumero));
    const pagas = cotas.filter((c) => PARCELA_PAGA_LABELS.has(c.status));
    const resumoCotas = {
      quantidade: cotas.length,
      pagas: pagas.length,
      vencidas: cotas.filter((c) => c.status === 'Vencida').length,
      venceHoje: cotas.filter((c) => c.status === 'Vence hoje').length,
      aVencer: cotas.filter((c) => c.status === 'Em aberto').length,
      novadas: cotas.filter((c) => c.status === 'Novada').length,
      // Juros e multa NÃO são valor pago (decisão Luís 02/10) — linha própria.
      valorPago: pagas.reduce((s, c) => s + c.valorPago - c.valorEncargo, 0),
      encargosPagos: pagas.reduce((s, c) => s + c.valorEncargo, 0),
      valorAPagar: cotas.filter((c) => c.status === 'Vencida' || c.status === 'Vence hoje' || c.status === 'Em aberto').reduce((s, c) => s + c.valorNominal, 0),
      valorVencido: cotas.filter((c) => c.status === 'Vencida').reduce((s, c) => s + c.valorNominal, 0),
      totalPlano: cent(a.valorParcelaNova) * a.numeroParcelasNovas,
    };

    // --- Entrada ----------------------------------------------------------------
    const lancEntrada = a.lancamentos.find((l) => l.tipo === 'ENTRADA_ACORDO') ?? null;
    const efetivado = a.status === 'ATIVO' || a.status === 'CUMPRIDO' || a.status === 'NOVADO';
    const valorEntrada = cent(a.valorEntrada);
    const entrada = {
      valor: valorEntrada,
      dataLimite: snap.dataLimiteEntrada ?? snap.dataPagamentoEntrada ?? null,
      pagaEm: lancEntrada ? lancEntrada.dataPagamento.toISOString() : efetivado && a.dataEfetivacao ? a.dataEfetivacao.toISOString() : null,
      cobrancaAsaasId: lancEntrada?.asaasChargeId ?? a.asaasChargeIdEntrada,
      situacao:
        valorEntrada === 0 ? ('sem_entrada' as const)
        : lancEntrada || efetivado ? ('paga' as const)
        : a.status === 'AGUARDANDO_ENTRADA' ? ('aguardando' as const)
        : a.status === 'RASCUNHO' ? ('aguardando_aprovacao' as const)
        : a.status === 'EXPIRADO' ? ('expirada' as const)
        : ('nao_paga' as const),
    };

    // --- Exclusões e vincendas incluídas (snapshot) → com número/vencimento da fatura
    const idsSnap = [...new Set([...(snap.exclusoes ?? []).map((e) => e.faturaId), ...(snap.vincendasIncluidas ?? [])])];
    const faturasSnap = idsSnap.length
      ? await this.prisma.db.fatura.findMany({ where: { id: { in: idsSnap } }, select: { id: true, numero: true, dataVencimento: true, valorTotal: true } })
      : [];
    const faturaSnap = (id: string) => {
      const f = faturasSnap.find((x) => x.id === id);
      return { faturaId: id, numero: f?.numero ?? null, dataVencimento: f ? dataCalendarioUTC(f.dataVencimento) : null, valorTotal: f ? cent(f.valorTotal) : null };
    };
    const exclusoes = (snap.exclusoes ?? []).map((e) => ({ ...faturaSnap(e.faturaId), justificativa: e.justificativa }));
    const vincendasIncluidas = (snap.vincendasIncluidas ?? []).map((id) => faturaSnap(id));

    // --- Trilha ------------------------------------------------------------------
    const [aprovacao, novacaoAbsorveu] = await Promise.all([
      this.prisma.db.aprovacao.findFirst({
        where: { referenciaTipo: 'acordo', referenciaId: a.id },
        orderBy: { createdAt: 'desc' },
        include: {
          solicitante: { select: { nome: true } },
          decisoes: { include: { usuario: { select: { nome: true } } }, orderBy: { createdAt: 'asc' } },
        },
      }),
      a.status === 'NOVADO'
        ? this.prisma.db.novacao.findFirst({
            where: { contaId: a.conta.id, status: 'ATIVO', dataAtivacao: { gte: a.dataCriacao }, deletedAt: null },
            orderBy: { dataAtivacao: 'asc' },
            select: { id: true, dataAtivacao: true },
          })
        : null,
    ]);
    const trilha: EventoTrilha[] = [];
    const resumoPlano = `${a.numeroParcelasNovas}× ${formatCurrency(cent(a.valorParcelaNova))} (${periodicidade})`;
    if (origem === 'legado') {
      trilha.push({
        em: a.dataCriacao.toISOString(),
        titulo: 'Acordo firmado no legado (Asaas)',
        por: null,
        detalhe: `Entrada ${formatCurrency(valorEntrada)} paga nesta data · plano ${resumoPlano} · ${cobertas.length} parcela(s) coberta(s)`,
      });
      trilha.push({
        em: a.createdAt.toISOString(),
        titulo: 'Importado pela migração do legado',
        por: a.operador.nome,
        detalhe: `Conciliação declarada (doc 02 §26.15): parcelas cobertas, faturas renegociadas, cotas já pagas e entrada vieram do Asaas. ${a.observacao ?? ''}`.trim(),
      });
    } else {
      trilha.push({
        em: a.dataCriacao.toISOString(),
        titulo: 'Proposta de acordo criada',
        por: a.operador.nome,
        detalhe: `${(snap.faturasSelecionadas ?? []).length || faturasCobertas.length || '—'} fatura(s) renegociada(s) · entrada ${formatCurrency(valorEntrada)} · ${resumoPlano}${snap.aceiteWhatsapp ? ' · de acordo do cliente registrado (WhatsApp)' : ''}`,
      });
    }
    if (aprovacao) {
      trilha.push({
        em: aprovacao.createdAt.toISOString(),
        titulo: 'Enviado à Central de Aprovações',
        por: aprovacao.solicitante.nome,
        detalhe: aprovacao.resumo,
      });
      const verbo = { APROVADA: 'aprovou', RECOMENDADA: 'recomendou a aprovação', REPROVADA: 'reprovou' } as Record<string, string>;
      for (const d of aprovacao.decisoes) {
        trilha.push({ em: d.createdAt.toISOString(), titulo: `${d.usuario.nome} ${verbo[d.decisao] ?? d.decisao.toLowerCase()}`, por: null, detalhe: d.parecer });
      }
      const ultimaAprovacao = [...aprovacao.decisoes].reverse().find((d) => d.decisao === 'APROVADA');
      if (aprovacao.status === 'APROVADA' && valorEntrada > 0) {
        trilha.push({
          em: ultimaAprovacao?.createdAt.toISOString() ?? aprovacao.updatedAt.toISOString(),
          titulo: 'Aprovado — cobrança da entrada gerada no Asaas',
          por: null,
          detalhe: entrada.dataLimite ? `Data-limite dura: ${this.diaBR(entrada.dataLimite)} — depois dela a cobrança não aceita pagamento e a proposta expira` : null,
        });
      }
    }
    if (lancEntrada) {
      trilha.push({
        em: lancEntrada.dataPagamento.toISOString(),
        titulo: 'Entrada paga',
        por: null,
        detalhe: `${formatCurrency(cent(lancEntrada.valor))}${lancEntrada.asaasChargeId ? ` · cobrança ${lancEntrada.asaasChargeId}` : ''} — o pagamento é o aceite formal do cliente`,
      });
    }
    if (a.dataEfetivacao && origem === 'nativo') {
      trilha.push({
        em: a.dataEfetivacao.toISOString(),
        titulo: 'Acordo efetivado',
        por: null,
        detalhe: `${cobertas.length} parcela(s) coberta(s) recebeu(ram) o vínculo do acordo, ${faturasCobertas.length} fatura(s) viraram "Renegociada" e ${cotas.length} cota(s) nova(s) entraram nas faturas seguintes`,
      });
    }
    if (a.status === 'CUMPRIDO') {
      const ultimaPaga = pagas.map((c) => c.dataPagamento).filter((d): d is string => !!d).sort().pop() ?? null;
      trilha.push({ em: ultimaPaga ? `${ultimaPaga}T12:00:00.000Z` : a.updatedAt.toISOString(), titulo: 'Acordo cumprido', por: null, detalhe: 'Todas as cotas do plano foram pagas — o acordo se cumpre, não se quita' });
    }
    if (a.status === 'NOVADO') {
      trilha.push({ em: novacaoAbsorveu?.dataAtivacao?.toISOString() ?? a.updatedAt.toISOString(), titulo: 'Saldo absorvido por novação', por: null, detalhe: 'As cotas em aberto foram extintas e entraram no saldo do contrato novo' });
    }
    if (a.status === 'CANCELADO') {
      trilha.push({
        em: a.updatedAt.toISOString(),
        titulo: 'Acordo cancelado',
        por: null,
        detalhe: aprovacao?.status === 'REPROVADA' ? 'Reprovado na Central de Aprovações' : 'Proposta não efetivada (cancelada ou substituída por novação)',
      });
    }
    if (a.status === 'EXPIRADO') {
      trilha.push({ em: a.updatedAt.toISOString(), titulo: 'Proposta expirada', por: null, detalhe: 'A entrada venceu sem pagamento — recálculo obrigatório antes de nova proposta (o saldo seguiu acumulando mora)' });
    }

    return {
      id: a.id,
      status: a.status.toLowerCase(),
      origem,
      contaId: a.conta.id,
      titular: a.conta.titular,
      contratos,
      criadoEm: a.dataCriacao.toISOString(),
      criadoPor: a.operador.nome,
      efetivadoEm: a.dataEfetivacao?.toISOString() ?? null,
      dataBase: dataBase.toISOString(),
      observacao: a.observacao,
      plano: {
        valorTotalRenegociado: cent(a.valorTotalRenegociado),
        valorEntrada,
        numeroParcelasNovas: a.numeroParcelasNovas,
        valorParcelaNova: cent(a.valorParcelaNova),
        periodicidade,
        totalPlano: resumoCotas.totalPlano,
      },
      // Cobertura PREVISTA = seleção do snapshot (acordo ainda sem vínculo nas parcelas).
      coberturaPrevista,
      // Saldos na data-base (snapshot nativo); no legado só o nominal coberto é conhecido.
      totaisCobertura: {
        quantidadeParcelas: cobertas.length,
        quantidadeFaturas: faturasCobertas.length,
        valorNominal: snap.totais?.valorNominal ?? nominalCoberto,
        encargosMora: snap.totais?.encargosMora ?? null,
        valorAtualizado: snap.totais?.valorAtualizado ?? null,
        moraHerdada: snap.moraHerdada ?? null,
      },
      faturasCobertas,
      cobertasSemFatura,
      cotas,
      resumoCotas,
      entrada,
      exclusoes,
      vincendasIncluidas,
      calculo: snap.calculo ?? null,
      aceiteWhatsapp: snap.aceiteWhatsapp ?? null,
      temTermoAntigo: !!snap.termo,
      legado: snap.legado
        ? { casoId: snap.legado.casoId, parcelasCobertasDeclaradas: snap.legado.parcelasCobertas, primeiraCotaEm: snap.legado.primeiraEm, ultimaCotaEm: snap.legado.ultimaEm }
        : null,
      aprovacao: aprovacao
        ? {
            id: aprovacao.id,
            status: aprovacao.status,
            resumo: aprovacao.resumo,
            solicitante: aprovacao.solicitante.nome,
            solicitadoEm: aprovacao.createdAt.toISOString(),
            decisoes: aprovacao.decisoes.map((d) => ({ usuario: d.usuario.nome, decisao: d.decisao, parecer: d.parecer, em: d.createdAt.toISOString() })),
          }
        : null,
      novacaoId: novacaoAbsorveu?.id ?? null,
      lancamentos: a.lancamentos.map((l) => ({
        id: l.id,
        tipo: l.tipo.toLowerCase(),
        descricao: l.descricao,
        valor: cent(l.valor),
        dataPagamento: l.dataPagamento.toISOString(),
        cobrancaAsaasId: l.asaasChargeId,
      })),
      trilha: ordenarTrilha(trilha),
    };
  }

  // dd/mm/aaaa de um instante ISO ou de uma data 'YYYY-MM-DD' (fuso do negócio).
  private diaBR(iso: string): string {
    const dia = iso.length === 10 ? iso : new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    return dia.split('-').reverse().join('/');
  }
}
