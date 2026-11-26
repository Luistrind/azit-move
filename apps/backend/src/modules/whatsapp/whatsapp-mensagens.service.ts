import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AreaSistema, Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { formatarWhatsapp, normalizarWhatsapp, situacaoMensagemAposStatusMeta, variantesWhatsapp } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { WhatsappMetaService } from './whatsapp-meta.service';

// Mensagens do WhatsApp que chegam pelo webhook (doc 02 §24 itens 1 e 2): a
// entrada do cliente é gravada com o conteúdo original, o horário da Meta e o
// id da mensagem; a conversa é do NÚMERO canônico, ligada ao titular quando
// casa com o cadastro. A tela (ConversaService) lê daqui.

export const UPLOADS_WHATSAPP = join(process.cwd(), 'uploads', 'whatsapp');
const EXTENSAO: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a', 'audio/aac': 'aac', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
};

export type MensagemMeta = {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  reaction?: { emoji?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  image?: { id: string; mime_type?: string; caption?: string };
  audio?: { id: string; mime_type?: string };
  video?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; caption?: string; filename?: string };
  sticker?: { id: string; mime_type?: string };
};

export type ValorMensagensMeta = { messages?: MensagemMeta[]; contacts?: { wa_id?: string; profile?: { name?: string } }[] };

@Injectable()
export class WhatsappMensagensService {
  private readonly logger = new Logger(WhatsappMensagensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: WhatsappMetaService,
    private readonly alertas: NotificacaoService,
    @InjectQueue(QUEUE_NAMES.WHATSAPP) private readonly fila: Queue,
  ) {}

  // Titular dono do número: compara só os dígitos do cadastro com todas as
  // formas do número (com/sem DDI, com/sem nono dígito).
  async titularDoNumero(numero: string): Promise<{ id: string; nome: string } | null> {
    const variantes = variantesWhatsapp(numero);
    const rows = await this.prisma.db.$queryRaw<{ id: string; nome: string }[]>(
      Prisma.sql`select id, nome from titulares where "deletedAt" is null and regexp_replace(whatsapp, '\\D', '', 'g') in (${Prisma.join(variantes)}) order by "createdAt" asc limit 1`,
    );
    return rows[0] ?? null;
  }

  // Lead do funil, ainda não promovido a titular, dono do número (doc 02 §34.3):
  // mesma comparação por variantes; o mais recente vale (lead pode duplicar).
  async leadDoNumero(numero: string): Promise<{ id: string; nome: string } | null> {
    const variantes = variantesWhatsapp(numero);
    const rows = await this.prisma.db.$queryRaw<{ id: string; nome: string }[]>(
      Prisma.sql`select id, nome from leads where "titularId" is null and regexp_replace(coalesce(telefone, ''), '\\D', '', 'g') in (${Prisma.join(variantes)}) order by "createdAt" desc limit 1`,
    );
    return rows[0] ?? null;
  }

  private textoDe(m: MensagemMeta): string | null {
    const loc = m.location;
    return (
      m.text?.body ??
      m.button?.text ??
      m.interactive?.button_reply?.title ??
      m.interactive?.list_reply?.title ??
      (m.reaction ? `Reagiu com ${m.reaction.emoji ?? ''}`.trim() : null) ??
      (loc ? `Localização: ${[loc.name, loc.address].filter(Boolean).join(' — ') || ''} (${loc.latitude}, ${loc.longitude})`.trim() : null) ??
      m.image?.caption ??
      m.video?.caption ??
      m.document?.caption ??
      (m.type === 'unsupported' ? '(tipo de mensagem não suportado pela API)' : null)
    );
  }

  // Entrada (fila → aqui). Idempotente pelo id da mensagem: a Meta reentrega.
  async registrarEntradas(valor: ValorMensagensMeta): Promise<number> {
    let novas = 0;
    for (const m of valor.messages ?? []) {
      if (!m?.id || !m.from) continue;
      if (await this.prisma.db.mensagemWhatsapp.findUnique({ where: { mensagemId: m.id }, select: { id: true } })) continue;
      const numero = normalizarWhatsapp(m.from) ?? m.from.replace(/\D/g, '');
      const nomePerfil = valor.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
      const midia = m.image ?? m.audio ?? m.video ?? m.document ?? m.sticker;
      const texto = this.textoDe(m);
      const titular = await this.titularDoNumero(numero);
      const jaTinhaNaoLida = await this.prisma.db.mensagemWhatsapp.count({ where: { numero, direcao: 'ENTRADA', lidaEm: null } });
      try {
        const criada = await this.prisma.db.mensagemWhatsapp.create({
          data: {
            direcao: 'ENTRADA',
            numero,
            titularId: titular?.id ?? null,
            nomePerfil,
            mensagemId: m.id,
            tipo: m.type,
            texto,
            midiaId: midia?.id ?? null,
            midiaTipo: midia?.mime_type ?? null,
            midiaNome: m.document?.filename ?? null,
            momento: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
            bruto: m as unknown as Prisma.InputJsonValue,
          },
        });
        novas += 1;
        if (criada.midiaId) await this.fila.add('midia-entrada', { id: criada.id }, { removeOnComplete: true, removeOnFail: 50 });
        // Sino só na PRIMEIRA não lida do número (§24 item 5) — a conversa em
        // andamento não vira uma notificação por mensagem.
        if (jaTinhaNaoLida === 0) {
          await this.alertas.emitir({
            titulo: `WhatsApp: ${titular?.nome ?? nomePerfil ?? formatarWhatsapp(numero)} respondeu`,
            corpo: (texto ?? `(${m.type})`).slice(0, 160),
            rota: `/conversas?numero=${numero}`,
            tipo: 'COBRANCA',
            area: AreaSistema.CARTEIRA_COBRANCA,
          });
        }
      } catch (e) {
        // Duas entregas da mesma mensagem em paralelo: a segunda perde no índice único.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    return novas;
  }

  // Mídia: o link da Meta expira — baixa e guarda no sistema (§24 item 1).
  async baixarMidia(id: string): Promise<void> {
    const m = await this.prisma.db.mensagemWhatsapp.findUnique({ where: { id } });
    if (!m?.midiaId || m.midiaRef) return;
    if (!this.meta.configurado()) return;
    const { buffer, mime } = await this.meta.baixarMidia(m.midiaId);
    const ref = `${m.id}.${EXTENSAO[mime.split(';')[0]] ?? 'bin'}`;
    await fs.mkdir(UPLOADS_WHATSAPP, { recursive: true });
    await fs.writeFile(join(UPLOADS_WHATSAPP, ref), buffer);
    await this.prisma.db.mensagemWhatsapp.update({ where: { id }, data: { midiaRef: ref, midiaTipo: mime } });
  }

  // Situação de entrega (entregue/lida/falhou) da RESPOSTA do operador.
  // Devolve false quando o id não é de uma mensagem da conversa.
  async aplicarStatusSaida(mensagemId: string, statusMeta: string, motivoFalha?: string): Promise<boolean> {
    const m = await this.prisma.db.mensagemWhatsapp.findUnique({ where: { mensagemId } });
    if (!m || m.direcao !== 'SAIDA') return false;
    const nova = situacaoMensagemAposStatusMeta(m.status, statusMeta);
    if (!nova) return true;
    await this.prisma.db.mensagemWhatsapp.update({
      where: { id: m.id },
      data: { status: nova, ...(nova === 'falhou' ? { falhaMotivo: (motivoFalha ?? 'falha informada pela Meta').slice(0, 500) } : {}) },
    });
    this.logger.debug(`mensagem ${m.id} → ${nova}`);
    return true;
  }
}
