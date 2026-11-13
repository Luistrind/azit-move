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

// Auto-bloqueio (doc 06 §13.3, aplicado 13/11/2026): o sistema NUNCA fica sem um
// administrador ATIVO com a área CONFIGURACOES — senão ninguém devolve área
// nenhuma pela interface. Conta pura sobre um estado (possivelmente simulado):
// a mutação é aplicada numa cópia e só vai ao banco se a regra continuar valendo.
export type UsuarioParaGuarda = {
  id: string;
  ativo: boolean;
  deletedAt: Date | null;
  papeis: RoleUsuario[];
  excecoes: ExcecaoArea[];
};

export function haAdminComConfiguracoes(usuarios: UsuarioParaGuarda[], matriz: CelulaMatriz[]): boolean {
  return usuarios.some(
    (u) =>
      u.ativo &&
      !u.deletedAt &&
      u.papeis.includes(RoleUsuario.ADMIN) &&
      resolverAreas(u.papeis, u.excecoes, matriz).has(AreaSistema.CONFIGURACOES),
  );
}

export class SemAdminComConfiguracoesError extends Error {
  constructor() {
    super('Esta alteração deixaria o sistema sem administrador ativo com a área Configurações — conceda a área (ou o papel) a outro usuário antes');
  }
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

  // Guarda do auto-bloqueio (doc 06 §13.3): carrega o estado real, aplica a
  // mutação pretendida numa CÓPIA (`simular`) e lança se depois dela não sobrar
  // administrador ativo com CONFIGURACOES. O controller chama antes de gravar.
  async exigirAdminComConfiguracoes(
    simular: (estado: { usuarios: UsuarioParaGuarda[]; matriz: CelulaMatriz[] }) => void,
  ): Promise<void> {
    const [linhas, matrizDb] = await Promise.all([
      this.prisma.db.usuario.findMany({
        where: { deletedAt: null },
        include: { roles: true, permissoesArea: true },
      }),
      this.prisma.db.permissaoPapelArea.findMany(),
    ]);
    const estado = {
      usuarios: linhas.map<UsuarioParaGuarda>((u) => ({
        id: u.id,
        ativo: u.ativo,
        deletedAt: u.deletedAt,
        papeis: u.roles.map((r) => r.role),
        excecoes: u.permissoesArea.map((p) => ({ area: p.area, concedida: p.concedida })),
      })),
      matriz: matrizDb.map<CelulaMatriz>((m) => ({ papel: m.papel, area: m.area, permitido: m.permitido })),
    };
    simular(estado);
    if (!haAdminComConfiguracoes(estado.usuarios, estado.matriz)) throw new SemAdminComConfiguracoesError();
  }

  // Sem usuário = a matriz mudou → todo mundo recalcula.
  invalidar(usuarioId?: string) {
    if (usuarioId) this.cache.delete(usuarioId);
    else this.cache.clear();
  }
}
