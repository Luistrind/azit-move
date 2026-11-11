import { randomBytes } from 'crypto';
import { formatCurrency, isoParaBR, primeiroNome } from '@azit/utils';

// ============================================================
// Fatura Azit — token e link da página pública (doc 02 §32.2 e §32.7).
// O link NUNCA é montado à mão fora daqui: endereço-base vem do ambiente
// (FATURA_PUBLICA_URL) e o token da fatura.
// ============================================================

// 64 hex (256 bits). Não expira; só o administrador regenera (vazamento).
export function novoTokenFatura(): string {
  return randomBytes(32).toString('hex');
}

export const TOKEN_FATURA_RE = /^[a-f0-9]{64}$/;

export function montarLinkFatura(baseUrl: string, token: string | null | undefined): string | null {
  if (!token) return null;
  return `${baseUrl.replace(/\/+$/, '')}/${token}`;
}

// WhatsApp do titular em dígitos com DDI para o wa.me (55 + DDD + número).
export function whatsappParaWaMe(whatsapp: string | null | undefined): string | null {
  const d = (whatsapp ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

// TEXTO PROVISÓRIO (pendência doc 02 §32.10-3: jurídico/V4 revisam). Sem
// "financiar/taxa/juros" (vocabulário 24/10). Serve ao envio manual pelo
// operador; os lembretes automáticos (§28) e a POP (§23) usarão a mesma base
// quando entrarem nesta branch.
export function mensagemLinkFatura(p: {
  nomeTitular: string;
  numero: number;
  vencimentoISO: string; // YYYY-MM-DD
  valorCentavos: number;
  situacao: string; // em_aberto | vence_hoje | vencida | ...
  link: string;
}): string {
  const nome = primeiroNome(p.nomeTitular);
  const venc = isoParaBR(p.vencimentoISO);
  const valor = formatCurrency(p.valorCentavos);
  const quando =
    p.situacao === 'vencida'
      ? `venceu em ${venc}`
      : p.situacao === 'vence_hoje'
        ? `vence hoje (${venc})`
        : `vence em ${venc}`;
  const atraso = p.situacao === 'vencida' ? ' O valor atualizado, com os encargos de atraso, está na página.' : '';
  return (
    `Olá, ${nome}! Aqui é da Azit Move. Sua fatura nº ${p.numero}, de ${valor}, ${quando}.${atraso} ` +
    `Veja os itens e pague com PIX pelo link: ${p.link}\n\n` +
    `O valor da página é atualizado em tempo real. Qualquer dúvida, é só responder por aqui.`
  );
}
