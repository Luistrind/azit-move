import { api } from '../lib/api';

// Operações sobre contratos (Bloco 6). Valores em centavos.
export interface Acordo {
  id: string;
  status: string;
  contratoNumero: string;
  titularId: string;
  titular: string;
  valorTotalRenegociado: number;
  valorEntrada: number;
  numeroParcelasNovas: number;
  valorParcelaNova: number;
  dataCriacao: string;
  dataEfetivacao: string | null;
}

export interface Novacao {
  id: string;
  status: string;
  contratoOrigem: string;
  contratoNovo: string;
  saldoLiquidado: number;
  dataEfetivacao: string | null;
}

export interface ParcelaElegivel {
  id: string;
  display: string;
  dataVencimento: string;
  valorNominal: number;
}

// Elegíveis da CONTA (renegociação conta-cêntrica — Doc 2 §7.7).
// Desde 17/08 (doc Acordo de Pagamento V1.0): valores ATUALIZADOS com mora
// (RAP007) + visão por FATURA (unidade de negociação, RAP003-005).
export interface FaturaElegivel {
  faturaId: string;
  numero: number | null;
  dataVencimento: string | null;
  valorNominal: number;
  encargosMora: number;
  valorAtualizado: number;
  itens: { display: string; contratoNumero: string; valorAtualizado: number }[];
}
// Prévia do acordo (doc 02 §7.7, 2026-08-18). Valores em centavos; taxas em fração.
export interface PreviaAcordo {
  motor: 'catalogo' | 'placeholder';
  periodicidade: 'semanal' | 'quinzenal' | 'mensal';
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
}

export interface ElegivelConta {
  contaId: string;
  titularId: string;
  contratos: {
    contratoId: string;
    numero: string;
    descricao: string;
    valor: number;
    valorNominal: number;
    encargosMora: number;
    parcelas: ParcelaElegivel[];
  }[];
  faturas: FaturaElegivel[];
  // Faturas VINCENDAS próximas (35 dias) — o operador PODE incluí-las (opt-in, 30/08).
  faturasProximas: FaturaElegivel[];
  valorTotal: number;
  valorNominalTotal: number;
  encargosMoraTotal: number;
  faturasVencidas: number;
}

export interface SimulacaoQuitacao {
  fonte?: 'catalogo' | 'parametros';
  liquidacaoTotal?: boolean;
  comissaoIsentada?: number; // centavos — isenção na liquidação total (Catálogo)
  protecaoIsentada?: number;
  parcelas: { id: string; display: string; valorNominal: number; valorPresente: number; diasAteVencimento: number }[];
  valorNominalTotal: number;
  valorQuitacao: number;
  desconto: number;
}

export const operacoesService = {
  async acordos(): Promise<Acordo[]> {
    const { data } = await api.get<Acordo[]>('/api/v1/acordos');
    return data;
  },
  async elegivelConta(contaId: string): Promise<ElegivelConta> {
    const { data } = await api.get<ElegivelConta>(`/api/v1/contas/${contaId}/renegociacao/elegivel`);
    return data;
  },
  // Prévia do acordo — números do SERVIDOR (motor do Catálogo quando o produto
  // Acordo de Pagamento está ATIVO; senão divisão simples provisória).
  async simularRenegociacaoConta(
    contaId: string,
    body: { valorEntrada: number; numeroParcelasNovas: number; faturasExcluidas?: { faturaId: string; justificativa: string }[]; faturasVincendasIncluidas?: string[] },
  ): Promise<PreviaAcordo> {
    const { data } = await api.post(`/api/v1/contas/${contaId}/renegociacao/simular`, body);
    return data;
  },
  async criarRenegociacaoConta(
    contaId: string,
    body: {
      valorEntrada: number;
      numeroParcelasNovas: number;
      valorParcelaNova?: number;
      periodicidade?: 'semanal' | 'quinzenal' | 'mensal';
      dataPagamentoEntrada?: string;
      faturasExcluidas?: { faturaId: string; justificativa: string }[];
      faturasVincendasIncluidas?: string[];
    },
  ): Promise<{ id: string; status: string; valorTotalRenegociado: number; valorParcela: number; periodicidade: string; motor: string; excecoes: string[]; contratosAfetados: number }> {
    const { data } = await api.post(`/api/v1/contas/${contaId}/renegociacao`, body);
    return data;
  },
  async termoAcordo(acordoId: string): Promise<{ id: string; titular: string; disponivel: boolean; texto: string }> {
    const { data } = await api.get(`/api/v1/acordos/${acordoId}/termo`);
    return data;
  },
  async simularEntrada(acordoId: string): Promise<void> {
    await api.post(`/api/v1/dev/simular-entrada-acordo/${acordoId}`);
  },
  // 6.6 — Novação (recuperação radical): liquida o contrato origem e gera um novo.
  async novacoes(): Promise<Novacao[]> {
    const { data } = await api.get<Novacao[]>('/api/v1/novacoes');
    return data;
  },
  async novar(
    contratoId: string,
    body: {
      dataPrimeiraParcela: string;
      valorTotal: number;
      numeroParcelas: number;
      valorParcelaInicial: number;
      periodicidade: 'semanal' | 'quinzenal' | 'mensal';
    },
  ): Promise<{ id: string; contratoOrigem: string; contratoNovo: string; saldoLiquidado: number }> {
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/novacao`, body);
    return data;
  },
  async simularQuitacao(contratoId: string): Promise<SimulacaoQuitacao> {
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/quitacao/simular`, {});
    return data;
  },
  async quitar(contratoId: string): Promise<void> {
    await api.post(`/api/v1/contratos/${contratoId}/quitacao`, {});
  },
  async registrarSinistro(contratoId: string, valorIndenizacao: number): Promise<unknown> {
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/sinistro`, { valorIndenizacao });
    return data;
  },
  // 6.8 — Reajuste IPCA: propõe; aprovação e aplicação acontecem via motor de
  // aprovação (Central de Aprovações — Doc 2 §7.9-A).
  async reajustar(contratoId: string, indicePercentual: number): Promise<void> {
    await api.post(`/api/v1/contratos/${contratoId}/reajuste`, { indicePercentual });
  },
};
