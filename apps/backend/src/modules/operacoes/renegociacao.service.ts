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
  precificarAcordoPagamento,
  renderTemplate,
  valorPorExtenso,
  numeroPorExtenso,
  dataPorExtenso,
  inicioHojeBrasilUTC,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasService } from '../asaas/asaas.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { CatalogoFonteService } from '../catalogo/catalogo-fonte.service';
import { TERMO_ACORDO_TEMPLATE } from './templates/termo-acordo.template';

const DIA_MS = 24 * 60 * 60 * 1000;
const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

export interface CriarRenegociacaoDto {
  valorEntrada: number; // centavos
  numeroParcelasNovas: number;
  valorParcelaNova?: number; // centavos — ignorado com motor do Catálogo ativo (RAP031)
  periodicidade?: 'semanal' | 'quinzenal' | 'mensal'; // ignorada com motor ativo (herdada)
  dataPagamentoEntrada?: string; // 'YYYY-MM-DD' — data-limite dura da entrada
  // Seleção por FATURA (doc Acordo de Pagamento V1.0 RAP006).
  faturasExcluidas?: { faturaId: string; justificativa: string }[];
  // Faturas VINCENDAS incluídas por opção do operador (decisão Luís 2026-08-30):
  // divergência consciente com o RAP003 (somente vencidas) — aumenta a entrada
  // mínima e antecipa a segurança do pagamento. Opt-in, nunca automático.
  faturasVincendasIncluidas?: string[];
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
      where: { contaId, status: { in: ['ATIVO', 'INADIMPLENTE', 'BLOQUEADO', 'SUSPENSO', 'EM_RECUPERACAO_VEICULO'] } },
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

    // Faturas VINCENDAS próximas (decisão Luís 2026-08-30): o operador PODE
    // incluí-las no acordo (opt-in na tela, desmarcadas por padrão) — janela de
    // 35 dias cobre "a próxima fatura" em qualquer periodicidade. Entram pelo
    // nominal, sem mora. Divergência consciente com o RAP003 do doc V1.0
    // (somente vencidas), registrada no doc 02 §7.7.
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

