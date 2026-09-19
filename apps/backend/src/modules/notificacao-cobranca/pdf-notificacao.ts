import PDFDocument from 'pdfkit';

// PDF das notificações formais (POP-COB-001, doc 02 §23 item 5): a notificação
// vai como DOCUMENTO anexado ao modelo curto da Meta. Layout sóbrio de
// correspondência jurídica; o rodapé carrega o SHA-256 do TEXTO — a mesma
// impressão digital guardada no banco (prova de integridade do conteúdo).

const EMITENTE = 'AZIT COMÉRCIO DE VEÍCULOS LTDA';
const EMITENTE_LINHA = 'CNPJ 57.265.780/0001-19 · Rua José Machado, 103, Tabuazeiro – Vitória/ES · contato@azitmove.com.br';
const TINTA = '#1d2733';
const APAGADO = '#6b7785';

export interface ConteudoNotificacao {
  titulo: string; // "1ª NOTIFICAÇÃO"
  subtitulo: string;
  assunto: string;
  texto: string; // linhas; "- " = item
  notificado: string; // nome
  contrato: string;
  emitidaEm: Date;
  textoSha256: string;
}

const dataHoraBR = (d: Date) =>
  d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function cabecalho(doc: PDFKit.PDFDocument) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(TINTA).text(EMITENTE);
  doc.font('Helvetica').fontSize(8).fillColor(APAGADO).text(EMITENTE_LINHA);
  const y = doc.y + 6;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).lineWidth(0.6).strokeColor('#c9d1da').stroke();
  doc.y = y + 14;
}

// Corpo: parágrafos justificados; itens com marcador e recuo.
function corpo(doc: PDFKit.PDFDocument, texto: string) {
  const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font('Helvetica').fontSize(10.5).fillColor(TINTA);
  for (const linha of texto.split('\n')) {
    const l = linha.trim();
    if (!l) continue;
    if (l.startsWith('- ')) {
      const x = doc.page.margins.left;
      doc.text('•', x + 8, doc.y, { continued: false, width: 10 });
      doc.moveUp();
      doc.text(l.slice(2), x + 22, doc.y, { width: largura - 22, align: 'justify', paragraphGap: 5, lineGap: 1.5 });
      doc.x = x;
    } else {
      doc.text(l, doc.page.margins.left, doc.y, { width: largura, align: 'justify', paragraphGap: 7, lineGap: 1.5 });
    }
  }
}

function rodapes(doc: PDFKit.PDFDocument, linha: (pagina: number, total: number) => string) {
  const faixa = doc.bufferedPageRange();
  for (let i = faixa.start; i < faixa.start + faixa.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // escrever na margem sem abrir página nova
    doc.font('Helvetica').fontSize(7.5).fillColor(APAGADO).text(linha(i - faixa.start + 1, faixa.count), doc.page.margins.left, doc.page.height - 40, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'center',
    });
    doc.page.margins.bottom = bottom;
  }
}

function paraBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    doc.end();
  });
}

function novoDoc(titulo: string) {
  return new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 64, left: 62, right: 62 },
    bufferPages: true,
    info: { Title: titulo, Author: EMITENTE, Creator: 'Azit Hub' },
  });
}

function escreverNotificacao(doc: PDFKit.PDFDocument, c: ConteudoNotificacao) {
  cabecalho(doc);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(TINTA).text(c.titulo.toUpperCase());
  doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(APAGADO).text(c.subtitulo);
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(9.5).fillColor(TINTA)
    .text(`Notificado(a): ${c.notificado}`)
    .text(`Contrato nº ${c.contrato}`);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(10.5).text(`Assunto: ${c.assunto}`);
  doc.moveDown(0.8);
  corpo(doc, c.texto);
}

export async function gerarPdfNotificacao(c: ConteudoNotificacao): Promise<Buffer> {
  const doc = novoDoc(`${c.titulo} — Contrato ${c.contrato}`);
  escreverNotificacao(doc, c);
  rodapes(doc, (p, t) =>
    `Documento emitido eletronicamente em ${dataHoraBR(c.emitidaEm)} (horário de Brasília) · Página ${p} de ${t}\n` +
    `Código de verificação do conteúdo (SHA-256): ${c.textoSha256}`,
  );
  return paraBuffer(doc);
}

