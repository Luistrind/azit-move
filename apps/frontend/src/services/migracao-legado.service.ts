import { api } from '../lib/api';

// Migração do legado (doc 02 §26) — bancada de conciliação dos clientes que
// já existem no Asaas. Valores em centavos; datas ISO (YYYY-MM-DD).

export interface CasoLegado {
  id: string;
  asaasCustomerId: string;
  nome: string;
  cpfCnpj: string | null;
  status: string;
  statusRotulo: string;
  situacao: string;
  situacaoRotulo: string;
  prioridade: number;
  totalCobrancas: number;
  cobrancasPagas: number;
  cobrancasPendentes: number;
  cobrancasVencidas: number;
  cobrancasOutras: number;
  valorParcelaPadrao: number | null;
  modeloSugerido: string | null;
  modeloRotulo: string | null;
  primeiraCobrancaEm: string | null;
  ultimaCobrancaEm: string | null;
  assinaturaAtiva: boolean;
  assinaturaValor: number | null;
  assinaturaCiclo: string | null;
  observacao: string | null;
  statusAlteradoEm: string | null;
  coletadoEm: string;
  titularId: string | null;
  contratoId: string | null;
}

export interface CobrancaLegada {
  id: string;
  asaasPaymentId: string;
  assinaturaId: string | null;
  valor: number;
  valorPago: number | null;
  vencimento: string;
  pagoEm: string | null;
  status: string;
  classe: 'paga' | 'pendente' | 'vencida' | 'outra';
  tipo: string | null;
  descricao: string | null;
  invoiceUrl: string | null;
  deletada: boolean;
}

export interface CasoLegadoDetalhe extends CasoLegado {
  email: string | null;
  telefone: string | null;
  assinatura: { id: string; status: string | null; valor: number | null; ciclo: string | null; proximoVencimento: string | null; descricao: string | null } | null;
  decomposicao: { parcelamento: number; seguro: number; taxaMensagens: number; padrao: boolean } | null;
  cobrancas: CobrancaLegada[];
}

export interface ResumoLegado {
  ambiente: 'simulado' | 'sandbox' | 'producao';
  coleta: {
    id: string;
    iniciadaEm: string;
    concluidaEm: string | null;
    emAndamento: boolean;
    erro: string | null;
    ambiente: string;
    clientesLidos: number;
    cobrancasLidas: number;
    casosNovos: number;
    casosAtualizados: number;
  } | null;
  porStatus: Record<string, number>;
  porSituacao: Record<string, number>;
  opcoes: { status: { valor: string; rotulo: string }[]; situacao: { valor: string; rotulo: string }[] };
}

export const migracaoLegadoService = {
  async resumo(): Promise<ResumoLegado> {
    const { data } = await api.get('/api/v1/migracao-legado/resumo');
    return data;
  },
  async coletar(): Promise<{ coletaId: string; ambiente: string }> {
    const { data } = await api.post('/api/v1/migracao-legado/coletar', {});
    return data;
  },
  async casos(f: { status?: string; situacao?: string; busca?: string } = {}): Promise<CasoLegado[]> {
    const { data } = await api.get('/api/v1/migracao-legado/casos', { params: f });
    return data;
  },
  async caso(id: string): Promise<CasoLegadoDetalhe> {
    const { data } = await api.get(`/api/v1/migracao-legado/casos/${id}`);
    return data;
  },
  async mudarStatus(id: string, status: string, observacao?: string): Promise<CasoLegado> {
    const { data } = await api.patch(`/api/v1/migracao-legado/casos/${id}/status`, { status, observacao });
    return data;
  },
  async anotar(id: string, observacao: string): Promise<CasoLegado> {
    const { data } = await api.patch(`/api/v1/migracao-legado/casos/${id}/observacao`, { observacao });
    return data;
  },
};
