import { formatCurrency } from '@azit/utils';

// Dossiê para judicialização (doc 02 §30): as páginas GERADAS pelo sistema são
// HTML no padrão visual do Hub (tokens do doc 03) renderizado pelo Chromium.
// Só texto e tabelas; as imagens (capturas) entram como data URL. Tudo o que é
// número vem calculado do service — aqui só se desenha.

const esc = (s: string | null | undefined): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
:root{--navy:#001029;--accent:#fa8e0d;--bg:#fff;--surface:#fff;--surface-input:#f1f4f8;--border:#e4e9ef;--border-light:#eef1f5;--text:#001029;--text-secondary:#6b7a8c;--text-muted:#9aa7b5;--ok-bg:#eafaf1;--ok-fg:#1f9d5b;--bad-bg:#fdeceb;--bad-fg:#e0413c;--warn-bg:#fef6e9;--warn-fg:#c98a0a}
*{box-sizing:border-box}
@page{size:A4;margin:16mm 14mm 18mm 14mm}
body{margin:0;background:#fff;color:var(--text);font-family:"Manrope","Segoe UI",system-ui,-apple-system,sans-serif;font-size:11.5px;line-height:1.4}
h1{font-family:"Outfit","Segoe UI",system-ui,sans-serif;font-size:19px;margin:0 0 2px}
h2{font-family:"Outfit","Segoe UI",system-ui,sans-serif;font-size:15px;margin:0 0 4px}
.sub{color:var(--text-secondary);font-size:11.5px;margin:0 0 12px}
.marca{display:flex;align-items:center;gap:8px;font-family:"Outfit","Segoe UI",sans-serif;font-weight:800;font-size:15px;color:var(--navy);margin-bottom:14px}
.marca span{color:var(--accent)}.marca small{font-weight:500;color:var(--text-muted);font-size:10px;margin-left:auto}
.card{border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid}
.head{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 18px}.head div{display:flex;flex-direction:column;gap:2px}
.head small{font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}.head span{font-size:12px;font-weight:600}.head em{font-style:normal;color:var(--text-secondary);font-size:10.5px}
.pills{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}.pill{border-radius:999px;padding:4px 10px;font-size:10.5px;font-weight:600;border:1px solid var(--border);background:var(--surface-input)}
.pill.ok{background:var(--ok-bg);color:var(--ok-fg);border-color:#cdeedb}.pill.bad{background:var(--bad-bg);color:var(--bad-fg);border-color:#f6cfcc}
.tit{font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin:0 0 8px}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}
th{text-align:left;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);padding:5px 7px;border-bottom:1px solid var(--border)}
td{padding:5px 7px;border-bottom:1px solid var(--border-light);vertical-align:middle;font-size:10.5px}tr{page-break-inside:avoid}
td.item{font-weight:600}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}td.r,th.r{text-align:right}
tr.futura td{color:var(--text-muted)}tr.atrasada td.item{color:#b8322e}
.chip{display:inline-block;border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700;white-space:nowrap}
.chip.ok{background:var(--ok-bg);color:var(--ok-fg)}.chip.bad{background:var(--bad-bg);color:var(--bad-fg)}.chip.warn{background:var(--warn-bg);color:var(--warn-fg)}.chip.neutro{background:var(--surface-input);color:#5b6b7f}
.tot{display:flex;justify-content:flex-end;gap:24px;padding:10px 7px 0;font-size:11.5px}.tot b{font-family:"Outfit","Segoe UI",sans-serif;font-size:13.5px}
.foot{color:var(--text-muted);font-size:10px;margin-top:8px}
.capa{min-height:60vh;display:flex;flex-direction:column;justify-content:center}
.capa .rotulo{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
.capa h1{font-size:24px;margin-bottom:6px}.capa p{margin:4px 0;font-size:12px;color:var(--text-secondary)}
.sumario{margin-top:26px}.sumario table td{font-size:11.5px;padding:6px 7px}
.anexo-capa{min-height:50vh;display:flex;flex-direction:column;justify-content:center}
.anexo-capa .rotulo{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
.anexo-capa h1{font-size:22px}.anexo-capa p{margin:4px 0;font-size:12px;color:var(--text-secondary)}
.pag-capturas{page-break-after:always;height:100%}
.pag-capturas:last-child{page-break-after:auto}
.cab{font-size:10px;color:var(--text-muted);margin-bottom:6px;display:flex;justify-content:space-between}
.duas{display:grid;grid-template-columns:1fr 1fr;gap:10px;height:238mm}
.duas figure{margin:0;border:1px solid var(--border);border-radius:8px;padding:6px;display:flex;flex-direction:column;min-height:0}
.duas figcaption{font-size:10px;font-weight:700;color:var(--text-secondary);margin-bottom:4px}
.duas img{flex:1;min-height:0;width:100%;object-fit:contain;object-position:top}
.texto{white-space:pre-wrap;font-size:10.5px;line-height:1.45}
`;

function pagina(corpo: string, titulo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head><body>${corpo}</body></html>`;
}

const marca = (rodape: string) => `<div class="marca">azit<span>move</span><small>${esc(rodape)}</small></div>`;

export interface CabecalhoDossie {
  numero: string;
  titular: string;
  cpf: string;
  veiculo: string; // "HYUNDAI HB20S 2024/2025 · placa ABC1D23"
  emitidoEm: string; // 'DD/MM/AAAA'
}

export interface SecaoSumario { titulo: string; paginaInicial: number; paginas: number }

// Capa + sumário (primeira página do dossiê).
export function htmlCapa(cab: CabecalhoDossie, secoes: SecaoSumario[], avisos: string[]): string {
  const linhas = secoes.map((s) => `<tr><td class="item">${esc(s.titulo)}</td><td class="num r">p. ${s.paginaInicial}${s.paginas > 1 ? `–${s.paginaInicial + s.paginas - 1}` : ''}</td></tr>`).join('');
  const av = avisos.length ? `<p class="foot">${avisos.map((a) => `⚠ ${esc(a)}`).join('<br>')}</p>` : '';
  return pagina(`${marca(`emitido em ${cab.emitidoEm}`)}
<div class="capa">
  <div class="rotulo">Dossiê para cobrança judicial</div>
  <h1>Contrato ${esc(cab.numero)}</h1>
  <p><b style="color:var(--text)">${esc(cab.titular)}</b> · CPF ${esc(cab.cpf)}</p>
  <p>${esc(cab.veiculo)}</p>
  <p>Documento montado pelo sistema Azit Move em ${esc(cab.emitidoEm)} a partir dos registros do contrato.</p>
  <div class="sumario"><p class="tit">Conteúdo</p><table><tbody>${linhas}</tbody></table></div>
  ${av}
</div>`, `Dossiê ${cab.numero}`);
}

export interface LinhaHistorico {
  item: string;
  vencimento: string; // 'DD/MM/AAAA' ou intervalo
  valor: number; // centavos
  pagamento: string; // 'DD/MM/AAAA' | '—'
  valorPago: number | null; // centavos
  situacao: { rotulo: string; tom: 'ok' | 'bad' | 'warn' | 'neutro' };
  classe?: 'atrasada' | 'futura' | '';
}

export interface DadosHistorico {
  cab: CabecalhoDossie;
  produto: string; // "Compra Parcelada"
  contrato: { assinadoEm: string; numeroParcelas: number; periodicidade: string; diaVencimento: string | null };
  veiculo: { descricao: string; placa: string; chassi: string | null };
  parcela: { valor: number; composicao: string }; // "R$ 942,00 + proteção R$ 50,00 + taxas R$ 5,00"
  pills: { texto: string; tom?: 'ok' | 'bad' }[];
  linhas: LinhaHistorico[];
  totais: { pago: number; emAtraso: number };
  nota: string;
}

// Histórico do contrato (modelo do dossiê do João Gabriel, 16/10/2026).
export function htmlHistorico(d: DadosHistorico): string {
  const linhas = d.linhas.map((l) => `<tr class="${l.classe ?? ''}">
<td class="item">${esc(l.item)}</td><td class="num">${esc(l.vencimento)}</td><td class="num r">${formatCurrency(l.valor)}</td>
<td class="num">${esc(l.pagamento)}</td><td class="num r">${l.valorPago === null ? '—' : formatCurrency(l.valorPago)}</td>
<td><span class="chip ${l.situacao.tom}">${esc(l.situacao.rotulo)}</span></td></tr>`).join('');
  const pills = d.pills.map((p) => `<span class="pill ${p.tom ?? ''}">${esc(p.texto)}</span>`).join('');
  return pagina(`${marca(`Carteira › Contratos › ${d.cab.numero} › Histórico`)}
<h1>Histórico do contrato ${esc(d.cab.numero)}</h1>
<p class="sub">${esc(d.produto)} · ${esc(d.cab.titular)} · emitido em ${esc(d.cab.emitidoEm)}</p>
<div class="card"><div class="head">
<div><small>Cliente</small><span>${esc(d.cab.titular)}</span><em>CPF ${esc(d.cab.cpf)}</em></div>
<div><small>Contrato</small><span>Nº ${esc(d.cab.numero)}</span><em>assinado em ${esc(d.contrato.assinadoEm)} · ${d.contrato.numeroParcelas} parcelas</em></div>
<div><small>Veículo</small><span>${esc(d.veiculo.descricao)}</span><em>placa ${esc(d.veiculo.placa)}${d.veiculo.chassi ? ` · chassi ${esc(d.veiculo.chassi)}` : ''}</em></div>
<div><small>Parcela ${esc(d.contrato.periodicidade)}</small><span>${formatCurrency(d.parcela.valor)}${d.contrato.diaVencimento ? ` · ${esc(d.contrato.diaVencimento)}` : ''}</span><em>${esc(d.parcela.composicao)}</em></div>
</div><div class="pills">${pills}</div></div>
<div class="card"><p class="tit">Parcelas — ${d.linhas.some((l) => l.item.startsWith('Entrada')) ? 'entrada e ' : ''}${d.contrato.numeroParcelas} ${esc(d.contrato.periodicidade === 'semanal' ? 'semanais' : d.contrato.periodicidade === 'quinzenal' ? 'quinzenais' : 'mensais')}</p>
<table><thead><tr><th>Item</th><th>Vencimento</th><th class="r">Valor</th><th>Pagamento</th><th class="r">Valor pago</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table>
<div class="tot"><span>Pago <b>${formatCurrency(d.totais.pago)}</b></span><span>Em atraso <b style="color:var(--bad-fg)">${formatCurrency(d.totais.emAtraso)}</b></span></div>
<p class="foot">${esc(d.nota)}</p></div>`, `Histórico ${d.cab.numero}`);
}

// Capa de anexo (comunicações, notificação, Infleet, contrato social).
export function htmlCapaAnexo(cab: CabecalhoDossie, titulo: string, paragrafos: string[]): string {
  return pagina(`${marca(`Dossiê · contrato ${cab.numero}`)}
<div class="anexo-capa"><div class="rotulo">Anexo</div><h1>${esc(titulo)}</h1>
<p><b style="color:var(--text)">Contrato ${esc(cab.numero)}</b> — ${esc(cab.titular)}</p><p>${esc(cab.veiculo)}</p>
${paragrafos.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`, titulo);
}

// Páginas das capturas: duas por página, numeradas.
export function htmlCapturas(cab: CabecalhoDossie, imagens: { dataUrl: string }[]): string {
  const total = imagens.length;
  const paginas: string[] = [];
  for (let i = 0; i < total; i += 2) {
    const par = imagens.slice(i, i + 2);
    const nums = par.map((_, k) => i + k + 1);
    paginas.push(`<section class="pag-capturas">
<div class="cab"><span>Comunicações com o cliente — WhatsApp (contrato ${esc(cab.numero)})</span><span>${nums.length === 2 ? `Capturas ${nums[0]} e ${nums[1]}` : `Captura ${nums[0]}`} de ${total}</span></div>
<div class="duas">${par.map((img, k) => `<figure><figcaption>Captura ${nums[k]}</figcaption><img src="${img.dataUrl}" alt="Captura ${nums[k]}"></figure>`).join('')}</div>
</section>`);
  }
  return pagina(paginas.join(''), `Capturas ${cab.numero}`);
}

// Instrumento do contrato em texto (quando não há PDF assinado): o markdown do
// snapshot vira texto corrido com títulos simples.
export function htmlTextoContrato(cab: CabecalhoDossie, texto: string): string {
  const corpo = esc(texto)
    .replace(/^### (.*)$/gm, '<h2>$1</h2>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return pagina(`${marca(`Contrato ${cab.numero} · instrumento gerado pelo sistema`)}<div class="texto">${corpo}</div>`, `Contrato ${cab.numero}`);
}
