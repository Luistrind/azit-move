import { chromium, Browser } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Render e junção de PDFs do dossiê (doc 02 §30). Chromium (Playwright, já na
// imagem do backend pelo robô do Infleet) desenha as páginas HTML; pdf-lib
// junta os PDFs (assinado, gerados, anexos) e carimba o rodapé.

export async function comNavegador<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  const navegador = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    return await fn(navegador);
  } finally {
    await navegador.close();
  }
}

export async function htmlParaPdf(navegador: Browser, html: string): Promise<Buffer> {
  const contexto = await navegador.newContext({ locale: 'pt-BR' });
  try {
    const pagina = await contexto.newPage();
    await pagina.setContent(html, { waitUntil: 'load' });
    const pdf = await pagina.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    return Buffer.from(pdf);
  } finally {
    await contexto.close();
  }
}

export async function contarPaginas(pdf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  return doc.getPageCount();
}

// WinAnsi (fonte padrão do pdf-lib) não tem todo caractere: tira o que não
// cabe em vez de falhar o dossiê inteiro por um nome com símbolo raro.
function winAnsiSeguro(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[^\x20-\x7E\xA0-\xFF–—•]/g, '');
}

export async function juntarPdfs(partes: Buffer[], rodape: string): Promise<{ pdf: Buffer; paginas: number }> {
  const saida = await PDFDocument.create();
  for (const parte of partes) {
    const doc = await PDFDocument.load(parte, { ignoreEncryption: true });
    const paginas = await saida.copyPages(doc, doc.getPageIndices());
    for (const p of paginas) saida.addPage(p);
  }
  const fonte = await saida.embedFont(StandardFonts.Helvetica);
  const total = saida.getPageCount();
  const texto = winAnsiSeguro(rodape);
  saida.getPages().forEach((p, i) => {
    const linha = `${texto} — página ${i + 1} de ${total}`;
    const largura = fonte.widthOfTextAtSize(linha, 7.5);
    const { width } = p.getSize();
    p.drawText(linha, { x: Math.max(14, (width - largura) / 2), y: 14, size: 7.5, font: fonte, color: rgb(0.42, 0.48, 0.55) });
  });
  const bytes = await saida.save();
  return { pdf: Buffer.from(bytes), paginas: total };
}
