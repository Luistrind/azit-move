import { api } from '../lib/api';

// Controle de frota (doc 02 §25): situação do veículo, ocorrências e desfecho.
// Valores em centavos.

export interface ItemQuadro {
  id: string;
  placa: string | null;
  descricao: string;
  status: string; // relação com o contrato (camada 1)
  situacao: string;
  situacaoRotulo: string;
  situacaoDesde: string | null;
  diasNaSituacao: number | null;
  previsaoRetorno: string | null;
  atrasadoNoRetorno: boolean;
  contrato: { id: string; numero: string; titular: { id: string; nome: string } } | null;
  ocorrenciasAbertas: number;
}

export interface Ocorrencia {
  id: string;
  tipo: string;
  tipoRotulo: string;
  orgao: string | null;
  numeroAuto: string | null;
  descricao: string | null;
  dataFato: string;
  dataVencimento: string | null;
  prazoIndicacao: string | null;
  valor: number;
  valorComDesconto: number | null;
  responsavel: 'CLIENTE' | 'AZIT';
  responsavelJustificativa: string | null;
  status: string;
  statusRotulo: string;
  desfechoEm: string | null;
  desfechoObs: string | null;
  prazoComprovante: string | null;
  comprovanteEm: string | null;
  temComprovante: boolean;
  origem: string;
  ativo: { id: string; placa: string | null; descricao: string };
  contrato: { id: string; numero: string; titular: { id: string; nome: string } } | null;
  repasse: { faturaId: string; faturaNumero: number; vencimento: string; statusFatura: string } | null;
}

export interface OpcoesFrota {
  situacoes: { valor: string; rotulo: string }[];
  tipos: { valor: string; rotulo: string }[];
  status: { valor: string; rotulo: string }[];
}

export interface ResumoImportacao {
  lidas: number;
  criadas: number;
  atualizadas: number;
  ignoradas: { placa?: string; numeroAuto?: string; motivo: string }[];
  naoMapeadas: number;
  amostraBruta: unknown | null;
}

export const frotaService = {
  async quadro(): Promise<ItemQuadro[]> {
    const { data } = await api.get<ItemQuadro[]>('/api/v1/frota/quadro');
    return data;
  },
  async opcoes(): Promise<OpcoesFrota> {
    const { data } = await api.get<OpcoesFrota>('/api/v1/frota/opcoes');
    return data;
  },
  async mover(ativoId: string, body: { situacao: string; motivo?: string; previsaoRetorno?: string }) {
    await api.post(`/api/v1/frota/ativos/${ativoId}/situacao`, body);
  },
  async historico(ativoId: string) {
    const { data } = await api.get<{ id: string; em: string; deRotulo: string | null; paraRotulo: string; motivo: string | null; usuario: string | null }[]>(
      `/api/v1/frota/ativos/${ativoId}/historico`,
    );
    return data;
  },
  async ocorrencias(filtros: { status?: string; tipo?: string; responsavel?: string; ativoId?: string; busca?: string } = {}): Promise<Ocorrencia[]> {
    const { data } = await api.get<Ocorrencia[]>('/api/v1/frota/ocorrencias', { params: filtros });
    return data;
  },
  async registrar(body: { ativoId?: string; placa?: string; tipo: string; orgao?: string; numeroAuto?: string; descricao?: string; dataFato: string; dataVencimento?: string; prazoIndicacao?: string; valor?: number }) {
    await api.post('/api/v1/frota/ocorrencias', body);
  },
  async definirResponsavel(id: string, responsavel: 'CLIENTE' | 'AZIT', justificativa: string) {
    await api.post(`/api/v1/frota/ocorrencias/${id}/responsavel`, { responsavel, justificativa });
  },
  async clientePaga(id: string, body: { prazoComprovante?: string; observacao?: string }) {
    await api.post(`/api/v1/frota/ocorrencias/${id}/cliente-paga`, body);
  },
  async comprovante(id: string, body: { arquivo?: { nome: string; conteudo: string }; observacao?: string }) {
    await api.post(`/api/v1/frota/ocorrencias/${id}/comprovante`, body);
  },
  async repassar(id: string, valor?: number) {
    const { data } = await api.post<{ resultado: string; faturaNumero: number; vencimento: string; valor: number }>(
      `/api/v1/frota/ocorrencias/${id}/repassar`,
      { valor },
    );
    return data;
  },
  async assumir(id: string, observacao?: string) {
    await api.post(`/api/v1/frota/ocorrencias/${id}/assumir`, { observacao });
  },
  async recurso(id: string, body: { prazo?: string; observacao?: string }) {
    await api.post(`/api/v1/frota/ocorrencias/${id}/recurso`, body);
  },
  async cancelar(id: string, motivo: string) {
    await api.post(`/api/v1/frota/ocorrencias/${id}/cancelar`, { motivo });
  },
  async reabrir(id: string, motivo: string) {
    await api.post(`/api/v1/frota/ocorrencias/${id}/reabrir`, { motivo });
  },
  // Robô do Infleet: a credencial vai só nesta chamada e não é guardada.
  async importarInfleet(usuario: string, senha: string): Promise<ResumoImportacao> {
    const { data } = await api.post<ResumoImportacao>('/api/v1/frota/ocorrencias/importar-infleet', { usuario, senha });
    return data;
  },
  abrirComprovante(id: string) {
    void api.get(`/api/v1/frota/ocorrencias/${id}/comprovante`, { responseType: 'blob' }).then((r) => {
      const url = URL.createObjectURL(r.data as Blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  },
};
