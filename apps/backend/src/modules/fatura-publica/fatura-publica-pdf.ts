import type { FaturaPublica } from '@azit/types';
import { formatCurrency, isoParaBR } from '@azit/utils';

// PDF da Fatura Azit (doc 02 §32.2): o mesmo conteúdo da página, em A4, para o
// cliente guardar ou imprimir. Em aberto = fatura; paga = comprovante. Renderiza
// pelo Chromium já usado no dossiê (dossie/pdf.ts).

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const SITUACAO: Record<string, string> = {
  em_aberto: 'Em aberto',
  vence_hoje: 'Vence hoje',
  vencida: 'Vencida',
  paga: 'Paga',
  indisponivel: 'Indisponível',
};

export function htmlFaturaPdf(p: FaturaPublica): string {
  const paga = p.situacao === 'paga';
  const rotuloSituacao = paga ? 'Paga' : p.pagaParcialmente ? 'Paga parcialmente' : (SITUACAO[p.situacao] ?? p.situacao);
  const linhas = p.itens
    .map(
      (it) => `<tr><td><div class="t">${esc(it.titulo)}</div>${it.subtitulo ? `<div class="s">${esc(it.subtitulo)}</div>` : ''}</td><td class="v">${formatCurrency(it.valor)}</td></tr>`,
    )
    .join('');
  const encargo = p.encargo
    ? `<tr class="enc"><td><div class="t">Multa por atraso</div><div class="s">cobrada uma única vez</div></td><td class="v">${formatCurrency(p.encargo.multa)}</td></tr>
       <tr class="enc"><td><div class="t">Atualização por dias de atraso</div><div class="s">${p.encargo.diasAtraso} ${p.encargo.diasAtraso === 1 ? 'dia' : 'dias'} · calculada só sobre o saldo que falta pagar</div></td><td class="v">${formatCurrency(p.encargo.atualizacao)}</td></tr>`
    : '';
  const recebidos = p.pagamentos.length
    ? `<h2>Valores já recebidos</h2><table>${p.pagamentos.map((r) => `<tr><td>Pagamento em ${isoParaBR(r.data)}</td><td class="v ok">${formatCurrency(r.valor)}</td></tr>`).join('')}</table>`
    : '';
  const pix =
    !paga && p.pix
      ? `<h2>Pagar com PIX</h2><div class="pix"><div class="pv">${formatCurrency(p.pix.valor)}</div><div class="s">Copia-e-cola${p.pix.simulado ? ' (ambiente de teste — PIX simulado)' : ''}:</div><div class="code">${esc(p.pix.payload)}</div></div>`
      : '';
  const vencTexto = paga
    ? `Vencimento ${isoParaBR(p.vencimento)}${p.dataPagamento ? ` · paga em ${isoParaBR(p.dataPagamento)}` : ''}`
    : p.encargo
      ? `Venceu em ${isoParaBR(p.vencimento)} · ${p.encargo.diasAtraso} ${p.encargo.diasAtraso === 1 ? 'dia' : 'dias'} de atraso`
      : `Vence em ${isoParaBR(p.vencimento)}`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Fatura Azit nº ${p.numero}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #17201c; font-size: 11.5pt; margin: 0; }
  .topo { background: #001029; color: #fff; padding: 16px 18px; border-radius: 10px; }
  .marca { font-weight: 800; font-size: 16pt; letter-spacing: -.01em; } .marca b { color: #fa8e0d; }
  .meta { color: #a9b6c6; font-size: 9.5pt; margin-top: 4px; }
  .ola { margin-top: 10px; font-size: 11pt; color: #d5deea; } .ola strong { color: #fff; }
  .sit { display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 999px; background: ${paga ? '#1f9d5b' : p.encargo ? '#e0413c' : '#2456c7'}; color: #fff; font-size: 9.5pt; font-weight: 700; }
  .total { margin-top: 10px; } .total .k { font-size: 8.5pt; letter-spacing: .06em; text-transform: uppercase; color: #a9b6c6; }
  .total .v { font-size: 26pt; font-weight: 800; } .total .venc { color: #d5deea; font-size: 10pt; }
  h2 { font-size: 9.5pt; letter-spacing: .08em; text-transform: uppercase; color: #6b7a8c; margin: 20px 0 6px; }
  table { width: 100%; border-collapse: collapse; } td { padding: 7px 0; border-bottom: 1px solid #e4e9ef; vertical-align: top; }
  td.v { text-align: right; white-space: nowrap; font-weight: 700; width: 120px; } .ok { color: #1f9d5b; }
  .t { font-weight: 600; } .s { font-size: 9.5pt; color: #6b7a8c; margin-top: 2px; }
  tr.enc .t { color: #8a5a00; }
  .soma { display: flex; justify-content: space-between; padding-top: 10px; font-weight: 800; font-size: 14pt; border-top: 1px dashed #c8d0d8; margin-top: 4px; }
  .pix { border: 1px solid #e4e9ef; border-radius: 10px; padding: 12px 14px; } .pv { font-weight: 800; font-size: 16pt; }
  .code { font-family: Consolas, monospace; font-size: 8.5pt; word-break: break-all; background: #f1f4f8; padding: 8px; border-radius: 6px; margin-top: 6px; }
  .pago { background: #eafaf1; color: #1f9d5b; border-radius: 10px; padding: 14px; font-weight: 700; margin-top: 16px; }
  .rodape { margin-top: 22px; font-size: 9pt; color: #6b7a8c; border-top: 1px solid #e4e9ef; padding-top: 8px; }
</style></head><body>
  <div class="topo">
    <div class="marca">azit<b>move</b></div>
    <div class="meta">Fatura nº ${p.numero}${p.contratos.length ? ` · Contrato ${esc(p.contratos.join(', '))}` : ''}${p.veiculo ? ` · ${esc(p.veiculo.descricao)}${p.veiculo.placa ? ` ${esc(p.veiculo.placa)}` : ''}` : ''}</div>
    <div class="ola">Olá, <strong>${esc(p.titular.primeiroNome)}</strong> (${esc(p.titular.documentoMascarado)}). ${paga ? 'Esta fatura está quitada.' : 'Aqui está o detalhe da sua fatura.'}</div>
    <div><span class="sit">${esc(rotuloSituacao)}</span></div>
    <div class="total"><div class="k">${paga ? 'Total pago' : p.pagaParcialmente ? 'Saldo a pagar hoje' : 'Total a pagar'}</div><div class="v">${formatCurrency(paga ? Math.max(p.valorPago, p.valorNominal) : p.totalHoje)}</div><div class="venc">${esc(vencTexto)}</div></div>
  </div>
  ${recebidos}
  <h2>Itens da fatura</h2>
  <table>${linhas}${encargo}</table>
  ${!paga ? `<div class="soma"><span>Total hoje</span><span>${formatCurrency(p.totalHoje)}</span></div>` : `<div class="pago">Fatura paga. Obrigado, ${esc(p.titular.primeiroNome)}!</div>`}
  ${pix}
  <div class="rodape">Azit Move${p.atendimentoWhatsapp ? ` · Dúvidas sobre esta fatura: WhatsApp ${esc(p.atendimentoWhatsapp)}` : ''} · Documento gerado em ${new Date(p.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Valores de atraso são calculados por dia; confira o valor atualizado na página da fatura antes de pagar.</div>
</body></html>`;
}
