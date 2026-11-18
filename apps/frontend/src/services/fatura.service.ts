import type { IntencaoPagamentoOperador, PagamentoFaturaOperador } from '@azit/types';
import { api } from '../lib/api';

// Visão de faturas do cliente (por conta). Cada fatura agrega itens de todos os
// contratos/produtos do mesmo ciclo (Doc 2 §372). Valores em centavos.
export interface FaturaItem {
  descricao: string;
  tipo: string;
  valor: number;
  credor: string;
}
export interface Fatura {
  id: string;
  numero: number;
  periodoReferencia: string;
  dataVencimento: string;
  dataFechamento: string | null;
  dataPagamento: string | null;
  status: string;
  situacao: string; // em_aberto | vence_hoje | vencida | paga | ...
  valorTotal: number;
  valorPago: number;
  // Só na lista da conta: o que falta pagar HOJE (fatura AZIT fechada: saldo +
  // multa + atualização do motor); null em fatura que não está em aberto.
  faltaHoje?: number | null;
  // Só na lista da conta: multa e atualização de hoje dentro do `faltaHoje` (a mesma conta da página do cliente).
  encargoHoje?: number;
  // false em fatura FECHADA = a cobrança automática falhou (estado de exceção).
  temCobrancaAsaas: boolean;
  // Fatura Azit F2 (doc 02 §32.4-A): 'AZIT' = Pix sob demanda. Não ter cobrança
  // é o normal dessas faturas — "Emitir cobrança" não se aplica a elas.
  modeloEncargo: 'ASAAS_NATIVO' | 'AZIT';
  // Fatura Azit (doc 02 §32.7): link público da fatura (fatura.azitmove.com.br/<token>).
  linkPublico: string | null;
  itens: FaturaItem[];
}

export interface EnvioLinkFatura {
  id: string;
  canal: 'whatsapp' | 'copia';
  usuario: string;
  em: string; // ISO
}

export interface FaturaDetalhe extends Fatura {
  titular: { id: string; nome: string };
  // Encargo de atraso corrido até hoje (centavos) — só vem quando a fatura está
  // fechada SEM cobrança no Asaas, para a decisão de reemissão.
  encargoAtual: number;
  // Fatura Azit (doc 02 §32.7): WhatsApp do titular (dígitos c/ DDI, para o
  // wa.me), mensagem pronta montada pelo backend e os envios manuais já feitos.
  whatsappTitular: string | null;
  mensagemWhatsapp: string | null;
  enviosLink: EnvioLinkFatura[];
  // Fatura Azit F2 (doc 02 §32.4-A): só em fatura do modelo de Pix sob demanda.
  // O que falta hoje (encargo calculado pela Azit), os pagamentos com o que
  // cada um quitou e o Pix ativo da conta.
  azit: FaturaAzitDetalhe | null;
}

export interface FaturaAzitDetalhe {
  situacao: 'paga' | 'parcial' | 'vencida' | 'hoje' | 'aberta';
  totalHoje: number;
  saldoNominal: number;
  multa: number;
  atualizacao: number;
  diasAtualizacao: number;
  atualizacaoDesde: string; // YYYY-MM-DD
  diasAtraso: number;
  pagoTotal: number;
  pagamentos: PagamentoFaturaOperador[];
  // Pix ativos de hoje da conta, um por valor (gerar outro valor não cancela os anteriores).
  intencoesAtivas: IntencaoPagamentoOperador[];
  contaMista: boolean;
  gatewaySimulado: boolean; // sem gateway real não há Pix para conferir
}

// Lançamento avulso da conta (doc 02 §4-A.3, revisão 30/08): entrada de contrato
// (dia zero) e entrada de acordo (efetivação) — dinheiro fora do ciclo de fatura.
export interface LancamentoConta {
  id: string;
  tipo: 'entrada_contrato' | 'entrada_acordo';
  // 'aguardando_pagamento' = cobrança gerada, dinheiro ainda não entrou
  // (pendência calculada em runtime — não existe como registro).
  situacao: 'paga' | 'aguardando_pagamento';
  descricao: string;
  valor: number;
  dataPagamento: string | null;
  dataLimite: string | null; // data-limite dura da entrada do acordo
  contratoId: string | null;
  contratoNumero: string | null;
  acordoId: string | null;
}

// Ficha do titular (doc 02 §33.2): as faturas da conta em visões calculadas.
//   agora = disponíveis e vencidas · vencer = ainda não disponíveis ·
//   pagas = quitadas · outras = renegociadas, novadas e rescindidas.
export type VisaoFaturasConta = 'agora' | 'vencer' | 'pagas' | 'outras';
export interface BlocoFaturas {
  visao: VisaoFaturasConta;
  total: number;
  offset: number;
  data: Fatura[];
}

