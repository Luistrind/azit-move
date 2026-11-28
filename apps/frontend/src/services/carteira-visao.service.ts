import { api } from '../lib/api';
import type { GrupoMudancaFoto, GrupoVariacaoTeto, ResumoEstado, VariacaoTeto, VisaoCarteira, VisaoMensal } from '@azit/utils';

// Visão da carteira por período (doc 02 §27) — três rotas, uma agregação.
// Teto/pagas/vencidas/a vencer por VENCIMENTO; `recebido` é CAIXA (data de pagamento).
export interface VisaoPeriodo extends VisaoCarteira {
  periodo: { de: string; ate: string };
  hoje: string;
  // Clientes ativos (conta com contrato ATIVO) e quem deles não tem fatura no período.
  ativos: { clientes: number; semFatura: ClienteSemFatura[] };
}
export interface ClienteSemFatura {
  contaId: string;
  titularId: string;
  titular: string;
  proximaFatura: string | null; // YYYY-MM-DD
}
// Por que o teto muda de um mês para o outro (doc 02 §27.10) — a conta é de `explicarVariacaoTeto`.
export interface ContaVariacao { contaId: string; titularId: string; titular: string; valor: number; faturas: number }
export interface VariacaoTetoNomeada extends Omit<VariacaoTeto, 'grupos'> {
  grupos: (Omit<GrupoVariacaoTeto, 'contas'> & { contas: ContaVariacao[] })[];
}
export type EstadoVisao = 'recebidas' | 'vencidas' | 'a_vencer';
export interface ClienteVisao {
  contaId: string;
  titularId: string;
  titular: string;
  valor: number; // centavos
  faturas: number; // recebidas: recebimentos (faturas + entradas)
  maisAntiga: string; // YYYY-MM-DD (recebidas: primeiro pagamento)
  ultimoPagamento?: string; // YYYY-MM-DD — só em recebidas
  bloqueada: boolean;
}

// Foto do início do mês (doc 02 §27.12): início × agora e a ponte do que mudou.
export interface ComparacaoFoto {
  mes: string;
  foto: null | {
    tiradaEm: string; // ISO
    inicio: { teto: ResumoEstado; porProduto: { chave: string; rotulo: string; teto: number }[] };
    ponte: {
      tetoFoto: number;
      tetoAgora: number;
      diferenca: number;
      grupos: (Omit<GrupoMudancaFoto, 'contas'> & { contas: { contaId: string; titularId: string; titular: string; valor: number; faturas: number }[] })[];
    };
  };
}

export const carteiraVisaoService = {
  async periodo(de: string, ate: string): Promise<VisaoPeriodo> {
    const { data } = await api.get<VisaoPeriodo>('/api/v1/contas/carteira/visao', { params: { de, ate } });
    return data;
  },
  async mensal(de: string, ate: string): Promise<VisaoMensal[]> {
    const { data } = await api.get<VisaoMensal[]>('/api/v1/contas/carteira/visao/mensal', { params: { de, ate } });
    return data;
  },
  // Primeiro e último mês com fatura contável (doc 02 §27.11).
  async limites(): Promise<{ primeiroMes: string | null; ultimoMes: string | null }> {
    const { data } = await api.get<{ primeiroMes: string | null; ultimoMes: string | null }>('/api/v1/contas/carteira/visao/limites');
    return data;
  },
  async variacao(de: string, para: string): Promise<VariacaoTetoNomeada> {
    const { data } = await api.get<VariacaoTetoNomeada>('/api/v1/contas/carteira/visao/variacao', { params: { de, para } });
    return data;
  },
  async foto(mes: string): Promise<ComparacaoFoto> {
    const { data } = await api.get<ComparacaoFoto>('/api/v1/contas/carteira/foto', { params: { mes } });
    return data;
  },
  // Só fora de produção (ferramenta de teste): tira ou refaz agora a foto do mês corrente.
  async tirarFotoTeste(): Promise<{ criada: boolean; faturas: number; tiradaEm: string }> {
    const { data } = await api.post('/api/v1/contas/carteira/foto/teste');
    return data;
  },
  async clientes(de: string, ate: string, estado: EstadoVisao): Promise<ClienteVisao[]> {
    const { data } = await api.get<ClienteVisao[]>('/api/v1/contas/carteira/visao/clientes', { params: { de, ate, estado } });
    return data;
  },
};
