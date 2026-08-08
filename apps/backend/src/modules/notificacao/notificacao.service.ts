import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class NotificacaoService {
  private readonly logger = new Logger(NotificacaoService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Emite sem propagar erro — notificação nunca derruba o fluxo de negócio.
  async emitir(titulo: string, corpo?: string, rota?: string): Promise<void> {
    try {
      await this.prisma.db.notificacao.create({ data: { titulo, corpo, rota } });
    } catch (e) {
      this.logger.error(`Falha ao emitir notificação: ${(e as Error).message}`);
    }
  }

  async listar(limite = 30) {
    const [naoLidas, itens] = await Promise.all([
      this.prisma.db.notificacao.count({ where: { lidaEm: null } }),
      this.prisma.db.notificacao.findMany({ orderBy: { createdAt: 'desc' }, take: limite }),
    ]);
    return {
      naoLidas,
      itens: itens.map((n) => ({
        id: n.id,
        titulo: n.titulo,
        corpo: n.corpo,
        rota: n.rota,
        lida: !!n.lidaEm,
        em: n.createdAt.toISOString(),
      })),
    };
  }

  async marcarLida(id: string) {
    await this.prisma.db.notificacao.updateMany({ where: { id, lidaEm: null }, data: { lidaEm: new Date() } });
    return { ok: true };
  }

  async marcarTodasLidas() {
    await this.prisma.db.notificacao.updateMany({ where: { lidaEm: null }, data: { lidaEm: new Date() } });
    return { ok: true };
  }
}
