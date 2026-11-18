import { api } from '../lib/api';

// Carteira consolidada por titular/conta (Doc 2: arquitetura centrada no titular).
export interface PosicaoConta {
  contaId: string;
  titularId: string;
  titular: string;
  cpfCnpj: string;
  contratosAtivos: number;
  contratosTotal: number;
  saldoDevedor: number; // centavos
  valorEmAtraso: number; // centavos
  faturasVencidas: number;
  bloqueada: boolean;
  situacao: 'em_dia' | 'em_atraso' | 'em_acordo' | 'bloqueada' | 'sem_contrato_ativo';
}

// Resumo da grade de clientes (doc 02 §27.8): valor sob gestão a VALOR PRESENTE
// (mesma conta da quitação antecipada) e nominal de referência.
export interface ResumoCarteira {
  contas: number;
  contasEmAtraso: number;
  contasBloqueadas: number;
  // Contas da grade sem contrato ATIVO (encerradas ou em formalização) — fora de `contas`.
  contasSemContratoAtivo: number;
  contratosAtivos: number;
  valorSobGestaoPresente: number; // centavos
  valorSobGestaoNominal: number; // centavos
  valorEmAtraso: number; // centavos
}

export const contaService = {
  async resumo(): Promise<ResumoCarteira> {
    const { data } = await api.get<ResumoCarteira>('/api/v1/contas/carteira/resumo');
    return data;
  },
  async carteira(): Promise<PosicaoConta[]> {
    const { data } = await api.get<PosicaoConta[]>('/api/v1/contas/carteira');
    return data;
  },
};
