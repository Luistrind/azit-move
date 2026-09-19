import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ETAPAS_NOTIFICACAO, type EtapaNotificacao } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { normalizarWhatsapp, variantesWhatsapp, WhatsappMetaService } from './whatsapp-meta.service';

// ============================================================
// Conversas do WhatsApp — doc 02 §24 (opção C, decisão Luís 19/09). O número
// dedicado fica SÓ na API: a resposta do cliente chega pelo webhook e é
// atendida aqui. A conversa é do NÚMERO (canônico, com nono dígito), ligada
// ao titular quando casa com o cadastro. A tela junta estas mensagens às
// notificações formais enviadas ao mesmo número (sem duplicar registro).
// ============================================================

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'whatsapp');
const JANELA_MS = 24 * 3_600_000;
const EXTENSAO: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a', 'audio/aac': 'aac', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
};

type MsgMeta = {
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

@Injectable()
export class ConversaService {
  private readonly logger = new Logger(ConversaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly meta: WhatsappMetaService,
    private readonly alertas: NotificacaoService,
    @InjectQueue(QUEUE_NAMES.NOTIFICACAO_COBRANCA) private readonly fila: Queue,
  ) {}

  private producao() {
    return this.config.get<string>('ambiente') === 'producao';
  }

  private async numerosTeste(): Promise<string[]> {
    const p = await this.prisma.db.parametroNotificacaoCobranca.findFirst({ select: { numerosTeste: true } });
    return p?.numerosTeste ?? [];
  }

  // Titular dono do número: compara só os dígitos do cadastro com todas as
  // formas do número (com/sem DDI, com/sem nono dígito).
  async titularDoNumero(numero: string): Promise<{ id: string; nome: string } | null> {
    const variantes = variantesWhatsapp(numero);
    const rows = await this.prisma.db.$queryRaw<{ id: string; nome: string }[]>(
      Prisma.sql`select id, nome from titulares where regexp_replace(whatsapp, '\\D', '', 'g') in (${Prisma.join(variantes)}) limit 1`,
    );
    return rows[0] ?? null;
  }

  // ---------------- Entrada (webhook → fila) ----------------

  async registrarEntradas(value: { messages?: MsgMeta[]; contacts?: { wa_id?: string; profile?: { name?: string } }[] }) {
    let novas = 0;
    for (const m of value.messages ?? []) {
      if (await this.prisma.db.mensagemWhatsapp.findUnique({ where: { mensagemId: m.id }, select: { id: true } })) continue; // reentrega da Meta
      const numero = normalizarWhatsapp(m.from) ?? m.from.replace(/\D/g, '');
      const nomePerfil = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
      const midia = m.image ?? m.audio ?? m.video ?? m.document ?? m.sticker;
      const loc = m.location;
      const texto =
        m.text?.body ??
        m.button?.text ??
        m.interactive?.button_reply?.title ??
        m.interactive?.list_reply?.title ??
        (m.reaction ? `Reagiu com ${m.reaction.emoji ?? ''}`.trim() : null) ??
        (loc ? `Localização: ${[loc.name, loc.address].filter(Boolean).join(' — ') || ''} (${loc.latitude}, ${loc.longitude})`.trim() : null) ??
        (m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? null) ??
        (m.type === 'unsupported' ? '(tipo de mensagem não suportado pela API)' : null);
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
        if (jaTinhaNaoLida === 0) {
          await this.alertas.emitir({
            titulo: `WhatsApp: ${titular?.nome ?? nomePerfil ?? `+${numero}`} respondeu`,
            corpo: (texto ?? `(${m.type})`).slice(0, 160),
            rota: `/conversas?numero=${numero}`,
            tipo: 'COBRANCA',
            area: 'CARTEIRA_COBRANCA',
          });
        }
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    return novas;
  }

  async baixarMidia(id: string) {
    const m = await this.prisma.db.mensagemWhatsapp.findUnique({ where: { id } });
    if (!m?.midiaId || m.midiaRef) return;
    if (!this.meta.configurado()) return;
    const { buffer, mime } = await this.meta.baixarMidia(m.midiaId);
    const ref = `${m.id}.${EXTENSAO[mime.split(';')[0]] ?? 'bin'}`;
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(join(UPLOADS_DIR, ref), buffer);
    await this.prisma.db.mensagemWhatsapp.update({ where: { id }, data: { midiaRef: ref, midiaTipo: mime } });
  }

  async arquivoMidia(id: string) {
    const m = await this.prisma.db.mensagemWhatsapp.findUnique({ where: { id } });
    if (!m?.midiaRef) throw new NotFoundException({ erro: 'sem_midia', mensagem: 'Mídia ainda não baixada ou indisponível' });
    return { buffer: await fs.readFile(join(UPLOADS_DIR, m.midiaRef)), tipo: m.midiaTipo ?? 'application/octet-stream', nome: m.midiaNome ?? m.midiaRef };
  }

  // Status (entregue/lida/falhou) das respostas em texto livre.
  async atualizarStatusSaida(mensagemId: string, status: string, quando: Date, motivo?: string): Promise<boolean> {
    const m = await this.prisma.db.mensagemWhatsapp.findUnique({ where: { mensagemId } });
    if (!m) return false;
    const mapa: Record<string, string> = { delivered: 'entregue', read: 'lida', failed: 'falhou' };
    if (!mapa[status]) return true;
    if (m.status === 'lida' && status === 'delivered') return true;
    await this.prisma.db.mensagemWhatsapp.update({ where: { id: m.id }, data: { status: mapa[status], ...(status === 'failed' ? { falhaMotivo: motivo ?? 'falha informada pela Meta' } : {}) } });
    this.logger.debug(`saída ${mensagemId} → ${mapa[status]} (${quando.toISOString()})`);
    return true;
  }

  // ---------------- Tela ----------------

  async listar() {
    const grupos = await this.prisma.db.mensagemWhatsapp.groupBy({ by: ['numero'], _max: { momento: true } });
    const naoLidas = await this.prisma.db.mensagemWhatsapp.groupBy({ by: ['numero'], where: { direcao: 'ENTRADA', lidaEm: null }, _count: { _all: true } });
    const mapaNaoLidas = new Map(naoLidas.map((n) => [n.numero, n._count._all]));
    const itens = await Promise.all(
      grupos.map(async (g) => {
        const ultima = await this.prisma.db.mensagemWhatsapp.findFirst({
          where: { numero: g.numero },
          orderBy: { momento: 'desc' },
          include: { titular: { select: { id: true, nome: true } } },
        });
        const comTitular = ultima?.titular ?? (await this.prisma.db.mensagemWhatsapp.findFirst({ where: { numero: g.numero, titularId: { not: null } }, include: { titular: { select: { id: true, nome: true } } } }))?.titular ?? null;
        const perfil = (await this.prisma.db.mensagemWhatsapp.findFirst({ where: { numero: g.numero, nomePerfil: { not: null } }, select: { nomePerfil: true } }))?.nomePerfil ?? null;
        return {
          numero: g.numero,
          titular: comTitular,
          nomePerfil: perfil,
          ultimaEm: g._max.momento?.toISOString() ?? null,
          ultimaDirecao: ultima?.direcao ?? null,
          ultimaPrevia: (ultima?.texto ?? (ultima ? `(${ultima.tipo})` : '')).slice(0, 120),
          naoLidas: mapaNaoLidas.get(g.numero) ?? 0,
        };
      }),
    );
    return itens.sort((a, b) => (b.naoLidas > 0 ? 1 : 0) - (a.naoLidas > 0 ? 1 : 0) || (b.ultimaEm ?? '').localeCompare(a.ultimaEm ?? ''));
  }

  async conversa(numeroBruto: string) {
    const numero = normalizarWhatsapp(numeroBruto) ?? numeroBruto.replace(/\D/g, '');
    const [mensagens, titular] = await Promise.all([
      this.prisma.db.mensagemWhatsapp.findMany({ where: { numero }, orderBy: { momento: 'asc' } }),
      this.titularDoNumero(numero),
    ]);
    // Notificações formais enviadas a este número (mesma conversa na tela).
    const notificacoes = await this.prisma.db.notificacaoCobranca.findMany({
      where: { destino: { in: variantesWhatsapp(numero) }, enviadaEm: { not: null } },
      include: { contrato: { select: { id: true, numero: true } } },
      orderBy: { enviadaEm: 'asc' },
    });
    const contratos = titular
      ? await this.prisma.db.contratoCredito.findMany({
          where: { conta: { titularId: titular.id }, status: 'ATIVO' },
          select: { id: true, numero: true, ativo: { select: { placa: true, modelo: true } } },
        })
      : [];
    const usuarios = new Map(
      (await this.prisma.db.usuario.findMany({ where: { id: { in: mensagens.map((m) => m.usuarioId).filter(Boolean) as string[] } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]),
    );
    const ultimaEntrada = [...mensagens].reverse().find((m) => m.direcao === 'ENTRADA');
    const janelaAteMs = ultimaEntrada ? ultimaEntrada.momento.getTime() + JANELA_MS : 0;
    const janelaAberta = janelaAteMs > Date.now();
    const itens = [
      ...mensagens.map((m) => ({
        id: m.id,
        origem: 'mensagem' as const,
        direcao: m.direcao,
        momento: m.momento.toISOString(),
        tipo: m.tipo,
        texto: m.texto,
        temMidia: !!m.midiaId,
        midiaDisponivel: !!m.midiaRef,
        midiaTipo: m.midiaTipo,
        midiaNome: m.midiaNome,
        status: m.status,
        falhaMotivo: m.falhaMotivo,
        autor: m.direcao === 'SAIDA' ? (m.usuarioId ? usuarios.get(m.usuarioId) ?? 'operador' : 'sistema') : null,
        lida: !!m.lidaEm,
      })),
      ...notificacoes.map((n) => ({
        id: n.id,
        origem: 'notificacao' as const,
        direcao: 'SAIDA' as const,
        momento: (n.enviadaEm as Date).toISOString(),
        tipo: 'notificacao',
        texto: `${ETAPAS_NOTIFICACAO[n.etapa as EtapaNotificacao].titulo} — ${n.assunto} (contrato ${n.contrato.numero})`,
        temMidia: !!n.pdfRef,
        midiaDisponivel: !!n.pdfRef,
        midiaTipo: 'application/pdf',
        midiaNome: null,
        status: n.status.toLowerCase(),
        falhaMotivo: n.falhaMotivo,
        autor: 'notificação automática',
        lida: true,
        contratoId: n.contrato.id,
      })),
    ].sort((a, b) => a.momento.localeCompare(b.momento));
    const lista = await this.numerosTeste();
    const autorizado = this.producao() || lista.includes(numero);
    return {
      numero,
      titular,
      nomePerfil: mensagens.find((m) => m.nomePerfil)?.nomePerfil ?? null,
      contratos,
      janela: { aberta: janelaAberta, ate: janelaAteMs ? new Date(janelaAteMs).toISOString() : null },
      envio: {
        provedorConfigurado: this.meta.configurado(),
        producao: this.producao(),
        numeroAutorizadoTeste: autorizado,
      },
      itens,
    };
  }

  async marcarLida(numeroBruto: string, usuarioId?: string) {
    const numero = normalizarWhatsapp(numeroBruto) ?? numeroBruto.replace(/\D/g, '');
    const pendentes = await this.prisma.db.mensagemWhatsapp.findMany({ where: { numero, direcao: 'ENTRADA', lidaEm: null }, orderBy: { momento: 'desc' } });
    if (!pendentes.length) return { marcadas: 0 };
    await this.prisma.db.mensagemWhatsapp.updateMany({ where: { id: { in: pendentes.map((p) => p.id) } }, data: { lidaEm: new Date() } });
    // Visto azul para o cliente (Meta marca as anteriores juntas). Fora de
    // produção só para número autorizado — nada sai para cliente real.
    const autorizado = this.producao() || (await this.numerosTeste()).includes(numero);
    if (this.meta.configurado() && autorizado && pendentes[0].mensagemId) {
      await this.meta.marcarComoLida(pendentes[0].mensagemId).catch((e) => this.logger.warn(`visto azul falhou: ${(e as Error).message}`));
    }
    this.logger.log(`conversa +${numero}: ${pendentes.length} mensagem(ns) lida(s) por ${usuarioId ?? '?'}`);
    return { marcadas: pendentes.length };
  }

  async responder(numeroBruto: string, texto: string, usuarioId?: string) {
    const numero = normalizarWhatsapp(numeroBruto);
    if (!numero) throw new UnprocessableEntityException({ erro: 'numero_invalido', mensagem: 'Número de WhatsApp inválido' });
    const t = (texto ?? '').trim();
    if (!t || t.length > 4096) throw new UnprocessableEntityException({ erro: 'texto_invalido', mensagem: 'Escreva a resposta (até 4.096 caracteres)' });
    const ultimaEntrada = await this.prisma.db.mensagemWhatsapp.findFirst({ where: { numero, direcao: 'ENTRADA' }, orderBy: { momento: 'desc' } });
    if (!ultimaEntrada || ultimaEntrada.momento.getTime() + JANELA_MS < Date.now()) {
      throw new UnprocessableEntityException({
        erro: 'janela_fechada',
        mensagem: 'A Meta só permite texto livre até 24h depois da última mensagem do cliente. Passado esse prazo, apenas modelos aprovados (as notificações) podem ser enviados.',
      });
    }
    const titular = await this.titularDoNumero(numero);
    const lista = await this.numerosTeste();
    const autorizado = this.producao() || lista.includes(numero);
    const real = this.meta.configurado() && autorizado;
    const registro = await this.prisma.db.mensagemWhatsapp.create({
      data: { direcao: 'SAIDA', numero, titularId: titular?.id ?? null, tipo: 'text', texto: t, usuarioId, momento: new Date(), status: real ? 'enviando' : 'simulada' },
    });
    if (!real) {
      const motivo = !this.meta.configurado() ? 'ambiente sem credencial do WhatsApp' : `+${numero} fora da lista de números autorizados deste ambiente de teste`;
      await this.prisma.db.mensagemWhatsapp.update({ where: { id: registro.id }, data: { falhaMotivo: `SIMULADA — ${motivo}; nada foi enviado` } });
      return { resultado: 'simulada', motivo };
    }
    try {
      const mensagemId = await this.meta.enviarTexto({ destino: numero, texto: t, destinoAutorizadoTeste: !this.producao() && lista.includes(numero) });
      await this.prisma.db.mensagemWhatsapp.update({ where: { id: registro.id }, data: { mensagemId, status: 'enviada' } });
      return { resultado: 'enviada' };
    } catch (e) {
      const motivo = (e as Error).message.slice(0, 500);
      await this.prisma.db.mensagemWhatsapp.update({ where: { id: registro.id }, data: { status: 'falhou', falhaMotivo: motivo } });
      return { resultado: 'falhou', motivo };
    }
  }

  // ---------------- Consumidores (régua, contrato, dossiê) ----------------

  async naoLidasPorTitular(titularIds: string[]): Promise<Map<string, number>> {
    if (!titularIds.length) return new Map();
    const g = await this.prisma.db.mensagemWhatsapp.groupBy({
      by: ['titularId'],
      where: { titularId: { in: titularIds }, direcao: 'ENTRADA', lidaEm: null },
      _count: { _all: true },
    });
    return new Map(g.map((x) => [x.titularId as string, x._count._all]));
  }

  async resumoDoTitular(titularId: string, whatsapp: string | null) {
    const numero = normalizarWhatsapp(whatsapp);
    const where = { OR: [{ titularId }, ...(numero ? [{ numero }] : [])] };
    const [total, naoLidas] = await Promise.all([
      this.prisma.db.mensagemWhatsapp.count({ where }),
      this.prisma.db.mensagemWhatsapp.count({ where: { ...where, direcao: 'ENTRADA', lidaEm: null } }),
    ]);
    return { numero, total, naoLidas };
  }

  async entradasDoTitular(titularId: string, whatsapp: string | null) {
    const numero = normalizarWhatsapp(whatsapp);
    return this.prisma.db.mensagemWhatsapp.findMany({
      where: { direcao: 'ENTRADA', OR: [{ titularId }, ...(numero ? [{ numero }] : [])] },
      orderBy: { momento: 'asc' },
    });
  }

  // Ferramenta de teste (homolog): simula uma mensagem recebida pelo webhook.
  async simularEntrada(numeroBruto: string, texto: string) {
    const numero = normalizarWhatsapp(numeroBruto);
    if (!numero) throw new UnprocessableEntityException({ erro: 'numero_invalido', mensagem: 'Número inválido' });
    const id = `wamid.TESTE.${Date.now()}`;
    await this.registrarEntradas({
      messages: [{ from: numero, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto || 'Mensagem de teste' } }],
      contacts: [{ wa_id: numero, profile: { name: 'Teste (simulado)' } }],
    });
    return { resultado: 'ok', numero };
  }
}
