import { ROTULO_CODIGO_ANALISE } from '@azit/utils';
import type { Aprovacao } from '../services/aprovacao.service';
import type { EventoTrilhaProps } from '../components/Trilha';
import { TRILHA_APROVACAO_FG } from '../config/statusColors';
import { instanteBR } from './datas';

// Textos humanos da Central de Aprovações (lista e dossiê, 21/10/2026) — uma
// fonte só para as duas telas.

// Central legível (feedback Luís 07/09): título sem id interno nem códigos —
// aprovações antigas gravaram "proposta cmXXXX (COC-08, ...)" no resumo. As
// exceções do acordo/novação saem do título porque aparecem como motivos.
export function tituloHumano(resumo: string): string {
  return resumo
    .replace(/\s*·\s*⚠ EXCEÇÕES:.*$/, '')
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1') // vencimento do contas a pagar vem em ISO
    .replace(/\bcm[a-z0-9]{16,}\b/g, '') // ids internos somem
    .replace(/\(?\b(?:COC|COM|APR)-\d+(?:,\s*(?:COC|COM|APR)-\d+)*\)?/g, '') // códigos viram bullets
    .replace(/COCAD — análise da proposta\s*/, 'Análise de cadastro · decisão do Comitê ')
    .replace(/\(exceção\)/, '· exceção encaminhada pelo analista')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s—·:]+$/, '')
    .trim();
}

// Motivos por extenso: payload das aprovações novas; nas antigas, traduz os
// códigos que estiverem no resumo pelo dicionário da política.
export function motivosDe(a: Aprovacao): string[] {
  if (a.motivos?.length) return a.motivos;
  const codigos = [...new Set(a.resumo.match(/\b(?:COC|COM|APR)-\d+\b/g) ?? [])];
  return codigos.map((c) => ROTULO_CODIGO_ANALISE[c] ?? c);
}

// "1/2 · Luís aprovou" — quem já decidiu, em uma linha.
export function resumoDecisoes(a: Aprovacao): string {
  const verbos: Record<string, string> = { APROVADA: 'aprovou', RECOMENDADA: 'recomendou', REPROVADA: 'reprovou' };
  const quem = a.decisoes.map((d) => `${d.usuario.split(' ')[0]} ${verbos[d.decisao] ?? d.decisao.toLowerCase()}`);
  return [`${a.aprovacoesFeitas}/${a.aprovacoesNecessarias}`, ...quem].join(' · ');
}

// O que acontece quando a ÚLTIMA aprovação necessária é registrada (efetivador
// de cada operação — doc 02 §7.9-A). Mantido em sincronia com os efetivadores.
const EFEITO_APROVACAO: Record<string, string> = {
  acordo: 'a cobrança da entrada é emitida no Asaas (com a data-limite) e o acordo aguarda o pagamento — o pagamento efetiva o plano nas próximas faturas.',
  novacao: 'os contratos novos são criados sem cronograma e o instrumento vai para assinatura; a novação ativa depois da assinatura (e do recebimento inicial, se houver).',
  analise_cadastro: 'a análise fica aprovada pelo Comitê e pode ser liberada para formalização.',
  credito_avulso: 'o crédito é efetivado no contrato do cliente.',
  reembolso_parcelado: 'o Reembolso Parcelado é efetivado e o desembolso ao fornecedor segue para o contas a pagar.',
  reajuste: 'a parcela reajustada passa a valer no contrato.',
  condicao_fora_parametro: 'a proposta fica liberada para formalizar com esta condição.',
  despesa_contas_pagar: 'o título segue para a programação de pagamento.',
  orcamento_contas_pagar: 'a cotação escolhida vira título a pagar no fluxo normal.',
  lote_pagamento: 'o lote é liberado para pagamento.',
  reabertura_titulo: 'o título é reaberto.',
  fornecedor_dados_bancarios: 'o cadastro / os dados bancários do fornecedor passam a valer.',
};

export function notaAoAprovar(a: Aprovacao): string {
  const efeito = EFEITO_APROVACAO[a.tipoOperacao] ?? 'a operação é efetivada.';
  const ordem = a.aprovacoesFeitas + 1;
  if (a.aprovacoesFaltando > 1) {
    return `Esta é a ${ordem}ª de ${a.aprovacoesNecessarias} aprovações: a sua fica registrada e a solicitação aguarda as demais. Na última, ${efeito}`;
  }
  return a.aprovacoesNecessarias > 1 ? `Esta é a ${ordem}ª de ${a.aprovacoesNecessarias} aprovações: ao aprovar, ${efeito}` : `Ao aprovar, ${efeito}`;
}

// Trilha da SOLICITAÇÃO: pedido, decisões e complementos em ordem cronológica.
export function trilhaDaSolicitacao(a: Aprovacao): EventoTrilhaProps[] {
  const verbos: Record<string, string> = { APROVADA: 'aprovou', RECOMENDADA: 'recomendou (acima da alçada)', REPROVADA: 'reprovou' };
  const eventos: EventoTrilhaProps[] = [
    { em: a.solicitadoEm, titulo: `${a.solicitante} solicitou`, cor: TRILHA_APROVACAO_FG.SOLICITADA },
    ...a.decisoes.map((d) => ({ em: d.em, titulo: `${d.usuario} ${verbos[d.decisao] ?? d.decisao.toLowerCase()}`, detalhe: d.parecer ? `“${d.parecer}”` : null, cor: TRILHA_APROVACAO_FG[d.decisao] })),
    ...a.complementos.flatMap((c) => [
      { em: c.pedidoEm, titulo: `${c.pedidoPor} pediu complemento`, detalhe: `“${c.pergunta}” · responder até ${instanteBR(c.prazo)}`, cor: TRILHA_APROVACAO_FG.COMPLEMENTO_PEDIDO },
      ...(c.respondidoEm ? [{ em: c.respondidoEm, titulo: `${c.respondidoPor ?? 'Solicitante'} respondeu o complemento`, detalhe: c.resposta ? `“${c.resposta}”` : null, cor: TRILHA_APROVACAO_FG.COMPLEMENTO_RESPONDIDO }] : []),
    ]),
  ];
  return eventos.sort((x, y) => (x.em ?? '').localeCompare(y.em ?? ''));
}
