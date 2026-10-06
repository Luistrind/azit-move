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
  parcelaIncluiServicos?: boolean;
  indiceReajuste: string | null;
  multaAtrasoPct: number | null;
  jurosMensalPct: number | null;
  garantiaDias: number | null;
  observacoes: string | null;
}

export type SituacaoLinha = 'paga' | 'paga_com_encargo' | 'paga_por_acordo' | 'em_acordo' | 'pendente' | 'vencida' | 'nao_cobrada' | 'futura' | 'valor_diverge';
export type ModoConciliacao = 'SEQUENCIA' | 'DATA';
export type ConfiancaLinha = 'alta' | 'media' | 'baixa';
export interface LinhaConciliacao {
  chave: string; serie: 'parcela' | 'intermediaria' | 'entrada'; numero: number; esperadoEm: string; esperadoValor: number;
  cobrancaId: string | null; cobradoEm: string | null; cobradoValor: number | null; pagoEm: string | null; pagoValor: number | null;
  encargo: number; situacao: SituacaoLinha; divergencia: boolean; confianca: ConfiancaLinha;
  // O que veio junto na cobrança (despesa repassada, intermediária, parcela de acordo) — não é divergência.
  componentes: { seguro: number; taxa: number; intermediaria: number; extra: number; extraRotulo: string | null; acordo: number } | null;
  // Entrada paga em várias transações: as partes somadas.
  partes: { cobrancaId: string; vencimento: string; valor: number; classe: string }[];
  observacao: string | null; // ex.: cobrança reemitida por atraso, cronograma deslocado
  deslocamentoDias: number | null;
  acordoGrupo: string | null;
}
// Grupo de parcelas de acordo (doc 02 §26.14): o que elas somam e o que quitam.
export interface GrupoAcordo {
  id: string; rotulo: string;
  parcelas: { cobrancaId: string; vencimento: string; valor: number; k: number | null; n: number | null; classe: string; pagoEm: string | null; dentroDeParcela: boolean }[];
  total: number; pago: number; concluido: boolean;
  proposta: { quantidade: number; juros: number; desconto: number; chaves: string[]; texto: string };
  confirmado: { quantidade: number; chaves: string[] } | null;
}
export interface ForaDoCronograma {
  cobrancaId: string; vencimento: string; valorOriginal: number; tipo: TipoCobrancaLegada; classe: string; descricao: string | null; motivo: string; divergencia: boolean;
}
export interface ResumoConciliacao {
  parcelasEsperadas: number; parcelasPagas: number; parcelasPendentes: number; parcelasVencidas: number; parcelasNaoCobradas: number; parcelasFuturas: number;
  intermediariasPagas: number; intermediariasEsperadas: number; entradaPaga: boolean | null; encargosPagos: number; saldoContratualRestante: number;
  divergencias: number; cobrancasForaDoCronograma: number;
  linhasConferir: number; linhasDecidir: number; acordosSemConfirmar: number; deslocamentoSemanas: number;
}
export type DesfechoDivergencia = 'PAGA_FORA_ASAAS' | 'VALOR_ACEITO' | 'ADIADA' | 'COBRANCA_AVULSA';
export type ModoVencimentos = 'CONTRATO' | 'ASAAS';
export interface DivergenciaReconhecida { chave: string; nota: string; desfecho?: DesfechoDivergencia; em: string; por: string }
export interface VinculoManual { cobrancaId: string; chave: string; em: string; por: string }