// ---------- Dossiê do contrato (checklist POP §16) ----------

export interface ItemDossie extends ConteudoNotificacao {
  status: string;
  destino: string | null;
  mensagemId: string | null;
  enviadaEm: Date | null;
  entregueEm: Date | null;
  lidaEm: Date | null;
  falhaMotivo: string | null;
  pdfSha256: string | null;
}

export interface Dossie {
  contrato: string;
  titular: string;
  cpfCnpj: string;
  veiculo: string;
  dataContrato: Date;
  geradoEm: Date;
  geradoPor: string;
  intervencoes: string[]; // linhas: bloqueio, retomada, jurídico
  itens: ItemDossie[];
  // Respostas do comprador pelo WhatsApp (doc 02 §24 item 6).
  mensagensRecebidas: { momento: Date; numero: string; texto: string; mensagemId: string | null }[];
}

export async function gerarPdfDossie(d: Dossie): Promise<Buffer> {
  const doc = novoDoc(`Dossiê de notificações — Contrato ${d.contrato}`);
  cabecalho(doc);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(TINTA).text('DOSSIÊ DE NOTIFICAÇÕES DE COBRANÇA');
  doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(APAGADO).text('Registro das notificações formais do POP-COB-001, com carimbos do provedor');
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(10).fillColor(TINTA)
    .text(`Contrato nº ${d.contrato}, celebrado em ${d.dataContrato.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`)
    .text(`Comprador(a): ${d.titular} · ${d.cpfCnpj}`)
    .text(`Veículo: ${d.veiculo}`);
  if (d.intervencoes.length) {
    doc.moveDown(0.6).font('Helvetica-Bold').text('Intervenções registradas');
    doc.font('Helvetica');
    for (const i of d.intervencoes) doc.text(`• ${i}`);
  }
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).text('Notificações');
  doc.moveDown(0.3);
  if (d.itens.length === 0) doc.font('Helvetica').text('Nenhuma notificação registrada.');
  for (const it of d.itens) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TINTA).text(`${it.titulo} — ${it.assunto}`);
    const linhas = [
      `Situação: ${it.status}${it.destino ? ` · destino WhatsApp +${it.destino}` : ''}`,
      it.enviadaEm ? `Enviada: ${dataHoraBR(it.enviadaEm)}` : null,
      it.entregueEm ? `Entregue: ${dataHoraBR(it.entregueEm)}` : null,
      it.lidaEm ? `Lida: ${dataHoraBR(it.lidaEm)}` : null,
      it.falhaMotivo ? `Falha: ${it.falhaMotivo}` : null,
      it.mensagemId ? `Id da mensagem (Meta): ${it.mensagemId}` : null,
      `SHA-256 do texto: ${it.textoSha256}`,
      it.pdfSha256 ? `SHA-256 do PDF enviado: ${it.pdfSha256}` : null,
    ].filter(Boolean) as string[];
    doc.font('Helvetica').fontSize(8.5).fillColor(APAGADO).text(linhas.join('\n'));
    doc.moveDown(0.6);
  }
  doc.moveDown(0.4).font('Helvetica-Bold').fontSize(10).fillColor(TINTA).text('Mensagens recebidas do comprador (WhatsApp)');
  doc.moveDown(0.3);
  if (d.mensagensRecebidas.length === 0) doc.font('Helvetica').fontSize(9).text('Nenhuma mensagem recebida.');
  for (const m of d.mensagensRecebidas) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(APAGADO).text(`${dataHoraBR(m.momento)} · +${m.numero}${m.mensagemId ? ` · id ${m.mensagemId}` : ''}`);
    doc.font('Helvetica').fontSize(9.5).fillColor(TINTA).text(m.texto, { paragraphGap: 5 });
  }
  // Íntegra de cada notificação, uma por página (mesmo texto do envio).
  for (const it of d.itens) {
    doc.addPage();
    escreverNotificacao(doc, it);
  }
  rodapes(doc, (p, t) => `Dossiê gerado em ${dataHoraBR(d.geradoEm)} por ${d.geradoPor} · Página ${p} de ${t}`);
  return paraBuffer(doc);
}
