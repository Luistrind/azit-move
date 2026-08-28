import { api } from '../lib/api';

// Catálogo de Produtos F1 (doc 02 §17). Dinheiro em CENTAVOS; percentual em fração.

export type ValorParametro = string | number | boolean;
export type Parametros = Record<string, ValorParametro>;

export interface ProdutoCatalogoResumo {
  id: string;
  chave: string;
  nome: string;
  finalidade: string | null;
  classificacao: string | null;
  status: string;
  contratacaoAvulsa: boolean;
  variantes: { id: string; chave: string; nome: string; status: string }[];
  totalVersoes: number;
  versaoVigenteProduto: number | null;
}

// Produto contratável avulso por cliente ativo (doc 02 §17) — fonte do
// modal "+ Contratar crédito".
export interface ProdutoAvulso {
  id: string;
  chave: string;
  nome: string;
  finalidade: string | null;
  descricao: string | null;
}

export interface VarianteDetalhe {
  id: string;
  chave: string;
  nome: string;
  status: string;
  versao: number | null;
  parametros: Parametros;
  parametrosEfetivos: Parametros;
}

export interface ProdutoCatalogoDetalhe {
  id: string;
  chave: string;
  nome: string;
  finalidade: string | null;
  classificacao: string | null;
  descricao: string | null;
  status: string;
  parametrosProduto: Parametros;
  versaoProduto: number | null;
  variantes: VarianteDetalhe[];
  versoes: { id: string; numero: number; nivel: string; vigenteDesde: string; vigenteAte: string | null; observacao: string | null; parametros: Parametros }[];
}

export const catalogoService = {
  async listar(): Promise<ProdutoCatalogoResumo[]> {
    const { data } = await api.get<ProdutoCatalogoResumo[]>('/api/v1/catalogo');
    return data;
  },
  async detalhe(id: string): Promise<ProdutoCatalogoDetalhe> {
    const { data } = await api.get<ProdutoCatalogoDetalhe>(`/api/v1/catalogo/${id}`);
    return data;
  },
  async mudarStatus(id: string, status: string) {
    const { data } = await api.post(`/api/v1/catalogo/${id}/status`, { status });
    return data;
  },
  async statusVariante(id: string, varianteId: string, status: string) {
    const { data } = await api.post(`/api/v1/catalogo/${id}/variantes/${varianteId}/status`, { status });
    return data;
  },
  async criarVersao(id: string, body: { varianteId?: string | null; parametros: Parametros; observacao?: string }) {
    const { data } = await api.post<{ id: string; numero: number }>(`/api/v1/catalogo/${id}/versoes`, body);
    return data;
  },
  async atualizarCadastral(id: string, body: { nome?: string; finalidade?: string; descricao?: string; contratacaoAvulsa?: boolean }) {
    const { data } = await api.patch(`/api/v1/catalogo/${id}`, body);
    return data;
  },
  async avulsos(): Promise<ProdutoAvulso[]> {
    const { data } = await api.get<ProdutoAvulso[]>('/api/v1/catalogo/avulsos');
    return data;
  },
};

