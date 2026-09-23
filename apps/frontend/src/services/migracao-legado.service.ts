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
  recente: boolean; // assinatura ativa e nenhuma parcela paga ainda (cliente novo)
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
  // F2: leitura da descrição
  valorOriginal: number;
  encargoPago: number | null;
  tipoInterpretado: TipoCobrancaLegada | null;
  tipoRotulo: string | null;
  interpretacao: { tipo: TipoCobrancaLegada; parcelamento: number; seguro: number; taxa: number; intermediaria: number; extra: number; extraRotulo: string | null; encargo: number; duvida: boolean; motivo: string } | null;
  interpretadoPor: 'regra' | 'ia' | 'operador' | null;
  duvida: boolean;
  interpretacaoObs: string | null;
}

export type TipoCobrancaLegada = 'parcela' | 'intermediaria' | 'entrada' | 'acordo' | 'reembolso' | 'outra';

export interface SerieParcelas { total: number | null; quantidade: number | null; valor: number | null; primeiraEm: string | null }
export interface TermosContratoLegado {
  numeroOrigem: string | null;
  dataAssinatura: string | null;
  compradorNome: string | null;
  compradorCpf: string | null;
  garantidorNome: string | null;
  garantidorCpf: string | null;
  veiculo: { marca: string | null; modelo: string | null; anoFabricacao: number | null; anoModelo: number | null; cor: string | null; placa: string | null; chassi: string | null; renavam: string | null; origem: string | null; combustivel: string | null; quilometragem: number | null };
  valorTotal: number | null;
  entradaValor: number | null;
  parcelas: SerieParcelas;
  intermediarias: SerieParcelas | null;
  seguroSemanal: number;
  taxaSemanal: number;
  indiceReajuste: string | null;
  multaAtrasoPct: number | null;
  jurosMensalPct: number | null;
  garantiaDias: number | null;
  observacoes: string | null;
}

export type SituacaoLinha = 'paga' | 'paga_com_encargo' | 'pendente' | 'vencida' | 'nao_cobrada' | 'futura' | 'valor_diverge';
export interface LinhaConciliacao {
  chave: string; serie: 'parcela' | 'intermediaria' | 'entrada'; numero: number; esperadoEm: string; esperadoValor: number;
  cobrancaId: string | null; cobradoEm: string | null; cobradoValor: number | null; pagoEm: string | null; pagoValor: number | null;
  encargo: number; situacao: SituacaoLinha; divergencia: boolean;
  // O que veio junto na cobrança (despesa repassada, intermediária) — não é divergência.
  componentes: { seguro: number; taxa: number; intermediaria: number; extra: number; extraRotulo: string | null } | null;
  // Entrada paga em várias transações: as partes somadas.
  partes: { cobrancaId: string; vencimento: string; valor: number; classe: string }[];
  observacao: string | null; // ex.: cobrança reemitida por atraso
}
export interface ForaDoCronograma {
  cobrancaId: string; vencimento: string; valorOriginal: number; tipo: TipoCobrancaLegada; classe: string; descricao: string | null; motivo: string; divergencia: boolean;
}
export interface ResumoConciliacao {
  parcelasEsperadas: number; parcelasPagas: number; parcelasPendentes: number; parcelasVencidas: number; parcelasNaoCobradas: number; parcelasFuturas: number;
  intermediariasPagas: number; intermediariasEsperadas: number; entradaPaga: boolean | null; encargosPagos: number; saldoContratualRestante: number;
  divergencias: number; cobrancasForaDoCronograma: number;
}
export interface DivergenciaReconhecida { chave: string; nota: string; em: string; por: string }

export interface CasoLegadoDetalhe extends CasoLegado {
  email: string | null;
  telefone: string | null;
  assinatura: { id: string; status: string | null; valor: number | null; ciclo: string | null; proximoVencimento: string | null; descricao: string | null } | null;
  decomposicao: { parcelamento: number; seguro: number; taxaMensagens: number; padrao: boolean } | null;
  cobrancas: CobrancaLegada[];
  // F2
  termos: TermosContratoLegado | null;
  termosFaltantes: string[];
  termosAtualizadosEm: string | null;
  pdf: { nome: string | null; em: string | null } | null;
  extracaoPdf: { modeloReconhecido: boolean; extraidos: string[]; faltantes: string[]; cpfDiverge: boolean; erro: string | null } | null;
  conciliacao: { linhas: LinhaConciliacao[]; fora: ForaDoCronograma[]; resumo: ResumoConciliacao; incompleta: boolean };
  divergenciasReconhecidas: DivergenciaReconhecida[];
  pendenciasParaValidar: string[];
  validadoEm: string | null;
  tiposCobranca: { valor: TipoCobrancaLegada; rotulo: string }[];
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
  // ---- F2 ----
  async salvarTermos(id: string, termos: TermosContratoLegado): Promise<{ salvo: boolean; faltantes: string[] }> {
    const { data } = await api.put(`/api/v1/migracao-legado/casos/${id}/termos`, termos);
    return data;
  },
  async anexarPdf(id: string, nome: string, conteudo: string): Promise<{ anexado: boolean; modeloReconhecido: boolean; extraidos: string[]; faltantes: string[]; cpfDiverge: boolean; preenchido: boolean; erroLeitura: string | null }> {
    const { data } = await api.post(`/api/v1/migracao-legado/casos/${id}/pdf`, { nome, conteudo });
    return data;
  },
  urlPdf(id: string): string {
    return `${import.meta.env.VITE_API_URL}/api/v1/migracao-legado/casos/${id}/pdf`;
  },
  async reinterpretar(id: string): Promise<{ interpretadas: number }> {
    const { data } = await api.post(`/api/v1/migracao-legado/casos/${id}/interpretar`, {});
    return data;
  },
  async definirInterpretacao(id: string, cobrancaId: string, corpo: { tipo: TipoCobrancaLegada; parcelamento?: number; seguro?: number; taxa?: number; intermediaria?: number; extra?: number; extraRotulo?: string; encargo?: number; observacao?: string }): Promise<CobrancaLegada> {
    const { data } = await api.put(`/api/v1/migracao-legado/casos/${id}/cobrancas/${cobrancaId}/interpretacao`, corpo);
    return data;
  },
  async desfazerInterpretacao(id: string, cobrancaId: string): Promise<void> {
    await api.delete(`/api/v1/migracao-legado/casos/${id}/cobrancas/${cobrancaId}/interpretacao`);
  },
  async reconhecerDivergencia(id: string, chave: string, nota: string): Promise<void> {
    await api.put(`/api/v1/migracao-legado/casos/${id}/divergencias/${encodeURIComponent(chave)}`, { nota });
  },
  async desfazerReconhecimento(id: string, chave: string): Promise<void> {
    await api.delete(`/api/v1/migracao-legado/casos/${id}/divergencias/${encodeURIComponent(chave)}`);
  },
  async validar(id: string): Promise<{ validado: boolean }> {
    const { data } = await api.post(`/api/v1/migracao-legado/casos/${id}/validar`, {});
    return data;
  },
  async anotar(id: string, observacao: string): Promise<CasoLegado> {
    const { data } = await api.patch(`/api/v1/migracao-legado/casos/${id}/observacao`, { observacao });
    return data;
  },
};
