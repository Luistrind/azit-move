import { formatCurrency, formatarInstanteHoraBR } from '@azit/utils';
import { ConteudoEmailNotificacao } from '../notificacao/notificacao.service';

// Conteúdo do e-mail dos eventos de aprovação (doc 06 v1.1 §12.2 / §12.3 item 1).
// Só entra o que pode sair do perímetro do sistema: tipo de operação, valor,
// quem solicitou (usuário interno), data e — pelo link — o ocorrido. NUNCA o
// `resumo` da solicitação (cita o cliente), parecer, pergunta ou resposta
// (texto livre que pode citar o cliente). Quem quiser detalhe clica e entra.
// Vocabulário: "não aprovada" em vez de "reprovada" (§12.3 item 6).

export type EventoEmailAprovacao =
  | { evento: 'esperando' }
  | { evento: 'escalada'; recomendadaPor: string }
  | { evento: 'complemento_pedido'; pedidoPor: string }
  | { evento: 'complemento_respondido'; respondidoPor: string }
  | { evento: 'decidida'; decisao: 'aprovada' | 'nao_aprovada' | 'recomendada'; por: string };

export interface DadosEmailAprovacao {
  aprovacaoId: string;
  operacaoNome: string;
  valorCentavos: number;
  solicitanteNome: string;
  em: Date; // instante do evento (data no fuso do Brasil — Regra 15)
}

export const ROTULO_DECISAO_EMAIL = { aprovada: 'aprovada', nao_aprovada: 'não aprovada', recomendada: 'recomendada' } as const;

export function emailAprovacao(d: DadosEmailAprovacao, ev: EventoEmailAprovacao): ConteudoEmailNotificacao {
  const base = [
    `Operação: ${d.operacaoNome}`,
    ...(d.valorCentavos > 0 ? [`Valor: ${formatCurrency(d.valorCentavos)}`] : []),
    `Solicitante: ${d.solicitanteNome}`,
    `Data: ${formatarInstanteHoraBR(d.em)}`,
  ];
  switch (ev.evento) {
    case 'esperando':
      return {
        assunto: `Aprovação esperando por você: ${d.operacaoNome}`,
        linhas: [...base, 'A sua alçada cobre esta operação. Abra o Hub para ver o dossiê e decidir.'],
        aprovacaoPendenteId: d.aprovacaoId,
      };
    case 'escalada':
      return {
        assunto: `Aprovação esperando por você: ${d.operacaoNome}`,
        linhas: [...base, `Recomendada por ${ev.recomendadaPor} — agora depende de quem tem alçada para o valor. Abra o Hub para decidir.`],
        aprovacaoPendenteId: d.aprovacaoId,
      };
    case 'complemento_pedido':
      return {
        assunto: `Pediram complemento na sua solicitação: ${d.operacaoNome}`,
        linhas: [...base, `${ev.pedidoPor} pediu um complemento. A pergunta está no Hub — a solicitação fica parada até a sua resposta.`],
      };
    case 'complemento_respondido':
      return {
        assunto: `Responderam o complemento: ${d.operacaoNome}`,
        linhas: [...base, `${ev.respondidoPor} respondeu o complemento que você pediu. A solicitação voltou para a fila de decisão.`],
        aprovacaoPendenteId: d.aprovacaoId,
      };
    case 'decidida':
      return {
        assunto: `Sua solicitação foi ${ROTULO_DECISAO_EMAIL[ev.decisao]}: ${d.operacaoNome}`,
        linhas: [...base, `Decisão: ${ROTULO_DECISAO_EMAIL[ev.decisao]} por ${ev.por}. O parecer está no Hub.`],
      };
  }
}
