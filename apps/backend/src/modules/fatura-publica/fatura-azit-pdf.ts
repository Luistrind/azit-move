import type { FaturaPublica } from '@azit/types';
import { diaBrasil, formatCurrency, isoParaBR, projetarConta } from '@azit/utils';

// PDF do modelo AZIT (doc 02 §32.2, D-20 do Vicente): dois documentos pela
// MESMA projeção da página — a FATURA (itens, o que falta pagar, encargos do
// dia e o Pix, se houver um ativo) e o COMPROVANTE (itens, encargos pagos e os
// pagamentos com data, hora e identificador). Folha sempre clara, como impressa.
// `faturaId` = qual fatura da conta imprimir (a do link ou outra que a página
// mostra). Renderiza pelo Chromium já usado no dossiê (dossie/pdf.ts).

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function htmlFaturaAzitPdf(p: FaturaPublica, faturaId: string): { html: string; paga: boolean } {
  const conta = p.conta;
  if (!conta) throw new Error('htmlFaturaAzitPdf exige a conta do modelo AZIT');
  const k = projetarConta(conta.motor.faturas, conta.hoje, [], conta.motor.parametros.cascata);
  const f = k.faturas.find((x) => x.id === faturaId);
  const meta = conta.faturas.find((x) => x.id === faturaId);
  const motor = conta.motor.faturas.find((x) => x.id === faturaId);
  if (!f || !meta || !motor) throw new Error('fatura fora da conta');
  const paga = f.situacao === 'paga';
  const brl = formatCurrency;
  const dias = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;
  const taxas = motor.itens[0];
  const pct = (n: number) => String(n).replace('.', ',');

  const linhas = motor.itens
    .map((it) => {
      const nome = meta.itens.find((m) => m.id === it.id);
      const saldo = f.saldos.get(it.id) ?? 0;
      return `<tr><td>${esc(nome?.titulo ?? 'Item da fatura')}${nome?.subtitulo ? `<small>${esc(nome.subtitulo)}</small>` : ''}</td><td class="v">${brl(it.valor)}</td><td class="v">${saldo === 0 ? '—' : brl(saldo)}</td></tr>`;
    })
    .join('');
  const multaTxt = taxas ? `${pct(taxas.multaPct)}%, uma única vez` : 'uma única vez';
  const atualTxt = taxas ? `${pct(taxas.atualizacaoMesPct)}% ao mês, proporcional aos dias` : 'proporcional aos dias';
  let encargos = '';
  if (paga) {
    if (f.encargosPagos.multa > 0) encargos += `<tr><td>Multa por atraso<small>${multaTxt}</small></td><td class="v">${brl(f.encargosPagos.multa)}</td><td class="v">—</td></tr>`;
    if (f.encargosPagos.atualizacao > 0) encargos += `<tr><td>Atualização por dias de atraso<small>${atualTxt}</small></td><td class="v">${brl(f.encargosPagos.atualizacao)}</td><td class="v">—</td></tr>`;
  } else if (f.diasAtraso > 0) {
    encargos += `<tr><td>Multa por atraso<small>${multaTxt}</small></td><td class="v">${brl(f.encargo.multa)}</td><td class="v">${f.encargo.multa ? brl(f.encargo.multa) : 'R$ 0,00 (paga)'}</td></tr>`;
    encargos += `<tr><td>Atualização por dias de atraso<small>${dias(f.encargo.dias)} · ${atualTxt}</small></td><td class="v">${brl(f.encargo.atualizacao)}</td><td class="v">${brl(f.encargo.atualizacao)}</td></tr>`;
  }
  const pagamentos = meta.recebidos.length
    ? `<h3>Pagamentos recebidos</h3><table><tr><th>Data e hora</th><th>Identificador do Pix</th><th class="v">Valor</th></tr>${meta.recebidos
        .map((r) => `<tr><td>${isoParaBR(r.data)}${r.hora ? ` ${r.hora}` : ''}</td><td class="id">${esc(r.identificador ?? '—')}</td><td class="v">${brl(r.valor)}</td></tr>`)
        .join('')}</table>`
    : '';
  const ultimo = meta.recebidos.at(-1);
  const situacaoTxt = paga ? 'Paga' : f.situacao === 'parcial' ? 'Paga parcialmente' : f.situacao === 'vencida' ? 'Vencida' : f.situacao === 'hoje' ? 'Vence hoje' : 'Em aberto';
  // O PDF nunca CRIA cobrança: mostra o Pix só se já houver um ativo hoje.
  const pix = paga
    ? ''
    : conta.pix
      ? `<div class="pixf"><b>Pix copia e cola · ${brl(conta.pix.valor)} · válido até 23h59 de ${isoParaBR(diaBrasil(new Date(conta.pix.validoAte)))}${conta.pix.simulado ? ' · ambiente de teste, não pague' : ''}</b>${esc(conta.pix.copiaECola)}</div>`
      : `<div class="pixf"><b>Como pagar</b>Abra o link da sua fatura e toque em "Copiar código Pix": o código é gerado na hora, com o valor do dia, e vale até as 23h59.</div>`;
  const geradoEm = new Date(p.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const corSelo = paga ? '#1f9d5b' : '#2456c7';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${paga ? 'Comprovante' : 'Fatura'} Azit nº ${meta.numero}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  .cab { display: flex; justify-content: space-between; gap: 10px; border-bottom: 2px solid #001029; padding-bottom: 10px; margin-bottom: 10px; }
  .wm { font-weight: 800; font-size: 16pt; color: #001029; } .wm b { color: #fa8e0d; }
  .cab .e { font-size: 9pt; color: #4b5563; } .cab .r { text-align: right; color: #4b5563; font-size: 9.5pt; } .cab .r b { color: #111827; font-size: 11pt; }
  .selo { display: inline-block; border: 1.5px solid ${corSelo}; color: ${corSelo}; border-radius: 4px; padding: 1px 7px; font-weight: 800; letter-spacing: .06em; font-size: 9pt; text-transform: uppercase; margin-top: 3px; }
  .dl { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin: 10px 0; color: #374151; } .dl b { color: #111827; font-weight: 600; }
  h3 { font-size: 11pt; color: #001029; margin: 14px 0 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { text-align: left; font-size: 8.5pt; letter-spacing: .06em; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #d1d5db; padding: 4px 0; }
  td { padding: 6px 0; border-bottom: 1px solid #eef1f5; vertical-align: top; }
  td.v, th.v { text-align: right; white-space: nowrap; } td.id { font-size: 9pt; word-break: break-all; }
  td small { display: block; color: #6b7280; font-size: 9pt; }
  tr.tot td { border-top: 2px solid #001029; border-bottom: 0; font-weight: 800; font-size: 12pt; }
  .pixf { border: 1px dashed #9ca3af; border-radius: 6px; padding: 8px 10px; margin-top: 10px; word-break: break-all; font-size: 9pt; color: #374151; }
  .pixf b { display: block; font-size: 10pt; color: #111827; margin-bottom: 3px; word-break: normal; }
  .pe { border-top: 1px solid #d1d5db; margin-top: 14px; padding-top: 8px; font-size: 9pt; color: #6b7280; }
</style></head><body>
  <div class="cab">
    <div><div class="wm">azit<b>move</b></div><div class="e">${esc(conta.recebedor.nome)}${conta.recebedor.cnpj ? ` · CNPJ ${esc(conta.recebedor.cnpj)}` : ''}</div></div>
    <div class="r"><b>${paga ? 'Comprovante de pagamento' : 'Fatura'} nº ${meta.numero}</b>${p.contratos.length ? `<br>Contrato ${esc(p.contratos.join(', '))}` : ''}<br><span class="selo">${esc(situacaoTxt)}</span></div>
  </div>
  <div class="dl">
    <span>Titular</span><b>${esc(p.titular.primeiroNome)} · ${esc(p.titular.documentoMascarado)}</b>
    ${p.veiculo ? `<span>Veículo</span><b>${esc(p.veiculo.descricao)}${p.veiculo.placa ? ` · ${esc(p.veiculo.placa)}` : ''}</b>` : ''}
    <span>Vencimento</span><b>${isoParaBR(f.vencimento)}</b>
    <span>${paga ? 'Pago em' : 'Saldo em'}</span><b>${paga && ultimo ? `${isoParaBR(ultimo.data)}${ultimo.hora ? ` às ${ultimo.hora}` : ''}` : isoParaBR(conta.hoje)}</b>
  </div>
  <table><tr><th>Item</th><th class="v">Valor</th><th class="v">${paga ? 'Em aberto' : 'Falta pagar'}</th></tr>${linhas}${encargos}
    <tr class="tot"><td>${paga ? 'Total pago' : 'Total a pagar hoje'}</td><td></td><td class="v">${brl(paga ? f.pagoTotal : f.totalHoje)}</td></tr></table>
  ${pagamentos}
  ${pix}
  <div class="pe">Documento gerado em ${geradoEm} na página da Fatura Azit.${p.atendimentoWhatsapp ? ` Dúvidas: WhatsApp ${esc(p.atendimentoWhatsapp)}.` : ''} ${paga ? 'Este comprovante vale como recibo de quitação da fatura.' : 'Depois do vencimento, multa e atualização entram sobre o saldo que faltar; confira o valor do dia na página antes de pagar.'}</div>
</body></html>`;
  return { html, paga };
}