export interface PlanoMigracao {
  titular: { cpfCnpj: string; nome: string; existente: { id: string; nome: string } | null };
  veiculo: { descricao: string; placa: string | null; existente: { id: string; descricao: string } | null; fipe: { valor: number; codigoFipe: string; modeloFipe: string; anoModelo: number; referencia: string; alternativas: string[] } | null; fipeMotivo: string | null };
  contrato: { numero: string; dataAssinatura: string; dataPrimeiraParcela: string; numeroParcelas: number; valorParcela: number; valorTotal: number; valorEntrada: number; modoVencimentos: string; taxaDescontoMensal: number | null };
  entrada: { valor: number; pagoEm: string; asaasChargeId: string | null } | null;
  faturas: { origem: string; vencimento: string; status: string; valorTotal: number; valorPago: number | null; pagoEm: string | null; asaasChargeId: string | null }[];
  rps: { rotulo: string; parcelas: { n: number; valor: number }[] }[];
  resumo: { faturasPagas: number; faturasFechadas: number; faturasAbertas: number; parcelasPagas: number; reembolsos: number; avulsas: number; encargos: number; assinaturaId: string | null; substituidas: number; emitidasAgora: number };
}
export interface MigracaoFeita {
  em: string; por: string | null; assinaturaParadaEm: string | null; assinaturaParadaErro: string | null; assinaturaId: string | null;
  resumo: { contratoNumero?: string; faturas?: number; faturasPagas?: number; faturasFechadas?: number; faturasAbertas?: number; reembolsos?: number; avulsas?: number; pdfCopiado?: boolean; cobrancasApagadas?: number; emitidasAgora?: number; cobrancasMantidas?: { vencimento: string; chargeId: string; erro: string }[]; orfasApagadas?: number; orfasErro?: string | null } | null;
}

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
  contratoDeOutroCliente: {
    cpfContrato: string; nomeContrato: string | null;
    casos: { id: string; nome: string; status: string; asaasCustomerId: string; totalCobrancas: number; cobrancasPagas: number; temContrato: boolean; fechado: boolean }[];
  } | null;
  conciliacao: { modo: ModoConciliacao; linhas: LinhaConciliacao[]; fora: ForaDoCronograma[]; acordos: GrupoAcordo[]; resumo: ResumoConciliacao; incompleta: boolean };
  modoConciliacao: ModoConciliacao;
  divergenciasReconhecidas: DivergenciaReconhecida[];
  vinculosManuais: VinculoManual[];
  modoVencimentos: ModoVencimentos;
  migracao: MigracaoFeita | null;
  desfechosDivergencia: { valor: DesfechoDivergencia; rotulo: string }[];
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
  async moverContrato(id: string, destinoId: string): Promise<{ movido: boolean; destinoId: string; destinoNome: string }> {
    const { data } = await api.post(`/api/v1/migracao-legado/casos/${id}/contrato/mover`, { destinoId });
    return data;
  },
  async retirarContrato(id: string): Promise<{ retirado: boolean }> {
    const { data } = await api.delete(`/api/v1/migracao-legado/casos/${id}/contrato`);
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
  async reconhecerDivergencia(id: string, chave: string, nota: string, desfecho: DesfechoDivergencia | ''): Promise<void> {
    await api.put(`/api/v1/migracao-legado/casos/${id}/divergencias/${encodeURIComponent(chave)}`, { nota, desfecho: desfecho || undefined });
  },
  async definirModoConciliacao(id: string, modo: ModoConciliacao): Promise<void> {
    await api.put(`/api/v1/migracao-legado/casos/${id}/conciliacao-modo`, { modo });
  },
  async confirmarAcordo(id: string, grupo: string, corpo: { quantidade?: number; chaves?: string[] }): Promise<void> {
    await api.put(`/api/v1/migracao-legado/casos/${id}/acordos/${encodeURIComponent(grupo)}`, corpo);
  },
  async desfazerAcordo(id: string, grupo: string): Promise<void> {
    await api.delete(`/api/v1/migracao-legado/casos/${id}/acordos/${encodeURIComponent(grupo)}`);
  },
  async definirModoVencimentos(id: string, modo: ModoVencimentos): Promise<void> {
    await api.put(`/api/v1/migracao-legado/casos/${id}/vencimentos`, { modo });
  },
  async desfazerReconhecimento(id: string, chave: string): Promise<void> {
    await api.delete(`/api/v1/migracao-legado/casos/${id}/divergencias/${encodeURIComponent(chave)}`);
  },
  async vincular(id: string, cobrancaId: string, chave: string): Promise<void> {
    await api.put(`/api/v1/migracao-legado/casos/${id}/vinculos/${cobrancaId}`, { chave });
  },
  async desvincular(id: string, cobrancaId: string): Promise<void> {
    await api.delete(`/api/v1/migracao-legado/casos/${id}/vinculos/${cobrancaId}`);
  },
  async previaMigracao(id: string): Promise<PlanoMigracao> {
    const { data } = await api.get<PlanoMigracao>(`/api/v1/migracao-legado/casos/${id}/migracao/previa`);
    return data;
  },
  async migrar(id: string): Promise<{ contratoId: string; titularId: string; contratoNumero: string; assinatura: { parada: boolean; motivo: string }; substituicao: { apagadas: number; emitidasAgora: number; mantidas: { vencimento: string; erro: string }[] } }> {
    const { data } = await api.post(`/api/v1/migracao-legado/casos/${id}/migrar`);
    return data;
  },
  async completar(id: string): Promise<{ taxa: number | null; taxaGravada: boolean; fipe: { valor: number; modeloFipe: string; referencia: string } | null; fipeGravada: boolean; fipeMotivo: string | null }> {
    const { data } = await api.post(`/api/v1/migracao-legado/casos/${id}/completar`);
    return data;
  },
  async limparCobrancasOrfas(id: string): Promise<{ apagadas: number; erro: string | null; vencimentos: string[] }> {
    const { data } = await api.post(`/api/v1/migracao-legado/casos/${id}/limpar-cobrancas-orfas`);
    return data;
  },
  async pararAssinatura(id: string): Promise<{ parada: boolean; motivo: string }> {
    const { data } = await api.post(`/api/v1/migracao-legado/casos/${id}/parar-assinatura`);
    return data;
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
