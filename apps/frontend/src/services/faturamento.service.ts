import type { GrupoCascataFatura, ParametrosFaturamentoResposta } from '@azit/types';
import { api } from '../lib/api';

// Configurações › Faturamento (doc 02 §32.8): parâmetros versionados + a chave
// do Pix sob demanda (§32.4-A). Dinheiro em centavos; percentuais em pontos.
export interface SalvarParametrosFaturamento {
  pixSobDemanda?: boolean;
  multaPadraoPct?: number;
  atualizacaoMesPadraoPct?: number;
  cascata?: GrupoCascataFatura[];
  minimoParcialPct?: number;
  minimoParcialPiso?: number;
  tetoIntencoesDia?: number;
  motivo?: string | null;
}

export const faturamentoService = {
  async obter(): Promise<ParametrosFaturamentoResposta> {
    const { data } = await api.get('/api/v1/faturamento/parametros');
    return data;
  },
  async salvar(body: SalvarParametrosFaturamento): Promise<ParametrosFaturamentoResposta> {
    const { data } = await api.post('/api/v1/faturamento/parametros', body);
    return data;
  },
};
