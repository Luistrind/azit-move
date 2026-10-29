import { api } from '../lib/api';

// Chamadas da Carteira / Contrato (Doc 7 itens 3.7–3.8). Valores em centavos.

export interface ContratoListaItem {
  id: string;
  numero: string;
  status: string;
  dataAssinatura: string;
  valorTotal: number;
  saldoDevedor: number;
  saldoDevedorAtual: number;
  numeroParcelas: number;
  parcelasPagas: number;
  titular: { id: string; nome: string; cpfCnpj: string };
  ativo: { placa: string | null; modelo: string | null; anoModelo: number | null } | null; // null = sem ativo (RP)
}

export interface ListaContratos {
  total: number;
  page: number;
  limit: number;
  data: ContratoListaItem[];
}

// Tipo DERIVADO do contrato (função única em @azit/utils, doc 02 §5.2, 29/10).
export type TipoContrato = 'veiculo' | 'reembolso' | 'credito' | 'termo_novacao';
export type ContagemPorTipo = Record<TipoContrato, number>;

// Composição do recebido (centavos). A janela é a de sempre — últimos 7 dias
// corridos (correção Luís 29/10) — e o total é o mesmo número de antes:
// valor pago das parcelas + lançamentos de entrada.
export interface RecebidoComposicao {
  veiculo: number; // principal das parcelas de veículo
  acordos: number; // cotas de acordo (itens de origem ACORDO) + Termo de novação
  reembolsos: number; // cotas de reembolso parcelado / crédito avulso
  encargos: number; // juros e multa pagos
  entradas: number; // lançamentos (entrada de contrato / de acordo)
  total: number;
}

// KPIs da Carteira por CONTA e por TIPO (decisão Luís 29/10/2026).
export interface ContratoKpis {
  totalContratos: number;
  porStatus: { status: string; total: number }[];
  saldoDevedorTotal: number;
  carteiraSobGestao: number; // = carteira.total
  carteira: { veiculo: number; acordos: number; reembolsos: number; total: number };
  contratosAtivos: number; // só contratos de VEÍCULO vigentes
  contratosAtivosPorTipo: ContagemPorTipo;
  contratosAtivosTotal: number;
  inadimplencia: {
    contasBase: number; // contas com contrato de veículo vigente
    contasInadimplentes: number; // contas da base com fatura vencida em aberto
    contasEmAtrasoForaDaBase: number; // fatura vencida sem veículo vigente (não entra no %)
    pct: number;
    valorEmAtraso: number; // centavos — o que falta pagar das faturas vencidas
    faturasVencidas: number;
  };
  inadimplentes: number; // = inadimplencia.contasInadimplentes
  inadimplenciaPct: number; // = inadimplencia.pct
  recebido: RecebidoComposicao;
  recebidoNaSemana: number; // = recebido.total
}

export interface ContratoDetalhe {
  id: string;
  numero: string;
  status: string;
  dataAssinatura: string;
  dataPrimeiraParcela: string;
  valorTotal: number;
  valorEntrada: number;
  saldoDevedor: number;
  numeroParcelas: number;
  periodicidade: string;
  // Três camadas (doc 02 §5.2, 07/09): situação calculada + intervenções.
  situacaoFinanceira: 'em_dia' | 'em_atraso' | 'em_acordo' | null;
  diasAtraso: number;
  veiculoBloqueadoEm: string | null;
  recuperacaoIniciadaEm: string | null;
  transferenciaEfetivadaEm: string | null;
  motivoEncerramento: string | null;
  // Novação que extinguiu este contrato (encerrado por novação) — link para o detalhe em Renegociações.
  novacaoOrigemId: string | null;
  titular: { id: string; nome: string; cpfCnpj: string; whatsapp: string };
  // null = contrato sem ativo (Reembolso Parcelado — doc 02 §19, 12/09).
  ativo: {
    placa: string | null;
    modelo: string | null;
    descricao: string;
    anoModelo: number | null;
    // Doc 02 §19 (20/09): a estrutura dona substituiu "origem de capital".
    estruturaJuridica: string | null;
  } | null;
  resumo: {
    parcelasPagas: number;
    totalParcelas: number;
    valorPago: number;
    encargosPagos?: number; // juros e multa pagos — fora do valor pago (02/10)
    saldoDevedorAtual: number;
    proximaParcela: { numero: number; dataVencimento: string; valorNominal: number } | null;
  };
}

export interface ParcelaCronograma {
  id: string;
  numero: number;
  totalParcelas: number;
  display: string;
  valorNominal: number;
  dataVencimento: string;
  status: string;
  composicao: string | null;
}

export interface ExtratoEvento {
  tipo: string;
  label: string;
  data: string;
  valor: number;
  encargo: number;
  atraso: boolean;
}

export const contratoService = {
  async kpis(): Promise<ContratoKpis> {
    const { data } = await api.get<ContratoKpis>('/api/v1/contratos/kpis');
    return data;
  },
  async listar(params: { page?: number; limit?: number; status?: string } = {}): Promise<ListaContratos> {
    const { data } = await api.get<ListaContratos>('/api/v1/contratos', { params });
    return data;
  },
  // Reserva de domínio transferida (doc 02 §5.2) — só Encerrado por quitação.
  async registrarTransferencia(id: string): Promise<{ resultado: string; em: string }> {
    const { data } = await api.post(`/api/v1/contratos/${id}/transferencia-efetivada`);
    return data;
  },
  async detalhe(id: string): Promise<ContratoDetalhe> {
    const { data } = await api.get<ContratoDetalhe>(`/api/v1/contratos/${id}`);
    return data;
  },
  async cronograma(id: string): Promise<ParcelaCronograma[]> {
    const { data } = await api.get<ParcelaCronograma[]>(`/api/v1/contratos/${id}/cronograma`);
    return data;
  },
  async extrato(id: string): Promise<ExtratoEvento[]> {
    const { data } = await api.get<ExtratoEvento[]>(`/api/v1/contratos/${id}/extrato`);
    return data;
  },
  async documento(id: string): Promise<{ numero: string; texto: string; disponivel: boolean }> {
    const { data } = await api.get(`/api/v1/contratos/${id}/documento`);
    return data;
  },
  // Dev: simula o pagamento da próxima parcela (dispara a conciliação real).
  async simularPagamento(id: string): Promise<void> {
    await api.post(`/api/v1/dev/simular-pagamento/${id}`);
  },
  // Bloco B (15/09): cancela contrato não efetivado (aguardando assinatura/
  // entrada) — libera o veículo; a proposta volta a ser reformalizável.
  async cancelarNaoEfetivado(id: string, motivo?: string): Promise<void> {
    await api.post(`/api/v1/contratos/${id}/cancelar`, { motivo });
  },
};
