import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AreaSistema, TipoNotificacao } from '@prisma/client';
import { CHAVE_PREFERENCIA_EMAIL_ALERTAS } from '@azit/types';
import { PrismaService } from '../../database/prisma.service';
import { PermissoesService } from '../permissoes/permissoes.service';
import { EmailService, OrigemEmail, VereditoAntesDeEnviar } from '../email/email.service';
import { modeloEmailHub } from '../email/modelo-email';

// Sino com destinatário e leitura INDIVIDUAL (doc 02 §16.1, decisão 07/09):
// notificação endereça um usuário direto OU uma área (matriz papel×área do §16);
// sem ambos, vale para todos. Cada usuário marca a própria leitura; a rota leva
// ao OCORRIDO ao clicar.
//
// Alerta por e-mail (doc 06 v1.1 §12, decisão 12/11): o e-mail é um SEGUNDO
// CANAL desta mesma notificação, só quando ela é DIRIGIDA a um usuário, é de
// aprovação e quem emite passou o conteúdo PRÓPRIO do e-mail (`email`), já sem
// dado pessoal do cliente (§12.3 item 1 — o título/corpo do sino podem citar o
// cliente; o e-mail sai do perímetro do sistema e não). Notificação por área ou
// geral nunca vira e-mail.

export const ORIGEM_EMAIL_NOTIFICACAO = 'notificacao';

export interface ConteudoEmailNotificacao {
  assunto: string;
  linhas: string[]; // operação, valor, solicitante, data — NUNCA nome/CPF/telefone/placa do cliente
  // Descarte na saída da fila (§12.3 item 2): enquanto esta solicitação estiver
  // PENDENTE e o destinatário não tiver decidido, o e-mail ainda faz sentido.
  aprovacaoPendenteId?: string;
}

export interface EmitirNotificacao {
  titulo: string;
  corpo?: string;
  rota: string; // obrigatória por decisão: toda notificação abre o ocorrido
  tipo?: TipoNotificacao;
  area?: AreaSistema;
  usuarioId?: string;
  email?: ConteudoEmailNotificacao;
}

// Tipos de notificação dirigida que viram e-mail (eventos da §12.2 — todos de aprovação).
export const TIPOS_NOTIFICACAO_COM_EMAIL: readonly TipoNotificacao[] = ['APROVACAO'];

@Injectable()
export class NotificacaoService implements OnModuleInit {
  private readonly logger = new Logger(NotificacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissoes: PermissoesService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.email.registrarOrigem(ORIGEM_EMAIL_NOTIFICACAO, {
      antesDeEnviar: (o) => this.antesDeEnviarEmail(o),
      enviado: (o, em) => this.registrarEmailEnviado(o, em),
      naoEnviado: (o, motivo) => this.registrarEmailNaoEnviado(o, motivo),
    });
  }

  // Emite sem propagar erro — notificação nunca derruba o fluxo de negócio.
  // Compat: aceita a assinatura antiga (titulo, corpo?, rota?) e a nova (objeto).
  // Devolve o id da notificação criada (null se falhou).
  async emitir(dados: EmitirNotificacao | string, corpo?: string, rota?: string): Promise<string | null> {
    const d: EmitirNotificacao =
      typeof dados === 'string' ? { titulo: dados, corpo, rota: rota ?? '/' } : dados;
    try {
      const n = await this.prisma.db.notificacao.create({
        data: {
          titulo: d.titulo,
          corpo: d.corpo,
          rota: d.rota,
          tipo: d.tipo ?? 'INFO',
          area: d.area,
          usuarioId: d.usuarioId,
        },
      });
      if (this.viraEmail(d)) await this.enfileirarEmail(n.id, d);
      return n.id;
    } catch (e) {
      this.logger.error(`Falha ao emitir notificação: ${(e as Error).message}`);
      return null;
    }
  }

  // Regra única de "esta notificação vira e-mail?" (§12.1/§12.2).
  viraEmail(d: EmitirNotificacao): d is EmitirNotificacao & { usuarioId: string; email: ConteudoEmailNotificacao } {
    return !!d.usuarioId && !!d.email && TIPOS_NOTIFICACAO_COM_EMAIL.includes(d.tipo ?? 'INFO');
  }

  // Ponte notificação → fila `email`. Nunca lança: o rastro do motivo fica na
  // própria notificação quando o e-mail não pode nem ser enfileirado.
  private async enfileirarEmail(notificacaoId: string, d: EmitirNotificacao & { usuarioId: string; email: ConteudoEmailNotificacao }) {
    try {
      const u = await this.prisma.db.usuario.findFirst({
        where: { id: d.usuarioId, ativo: true },
        select: { email: true, preferencias: true },
      });
      if (!u) return; // inativo ou excluído: só o sino (que ele nem vê)
      const prefs = (u.preferencias as Record<string, unknown> | null) ?? {};
      if (prefs[CHAVE_PREFERENCIA_EMAIL_ALERTAS] === false) return; // preferência desligada (§12.3 item 4)
      if (!u.email) {
        await this.prisma.db.notificacao.update({ where: { id: notificacaoId }, data: { emailFalha: 'destinatario_sem_email' } });
        return;
      }
      const url = `${this.config.get<string>('appUrl') ?? ''}${d.rota.startsWith('/') ? d.rota : `/${d.rota}`}`;
      const corpo = modeloEmailHub({ titulo: d.email.assunto, linhas: d.email.linhas, url });
      const contexto: Record<string, unknown> = { usuarioId: d.usuarioId };
      if (d.email.aprovacaoPendenteId) contexto.aprovacaoPendenteId = d.email.aprovacaoPendenteId;
      await this.email.enviar({
        para: u.email,
        assunto: d.email.assunto,
        corpo,
        origem: { tipo: ORIGEM_EMAIL_NOTIFICACAO, id: notificacaoId, contexto },
      });
    } catch (e) {
      const motivo = `nao_enfileirado: ${(e as Error).message}`.slice(0, 300);
      this.logger.error(`E-mail da notificação ${notificacaoId} não enfileirado: ${(e as Error).message}`);
      await this.prisma.db.notificacao.update({ where: { id: notificacaoId }, data: { emailFalha: motivo } }).catch(() => undefined);
    }
  }