// Um dinheiro que entrou na conta e para onde ele foi (doc 02 §33.3).
export interface PagamentoDaConta {
  id: string;
  dia: string; // AAAA-MM-DD
  hora: string | null;
  tipo: 'pix' | 'cobranca' | 'sinistro' | 'entrada_contrato' | 'entrada_acordo';
  valor: number; // o dinheiro inteiro, com excedente
  excedente: number;
  descricao: string | null;
  contratoNumero: string | null;
  acordoId: string | null;
  destinos: { faturaId: string; numero: number; valor: number; encargos: number; quitou: boolean }[];
}
export interface BlocoPagamentos {
  total: number;
  offset: number;
  data: PagamentoDaConta[];
}

// Posição de hoje da conta (doc 02 §33.1) — tudo calculado na leitura.
export interface PosicaoConta {
  hoje: string;
  atraso: { faturas: number; valorHoje: number; encargos: number; diasMaisAntiga: number };
  proxima: { id: string; numero: number; dataVencimento: string; valor: number; disponivel: boolean } | null;
  ultimoPagamento: PagamentoDaConta | null;
  faturaComLinkId: string | null;
  trilho: { pagas: number; emAtraso: number; valorEmAtraso: number; aVencer: number; valorAVencer: number };
  contagem: Record<VisaoFaturasConta, number>;
}

export const faturaService = {
  // "Agora" vem inteira; as outras visões chegam em blocos (offset = quantas já estão na tela).
  async daConta(contaId: string, visao: VisaoFaturasConta, offset = 0, limit = 10): Promise<BlocoFaturas> {
    const { data } = await api.get(`/api/v1/contas/${contaId}/faturas`, { params: { visao, offset, limit } });
    return data;
  },
  async posicao(contaId: string): Promise<PosicaoConta> {
    const { data } = await api.get(`/api/v1/contas/${contaId}/posicao`);
    return data;
  },
  async pagamentos(contaId: string, offset = 0, limit = 10): Promise<BlocoPagamentos> {
    const { data } = await api.get(`/api/v1/contas/${contaId}/pagamentos`, { params: { offset, limit } });
    return data;
  },
  async lancamentos(contaId: string): Promise<LancamentoConta[]> {
    const { data } = await api.get(`/api/v1/contas/${contaId}/lancamentos`);
    return data;
  },
  async detalhe(faturaId: string): Promise<FaturaDetalhe> {
    const { data } = await api.get(`/api/v1/faturas/${faturaId}`);
    return data;
  },
  // Reemissão manual (contingência): o sistema emite mantendo o vínculo — nunca
  // criar cobrança pelo painel do Asaas (sem externalReference não concilia).
  async gerarCobranca(faturaId: string, body: { vencimento?: string; incluirEncargo?: boolean }): Promise<{ chargeId: string; valorCobrado: number; vencimento: string; encargoIncluido: number }> {
    const { data } = await api.post(`/api/v1/faturas/${faturaId}/gerar-cobranca`, body);
    return data;
  },
  // Fatura Azit (doc 02 §32.7): registra que o operador copiou o link ou abriu o
  // WhatsApp com a mensagem — devolve o detalhe atualizado (com os envios).
  async registrarEnvioLink(faturaId: string, canal: 'whatsapp' | 'copia'): Promise<FaturaDetalhe> {
    const { data } = await api.post(`/api/v1/faturas/${faturaId}/envios-link`, { canal });
    return data;
  },
  // Consulta a cobrança no Asaas e, se paga, reprocessa a conciliação (02/10).
  async conferirPagamento(faturaId: string): Promise<{ enfileirado: boolean; statusAsaas: string | null; motivo: string | null }> {
    const { data } = await api.post(`/api/v1/faturas/${faturaId}/conferir-pagamento`);
    return data;
  },
  // Pix sob demanda (doc 02 §32.4-A): pergunta ao gateway pelos Pix recentes da
  // conta e enfileira a baixa dos que ele confirma como pagos.
  async conferirPix(contaId: string): Promise<{ conferidas: number; enfileiradas: number; simulado: boolean }> {
    const { data } = await api.post(`/api/v1/contas/${contaId}/pix/conferir`);
    return data;
  },
  // Dev/homologação: simula o pagamento do Pix ativo (mesmo job do webhook).
  async simularPagamentoPix(intencaoId: string): Promise<void> {
    await api.post(`/api/v1/dev/simular-pagamento-pix/${intencaoId}`);
  },
  // Dev: paga a fatura (enfileira a conciliação, como o webhook do Asaas).
  async simularPagamento(faturaId: string): Promise<void> {
    await api.post(`/api/v1/dev/simular-pagamento-fatura/${faturaId}`);
  },
  // Dev: envelhece a fatura em 1 dia (simula atraso dia a dia).
  async envelhecer(faturaId: string): Promise<{ diasAtraso: number }> {
    const { data } = await api.post(`/api/v1/dev/envelhecer-fatura/${faturaId}`);
    return data;
  },
};
