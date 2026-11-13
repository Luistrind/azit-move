// Modelo ÚNICO do e-mail do Hub (doc 06 §12.4): texto curto + botão "Abrir no
// Hub" + rodapé. Sem imagem externa, sem HTML pesado. Quem chama já garantiu
// que as linhas NÃO carregam dado pessoal do cliente (§12.3 item 1).

export interface ConteudoEmailHub {
  titulo: string;
  linhas: string[]; // "Rótulo: valor" ou frases curtas
  url: string; // absoluta — APP_URL + rota do ocorrido
  rotuloBotao?: string;
}

export const RODAPE_EMAIL_HUB = 'Azit Hub · mensagem automática — não responda este e-mail.';

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function modeloEmailHub(c: ConteudoEmailHub): { texto: string; html: string } {
  const botao = c.rotuloBotao ?? 'Abrir no Hub';
  const texto = [c.titulo, '', ...c.linhas, '', `${botao}: ${c.url}`, '', RODAPE_EMAIL_HUB].join('\n');
  const html = [
    '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1d2433">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e6eb;border-radius:12px;padding:24px">',
    `<h1 style="font-size:18px;margin:0 0 16px">${escapar(c.titulo)}</h1>`,
    ...c.linhas.map((l) => `<p style="font-size:14px;line-height:1.5;margin:0 0 8px">${escapar(l)}</p>`),
    `<p style="margin:24px 0 8px"><a href="${escapar(c.url)}" style="display:inline-block;background:#1d2433;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:10px 18px;border-radius:8px">${escapar(botao)}</a></p>`,
    `<p style="font-size:12px;color:#6b7280;margin:0 0 16px">Se o botão não abrir, copie o endereço: ${escapar(c.url)}</p>`,
    `<p style="font-size:11px;color:#9aa1ad;border-top:1px solid #e3e6eb;padding-top:12px;margin:0">${escapar(RODAPE_EMAIL_HUB)}</p>`,
    '</div></body></html>',
  ].join('');
  return { texto, html };
}
