import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { IntegracoesService } from '../integracoes/integracoes.service';

// Cliente da WhatsApp Business Platform — Cloud API oficial da Meta (doc 02
// §11.3/§23). Mensagem iniciada pela empresa exige MODELO aprovado; a
// notificação formal vai como PDF no cabeçalho (documento) do modelo.
//
// Modelo a cadastrar no WhatsApp Manager (categoria UTILIDADE, pt_BR):
//   Cabeçalho: DOCUMENTO
//   Corpo: "Olá, {{1}}. Segue a {{2}} referente ao contrato nº {{3}},
//           veículo placa {{4}}. O documento anexo traz os detalhes e os
//           prazos. Para regularizar ou negociar, fale com a Azit pelos
//           canais informados no seu contrato."

export class ErroMeta extends Error {}

@Injectable()
export class WhatsappMetaService {
  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly config: ConfigService,
  ) {}

  configurado(): boolean {
    const w = this.integracoes.whatsapp();
    return !!(w.phoneNumberId && w.accessToken);
  }

  // Sobe o PDF como mídia (fica na Meta, referenciado por id — o documento
  // nunca precisa de URL pública).
  private async subirPdf(pdf: Buffer, nomeArquivo: string): Promise<string> {
    const w = this.integracoes.whatsapp();
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), nomeArquivo);
    const resp = await fetch(`${w.graphUrl}/${w.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${w.accessToken}` },
      body: form,
    });
    const body = (await resp.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: number } };
    if (!resp.ok || !body.id) throw new ErroMeta(`upload do PDF recusado (${resp.status}): ${body.error?.message ?? 'sem detalhe'}`);
    return body.id;
  }

  async enviarNotificacao(p: {
    destino: string; // só dígitos, com DDI
    // Número real ÚNICO em todos os ambientes (doc 02 §23 item 10): fora de
    // produção o chamador precisa afirmar que o destino está na lista de teste.
    // Segunda camada da trava — nenhum caminho novo envia a cliente por engano.
    destinoAutorizadoTeste: boolean;
    modelo: string;
    idioma: string;
    pdf: Buffer;
    nomeArquivo: string;
    parametros: string[]; // {{1}}..{{n}} do corpo
  }): Promise<string> {
    if (this.config.get<string>('ambiente') !== 'producao' && !p.destinoAutorizadoTeste) {
      throw new ErroMeta(`envio bloqueado: +${p.destino} não está autorizado neste ambiente de teste`);
    }
    const w = this.integracoes.whatsapp();
    const mediaId = await this.subirPdf(p.pdf, p.nomeArquivo);
    const resp = await fetch(`${w.graphUrl}/${w.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${w.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: p.destino,
        type: 'template',
        template: {
          name: p.modelo,
          language: { code: p.idioma },
          components: [
            { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename: p.nomeArquivo } }] },
            // A Meta recusa quebra de linha/tab em parâmetro — normaliza.
            { type: 'body', parameters: p.parametros.map((t) => ({ type: 'text', text: t.replace(/\s+/g, ' ').trim() })) },
          ],
        },
      }),
    });
    const body = (await resp.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    const id = body.messages?.[0]?.id;
    if (!resp.ok || !id) throw new ErroMeta(`envio recusado (${resp.status}): ${body.error?.message ?? 'sem detalhe'}`);
    return id;
  }

  // X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo cru, app secret).
  assinaturaValida(corpoCru: Buffer | undefined, assinatura: string | undefined): boolean {
    const segredo = this.integracoes.whatsapp().appSecret;
    if (!segredo || !corpoCru || !assinatura?.startsWith('sha256=')) return false;
    const esperado = Buffer.from(`sha256=${createHmac('sha256', segredo).update(corpoCru).digest('hex')}`);
    const recebido = Buffer.from(assinatura);
    return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
  }
}

// WhatsApp do titular → formato da Meta (DDI 55 + DDD + número, só dígitos).
// Retorna null se não for um celular brasileiro plausível.
export function normalizarWhatsapp(bruto: string | null | undefined): string | null {
  let d = (bruto ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return /^55\d{10,11}$/.test(d) ? d : null;
}
