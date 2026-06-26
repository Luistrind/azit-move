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
};
