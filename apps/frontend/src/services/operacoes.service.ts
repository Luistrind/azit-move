import { api } from '../lib/api';

// Operações sobre contratos (Bloco 6). Valores em centavos.
export interface ContratoResumo {
  id: string;
  numero: string;
  descricao: string; // ativo (veículo) ou "Reembolso Parcelado"
  placa: string | null;
}

export interface Acordo {
  id: string;
  status: string;
  origem: 'nativo' | 'legado'; // legado = importado pela migração do Asaas (doc 02 §26.15)
  contratoNumero: string;
  contratos: ContratoResumo[];
  contaId: string;
  titularId: string;
  titular: string;
  criadoPor: string;
  valorTotalRenegociado: number;
  valorEntrada: number;
  numeroParcelasNovas: number;
  valorParcelaNova: number;
  periodicidade: 'semanal' | 'quinzenal' | 'mensal';
  dataCriacao: string;
  dataEfetivacao: string | null;
}

// Evento da trilha (acordo/novação): texto humano, sem id — mesmo padrão da
// trilha de decisões da Central de Aprovações.
export interface EventoTrilha {
  em: string | null;
  titulo: string;
  por: string | null;
  detalhe: string | null;
}

export interface AprovacaoResumo {
  id: string;
  status: 'PENDENTE' | 'APROVADA' | 'REPROVADA' | 'CANCELADA';
  resumo: string;
  solicitante: string;
  solicitadoEm: string;
  decisoes: { usuario: string; decisao: 'APROVADA' | 'RECOMENDADA' | 'REPROVADA'; parecer: string | null; em: string }[];
}

// Parcela coberta pelo acordo (vínculo acordoId — Regra 5: não é status).
export interface ParcelaCoberta {
  parcelaId: string;
  contratoId: string;
  contratoNumero: string;
  produto: string;
  display: string;
  numero: number;
  dataVencimento: string; // 'YYYY-MM-DD'
  valorNominal: number;
  diasAtrasoNaDataBase: number;
  status: string; // rótulo (Em acordo / Paga …)
  faturaId: string | null;
}

export interface FaturaCoberta {
  id: string;
  numero: number;
  dataVencimento: string;
  status: string; // renegociada | novada | paga …
  valorTotal: number;
  valorPago: number;
  dataPagamento: string | null;
  diasAtrasoNaDataBase: number;
  itens: { descricao: string; tipo: string; valor: number; credor: string; coberto: boolean }[];
  parcelas: ParcelaCoberta[];
}

// Cota nova do plano (parcela do ItemContratado de origem ACORDO).
export interface CotaAcordo {
  parcelaId: string;
  contratoId: string;
  contratoNumero: string;
  numero: number;
  totalParcelas: number;
  display: string;
  dataVencimento: string;
  valorNominal: number;
  status: string; // rótulo (Paga / Vencida / Em aberto …)
  dataPagamento: string | null;
  valorPago: number;
  valorEncargo: number;
  fatura: { id: string; numero: number; dataVencimento: string; status: string } | null;
}

// Detalhe do acordo (GET acordos/:id) — tela Renegociações, 21/10.
export interface AcordoDetalhe {
  id: string;
  status: string;
  origem: 'nativo' | 'legado';
  contaId: string;
  titular: { id: string; nome: string };
  contratos: ContratoResumo[];
  criadoEm: string;
  criadoPor: string;
  efetivadoEm: string | null;
  dataBase: string;
  observacao: string | null;
  plano: { valorTotalRenegociado: number; valorEntrada: number; numeroParcelasNovas: number; valorParcelaNova: number; periodicidade: string; totalPlano: number };
  totaisCobertura: { quantidadeParcelas: number; quantidadeFaturas: number; valorNominal: number; encargosMora: number | null; valorAtualizado: number | null; moraHerdada: string | null };
  faturasCobertas: FaturaCoberta[];
  cobertasSemFatura: ParcelaCoberta[];
  cotas: CotaAcordo[];
  resumoCotas: { quantidade: number; pagas: number; vencidas: number; venceHoje: number; aVencer: number; novadas: number; valorPago: number; encargosPagos: number; valorAPagar: number; valorVencido: number; totalPlano: number };
  entrada: { valor: number; dataLimite: string | null; pagaEm: string | null; cobrancaAsaasId: string | null; situacao: 'sem_entrada' | 'paga' | 'aguardando' | 'aguardando_aprovacao' | 'expirada' | 'nao_paga' };
  exclusoes: { faturaId: string; numero: number | null; dataVencimento: string | null; valorTotal: number | null; justificativa: string }[];
  vincendasIncluidas: { faturaId: string; numero: number | null; dataVencimento: string | null; valorTotal: number | null }[];
  calculo: (Partial<PreviaAcordo> & { motor: 'catalogo' | 'placeholder' }) | null;
  aceiteWhatsapp: { confirmadoPeloOperadorEm: string } | null;
  temTermoAntigo: boolean;
  legado: { casoId: string; parcelasCobertasDeclaradas: number[]; primeiraCotaEm: string; ultimaCotaEm: string } | null;
  aprovacao: AprovacaoResumo | null;
  novacaoId: string | null;
  lancamentos: { id: string; tipo: string; descricao: string; valor: number; dataPagamento: string; cobrancaAsaasId: string | null }[];
  trilha: EventoTrilha[];
}

