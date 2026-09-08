import { Injectable, Logger } from '@nestjs/common';
import { AreaSistema, RoleUsuario, TipoNotificacao } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// Sino com destinatário e leitura INDIVIDUAL (doc 02 §16.1, decisão 07/09):
// notificação endereça um usuário direto OU uma área (matriz papel×área do §16);
// sem ambos, vale para todos. Cada usuário marca a própria leitura; a rota leva
// ao OCORRIDO ao clicar.

export interface EmitirNotificacao {
  titulo: string;
  corpo?: string;
  rota: string; // obrigatória por decisão: toda notificação abre o ocorrido
  tipo?: TipoNotificacao;
  area?: AreaSistema;
  usuarioId?: string;
}

@Injectable()
export class NotificacaoService {
  private readonly logger = new Logger(NotificacaoService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Emite sem propagar erro — notificação nunca derruba o fluxo de negócio.
  // Compat: aceita a assinatura antiga (titulo, corpo?, rota?) e a nova (objeto).
  async emitir(dados: EmitirNotificacao | string, corpo?: string, rota?: string): Promise<void> {
    const d: EmitirNotificacao =
      typeof dados === 'string' ? { titulo: dados, corpo, rota: rota ?? '/' } : dados;
    try {
      await this.prisma.db.notificacao.create({
        data: {
          titulo: d.titulo,
          corpo: d.corpo,
          rota: d.rota,
          tipo: d.tipo ?? 'INFO',
          area: d.area,
          usuarioId: d.usuarioId,
        },
      });
    } catch (e) {
      this.logger.error(`Falha ao emitir notificação: ${(e as Error).message}`);
    }
  }

  // Visíveis ao usuário: endereçadas a ele + da(s) sua(s) área(s) + gerais.
  async listar(usuarioId: string, limite = 30) {
    const areas = await this.areasEfetivas(usuarioId);
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
    const areas = await this.areasEfetivas(usuarioId);
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

  // Mesma resolução de áreas do Início/Usuários (união dos papéis ± exceções).
  private async areasEfetivas(usuarioId: string): Promise<Set<AreaSistema>> {
    const usuario = await this.prisma.db.usuario.findFirst({
      where: { id: usuarioId },
      include: { roles: true, permissoesArea: true },
    });
    const areas = new Set<AreaSistema>();
    if (!usuario) return areas;
    const papeis = usuario.roles.map((r) => r.role as RoleUsuario);
    const matriz = await this.prisma.db.permissaoPapelArea.findMany();
    for (const m of matriz) {
      if (m.permitido && papeis.includes(m.papel)) areas.add(m.area);
    }
    for (const e of usuario.permissoesArea) {
      if (e.concedida) areas.add(e.area);
      else areas.delete(e.area);
    }
    return areas;
  }
}
