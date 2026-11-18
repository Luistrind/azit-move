import { formatCurrency } from './formatters';

// "De acordo" do Reembolso Parcelado (doc 02 §18.7, decisão de 18/11/2026): o
// produto vale pela resposta do cliente no WhatsApp — sem contrato nem
// assinatura. A mensagem é montada AQUI, uma vez, e é ela que fica gravada no
// registro do aceite. Vocabulário: sem "financiar", "taxa" ou "juros".

export interface AceiteWhatsappRegistrado {
  confirmadoPeloOperadorEm: string; // ISO
  confirmadoPor?: string | null; // id do usuário que registrou
  mensagemEnviada?: string | null;
  respostaCliente?: string | null;
}

const FREQUENCIA: Record<string, [string, string]> = {
  semanal: ['parcela semanal', 'parcelas semanais'],
  quinzenal: ['parcela quinzenal', 'parcelas quinzenais'],
  mensal: ['parcela mensal', 'parcelas mensais'],
};

export function mensagemDeAcordoReembolso(p: {
  nomeCliente: string;
  fornecedorNome: string;
  finalidade?: string | null;
  valorPagoAoFornecedor: number; // centavos
  numeroParcelas: number;
  valorParcela: number; // centavos
  totalAPagar: number; // centavos
  periodicidade: string; // semanal | quinzenal | mensal
}): string {
  const primeiroNome = p.nomeCliente.trim().split(/\s+/)[0] ?? '';
  const [um, varios] = FREQUENCIA[p.periodicidade.toLowerCase()] ?? ['parcela', 'parcelas'];
  const finalidade = p.finalidade?.trim();
  return [
    `Olá, ${primeiroNome}! Aqui é a Azit Move. Segue o Reembolso Parcelado que combinamos:`,
    '',
    `• Nós pagamos ${formatCurrency(p.valorPagoAoFornecedor)} à vista a ${p.fornecedorNome.trim()}${finalidade ? ` (${finalidade})` : ''}.`,
    `• Você nos paga em ${p.numeroParcelas} ${p.numeroParcelas === 1 ? um : varios} de ${formatCurrency(p.valorParcela)}, junto com as suas faturas, a partir da próxima fatura em aberto.`,
    `• Total: ${formatCurrency(p.totalAPagar)}.`,
    '',
    'Se estiver de acordo com essas condições, responda *DE ACORDO* a esta mensagem.',
  ].join('\n');
}

// Texto corrido do aceite, para o dossiê (Central de Aprovações e judicialização).
export function textoDoAceiteWhatsapp(a: AceiteWhatsappRegistrado, quemRegistrou: string, quando: string): string {
  return [
    'CONTRATAÇÃO POR "DE ACORDO" DO CLIENTE (WhatsApp) — sem contrato assinado.',
    '',
    `Registrado por ${quemRegistrou} em ${quando}.`,
    '',
    'Mensagem enviada ao cliente:',
    a.mensagemEnviada?.trim() || '(mensagem não registrada)',
    '',
    'Resposta do cliente:',
    a.respostaCliente?.trim() || '(o texto da resposta não foi registrado; a confirmação foi marcada pelo operador)',
  ].join('\n');
}
