import { api } from '../lib/api';

// Configuração do simulador (Doc 2 §4-A.2/4-A.3). Valores em CENTAVOS.
export interface OfertaPadraoConfig {
  prazoMeses: number;
  frequencia: 'MENSAL' | 'QUINZENAL' | 'SEMANAL';
  valorEntrada: number;
}

export interface ParametrosSimulador {
  id: string;
  comissaoInicial: number;
  comissaoRecorrente: number;
  taxaMensal: number; // fração (0.02 = 2% a.m.)
  taxaDescontoAntecipacaoCR: number;
  entradaMinima: number;
  prazoMinMeses: number;
  prazoMaxMeses: number;
  prazosPadronizados: number[];
  fatorPrecificacaoSemanal: number;
  fatorPrecificacaoQuinzenal: number;
  fatorSemanal: number;
  fatorQuinzenal: number;
  validadeDias: number;
  ofertasPadrao: OfertaPadraoConfig[];
  vigenteDesde: string;
}

export interface OfertaFixaApi {
  id: string;
  nome: string;
  valorEntrada: number;
  valorParcela: number;
  frequencia: 'mensal' | 'quinzenal' | 'semanal';
  prazoMeses: number;
  ativa: boolean;
  vigente: boolean;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  ativosVinculados: number;
}

export const simuladorService = {
  async parametros(): Promise<ParametrosSimulador> {
    const { data } = await api.get<ParametrosSimulador>('/api/v1/simulador/parametros');
    return data;
  },
  async versoes(): Promise<ParametrosSimulador[]> {
    const { data } = await api.get<ParametrosSimulador[]>('/api/v1/simulador/parametros/versoes');
    return data;
  },
  async criarVersao(body: Omit<ParametrosSimulador, 'id' | 'vigenteDesde'>): Promise<ParametrosSimulador> {
    const { data } = await api.post<ParametrosSimulador>('/api/v1/simulador/parametros', body);
    return data;
  },
  async ofertasFixas(): Promise<OfertaFixaApi[]> {
    const { data } = await api.get<OfertaFixaApi[]>('/api/v1/simulador/ofertas-fixas');
    return data;
  },
  async criarOfertaFixa(body: {
    nome: string;
    valorEntrada: number;
    valorParcela: number;
    frequencia: 'mensal' | 'quinzenal' | 'semanal';
    prazoMeses: number;
    vigenciaFim?: string;
  }): Promise<OfertaFixaApi> {
    const { data } = await api.post<OfertaFixaApi>('/api/v1/simulador/ofertas-fixas', body);
    return data;
  },
  async atualizarOfertaFixa(id: string, body: { ativa?: boolean }): Promise<OfertaFixaApi> {
    const { data } = await api.patch<OfertaFixaApi>(`/api/v1/simulador/ofertas-fixas/${id}`, body);
    return data;
  },
};
