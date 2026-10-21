import { Injectable } from '@nestjs/common';
import { StatusParcela } from '@prisma/client';
import {
  comprometimentoRenda,
  dataCalendarioUTC,
  formatarDiaBR,
  formatCurrency,
  inicioHojeBrasilUTC,
  rotuloAtivo,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AprovacaoService } from './aprovacao.service';

const cent = (v: { toString(): string } | null | undefined) => Math.round(Number(v?.toString() ?? '0') * 100);
const PARCELA_PAGA: StatusParcela[] = ['PAGA', 'PAGA_EM_ATRASO', 'PAGA_ANTECIPADA'];
const FREQ = { SEMANAL: 'semanal', QUINZENAL: 'quinzenal', MENSAL: 'mensal' } as const;
type Frequencia = (typeof FREQ)[keyof typeof FREQ];
const RESPONSAVEL: Record<string, string> = { AZIT: 'Azit', INVESTIDOR: 'Investidor', CLIENTE: 'Cliente (repasse)', OUTRA_ENTIDADE: 'Outra entidade' };

// Bloco genérico do dossiê (tipos sem tela de detalhe própria — contas a pagar,
// crédito, reajuste, condição comercial): o backend monta rótulo/valor já em
// texto humano e a tela só desenha (componente genérico, configurado por props).
export interface BlocoDossie {
  titulo: string;
  campos?: { rotulo: string; valor: string; tom?: 'alerta' | 'atencao' | 'ok' }[];
  tabela?: { colunas: string[]; direita?: number[]; linhas: { celulas: string[]; destaque?: boolean }[] };
  nota?: string;
}

// Histórico de recuperação do titular (protótipo 14/10): o que a conta já
// negociou, como está pagando e quanto a operação compromete da renda.
// Nada aqui é gravado — tudo calculado na leitura (Regra 7).
export interface ContextoConta {
  contaId: string;
  clienteDesde: string; // instante ISO (cadastro do titular)
  contratos: {
    id: string;
    numero: string;
    descricao: string;
    placa: string | null;
    periodicidade: Frequencia;
    parcelasPagas: number;
    numeroParcelas: number;
    ultimoVencimento: string | null; // 'YYYY-MM-DD'
    veiculoBloqueadoEm: string | null;
    recuperacaoIniciadaEm: string | null;
  }[];
  acordos: { id: string; status: string; criadoEm: string; plano: string; cotas: number; cotasPagas: number }[];
  ordemAcordo: number | null; // "2º acordo da conta" (só no dossiê de acordo)
  acordosEmAberto: number; // além do que está em decisão
  novacoes: { id: string; status: string; criadaEm: string }[];
  proximaFatura: { numero: number; dataVencimento: string; valorTotal: number } | null;
  renda: { apurada: number; analiseEm: string } | null;
  comprometimento: {
    frequencia: Frequencia;
    atual: number | null; // próxima fatura ÷ renda
    comOperacao: number | null; // fatura/parcela com a operação ÷ renda
    valorComOperacao: number | null;
    limitePolitica: number | null; // alçada de comprometimento da política da análise
  } | null;
}

export interface DetalheDossie {
  tipo: string;
  referenciaId: string;
  // Observação de quem pediu (tipos genéricos — acordo e novação trazem a
  // própria no detalhe da tela de Renegociações).
  observacao: { autor: string | null; em: string | null; texto: string } | null;
  blocos: BlocoDossie[];
  conta: ContextoConta | null;
}