// Nome por extenso e tipo de exibição de cada parâmetro conhecido (P4 — sem sigla em tela).
export type TipoParametro = 'dinheiro' | 'percentual' | 'inteiro' | 'texto' | 'booleano';
export const PARAMETROS_CONHECIDOS: Record<string, { nome: string; tipo: TipoParametro }> = {
  // gerais / datas e cobrança
  atualizacaoMonetaria: { nome: 'Índice de atualização monetária', tipo: 'texto' },
  multaMoratoria: { nome: 'Multa moratória', tipo: 'percentual' },
  jurosMoraMensal: { nome: 'Juros de mora ao mês', tipo: 'percentual' },
  meioPagamento: { nome: 'Meio de pagamento', tipo: 'texto' },
  prazoAtivacaoDias: { nome: 'Prazo máximo entre assinatura e ativação (dias)', tipo: 'inteiro' },
  primeiroVencimentoMensalDias: { nome: 'Primeiro vencimento — mensal (dias)', tipo: 'inteiro' },
  primeiroVencimentoQuinzenalDias: { nome: 'Primeiro vencimento — quinzenal (dias)', tipo: 'inteiro' },
  primeiroVencimentoSemanalDias: { nome: 'Primeiro vencimento — semanal (dias)', tipo: 'inteiro' },
  primeiroVencimentoDiariaDias: { nome: 'Primeiro vencimento — diária (dias)', tipo: 'inteiro' },
  baseMensalDias: { nome: 'Base mensal para pró-rata (dias)', tipo: 'inteiro' },
  criterioElegibilidadeBem: { nome: 'Critério de elegibilidade do bem', tipo: 'texto' },
  // compra parcelada — variante
  entradaMinima: { nome: 'Entrada mínima', tipo: 'dinheiro' },
  prazoMinimoMeses: { nome: 'Prazo mínimo do contrato (meses)', tipo: 'inteiro' },
  prazoMaximoMeses: { nome: 'Prazo máximo do contrato (meses)', tipo: 'inteiro' },
  taxaRemuneracaoMensal: { nome: 'Taxa mensal de remuneração do capital', tipo: 'percentual' },
  comissaoInicial: { nome: 'Comissão inicial de consignação', tipo: 'dinheiro' },
  comissaoRecorrenteMensal: { nome: 'Comissão recorrente mensal', tipo: 'dinheiro' },
  taxaDescontoBemAntecipacao: { nome: 'Desconto do bem por antecipação (taxa mensal)', tipo: 'percentual' },
  taxaDescontoComissaoAntecipacao: { nome: 'Desconto da comissão por antecipação (taxa mensal)', tipo: 'percentual' },
  isencaoComissaoLiquidacao: { nome: 'Isenção da comissão recorrente na liquidação antecipada', tipo: 'booleano' },
  protecaoObrigatoria: { nome: 'Proteção veicular obrigatória', tipo: 'booleano' },
  protecaoMensal: { nome: 'Proteção veicular mensal', tipo: 'dinheiro' },
  taxaDescontoProtecaoAntecipacao: { nome: 'Desconto da proteção por antecipação (taxa mensal)', tipo: 'percentual' },
  isencaoProtecaoLiquidacao: { nome: 'Isenção da proteção na liquidação antecipada', tipo: 'booleano' },
  modeloContrato: { nome: 'Modelo de contrato', tipo: 'texto' },
  oferta1Desativada: { nome: 'Condição padrão 1 — desativada (some do atendimento)', tipo: 'booleano' },
  oferta2Desativada: { nome: 'Condição padrão 2 — desativada (some do atendimento)', tipo: 'booleano' },
  oferta3Desativada: { nome: 'Condição padrão 3 — desativada (some do atendimento)', tipo: 'booleano' },
  oferta1PrazoMeses: { nome: 'Condição padrão 1 — prazo (meses)', tipo: 'inteiro' },
  oferta1Frequencia: { nome: 'Condição padrão 1 — frequência', tipo: 'texto' },
  oferta1Entrada: { nome: 'Condição padrão 1 — entrada', tipo: 'dinheiro' },
  oferta2PrazoMeses: { nome: 'Condição padrão 2 — prazo (meses)', tipo: 'inteiro' },
  oferta2Frequencia: { nome: 'Condição padrão 2 — frequência', tipo: 'texto' },
  oferta2Entrada: { nome: 'Condição padrão 2 — entrada', tipo: 'dinheiro' },
  oferta3PrazoMeses: { nome: 'Condição padrão 3 — prazo (meses)', tipo: 'inteiro' },
  oferta3Frequencia: { nome: 'Condição padrão 3 — frequência', tipo: 'texto' },
  oferta3Entrada: { nome: 'Condição padrão 3 — entrada', tipo: 'dinheiro' },
  // reembolso parcelado
  valorMinimoOperacao: { nome: 'Valor mínimo da operação', tipo: 'dinheiro' },
  valorMaximoOperacao: { nome: 'Valor máximo da operação', tipo: 'dinheiro' },
  quantidadeMinimaParcelas: { nome: 'Quantidade mínima de parcelas', tipo: 'inteiro' },
  valorMinimoParcela: { nome: 'Valor mínimo da parcela', tipo: 'dinheiro' },
  encargoMensalProcessamento: { nome: 'Encargo mensal do processamento', tipo: 'percentual' },
  taxaInicialProcessamento: { nome: 'Taxa inicial de processamento', tipo: 'percentual' },
  taxaMinimaProcessamento: { nome: 'Taxa mínima inicial de processamento', tipo: 'dinheiro' },
  limiteParcelaAcessoria: { nome: 'Limite da parcela acessória (sobre a parcela principal)', tipo: 'percentual' },
  cobranca: { nome: 'Forma de cobrança', tipo: 'texto' },
  liquidacaoAntecipada: { nome: 'Liquidação antecipada', tipo: 'texto' },
  // Acordo de Pagamento (doc Vicente V1.0 — parâmetros AP001-AP027)
  diasMinimosAtrasoElegibilidade: { nome: 'Dias mínimos de atraso para elegibilidade', tipo: 'inteiro' },
  maxAcordosAtivosSimultaneos: { nome: 'Máximo de acordos ativos simultâneos', tipo: 'inteiro' },
  percentualEntradaMinima: { nome: 'Percentual mínimo de entrada', tipo: 'percentual' },
  prazoMaximoPadraoMeses: { nome: 'Prazo máximo padrão (meses)', tipo: 'inteiro' },
  prazoTetoExcecaoMeses: { nome: 'Teto de prazo em exceção CONAC (meses)', tipo: 'inteiro' },
  descontoPadrao: { nome: 'Desconto padrão', tipo: 'percentual' },
  limiteDescontoOperador: { nome: 'Limite de desconto do operador', tipo: 'percentual' },
  frequencia: { nome: 'Frequência', tipo: 'texto' },
  meioPagamentoEntrada: { nome: 'Meio de pagamento da entrada', tipo: 'texto' },
  meioPagamentoParcelas: { nome: 'Meio de pagamento das parcelas', tipo: 'texto' },
  ajusteResidual: { nome: 'Ajuste residual', tipo: 'texto' },
  oferta1Valor: { nome: 'Condição padrão 1 — valor', tipo: 'dinheiro' },
  oferta1Parcelas: { nome: 'Condição padrão 1 — parcelas', tipo: 'inteiro' },
  oferta2Valor: { nome: 'Condição padrão 2 — valor', tipo: 'dinheiro' },
  oferta2Parcelas: { nome: 'Condição padrão 2 — parcelas', tipo: 'inteiro' },
  oferta3Valor: { nome: 'Condição padrão 3 — valor', tipo: 'dinheiro' },
  oferta3Parcelas: { nome: 'Condição padrão 3 — parcelas', tipo: 'inteiro' },
  // proteção veicular
  vigenciaPadraoMeses: { nome: 'Vigência padrão (meses)', tipo: 'inteiro' },
  indiceReajuste: { nome: 'Índice de reajuste', tipo: 'texto' },
  taxaAdministracaoMensal: { nome: 'Taxa fixa de administração mensal', tipo: 'dinheiro' },
  contribuicaoMinimaMensal: { nome: 'Contribuição mínima mensal', tipo: 'dinheiro' },
  acrescimoMensalPerfil: { nome: 'Acréscimo mensal padrão por perfil', tipo: 'dinheiro' },
  ofertaEssencialTaxaFipe: { nome: 'Oferta Essencial — taxa mensal sobre a tabela FIPE', tipo: 'percentual' },
  ofertaEssencialAssistencia: { nome: 'Oferta Essencial — custo mensal de assistência', tipo: 'dinheiro' },
  ofertaEssencialCobertura: { nome: 'Oferta Essencial — cobertura', tipo: 'texto' },
  ofertaProtecaoTaxaFipe: { nome: 'Oferta Proteção — taxa mensal sobre a tabela FIPE', tipo: 'percentual' },
  ofertaProtecaoAssistencia: { nome: 'Oferta Proteção — custo mensal de assistência', tipo: 'dinheiro' },
  ofertaProtecaoCobertura: { nome: 'Oferta Proteção — cobertura', tipo: 'texto' },
  ofertaCompletaTaxaFipe: { nome: 'Oferta Completa — taxa mensal sobre a tabela FIPE', tipo: 'percentual' },
  ofertaCompletaAssistencia: { nome: 'Oferta Completa — custo mensal de assistência', tipo: 'dinheiro' },
  ofertaCompletaCobertura: { nome: 'Oferta Completa — cobertura', tipo: 'texto' },
  statusValores: { nome: 'Situação dos valores', tipo: 'texto' },
  cancelamentoAntecipado: { nome: 'Cancelamento antecipado', tipo: 'texto' },
};

export function nomeParametro(chave: string): string {
  return PARAMETROS_CONHECIDOS[chave]?.nome ?? chave;
}

export function formatarParametro(chave: string, valor: ValorParametro): string {
  const tipo = PARAMETROS_CONHECIDOS[chave]?.tipo ?? (typeof valor === 'boolean' ? 'booleano' : typeof valor === 'number' ? 'inteiro' : 'texto');
  if (tipo === 'booleano' || typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (typeof valor !== 'number') return String(valor);
  if (tipo === 'dinheiro') return (valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (tipo === 'percentual') return `${(valor * 100).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
  return valor.toLocaleString('pt-BR');
}

export const NOME_CICLO: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  ATIVO: 'Ativo',
  SUSPENSO: 'Suspenso',
  ENCERRADO: 'Encerrado',
};
