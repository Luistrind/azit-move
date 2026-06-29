import { api } from '../lib/api';

// Operações sobre contratos (Bloco 6). Valores em centavos.
export interface Acordo {
  id: string;
  status: string;
  contratoNumero: string;
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

export interface Elegivel {
  parcelas: { id: string; display: string; dataVencimento: string; valorNominal: number }[];
  valorTotal: number;
}

export interface SimulacaoQuitacao {
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
  async elegivel(contratoId: string): Promise<Elegivel> {
    const { data } = await api.get<Elegivel>(`/api/v1/contratos/${contratoId}/renegociacao/elegivel`);
    return data;
  },
  async criarRenegociacao(
    contratoId: string,
    body: { valorEntrada: number; numeroParcelasNovas: number; valorParcelaNova: number },
  ): Promise<{ id: string; nivelAlcada: number | null }> {
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/renegociacao`, body);
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
  // 6.8 — Reajuste IPCA: gera (pendente) -> aprova (alçada) -> aplica nas parcelas
  // futuras. Aqui encadeado para o operador disparar o ciclo.
  async reajustar(contratoId: string, indicePercentual: number): Promise<void> {
    const { data } = await api.post<{ id: string }>(`/api/v1/contratos/${contratoId}/reajuste`, { indicePercentual });
    await api.post(`/api/v1/reajustes/${data.id}/aprovar`);
    await api.post(`/api/v1/reajustes/${data.id}/aplicar`);
  },
};