// Novação CONTA-cêntrica (F2, 14/09): dois contratos novos assinados juntos.
export interface Novacao {
  id: string;
  status: string;
  contaId: string;
  criadaPor: string;
  contratoUnico: boolean;
  veiculo: { placa: string | null; descricao: string } | null;
  contratosOrigem: string[]; // números dos contratos extintos (após a ativação)
  titularId: string;
  titular: string;
  saldoVeiculo: number;
  saldoDemais: number;
  valorParcela: number;
  recebimentoInicial: number;
  contratoVeiculo: { id: string; numero: string } | null;
  contratoTermo: { id: string; numero: string } | null;
  // 1ª parcela do contrato novo (15/10) e se ainda pode ser trocada antes da assinatura.
  primeiraParcela: string | null;
  frequencia: 'semanal' | 'quinzenal' | 'mensal' | null;
  assinaturaStatus: string | null;
  podeAlterarPrimeiraParcela: boolean;
  dataAssinatura: string | null;
  dataAtivacao: string | null;
  criadaEm: string;
}

// Contrato gerado pela novação (veículo ou Termo), com assinatura e cronograma.
export interface ContratoNovacao {
  papel: 'veiculo' | 'termo';
  id: string;
  numero: string;
  status: string; // lower (ativo, aguardando_assinatura, encerrado…)
  descricao: string;
  placa: string | null;
  numeroParcelas: number;
  valorParcela: number;
  valorTotal: number;
  dataPrimeiraParcela: string;
  periodicidade: string;
  cronogramaGerado: boolean;
  cronograma: { total: number; pagas: number; vencidas: number; aVencer: number; proximoVencimento: string | null };
  assinatura: {
    status: string; // enviado | parcialmente_assinado | assinado | recusado | cancelado
    simulado: boolean;
    enviadoEm: string;
    concluidoEm: string | null;
    motivoRecusa: string | null;
    signatarios: { papel: string; nome: string; visualizouEm: string | null; assinouEm: string | null }[];
  } | null;
}

// Detalhe da novação (GET novacoes/:id) — tela Renegociações, 21/10.
export interface NovacaoDetalhe {
  id: string;
  status: string;
  contaId: string;
  titular: { id: string; nome: string };
  criadaEm: string;
  criadaPor: string;
  observacao: string | null;
  dataBase: string | null;
  contratoUnico: boolean;
  saldoVeiculo: number;
  saldoDemais: number;
  valorParcela: number;
  recebimentoInicial: { valor: number; cobrancaAsaasId: string | null; pagoEm: string | null; situacao: 'sem_recebimento' | 'pago' | 'aguardando' | 'expirado' | 'pendente' };
  termos: { prazoMeses: number | null; numeroParcelasVeiculo: number | null; frequencia: string | null; desconto: number; acrescimo: number; acrescimoMotivo: string | null; trocaAtivoId: string | null; dataPrimeiraParcela: string | null } | null;
  simulacao: SimulacaoNovacao | null; // congelada na proposta (números do servidor na data-base)
  origens: { id: string; numero: string; descricao: string; placa: string | null; encerradoEm: string | null; parcelasNovadas: number; valorNominalNovado: number; acordosNovados: { id: string; plano: string }[] }[];
  faturasNovadas: number;
  contratoVeiculo: ContratoNovacao | null;
  contratoTermo: ContratoNovacao | null;
  aprovacao: AprovacaoResumo | null;
  dataAssinatura: string | null;
  dataAtivacao: string | null;
  trilha: EventoTrilha[];
}

