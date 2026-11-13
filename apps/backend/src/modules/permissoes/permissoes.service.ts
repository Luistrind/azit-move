import { Injectable } from '@nestjs/common';
import { AreaSistema, RoleUsuario } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// Áreas efetivas de um usuário = união das áreas dos seus papéis (matriz
// papel × área, editável) ± exceções por usuário (doc 02 §16, doc 06 §5.4).
//
// UMA conta, UMA função (Regra 16 / doc 06 §5.4 item 4): esta é a única
// implementação. Guard de área, sino, Início, GET /me/areas e a tela Usuários e
// permissões chamam daqui. Antes da v1.1 estava escrita três vezes.
//
// Cache em memória de 60 s por usuário (doc 06 §5.4 item 5): a área não vai no
// token porque muda por ação do Admin e precisa valer na hora; o cache só evita
// duas consultas por requisição e é invalidado em toda mutação de usuário,
// papel, matriz ou exceção (UsuariosController chama `invalidar`).

export type CelulaMatriz = { papel: RoleUsuario; area: AreaSistema; permitido: boolean };
export type ExcecaoArea = { area: AreaSistema; concedida: boolean };

export const TTL_CACHE_AREAS_MS = 60_000;

// Conta pura (sem banco): usada pelo service e pela tela de Usuários, que já tem
// a matriz carregada para N usuários.
export function resolverAreas(
  papeis: RoleUsuario[],
  excecoes: ExcecaoArea[],
  matriz: CelulaMatriz[],
): Set<AreaSistema> {
  const areas = new Set<AreaSistema>();
  for (const m of matriz) {
    if (m.permitido && papeis.includes(m.papel)) areas.add(m.area);
  }
  for (const e of excecoes) {
    if (e.concedida) areas.add(e.area);
    else areas.delete(e.area);
  }
  return areas;
}

@Injectable()
export class PermissoesService {
  private readonly cache = new Map<string, { areas: Set<AreaSistema>; expiraEm: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async areasEfetivas(usuarioId: string): Promise<Set<AreaSistema>> {
    const agora = Date.now();
    const emCache = this.cache.get(usuarioId);
    if (emCache && emCache.expiraEm > agora) return new Set(emCache.areas);

    const usuario = await this.prisma.db.usuario.findFirst({
      where: { id: usuarioId },
      include: { roles: true, permissoesArea: true },
    });
    const areas = usuario
      ? resolverAreas(
          usuario.roles.map((r) => r.role),
          usuario.permissoesArea,
          await this.prisma.db.permissaoPapelArea.findMany(),
        )
      : new Set<AreaSistema>();
    this.cache.set(usuarioId, { areas, expiraEm: agora + TTL_CACHE_AREAS_MS });
    return new Set(areas);
  }

  // Mesma conta, para quem já tem matriz e exceções em mãos (lista de usuários).
  resolver(papeis: RoleUsuario[], excecoes: ExcecaoArea[], matriz: CelulaMatriz[]): AreaSistema[] {
    return [...resolverAreas(papeis, excecoes, matriz)];
  }

  // Sem usuário = a matriz mudou → todo mundo recalcula.
  invalidar(usuarioId?: string) {
    if (usuarioId) this.cache.delete(usuarioId);
    else this.cache.clear();
  }
}
