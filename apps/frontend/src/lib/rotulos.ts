// Rótulos legíveis de status (proposta UX, princípio P4: nenhuma sigla/código em tela).
// Cor continua vindo de config/statusColors.ts (Regra 9); aqui é só o texto.

export const ROTULO_STATUS_ANALISE: Record<string, string> = {
  ATENDIMENTO_INICIADO: 'Atendimento iniciado',
  SIMULACAO_REALIZADA: 'Simulação realizada',
  CADASTRO_EM_PREENCHIMENTO: 'Cadastro em preenchimento',
  DOCUMENTOS_ENVIADOS: 'Documentos enviados',
  CONSULTA_INICIAL_REALIZADA: 'Consulta inicial realizada',
  EM_TRIAGEM_INICIAL: 'Em triagem inicial',
  PENDENTE_DE_COMPLEMENTO: 'Pendente de complemento',
  EM_ANALISE_COMPLEMENTAR: 'Em análise complementar',
  SCORE_CONSULTADO: 'Score consultado',
  RESTRICOES_CONSULTADAS: 'Restrições consultadas',
  PARECER_EMITIDO: 'Parecer emitido',
  APROVADO_ALCADA_ANALISTA: 'Aprovado na alçada do analista',
  AGUARDANDO_COCAD: 'Aguardando o Comitê de Cadastro',
  APROVADO_COCAD: 'Aprovado pelo Comitê de Cadastro',
  APROVADO_COM_RESSALVAS: 'Aprovado com ressalvas',
  RESSALVA_EM_TRATAMENTO: 'Ressalva em tratamento',
  PENDENTE_COMPLEMENTO_COCAD: 'Pendente de complemento do Comitê',
  LIBERADO_PARA_FORMALIZACAO: 'Liberado para formalização',
  NAO_APROVADO: 'Não aprovado',
  PROPOSTA_ENCERRADA: 'Proposta encerrada',
};

export const ROTULO_STATUS_PROPOSTA: Record<string, string> = {
  PENDENTE: 'Pendente',
  EM_ANALISE: 'Em análise',
  APROVADA: 'Aprovada',
  REPROVADA: 'Reprovada',
  CANCELADA: 'Cancelada',
  EM_FORMALIZACAO: 'Em formalização',
  CONVERTIDA: 'Convertida em contrato',
};

export const ROTULO_STATUS_CONTRATO: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_ASSINATURA: 'Aguardando assinatura',
  AGUARDANDO_PAGAMENTO_INICIAL: 'Aguardando pagamento da entrada',
  AGUARDANDO_ENTREGA_VEICULO: 'Aguardando entrega do veículo',
  ATIVO: 'Ativo',
  INADIMPLENTE: 'Inadimplente',
  BLOQUEADO: 'Bloqueado',
  SUSPENSO: 'Suspenso',
  EM_RECUPERACAO_VEICULO: 'Em recuperação do veículo',
  CANCELADO: 'Cancelado',
  RESCINDIDO: 'Rescindido',
  LIQUIDADO_POR_NOVACAO: 'Liquidado por novação',
  QUITADO_AGUARDANDO_TRANSFERENCIA: 'Quitado — aguardando transferência',
  QUITADO_TRANSFERENCIA_EFETIVADA: 'Quitado — transferência efetivada',
};

// Fallback genérico: converte QUALQUER_COISA_ASSIM em "Qualquer coisa assim".
export function rotuloStatus(status: string): string {
  return (
    ROTULO_STATUS_ANALISE[status] ??
    ROTULO_STATUS_PROPOSTA[status] ??
    ROTULO_STATUS_CONTRATO[status] ??
    (status.charAt(0) + status.slice(1).toLowerCase()).replace(/_/g, ' ')
  );
}