  // --- Ganchos chamados pelo processor da fila `email` -----------------------

  // §12.3 item 2: se a pessoa já leu a notificação, já decidiu, ou a solicitação
  // já saiu de PENDENTE antes de o e-mail sair da fila, descarta.
  async antesDeEnviarEmail(origem: OrigemEmail): Promise<VereditoAntesDeEnviar> {
    const usuarioId = origem.contexto?.usuarioId as string | undefined;
    const aprovacaoId = origem.contexto?.aprovacaoPendenteId as string | undefined;
    if (usuarioId) {
      const lida = await this.prisma.db.notificacaoLida.findFirst({ where: { notificacaoId: origem.id, usuarioId } });
      if (lida) return { ok: false, motivo: 'descartado_ja_lida' };
    }
    if (aprovacaoId) {
      const a = await this.prisma.db.aprovacao.findFirst({ where: { id: aprovacaoId }, select: { status: true, decisoes: { select: { usuarioId: true } } } });
      if (!a || a.status !== 'PENDENTE') return { ok: false, motivo: 'descartado_aprovacao_encerrada' };
      if (usuarioId && a.decisoes.some((dec) => dec.usuarioId === usuarioId)) return { ok: false, motivo: 'descartado_ja_decidiu' };
    }
    return { ok: true };
  }

  async registrarEmailEnviado(origem: OrigemEmail, em: Date) {
    await this.prisma.db.notificacao.update({ where: { id: origem.id }, data: { emailEnviadoEm: em, emailFalha: null } });
  }

  async registrarEmailNaoEnviado(origem: OrigemEmail, motivo: string) {
    await this.prisma.db.notificacao.update({ where: { id: origem.id }, data: { emailFalha: motivo.slice(0, 300) } });
  }

  // --- Auditoria (Usuários e permissões › painel do usuário) ------------------
  async alertasEmailDoUsuario(usuarioId: string, limite = 20) {
    const [u, itens] = await Promise.all([
      this.prisma.db.usuario.findFirst({ where: { id: usuarioId }, select: { email: true, preferencias: true } }),
      this.prisma.db.notificacao.findMany({
        where: { usuarioId, tipo: { in: [...TIPOS_NOTIFICACAO_COM_EMAIL] } },
        orderBy: { createdAt: 'desc' },
        take: limite,
        include: { leituras: { where: { usuarioId }, select: { em: true } } },
      }),
    ]);
    const prefs = (u?.preferencias as Record<string, unknown> | null) ?? {};
    return {
      email: u?.email ?? null,
      emailAlertas: prefs[CHAVE_PREFERENCIA_EMAIL_ALERTAS] !== false,
      itens: itens.map((n) => ({
        id: n.id,
        titulo: n.titulo,
        rota: n.rota,
        em: n.createdAt.toISOString(),
        lidaEm: n.leituras[0]?.em?.toISOString() ?? null,
        emailEnviadoEm: n.emailEnviadoEm?.toISOString() ?? null,
        emailFalha: n.emailFalha,
      })),
    };
  }

  // Visíveis ao usuário: endereçadas a ele + da(s) sua(s) área(s) + gerais.
  async listar(usuarioId: string, limite = 30) {
    const areas = await this.permissoes.areasEfetivas(usuarioId);
    const visivel = {
      OR: [
        { usuarioId },
        { usuarioId: null, area: null },
        { usuarioId: null, area: { in: [...areas] } },
      ],
    };
    const [itens, naoLidas] = await Promise.all([
      this.prisma.db.notificacao.findMany({
        where: visivel,
        orderBy: { createdAt: 'desc' },
        take: limite,
        include: { leituras: { where: { usuarioId }, select: { em: true } } },
      }),
      this.prisma.db.notificacao.count({
        where: { ...visivel, leituras: { none: { usuarioId } } },
      }),
    ]);
    return {
      naoLidas,
      itens: itens.map((n) => ({
        id: n.id,
        titulo: n.titulo,
        corpo: n.corpo,
        rota: n.rota,
        tipo: n.tipo.toLowerCase(),
        lida: n.leituras.length > 0,
        em: n.createdAt.toISOString(),
      })),
    };
  }

  // Leitura INDIVIDUAL (decisão Luís 07/09): marca só para este usuário.
  async marcarLida(id: string, usuarioId: string) {
    await this.prisma.db.notificacaoLida.upsert({
      where: { notificacaoId_usuarioId: { notificacaoId: id, usuarioId } },
      update: {},
      create: { notificacaoId: id, usuarioId },
    });
    return { ok: true };
  }

  async marcarTodasLidas(usuarioId: string) {
    const areas = await this.permissoes.areasEfetivas(usuarioId);
    const pendentes = await this.prisma.db.notificacao.findMany({
      where: {
        OR: [
          { usuarioId },
          { usuarioId: null, area: null },
          { usuarioId: null, area: { in: [...areas] } },
        ],
        leituras: { none: { usuarioId } },
      },
      select: { id: true },
    });
    if (pendentes.length) {
      await this.prisma.db.notificacaoLida.createMany({
        data: pendentes.map((n) => ({ notificacaoId: n.id, usuarioId })),
        skipDuplicates: true,
      });
    }
    return { ok: true, marcadas: pendentes.length };
  }
}