// Dossiê da Central de Aprovações (pedido Luís 21/10, protótipo de 14/10).
// Acordo e novação: o detalhe da OPERAÇÃO vem dos mesmos endpoints da tela de
// Renegociações (GET acordos/:id, novacoes/:id) — aqui só o que é próprio da
// decisão: contexto da conta, histórico de recuperação e comprometimento.
@Injectable()
export class AprovacaoDossieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aprovacao: AprovacaoService,
  ) {}

  async dossie(aprovacaoId: string, usuarioId: string) {
    const item = await this.aprovacao.obter(aprovacaoId, usuarioId);
    const ref = await this.prisma.db.aprovacao.findFirst({ where: { id: aprovacaoId }, select: { referenciaTipo: true, referenciaId: true, payload: true } });
    const detalhe = ref ? await this.detalhe(item.tipoOperacao, ref.referenciaTipo, ref.referenciaId, item.titular?.id ?? null, ref.payload) : null;
    return { ...item, detalhe };
  }

  private async detalhe(tipo: string, referenciaTipo: string, referenciaId: string, titularId: string | null, payload: unknown): Promise<DetalheDossie> {
    const base: DetalheDossie = { tipo, referenciaId, observacao: null, blocos: [], conta: null };
    switch (referenciaTipo) {
      case 'acordo':
        return { ...base, conta: await this.contextoAcordo(referenciaId) };
      case 'novacao':
        return { ...base, conta: await this.contextoNovacao(referenciaId) };
      case 'contrato_credito':
        return this.detalheCredito(base, referenciaId, payload);
      case 'reajuste':
        return this.detalheReajuste(base, referenciaId);
      case 'proposta':
        return this.detalheProposta(base, referenciaId, titularId);
      case 'titulo_pagar':
        return this.detalheTitulo(base, referenciaId);
      case 'solicitacao_orcamento':
        return this.detalheOrcamento(base, referenciaId);
      case 'fornecedor_financeiro':
        return this.detalheFornecedor(base, referenciaId);
      case 'lote_pagamento':
        return this.detalheLote(base, referenciaId);
      default:
        // analise_cadastro: a tela usa o dossiê da própria análise (GET analises/:id).
        return base;
    }
  }

  // --- Acordo / novação --------------------------------------------------------

  private async contextoAcordo(acordoId: string) {
    const a = await this.prisma.db.acordo.findFirst({
      where: { id: acordoId },
      select: { id: true, contaId: true, status: true, periodicidade: true, valorParcelaNova: true, snapshotJson: true },
    });
    if (!a) return null;
    const snap = (a.snapshotJson ?? {}) as { faturasSelecionadas?: string[] };
    // Antes da efetivação a cota ainda não está nas faturas: fatura do período
    // durante o acordo = próxima fatura (fora da seleção) + cota. Depois, a
    // própria próxima fatura já carrega a cota.
    const somaCota = a.status === 'RASCUNHO' || a.status === 'AGUARDANDO_ENTRADA';
    return this.contextoConta(a.contaId, {
      acordoAtualId: a.id,
      faturasExcluidas: snap.faturasSelecionadas ?? [],
      frequencia: FREQ[a.periodicidade],
      valorComOperacao: (proxima) => (proxima === null ? null : proxima + (somaCota ? cent(a.valorParcelaNova) : 0)),
    });
  }

  private async contextoNovacao(novacaoId: string) {
    const n = await this.prisma.db.novacao.findFirst({
      where: { id: novacaoId },
      select: { id: true, contaId: true, valorParcela: true, snapshotJson: true },
    });
    if (!n) return null;
    const sim = ((n.snapshotJson ?? {}) as { simulacao?: { frequencia?: Frequencia } }).simulacao;
    // A parcela única registrada é a COMPOSTA (financeira + CR + proteção) — ela
    // substitui a fatura inteira da conta.
    return this.contextoConta(n.contaId, {
      novacaoAtualId: n.id,
      frequencia: sim?.frequencia ?? null,
      valorComOperacao: () => cent(n.valorParcela),
    });
  }

  async contextoConta(
    contaId: string,
    opts: {
      acordoAtualId?: string;
      novacaoAtualId?: string;
      faturasExcluidas?: string[];
      frequencia?: Frequencia | null;
      valorComOperacao?: (proximaFatura: number | null) => number | null;
    } = {},
  ): Promise<ContextoConta | null> {
    const conta = await this.prisma.db.conta.findFirst({
      where: { id: contaId },
      select: { id: true, titularId: true, titular: { select: { createdAt: true } } },
    });
    if (!conta) return null;
    const hoje = inicioHojeBrasilUTC();

    const [contratos, acordos, novacoes, proxima, renda] = await Promise.all([
      this.prisma.db.contratoCredito.findMany({
        where: { contaId, status: 'ATIVO' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, numero: true, numeroParcelas: true, periodicidade: true,
          veiculoBloqueadoEm: true, recuperacaoIniciadaEm: true,
          ativo: { select: { descricao: true, placa: true } },
        },
      }),
      this.prisma.db.acordo.findMany({
        where: { contaId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, status: true, dataCriacao: true, numeroParcelasNovas: true, valorParcelaNova: true, periodicidade: true,
          itensGerados: { select: { parcelas: { where: { deletedAt: null }, select: { status: true } } } },
        },
      }),
      this.prisma.db.novacao.findMany({
        where: { contaId, deletedAt: null, ...(opts.novacaoAtualId ? { id: { not: opts.novacaoAtualId } } : {}) },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, createdAt: true },
      }),
      this.prisma.db.fatura.findFirst({
        where: {
          contaId,
          dataVencimento: { gte: hoje },
          status: { in: ['ABERTA', 'FECHADA'] },
          ...(opts.faturasExcluidas?.length ? { id: { notIn: opts.faturasExcluidas } } : {}),
        },
        orderBy: { dataVencimento: 'asc' },
        select: { numero: true, dataVencimento: true, valorTotal: true },
      }),
      // Renda: a apurada do titular na análise mais recente (a mesma que a
      // política usa no comprometimento — §14), com os fatores daquela versão.
      this.prisma.db.participanteAnalise.findFirst({
        where: { titularId: conta.titularId, rendaApurada: { not: null } },
        orderBy: { analise: { createdAt: 'desc' } },
        select: {
          rendaApurada: true,
          analise: { select: { createdAt: true, parametroVersao: { select: { fatorSemanal: true, fatorQuinzenal: true, comprometimentoAlcada: true } } } },
        },
      }),
    ]);

    const ids = contratos.map((c) => c.id);
    const [pagas, ultimos] = ids.length
      ? await Promise.all([
          this.prisma.db.parcela.groupBy({ by: ['contratoId'], where: { contratoId: { in: ids }, status: { in: PARCELA_PAGA } }, _count: { _all: true } }),
          this.prisma.db.parcela.groupBy({ by: ['contratoId'], where: { contratoId: { in: ids }, deletedAt: null, itemContratado: { origem: 'VENDA' } }, _max: { dataVencimento: true } }),
        ])
      : [[], []];

    const ordemAcordo = opts.acordoAtualId ? acordos.findIndex((a) => a.id === opts.acordoAtualId) + 1 || null : null;
    const outrosAcordos = acordos.filter((a) => a.id !== opts.acordoAtualId);

    const valorProxima = proxima ? cent(proxima.valorTotal) : null;
    const frequencia = opts.frequencia ?? (contratos[0] ? FREQ[contratos[0].periodicidade] : null);
    const rendaApurada = renda?.rendaApurada ? cent(renda.rendaApurada) : null;
    const pv = renda?.analise.parametroVersao;
    const fatores = pv ? { fatorSemanal: Number(pv.fatorSemanal.toString()), fatorQuinzenal: Number(pv.fatorQuinzenal.toString()) } : null;
    const valorComOperacao = opts.valorComOperacao ? opts.valorComOperacao(valorProxima) : null;

    return {
      contaId,
      clienteDesde: conta.titular.createdAt.toISOString(),
      contratos: contratos.map((c) => ({
        id: c.id,
        numero: c.numero,
        descricao: c.ativo?.descricao ?? 'Reembolso Parcelado',
        placa: c.ativo?.placa ?? null,
        periodicidade: FREQ[c.periodicidade],
        parcelasPagas: pagas.find((g) => g.contratoId === c.id)?._count._all ?? 0,
        numeroParcelas: c.numeroParcelas,
        ultimoVencimento: (() => {
          const d = ultimos.find((g) => g.contratoId === c.id)?._max.dataVencimento;
          return d ? dataCalendarioUTC(d) : null;
        })(),
        veiculoBloqueadoEm: c.veiculoBloqueadoEm?.toISOString() ?? null,
        recuperacaoIniciadaEm: c.recuperacaoIniciadaEm?.toISOString() ?? null,
      })),
      acordos: outrosAcordos.map((a) => {
        const cotas = a.itensGerados.flatMap((i) => i.parcelas);
        return {
          id: a.id,
          status: a.status.toLowerCase(),
          criadoEm: a.dataCriacao.toISOString(),
          plano: `${a.numeroParcelasNovas}× ${formatCurrency(cent(a.valorParcelaNova))} (${FREQ[a.periodicidade]})`,
          cotas: cotas.length,
          cotasPagas: cotas.filter((p) => p.status !== null && PARCELA_PAGA.includes(p.status)).length,
        };
      }),
      ordemAcordo,
      acordosEmAberto: outrosAcordos.filter((a) => ['RASCUNHO', 'AGUARDANDO_ENTRADA', 'ATIVO'].includes(a.status)).length,
      novacoes: novacoes.map((n) => ({ id: n.id, status: n.status.toLowerCase(), criadaEm: n.createdAt.toISOString() })),
      proximaFatura: proxima ? { numero: proxima.numero, dataVencimento: dataCalendarioUTC(proxima.dataVencimento), valorTotal: cent(proxima.valorTotal) } : null,
      renda: rendaApurada && renda ? { apurada: rendaApurada, analiseEm: renda.analise.createdAt.toISOString() } : null,
      comprometimento: frequencia && fatores
        ? {
            frequencia,
            atual: valorProxima !== null ? comprometimentoRenda(valorProxima, frequencia, rendaApurada, fatores) : null,
            comOperacao: valorComOperacao !== null ? comprometimentoRenda(valorComOperacao, frequencia, rendaApurada, fatores) : null,
            valorComOperacao,
            limitePolitica: pv ? Number(pv.comprometimentoAlcada.toString()) : null,
          }
        : frequencia
          ? { frequencia, atual: null, comOperacao: null, valorComOperacao, limitePolitica: null }
          : null,
    };
  }

  // --- Crédito avulso / Reembolso Parcelado ----------------------------------

  private async detalheCredito(base: DetalheDossie, contratoId: string, payload: unknown): Promise<DetalheDossie> {
    const c = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: {
        numero: true, contaId: true, valorTotal: true, valorEntrada: true, numeroParcelas: true, valorParcelaInicial: true,
        periodicidade: true, dataPrimeiraParcela: true,
        ativo: { select: { descricao: true, placa: true } },
        itensContratados: { where: { deletedAt: null }, select: { descricao: true, valor: true, numeroParcelas: true } },
      },
    });
    if (!c) return base;
    const p = (payload ?? {}) as { valorPrincipal?: number; fornecedorNome?: string };
    const blocos: BlocoDossie[] = [
      {
        titulo: 'O que está sendo contratado',
        campos: [
          { rotulo: 'Contrato', valor: c.numero },
          { rotulo: 'Item', valor: c.itensContratados.map((i) => i.descricao).join(' · ') || '—' },
          ...(c.ativo ? [{ rotulo: 'Veículo', valor: rotuloAtivo(c.ativo) }] : []),
          ...(p.valorPrincipal ? [{ rotulo: 'Valor pago à vista ao fornecedor', valor: `${formatCurrency(p.valorPrincipal)}${p.fornecedorNome ? ` · ${p.fornecedorNome}` : ''}` }] : []),
          { rotulo: 'Plano do cliente', valor: `${c.numeroParcelas}× ${formatCurrency(cent(c.valorParcelaInicial))} (${FREQ[c.periodicidade]})` },
          ...(cent(c.valorEntrada) > 0 ? [{ rotulo: 'Entrada', valor: formatCurrency(cent(c.valorEntrada)) }] : []),
          { rotulo: 'Total a pagar pelo cliente', valor: formatCurrency(cent(c.valorTotal)) },
          { rotulo: '1ª parcela', valor: formatarDiaBR(c.dataPrimeiraParcela) },
        ],
      },
    ];
    return { ...base, blocos, conta: await this.contextoConta(c.contaId) };
  }

  // --- Reajuste IPCA ---------------------------------------------------------------

  private async detalheReajuste(base: DetalheDossie, reajusteId: string): Promise<DetalheDossie> {
    const r = await this.prisma.db.reajusteIPCA.findFirst({
      where: { id: reajusteId },
      select: {
        indiceAplicado: true, valorParcelaAnterior: true, valorParcelaNovo: true, dataAniversario: true,
        contrato: { select: { numero: true, contaId: true, periodicidade: true, ativo: { select: { descricao: true, placa: true } } } },
      },
    });
    if (!r) return base;
    const anterior = cent(r.valorParcelaAnterior);
    const novo = cent(r.valorParcelaNovo);
    const blocos: BlocoDossie[] = [
      {
        titulo: 'O que muda',
        campos: [
          { rotulo: 'Contrato', valor: `${r.contrato.numero}${r.contrato.ativo ? ` · ${rotuloAtivo(r.contrato.ativo)}` : ''}` },
          { rotulo: 'Índice aplicado (IPCA)', valor: `${Number(r.indiceAplicado.toString()).toFixed(2).replace('.', ',')}%` },
          { rotulo: 'Parcela atual', valor: `${formatCurrency(anterior)} (${FREQ[r.contrato.periodicidade]})` },
          { rotulo: 'Parcela reajustada', valor: `${formatCurrency(novo)} (+ ${formatCurrency(novo - anterior)})`, tom: 'atencao' },
          { rotulo: 'Aniversário do contrato', valor: formatarDiaBR(r.dataAniversario) },
        ],
      },
    ];
    return { ...base, blocos, conta: await this.contextoConta(r.contrato.contaId) };
  }

  // --- Condição comercial fora do parâmetro -----------------------------------

  private async detalheProposta(base: DetalheDossie, propostaId: string, titularId: string | null): Promise<DetalheDossie> {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      select: {
        valorEntrada: true, valorParcela: true, numeroParcelas: true, frequencia: true,
        ativo: { select: { descricao: true, placa: true, valorVenda: true } },
      },
    });
    if (!p) return base;
    const freq = p.frequencia ? FREQ[p.frequencia] : null;
    const blocos: BlocoDossie[] = [
      {
        titulo: 'Condição proposta',
        campos: [
          { rotulo: 'Veículo', valor: rotuloAtivo(p.ativo) },
          ...(p.ativo.valorVenda ? [{ rotulo: 'Valor de venda do veículo', valor: formatCurrency(cent(p.ativo.valorVenda)) }] : []),
          { rotulo: 'Entrada', valor: formatCurrency(cent(p.valorEntrada)) },
          { rotulo: 'Plano', valor: `${p.numeroParcelas}× ${formatCurrency(cent(p.valorParcela))}${freq ? ` (${freq})` : ''}` },
        ],
        nota: 'O que está fora do parâmetro do produto aparece nos motivos acima.',
      },
    ];
    // Titular novo não tem conta; se já for cliente, o histórico vem junto.
    const conta = titularId ? await this.prisma.db.conta.findFirst({ where: { titularId }, select: { id: true } }) : null;
    return { ...base, blocos, conta: conta ? await this.contextoConta(conta.id) : null };
  }

  // --- Contas a pagar -----------------------------------------------------------

  private async detalheTitulo(base: DetalheDossie, tituloId: string): Promise<DetalheDossie> {
    const t = await this.prisma.db.tituloPagar.findFirst({
      where: { id: tituloId },
      select: {
        descricao: true, valor: true, vencimento: true, competencia: true, formaPagamento: true, responsavelEconomico: true,
        status: true, urgente: true, justificativaUrgencia: true, justificativaNatureza: true, ativoId: true, criadoPor: true, createdAt: true,
        natureza: { select: { nome: true, especial: true } },
        fornecedor: { select: { nome: true, status: true, alertaProximoPagamento: true } },
        contratoCredito: { select: { numero: true } },
      },
    });
    if (!t) return base;
    const ativo = t.ativoId ? await this.prisma.db.ativo.findFirst({ where: { id: t.ativoId }, select: { descricao: true, placa: true } }) : null;
    const blocos: BlocoDossie[] = [
      {
        titulo: 'Título a pagar',
        campos: [
          { rotulo: 'Descrição', valor: t.descricao },
          { rotulo: 'Natureza', valor: `${t.natureza.nome}${t.natureza.especial ? ' · natureza especial (Diretor)' : ''}` },
          { rotulo: 'Fornecedor', valor: t.fornecedor.nome },
          { rotulo: 'Valor', valor: formatCurrency(cent(t.valor)) },
          { rotulo: 'Vencimento', valor: formatarDiaBR(t.vencimento) },
          { rotulo: 'Forma de pagamento', valor: t.formaPagamento.toUpperCase() },
          { rotulo: 'Quem arca', valor: RESPONSAVEL[t.responsavelEconomico] ?? t.responsavelEconomico },
          ...(t.competencia ? [{ rotulo: 'Competência', valor: t.competencia }] : []),
          ...(ativo ? [{ rotulo: 'Veículo', valor: rotuloAtivo(ativo) }] : []),
          ...(t.contratoCredito ? [{ rotulo: 'Reembolso Parcelado', valor: `contrato ${t.contratoCredito.numero}` }] : []),
          ...(t.urgente ? [{ rotulo: 'Urgente', valor: t.justificativaUrgencia ?? 'sim', tom: 'atencao' as const }] : []),
        ],
      },
      {
        titulo: 'Fornecedor',
        campos: [
          { rotulo: 'Situação do cadastro', valor: t.fornecedor.status.toLowerCase().replace(/_/g, ' '), tom: t.fornecedor.status === 'ATIVO' ? 'ok' : 'atencao' },
          ...(t.fornecedor.alertaProximoPagamento ? [{ rotulo: 'Alerta', valor: 'dados bancários alterados recentemente — confira antes de pagar', tom: 'alerta' as const }] : []),
        ],
      },
    ];
    const observacao = t.justificativaNatureza || t.justificativaUrgencia
      ? { autor: t.criadoPor ? await this.nomeUsuario(t.criadoPor) : null, em: t.createdAt.toISOString(), texto: [t.justificativaNatureza, t.justificativaUrgencia].filter(Boolean).join(' · ') }
      : null;
    return { ...base, blocos, observacao };
  }

  private async detalheOrcamento(base: DetalheDossie, solicitacaoId: string): Promise<DetalheDossie> {
    const o = await this.prisma.db.solicitacaoOrcamento.findFirst({
      where: { id: solicitacaoId },
      select: {
        descricao: true, naturezaId: true, ativoId: true, urgencia: true, justificativaDispensa: true, solicitanteId: true, updatedAt: true,
        propostas: { orderBy: { valor: 'asc' }, select: { fornecedorId: true, nomeFornecedor: true, valor: true, prazo: true, garantia: true, condicao: true, selecionado: true, motivoSelecao: true } },
      },
    });
    if (!o) return base;
    const [natureza, ativo, fornecedores] = await Promise.all([
      o.naturezaId ? this.prisma.db.naturezaFinanceira.findFirst({ where: { id: o.naturezaId }, select: { nome: true } }) : null,
      o.ativoId ? this.prisma.db.ativo.findFirst({ where: { id: o.ativoId }, select: { descricao: true, placa: true } }) : null,
      this.prisma.db.fornecedorFin.findMany({ where: { id: { in: o.propostas.map((p) => p.fornecedorId).filter((x): x is string => !!x) } }, select: { id: true, nome: true } }),
    ]);
    const nome = (p: { fornecedorId: string | null; nomeFornecedor: string | null }) => p.nomeFornecedor ?? fornecedores.find((f) => f.id === p.fornecedorId)?.nome ?? '—';
    const escolhida = o.propostas.find((p) => p.selecionado);
    const blocos: BlocoDossie[] = [
      {
        titulo: `Cotações (${o.propostas.length})`,
        tabela: {
          colunas: ['Fornecedor', 'Valor', 'Prazo', 'Garantia', 'Condição', ''],
          direita: [1],
          linhas: o.propostas.map((p) => ({
            celulas: [nome(p), formatCurrency(cent(p.valor)), p.prazo ?? '—', p.garantia ?? '—', p.condicao ?? '—', p.selecionado ? 'Escolhida' : ''],
            destaque: p.selecionado,
          })),
        },
        nota: o.justificativaDispensa ? `Dispensa de cotação: ${o.justificativaDispensa}` : undefined,
      },
      {
        titulo: 'Pedido',
        campos: [
          { rotulo: 'Descrição', valor: o.descricao },
          ...(natureza ? [{ rotulo: 'Natureza', valor: natureza.nome }] : []),
          ...(ativo ? [{ rotulo: 'Veículo', valor: rotuloAtivo(ativo) }] : []),
          { rotulo: 'Urgência', valor: o.urgencia.toLowerCase(), tom: o.urgencia === 'NORMAL' ? undefined : 'atencao' },
          ...(escolhida ? [{ rotulo: 'Aprovar gera', valor: `título a pagar de ${formatCurrency(cent(escolhida.valor))} para ${nome(escolhida)}` }] : []),
        ],
      },
    ];
    const observacao = escolhida?.motivoSelecao
      ? { autor: o.solicitanteId ? await this.nomeUsuario(o.solicitanteId) : null, em: o.updatedAt.toISOString(), texto: escolhida.motivoSelecao }
      : null;
    return { ...base, blocos, observacao };
  }

  private async detalheFornecedor(base: DetalheDossie, fornecedorId: string): Promise<DetalheDossie> {
    const f = await this.prisma.db.fornecedorFin.findFirst({
      where: { id: fornecedorId },
      select: {
        nome: true, cpfCnpj: true, contato: true, email: true, status: true,
        dadosBancarios: { orderBy: { versao: 'desc' }, take: 2, select: { versao: true, banco: true, agencia: true, conta: true, chavePix: true, ativo: true, motivo: true, criadoPor: true, createdAt: true } },
      },
    });
    if (!f) return base;
    const [proposta, vigente] = f.dadosBancarios;
    const linha = (rot: string, d?: (typeof f.dadosBancarios)[number]) =>
      ({ celulas: [rot, d?.banco ?? '—', d?.agencia ?? '—', d?.conta ?? '—', d?.chavePix ?? '—'] });
    const blocos: BlocoDossie[] = [
      {
        titulo: 'Fornecedor',
        campos: [
          { rotulo: 'Nome', valor: f.nome },
          { rotulo: 'CPF/CNPJ', valor: f.cpfCnpj },
          { rotulo: 'Situação', valor: f.status.toLowerCase().replace(/_/g, ' ') },
          ...(f.contato ? [{ rotulo: 'Contato', valor: f.contato }] : []),
          ...(f.email ? [{ rotulo: 'E-mail', valor: f.email }] : []),
        ],
      },
      ...(proposta
        ? [{
            titulo: 'Dados bancários',
            tabela: {
              colunas: ['', 'Banco', 'Agência', 'Conta', 'Chave PIX'],
              linhas: [
                { ...linha(proposta.ativo ? `Versão ${proposta.versao} (vigente)` : `Versão ${proposta.versao} (para aprovar)`, proposta), destaque: !proposta.ativo },
                ...(vigente ? [linha(`Versão ${vigente.versao}${vigente.ativo ? ' (vigente)' : ''}`, vigente)] : []),
              ],
            },
          }]
        : []),
    ];
    const observacao = proposta?.motivo
      ? { autor: proposta.criadoPor ? await this.nomeUsuario(proposta.criadoPor) : null, em: proposta.createdAt.toISOString(), texto: proposta.motivo }
      : null;
    return { ...base, blocos, observacao };
  }

  private async detalheLote(base: DetalheDossie, loteId: string): Promise<DetalheDossie> {
    const l = await this.prisma.db.lotePagamento.findFirst({
      where: { id: loteId },
      select: {
        dataProgramada: true, totalValor: true, urgente: true, observacao: true,
        conta: { select: { banco: true, agencia: true, conta: true } },
        titulos: { orderBy: { vencimento: 'asc' }, select: { descricao: true, valor: true, vencimento: true, fornecedor: { select: { nome: true } }, natureza: { select: { nome: true } } } },
      },
    }).catch(() => null);
    if (!l) return base;
    const blocos: BlocoDossie[] = [
      {
        titulo: `Títulos do lote (${l.titulos.length})`,
        tabela: {
          colunas: ['Fornecedor', 'Descrição', 'Natureza', 'Vencimento', 'Valor'],
          direita: [4],
          linhas: l.titulos.map((t) => ({ celulas: [t.fornecedor.nome, t.descricao, t.natureza.nome, formatarDiaBR(t.vencimento), formatCurrency(cent(t.valor))] })),
        },
      },
      {
        titulo: 'Pagamento',
        campos: [
          { rotulo: 'Data programada', valor: formatarDiaBR(l.dataProgramada) },
          { rotulo: 'Total', valor: formatCurrency(cent(l.totalValor)) },
          { rotulo: 'Conta de saída', valor: [l.conta.banco, l.conta.agencia, l.conta.conta].filter(Boolean).join(' · ') || '—' },
          ...(l.urgente ? [{ rotulo: 'Urgente', valor: 'sim', tom: 'atencao' as const }] : []),
        ],
      },
    ];
    return { ...base, blocos, observacao: l.observacao ? { autor: null, em: null, texto: l.observacao } : null };
  }

  private async nomeUsuario(id: string): Promise<string | null> {
    const u = await this.prisma.db.usuario.findFirst({ where: { id }, select: { nome: true } });
    return u?.nome ?? null;
  }
}

