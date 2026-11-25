// WhatsApp enxuto (doc 02 §23, §24, §28 — decisão Luís 15/11/2026).
// Casa com os enums do Prisma; rótulos por extenso para a tela (Regra 9).

// Desfecho da regra única de envio (§23.2): toda mensagem que sai pelo WhatsApp
// passa por ela — nenhuma tela ou job decide sozinho se manda de verdade.
export enum DecisaoEnvioWhatsapp {
  ENVIA = 'ENVIA',
  SIMULADO = 'SIMULADO', // fora de produção: registra, não envia
  RETIDO = 'RETIDO', // produção sem credencial: nunca simula
}

// Momento do lembrete de pagamento (§28.1).
export enum MomentoLembrete {
  D_MENOS_2 = 'D_MENOS_2',
  D_ZERO = 'D_ZERO',
}

export const NOME_MOMENTO_LEMBRETE: Record<MomentoLembrete, string> = {
  [MomentoLembrete.D_MENOS_2]: '2 dias antes do vencimento',
  [MomentoLembrete.D_ZERO]: 'No dia do vencimento',
};

// Situação REAL do lembrete (gravada — §28.4).
export enum SituacaoLembrete {
  PREPARADO = 'PREPARADO', // registrado, aguardando a resposta da Meta
  ENVIADO = 'ENVIADO',
  ENTREGUE = 'ENTREGUE',
  LIDO = 'LIDO',
  FALHOU = 'FALHOU',
  SIMULADO = 'SIMULADO',
  RETIDO = 'RETIDO',
}

export const NOME_SITUACAO_LEMBRETE: Record<SituacaoLembrete, string> = {
  [SituacaoLembrete.PREPARADO]: 'Enviando',
  [SituacaoLembrete.ENVIADO]: 'Enviado',
  [SituacaoLembrete.ENTREGUE]: 'Entregue',
  [SituacaoLembrete.LIDO]: 'Lido',
  [SituacaoLembrete.FALHOU]: 'Falhou',
  [SituacaoLembrete.SIMULADO]: 'Simulado — não enviado',
  [SituacaoLembrete.RETIDO]: 'Retido — não enviado',
};

export function nomeSituacaoLembrete(situacao: string): string {
  return (NOME_SITUACAO_LEMBRETE as Record<string, string>)[situacao] ?? situacao;
}

export function nomeMomentoLembrete(momento: string): string {
  return (NOME_MOMENTO_LEMBRETE as Record<string, string>)[momento] ?? momento;
}

// Situação da mensagem de SAÍDA na conversa (resposta do operador — §24).
// Minúsculas, como a API envia.
export const NOME_SITUACAO_MENSAGEM_WHATSAPP: Record<string, string> = {
  enviando: 'Enviando',
  enviada: 'Enviada',
  entregue: 'Entregue',
  lida: 'Lida',
  falhou: 'Falhou',
  simulada: 'Simulada — não enviada',
  retida: 'Retida — não enviada',
};

// Etiqueta automática do contato na tela Conversas (doc 02 §34.3). DERIVADA na
// leitura, pelo cadastro de agora — nunca gravada (Regras 7 e 8).
export enum EtiquetaContato {
  CLIENTE = 'CLIENTE',
  EX_CLIENTE = 'EX_CLIENTE',
  LEAD = 'LEAD',
  NAO_CADASTRADO = 'NAO_CADASTRADO',
}

export const NOME_ETIQUETA_CONTATO: Record<EtiquetaContato, string> = {
  [EtiquetaContato.CLIENTE]: 'Cliente',
  [EtiquetaContato.EX_CLIENTE]: 'Ex-cliente',
  [EtiquetaContato.LEAD]: 'Lead',
  [EtiquetaContato.NAO_CADASTRADO]: 'Não cadastrado',
};

// Tipo da mídia que o operador manda pela tela (§34.6).
export enum TipoMidiaSaidaWhatsapp {
  IMAGEM = 'IMAGEM',
  DOCUMENTO = 'DOCUMENTO',
  AUDIO = 'AUDIO',
}
