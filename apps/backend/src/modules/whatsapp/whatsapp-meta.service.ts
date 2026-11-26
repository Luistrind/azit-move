import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { IntegracoesService } from '../integracoes/integracoes.service';

// Cliente da WhatsApp Business Platform — Cloud API oficial da Meta (doc 02
// §11.3 e §23). Só fala HTTP com a Meta: QUEM decide se uma mensagem sai de
// verdade é a regra única de envio (WhatsappEnvioService). Este cliente é a
// SEGUNDA camada da trava (§23.2): fora de produção recusa enviar sem a
// autorização explícita do destino.
//
// Token e segredo nunca vão para log nem para mensagem de erro.

export class ErroMeta extends Error {
  constructor(
    mensagem: string,
    readonly codigo?: number,
  ) {
    super(mensagem);
  }
}

type RespostaEnvio = { messages?: { id: string }[]; error?: { message?: string; code?: number; error_data?: { details?: string } } };

// A Meta só aceita texto livre até 24 h depois da última mensagem do cliente;
// fora disso responde com este código (ela é a fonte da verdade da janela).
const CODIGO_FORA_DA_JANELA = 131047;

@Injectable()
export class WhatsappMetaService {
  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly config: ConfigService,
  ) {}

  // Há provedor quando existem o id do número E o token de acesso.
  configurado(): boolean {
    const w = this.integracoes.whatsapp();
    return !!(w.phoneNumberId && w.accessToken);
  }

  private producao(): boolean {
    return this.config.get<string>('ambiente') === 'producao';
  }

  private exigirAutorizacao(destino: string, destinoAutorizadoTeste: boolean) {
    if (!this.producao() && !destinoAutorizadoTeste) {
      throw new ErroMeta(`envio bloqueado: +${destino} não está autorizado neste ambiente de teste`);
    }
  }

  private async postarMensagem(corpo: Record<string, unknown>): Promise<string> {
    const w = this.integracoes.whatsapp();
    const resp = await fetch(`${w.graphUrl}/${w.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${w.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
    });
    const body = (await resp.json().catch(() => ({}))) as RespostaEnvio;
    const id = body.messages?.[0]?.id;
    if (!resp.ok || !id) {
      if (body.error?.code === CODIGO_FORA_DA_JANELA) {
        throw new ErroMeta('fora da janela de 24 h — a Meta só aceita modelo aprovado', CODIGO_FORA_DA_JANELA);
      }
      const detalhe = [body.error?.message, body.error?.error_data?.details].filter(Boolean).join(' — ') || 'sem detalhe';
      throw new ErroMeta(`envio recusado pela Meta (${resp.status}): ${detalhe}`, body.error?.code);
    }
    return id;
  }

  // Modelo aprovado (mensagem iniciada pela empresa): variáveis do corpo, na
  // ordem {{1}}..{{n}}, e — quando o modelo tem botão de link dinâmico — o
  // final do endereço (o domínio é fixo no modelo; §23.3).
  async enviarModelo(p: {
    destino: string; // canônico, só dígitos com DDI
    destinoAutorizadoTeste: boolean;
    modelo: string;
    idioma: string;
    variaveisCorpo: string[];
    sufixoBotaoUrl?: string;
  }): Promise<string> {
    this.exigirAutorizacao(p.destino, p.destinoAutorizadoTeste);
    const components: Record<string, unknown>[] = [];
    if (p.variaveisCorpo.length > 0) {
      // A Meta recusa quebra de linha e tabulação em variável — normaliza.
      components.push({ type: 'body', parameters: p.variaveisCorpo.map((t) => ({ type: 'text', text: t.replace(/\s+/g, ' ').trim() })) });
    }
    if (p.sufixoBotaoUrl) {
      components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: p.sufixoBotaoUrl }] });
    }
    return this.postarMensagem({
      to: p.destino,
      type: 'template',
      template: { name: p.modelo, language: { code: p.idioma }, components },
    });
  }

  // Texto livre (só dentro da janela de 24 h — §24 item 3).
  async enviarTexto(p: { destino: string; texto: string; destinoAutorizadoTeste: boolean }): Promise<string> {
    this.exigirAutorizacao(p.destino, p.destinoAutorizadoTeste);
    return this.postarMensagem({ to: p.destino, type: 'text', text: { body: p.texto, preview_url: false } });
  }

  // Mídia pela tela (doc 02 §34.6): sobe o arquivo para a Meta (/media) e manda
  // a mensagem com o id devolvido. Imagem e documento levam legenda; documento
  // leva o nome do arquivo; áudio ogg/opus chega ao cliente como mensagem de voz.
  async enviarMidia(p: {
    destino: string;
    destinoAutorizadoTeste: boolean;
    tipo: 'image' | 'document' | 'audio';
    arquivo: Buffer;
    mime: string;
    nomeArquivo: string;
    legenda?: string | null;
  }): Promise<string> {
    this.exigirAutorizacao(p.destino, p.destinoAutorizadoTeste);
    const w = this.integracoes.whatsapp();
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', p.mime);
    form.append('file', new Blob([new Uint8Array(p.arquivo)], { type: p.mime }), p.nomeArquivo);
    const resp = await fetch(`${w.graphUrl}/${w.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${w.accessToken}` },
      body: form,
    });
    const up = (await resp.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: number } };
    if (!resp.ok || !up.id) {
      throw new ErroMeta(`envio do arquivo recusado pela Meta (${resp.status}): ${up.error?.message ?? 'sem detalhe'}`, up.error?.code);
    }
    const legenda = p.legenda?.trim() || undefined;
    const conteudo =
      p.tipo === 'image'
        ? { id: up.id, caption: legenda }
        : p.tipo === 'document'
          ? { id: up.id, caption: legenda, filename: p.nomeArquivo }
          : { id: up.id };
    return this.postarMensagem({ to: p.destino, type: p.tipo, [p.tipo]: conteudo });
  }

  // Mídia recebida: o link da Meta expira, então baixa na hora (§24 item 1).
  async baixarMidia(mediaId: string): Promise<{ buffer: Buffer; mime: string }> {
    const w = this.integracoes.whatsapp();
    const meta = await fetch(`${w.graphUrl}/${mediaId}`, { headers: { Authorization: `Bearer ${w.accessToken}` } });
    const info = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string; error?: { message?: string } };
    if (!meta.ok || !info.url) throw new ErroMeta(`mídia indisponível (${meta.status}): ${info.error?.message ?? 'sem detalhe'}`);
    const arq = await fetch(info.url, { headers: { Authorization: `Bearer ${w.accessToken}` } });
    if (!arq.ok) throw new ErroMeta(`download da mídia recusado (${arq.status})`);
    return { buffer: Buffer.from(await arq.arrayBuffer()), mime: info.mime_type ?? 'application/octet-stream' };
  }

  // Confirmação de leitura (visto azul) da mensagem recebida.
  async marcarComoLida(mensagemId: string): Promise<void> {
    const w = this.integracoes.whatsapp();
    await fetch(`${w.graphUrl}/${w.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${w.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: mensagemId }),
    });
  }

  // X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo cru, segredo do aplicativo).
  assinaturaValida(corpoCru: Buffer | undefined, assinatura: string | undefined): boolean {
    const segredo = this.integracoes.whatsapp().appSecret;
    if (!segredo || !corpoCru || !assinatura?.startsWith('sha256=')) return false;
    const esperado = Buffer.from(`sha256=${createHmac('sha256', segredo).update(corpoCru).digest('hex')}`);
    const recebido = Buffer.from(assinatura);
    return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
  }
}
