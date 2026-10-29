import { api } from '../lib/api';

// Carteira consolidada por titular/conta (Doc 2: arquitetura centrada no titular).
import type { ContagemPorTipo } from './contrato.service';

// Posição por titular (decisão Luís 29/10/2026, doc 02 §5.2): Contratos = só os
// de veículo; atraso e faturas vencidas vêm das FATURAS da conta (régua única
// com a inadimplência dos cartões).
export interface PosicaoConta {
  contaId: string;
  titularId: string;
  titular: string;
  cpfCnpj: string;
  contratosAtivos: number; // contratos de VEÍCULO vigentes
  contratosPorTipo: ContagemPorTipo;
  reembolsosAtivos: number; // reembolsos parcelados + créditos avulsos em andamento
  contratosTotal: number;
  saldoDevedor: number; // centavos
  valorEmAtraso: number; // centavos — o que falta pagar das faturas vencidas em aberto
  faturasVencidas: number;
  bloqueada: boolean;
  situacao: 'em_dia' | 'em_atraso' | 'em_acordo' | 'bloqueada';
}

export const contaService = {
  async carteira(): Promise<PosicaoConta[]> {
    const { data } = await api.get<PosicaoConta[]>('/api/v1/contas/carteira');
    return data;
  },
};