export interface ParcelaElegivel {
  id: string;
  display: string;
  dataVencimento: string;
  valorNominal: number;
}

// Elegíveis da CONTA (renegociação conta-cêntrica — Doc 2 §7.7).
// Desde 17/08 (doc Acordo de Pagamento V1.0): valores ATUALIZADOS com mora
// (RAP007) + visão por FATURA (unidade de negociação, RAP003-005).
export interface FaturaElegivel {
  faturaId: string;
  numero: number | null;
  dataVencimento: string | null;
  valorNominal: number;
  encargosMora: number;
  valorAtualizado: number;
  itens: { display: string; contratoNumero: string; valorAtualizado: number }[];
}
// Prévia do acordo (doc 02 §7.7, 2026-08-18). Valores em centavos; taxas em fração.
export interface PreviaAcordo {
  motor: 'catalogo' | 'placeholder';
  periodicidade: 'semanal' | 'quinzenal' | 'mensal';
  saldoNegociado: number;
  entradaMinima: number;
  taxaInicial: number;
  tpFinanciada?: number;
  amortizacaoEntrada?: number;
  taxaPeriodo: number;
  encargoMensal?: number;
  saldoAParcelar: number;
  valorParcela: number;
  valorMinimoParcela?: number;
  totalAPagar: number;
  excecoes: string[];
}

export interface ElegivelConta {
  contaId: string;
  titularId: string;
  contratos: {
    contratoId: string;
    numero: string;
    descricao: string;
    valor: number;
    valorNominal: number;
    encargosMora: number;
    parcelas: ParcelaElegivel[];
  }[];
  faturas: FaturaElegivel[];
  // Faturas VINCENDAS próximas (35 dias) — o operador PODE incluí-las (opt-in, 30/08).
  faturasProximas: FaturaElegivel[];
  valorTotal: number;
  valorNominalTotal: number;
  encargosMoraTotal: number;
  faturasVencidas: number;
  // Acordos em aberto da conta (rascunho/aguardando entrada/ativo) — máx 2.
  acordosAbertos: number;
}

// F1 da Novação (doc adaptações A7 passos 1–2, 13/09): decomposição do saldo
// da conta por produto — parte do veículo (Contrato 1) × demais produtos
// (Contrato 2 — Termo de Regularização de Débitos). Centavos.
export interface ComponenteDecomposicao {
  origem: string;
  produto: 'veiculo' | 'seguro' | 'reembolso' | 'outro';
  situacao: 'vencido' | 'futuro';
  dias: number;
  valorNominal: number;
  ajuste: number; // mora (+) ou desconto de valor presente (−)
  valor: number;
}

export interface FaseNovacao {
  saldo: number;
  parcelasCheias: number;
  valorUltima: number;
  totalParcelas: number;
}

// Simulação da proposta (A7 passos 3-4): parcela única, Contrato 2 primeiro,
// fatura de transição com antecipação do veículo, depois o veículo.
export interface SimulacaoNovacao {
  contaId: string;
  titularNome: string;
  dataBase: string;
  frequencia: 'semanal' | 'quinzenal' | 'mensal';
  prazoMeses: number | null;
  numeroParcelasVeiculo: number;
  // 1ª parcela escolhida e a sugestão do ciclo da conta (15/10).
  dataPrimeiraParcela: string;
  dataPrimeiraParcelaPadrao: string;
  // Troca de veículo (F3): ajuste pelos valores de cadastro (entra − sai).
  troca: null | { ativoEntraId: string; entraDescricao: string; entraValor: number; ativoSaiId: string; saiDescricao: string; saiValor: number; ajuste: number };
  // Acréscimo ao saldo (09/10): valor somado à dívida, com motivo.
  acrescimo: number;
  acrescimoMotivo: string | null;
  produtoAtivo: boolean;
  versaoParametros: number | null;
  decomposicao: {
    parteVeiculo: { vencido: number; futuro: number; deAcordos: number; total: number };
    demaisProdutos: { porProduto: { produto: string; total: number }[]; total: number };
    totalGeral: number;
  };
  saldoBase: number;
  saldoNovado: number;
  taxaInicial: number;
  entradaMinima: number;
  tpFinanciada: number;
  amortizacaoInicial: number;
  saldoAParcelarVeiculo: number;
  taxaMensal: number; // TR (fração a.m.) — exibida como vem do servidor, nunca reconvertida de taxaPeriodo (Regra 16)
  taxaPeriodo: number;
  valorParcela: number; // componente FINANCEIRO (Price)
  // F4 (A3/A4, 15/09): parcela composta — o valor real assinado/cobrado.
  comissaoPorPeriodo: number;
  protecaoPorPeriodo: number;
  valorParcelaTotal: number;
  contrato2: FaseNovacao & { antecipacaoTransicao: number; totalComposto: number };
  contrato1: FaseNovacao & { totalComposto: number };
  totalParcelasRelacionamento: number;
  totalAPagar: number;
  excecoes: string[];
}