    return { contaId, titularId: conta.titularId, contratos, faturas, faturasProximas, valorTotal, valorNominalTotal, encargosMoraTotal: valorTotal - valorNominalTotal, faturasVencidas };
  }

  // Propõe o acordo da conta → solicitação no motor de aprovação (sem gate de alçada
  // na criação: propor e aprovar são atos distintos — Doc 2 §7.9-A).
  async criarPorConta(contaId: string, dto: CriarRenegociacaoDto, operadorId: string) {
    const eleg = await this.elegiveisConta(contaId);

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
    const dataPagamentoEntrada = dto.dataPagamentoEntrada
      ? new Date(`${dto.dataPagamentoEntrada}T12:00:00-03:00`)
      : new Date(Date.now() + prazoDias * DIA_MS);
    if (dataPagamentoEntrada.getTime() < Date.now() - DIA_MS) {
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
      dataPagamentoEntrada: dataPagamentoEntrada.toISOString(),
    };

    // Termo de confissão de dívida e acordo de parcelamento (instrumento PRÓPRIO
    // do acordo — doc 02 §7.7, 2026-08-18) gerado e congelado na proposta.
    const termo = await this.gerarTermo({
      contaId,
      valorTotal,
      valorEntrada: dto.valorEntrada,
      numeroParcelas: dto.numeroParcelasNovas,
      valorParcela,
      periodicidade: freqApi,
      dataPagamentoEntrada,
      faturas: faturasSelecionadas,
    });

    const acordo = await this.prisma.db.acordo.create({
      data: {
        contaId,
        operadorId,
        valorTotalRenegociado: reais(valorTotal),
        valorEntrada: reais(dto.valorEntrada),
        numeroParcelasNovas: dto.numeroParcelasNovas,
        valorParcelaNova: reais(valorParcela),
        periodicidade,
        snapshotJson: { ...snapshot, termo } as unknown as Prisma.InputJsonValue,
      },
    });

    const flagExcecoes = previa.excecoes.length ? ` · ⚠ EXCEÇÕES: ${previa.excecoes.join('; ')}` : '';
    await this.aprovacao.criar({
      tipoOperacao: 'acordo',
      referenciaTipo: 'acordo',
      referenciaId: acordo.id,
      titularId: eleg.titularId,
      valorCentavos: valorTotal,
      resumo: `Renegociação (${faturasSelecionadas.length} fatura(s)) — entrada R$ ${reais(dto.valorEntrada)} + ${dto.numeroParcelasNovas}× R$ ${reais(valorParcela)} ${freqApi}${previa.motor === 'catalogo' ? ` (motor Catálogo: TP R$ ${reais(previa.taxaInicial)}, TR ${(previa.encargoMensal ?? 0) * 100}% a.m.)` : ' (cálculo provisório)'}${flagExcecoes}`,
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

  // Texto do termo (template jurídico do Luís adaptado ao conta-cêntrico).
  private async gerarTermo(p: {
    contaId: string;
    valorTotal: number;
    valorEntrada: number;
    numeroParcelas: number;
    valorParcela: number;
    periodicidade: 'semanal' | 'quinzenal' | 'mensal';
    dataPagamentoEntrada: Date;
    faturas: { faturaId: string; numero: number | null; dataVencimento: string | null; valorNominal: number; encargosMora: number; valorAtualizado: number }[];
  }): Promise<string> {
    const conta = await this.prisma.db.conta.findFirst({
      where: { id: p.contaId },
      select: {
        titular: { select: { nome: true, cpfCnpj: true, whatsapp: true, email: true } },
        contratosCredito: {
          where: { status: { in: ['ATIVO', 'INADIMPLENTE', 'BLOQUEADO', 'SUSPENSO', 'EM_RECUPERACAO_VEICULO'] } },
          select: { numero: true, dataAssinatura: true, ativo: { select: { descricao: true, placa: true } } },
        },
      },
    });
    const t = conta?.titular;
    const contratosOrigem = (conta?.contratosCredito ?? [])
      .map((c) => `Contrato de Compra e Venda de Veículo com Reserva de Domínio nº ${c.numero}, de ${c.dataAssinatura.toLocaleDateString('pt-BR')} (${c.ativo.descricao}${c.ativo.placa ? `, placa ${c.ativo.placa}` : ''})`)
      .join('; ');
    const tabelaFaturas = p.faturas
      .map((f) => `Fatura ${f.numero ?? '—'} · venc. ${f.dataVencimento ? new Date(f.dataVencimento).toLocaleDateString('pt-BR') : '—'} · original R$ ${reais(f.valorNominal)} · encargos R$ ${reais(f.encargosMora)} · atualizado R$ ${reais(f.valorAtualizado)}`)
      .join('\n');
    const passo = p.periodicidade === 'mensal' ? 30 : p.periodicidade === 'quinzenal' ? 14 : 7;
    const proximaFatura = await this.prisma.db.fatura.findFirst({
      // Faturas cobertas pelo acordo (inclusive vincendas incluídas) não recebem o plano.
      where: {
        contaId: p.contaId,
        status: 'ABERTA',
        dataVencimento: { gt: new Date() },
        id: { notIn: p.faturas.map((f) => f.faturaId) },
      },
      orderBy: { dataVencimento: 'asc' },
      select: { dataVencimento: true },
    });
    const dataPrimeira = proximaFatura?.dataVencimento ?? new Date(p.dataPagamentoEntrada.getTime() + passo * DIA_MS);
    const plural = { semanal: 'semanais', quinzenal: 'quinzenais', mensal: 'mensais' }[p.periodicidade];
    const params = await this.prisma.db.parametroAssinatura.findFirst();
    const linhaTest = (nome?: string, cpf?: string) => (nome ? `${nome}\nCPF: ${cpf || '—'}` : 'Nome:\nCPF:');
    return renderTemplate(TERMO_ACORDO_TEMPLATE, {
      numeroAcordo: 'a definir na aprovação',
      nomeCliente: t?.nome ?? '—',
      cpfCliente: t?.cpfCnpj ?? '—',
      telefoneCliente: t?.whatsapp ?? '—',
      emailCliente: t?.email ?? '—',
      contratosOrigem: contratosOrigem || 'relação contratual mantida junto à CREDORA',
      tabelaFaturas,
      valorTotalConfessado: `R$ ${reais(p.valorTotal)}`,
      valorTotalExtenso: valorPorExtenso(p.valorTotal),
      valorEntrada: `R$ ${reais(p.valorEntrada)}`,
      valorEntradaExtenso: valorPorExtenso(p.valorEntrada),
      dataEntrada: p.dataPagamentoEntrada.toLocaleDateString('pt-BR'),
      qtdeParcelas: p.numeroParcelas,
      qtdeParcelasExtenso: numeroPorExtenso(p.numeroParcelas),
      periodicidadePlural: plural,
      valorParcela: `R$ ${reais(p.valorParcela)}`,
      valorParcelaExtenso: valorPorExtenso(p.valorParcela),
      dataPrimeiraParcela: dataPrimeira.toLocaleDateString('pt-BR'),
      dataAssinaturaLinha: `VITÓRIA/ES, ${dataPorExtenso(new Date())}.`,
      testemunha1Linha: linhaTest(params?.testemunha1Nome, params?.testemunha1Cpf),
      testemunha2Linha: linhaTest(params?.testemunha2Nome, params?.testemunha2Cpf),
    });
  }

  // Termo congelado no snapshot — visualização na tela de renegociações.
  async termo(acordoId: string) {
    const a = await this.prisma.db.acordo.findFirst({
      where: { id: acordoId },
      select: { id: true, snapshotJson: true, conta: { select: { titular: { select: { nome: true } } } } },
    });
    if (!a) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Acordo não encontrado' });
    const snap = a.snapshotJson as null | { termo?: string };
    return {
      id: a.id,
      titular: a.conta.titular.nome,
      disponivel: !!snap?.termo,
      texto: snap?.termo ?? 'Termo não disponível (acordo criado antes do instrumento próprio — 18/08/2026).',
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
    // Data-limite DURA da entrada (decisão 2026-08-18): vence na data informada
    // pelo operador e o Asaas cancela o registro após o vencimento — pagamento
    // tardio não entra; sem pagamento, a proposta expira.
    const snap = acordo.snapshotJson as null | { dataPagamentoEntrada?: string };
    const vencimento = snap?.dataPagamentoEntrada ? new Date(snap.dataPagamentoEntrada) : new Date(Date.now() + 3 * DIA_MS);
    const cobranca = await this.asaas.criarCobranca({
      externalReference: `acordo:${acordo.id}`,
      valor: cent(acordo.valorEntrada),
      vencimento,
      cancelarRegistroAposVencimento: true,
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
      origemCapitalId: string;
      faturaIds: string[];
    }[] = [];
    for (const c of contratos) {
      const parcelas = await this.prisma.db.parcela.findMany({
        where: { contratoId: c.id, status: null, acordoId: null, ...filtroCobertura },
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
    });

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
