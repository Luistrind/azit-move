import { isoParaBR } from '@azit/utils';

// PDF da simulação mandada ao cliente pela tela Conversas (doc 02 §34.7). Leva
// SÓ os valores que o serviço da simulação já devolveu (a tela manda as linhas
// prontas) — nenhuma conta aqui (Regra 16). Renderiza pelo Chromium do dossiê.

export interface DocumentoSimulacao {
  titulo: string; // ex.: "Simulação · Fiat Mobi Like 2023"
  para: string; // nome de quem recebe
  destaque: { rotulo: string; valor: string } | null; // ex.: "Parcela" / "R$ 699 por semana"
  linhas: { rotulo: string; valor: string }[];
  observacoes: string[];
  emitidaEm: string; // YYYY-MM-DD (fuso do Brasil)
}

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function nomeArquivoSimulacao(titulo: string): string {
  const base = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return `${base || 'simulacao'}-azit-move.pdf`;
}

export function htmlSimulacaoPdf(d: DocumentoSimulacao): string {
  const linhas = d.linhas.map((l) => `<tr><td>${esc(l.rotulo)}</td><td class="v">${esc(l.valor)}</td></tr>`).join('');
  const obs = d.observacoes.length ? `<ul class="obs">${d.observacoes.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 22mm 18mm; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #001029; font-size: 12.5px; margin: 0; }
    .logo { font-weight: 800; font-size: 22px; letter-spacing: -.01em; }
    .logo span { color: #FA8E0D; }
    h1 { font-size: 18px; margin: 22px 0 4px; }
    .sub { color: #5b6b7f; font-size: 12px; }
    .dest { margin: 20px 0; padding: 16px 18px; border-radius: 12px; background: #f8fafc; border: 1px solid #e4e9ef; }
    .dest .r { color: #5b6b7f; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
    .dest .x { font-size: 28px; font-weight: 800; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 9px 0; border-bottom: 1px solid #eef1f5; }
    td.v { text-align: right; font-weight: 700; white-space: nowrap; }
    .obs { margin: 18px 0 0; padding-left: 16px; color: #5b6b7f; }
    .obs li { margin-bottom: 4px; }
    .rodape { margin-top: 36px; color: #9aa7b5; font-size: 10.5px; }
  </style></head><body>
    <div class="logo">azit<span>move</span></div>
    <h1>${esc(d.titulo)}</h1>
    <div class="sub">Para ${esc(d.para)} · emitida em ${isoParaBR(d.emitidaEm)}</div>
    ${d.destaque ? `<div class="dest"><div class="r">${esc(d.destaque.rotulo)}</div><div class="x">${esc(d.destaque.valor)}</div></div>` : ''}
    <table>${linhas}</table>
    ${obs}
    <div class="rodape">Simulação sem valor de contrato. Os valores valem para as datas indicadas acima. Azit Move.</div>
  </body></html>`;
}