export interface DecomposicaoNovacao {
  contaId: string;
  titularId: string;
  titularNome: string;
  dataBase: string;
  frequenciaHerdada: 'semanal' | 'quinzenal' | 'mensal';
  contratos: { id: string; numero: string; descricao: string; temAtivo: boolean; status: string; taxaVpMensal: number }[];
  parteVeiculo: { vencido: number; futuro: number; deAcordos: number; total: number };
  demaisProdutos: {
    porProduto: { produto: string; vencido: number; futuro: number; deAcordos: number; total: number }[];
    total: number;
  };
  totalGeral: number;
  memoria: {
    componentes: ComponenteDecomposicao[];
    acordos: {
      acordoId: string;
      status: string | null;
      saldoAberto: number;
      nominalCoberto: number;
      encargosAcordo: number;
      porProduto: { produto: string; dividaOriginal: number; saldo: number }[];
      parcelasAbertas: ComponenteDecomposicao[];
    }[];
    ignorados: { origem: string; produto: string; motivo: string; valorNominal: number }[];
  };
}

export interface SimulacaoQuitacao {
  fonte?: 'catalogo' | 'parametros';
  liquidacaoTotal?: boolean;
  comissaoIsentada?: number; // centavos — isenção na liquidação total (Catálogo)
  protecaoIsentada?: number;
  parcelas: { id: string; display: string; valorNominal: number; valorPresente: number; diasAteVencimento: number }[];
  valorNominalTotal: number;
  valorQuitacao: number;
  desconto: number;
}

export const operacoesService = {
  async acordos(): Promise<Acordo[]> {
    const { data } = await api.get<Acordo[]>('/api/v1/acordos');
    return data;
  },
  // Detalhe do acordo (21/10): cobertas, entrada, cotas, snapshot e trilha.
  async acordo(id: string): Promise<AcordoDetalhe> {
    const { data } = await api.get<AcordoDetalhe>(`/api/v1/acordos/${id}`);
    return data;
  },
  // Detalhe da novação (21/10): origens, decomposição, contratos novos e trilha.
  async novacao(id: string): Promise<NovacaoDetalhe> {
    const { data } = await api.get<NovacaoDetalhe>(`/api/v1/novacoes/${id}`);
    return data;
  },
  async elegivelConta(contaId: string): Promise<ElegivelConta> {
    const { data } = await api.get<ElegivelConta>(`/api/v1/contas/${contaId}/renegociacao/elegivel`);
    return data;
  },
  // Prévia do acordo — números do SERVIDOR (motor do Catálogo quando o produto
  // Acordo de Pagamento está ATIVO; senão divisão simples provisória).
  async simularRenegociacaoConta(
    contaId: string,
    body: { valorEntrada: number; numeroParcelasNovas: number; faturasExcluidas?: { faturaId: string; justificativa: string }[]; faturasVincendasIncluidas?: string[] },
  ): Promise<PreviaAcordo> {
    const { data } = await api.post(`/api/v1/contas/${contaId}/renegociacao/simular`, body);
    return data;
  },
  async criarRenegociacaoConta(
    contaId: string,
    body: {
      valorEntrada: number;
      numeroParcelasNovas: number;
      valorParcelaNova?: number;
      periodicidade?: 'semanal' | 'quinzenal' | 'mensal';
      dataLimiteEntrada?: string;
      faturasExcluidas?: { faturaId: string; justificativa: string }[];
      faturasVincendasIncluidas?: string[];
      // De acordo do cliente via WhatsApp (doc 02 §7.7, 09/09) — obrigatório.
      aceiteWhatsapp: boolean;
    },
  ): Promise<{ id: string; status: string; valorTotalRenegociado: number; valorParcela: number; periodicidade: string; motor: string; excecoes: string[]; contratosAfetados: number }> {
    const { data } = await api.post(`/api/v1/contas/${contaId}/renegociacao`, body);
    return data;
  },
  async simularEntrada(acordoId: string): Promise<void> {
    await api.post(`/api/v1/dev/simular-entrada-acordo/${acordoId}`);
  },
  // F1 da Novação: decomposição do saldo por produto (insumo da simulação).
  async decomposicaoNovacao(contaId: string): Promise<DecomposicaoNovacao> {
    const { data } = await api.get(`/api/v1/contas/${contaId}/novacao/decomposicao`);
    return data;
  },
  // Simulação da proposta de novação (A7 passos 3-4) — números do SERVIDOR.
  async simularNovacao(
    contaId: string,
    body: { prazoMeses?: number; numeroParcelasVeiculo?: number; frequencia?: 'semanal' | 'quinzenal' | 'mensal'; desconto?: number; recebimentoInicial?: number; trocaAtivoId?: string; acrescimo?: number; acrescimoMotivo?: string; dataPrimeiraParcela?: string },
  ): Promise<SimulacaoNovacao> {
    const { data } = await api.post(`/api/v1/contas/${contaId}/novacao/simular`, body);
    return data;
  },
  // 6.6 — Novação conta-cêntrica (F2): proposta formal → aprovação → 2
  // contratos assinados juntos → recebimento inicial → ativação atômica.
  async novacoes(): Promise<Novacao[]> {
    const { data } = await api.get<Novacao[]>('/api/v1/novacoes');
    return data;
  },
  async solicitarNovacao(
    contaId: string,
    body: { prazoMeses: number; frequencia?: 'semanal' | 'quinzenal' | 'mensal'; desconto?: number; recebimentoInicial?: number; trocaAtivoId?: string; acrescimo?: number; acrescimoMotivo?: string; dataPrimeiraParcela?: string; contratoUnico?: boolean; observacao?: string },
  ): Promise<{ id: string; status: string; valorParcela: number }> {
    const { data } = await api.post(`/api/v1/contas/${contaId}/novacao`, body);
    return data;
  },
  // Troca a 1ª parcela enquanto a novação aguarda assinatura (15/10): regenera e reenvia o instrumento.
  async alterarPrimeiraParcelaNovacao(novacaoId: string, dataPrimeiraParcela: string): Promise<{ dataPrimeiraParcela: string; assinatura: { reenviada: boolean; motivo: string | null } }> {
    const { data } = await api.patch(`/api/v1/novacoes/${novacaoId}/primeira-parcela`, { dataPrimeiraParcela });
    return data;
  },
  async simularRecebimentoNovacao(novacaoId: string): Promise<void> {
    await api.post(`/api/v1/dev/simular-recebimento-novacao/${novacaoId}`);
  },
  async simularQuitacao(contratoId: string): Promise<SimulacaoQuitacao> {
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/quitacao/simular`, {});
    return data;
  },
  async quitar(contratoId: string): Promise<void> {
    await api.post(`/api/v1/contratos/${contratoId}/quitacao`, {});
  },
  async registrarSinistro(contratoId: string, valorIndenizacao: number): Promise<unknown> {
    const { data } = await api.post(`/api/v1/contratos/${contratoId}/sinistro`, { valorIndenizacao });
    return data;
  },
  // 6.8 — Reajuste IPCA: propõe; aprovação e aplicação acontecem via motor de
  // aprovação (Central de Aprovações — Doc 2 §7.9-A).
  async reajustar(contratoId: string, indicePercentual: number): Promise<void> {
    await api.post(`/api/v1/contratos/${contratoId}/reajuste`, { indicePercentual });
  },
};
