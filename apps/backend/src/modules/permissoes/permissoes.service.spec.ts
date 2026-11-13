import { AreaSistema, RoleUsuario } from '@prisma/client';
import { PermissoesService, resolverAreas, TTL_CACHE_AREAS_MS } from './permissoes.service';

// Áreas efetivas (doc 02 §16, doc 06 §5.4 item 4/5): papel padrão pela matriz,
// exceção concedendo, exceção revogando, cache de 60 s invalidado na mutação. Sem banco.

const MATRIZ = [
  { papel: RoleUsuario.OPERADOR, area: AreaSistema.COMERCIAL, permitido: true },
  { papel: RoleUsuario.OPERADOR, area: AreaSistema.CARTEIRA_COBRANCA, permitido: true },
  { papel: RoleUsuario.OPERADOR, area: AreaSistema.ANALISE_CADASTRO, permitido: false },
  { papel: RoleUsuario.ADMIN, area: AreaSistema.CONFIGURACOES, permitido: true },
];

function montar(usuario: { roles: { role: RoleUsuario }[]; permissoesArea: { area: AreaSistema; concedida: boolean }[] } | null) {
  const findFirst = jest.fn().mockResolvedValue(usuario);
  const findMany = jest.fn().mockResolvedValue(MATRIZ);
  const prisma = { db: { usuario: { findFirst }, permissaoPapelArea: { findMany } } };
  const service = new PermissoesService(prisma as never);
  return { service, findFirst, findMany };
}

describe('resolverAreas (conta pura)', () => {
  it('papel padrão: só as células permitidas da matriz', () => {
    const areas = resolverAreas([RoleUsuario.OPERADOR], [], MATRIZ);
    expect([...areas].sort()).toEqual([AreaSistema.CARTEIRA_COBRANCA, AreaSistema.COMERCIAL]);
  });

  it('papéis se somam', () => {
    const areas = resolverAreas([RoleUsuario.OPERADOR, RoleUsuario.ADMIN], [], MATRIZ);
    expect(areas.has(AreaSistema.CONFIGURACOES)).toBe(true);
    expect(areas.has(AreaSistema.COMERCIAL)).toBe(true);
  });

  it('exceção concedendo adiciona área que o papel não tem', () => {
    const areas = resolverAreas([RoleUsuario.OPERADOR], [{ area: AreaSistema.ANALISE_CADASTRO, concedida: true }], MATRIZ);
    expect(areas.has(AreaSistema.ANALISE_CADASTRO)).toBe(true);
  });

  it('exceção revogando retira área que o papel dá', () => {
    const areas = resolverAreas([RoleUsuario.OPERADOR], [{ area: AreaSistema.COMERCIAL, concedida: false }], MATRIZ);
    expect(areas.has(AreaSistema.COMERCIAL)).toBe(false);
    expect(areas.has(AreaSistema.CARTEIRA_COBRANCA)).toBe(true);
  });

  it('ADMIN não é curinga: só o que a matriz lhe dá', () => {
    const areas = resolverAreas([RoleUsuario.ADMIN], [], MATRIZ);
    expect([...areas]).toEqual([AreaSistema.CONFIGURACOES]);
  });
});

describe('PermissoesService.areasEfetivas', () => {
  beforeEach(() => { jest.useFakeTimers({ now: new Date('2026-11-12T15:00:00.000Z') }); });
  afterEach(() => { jest.useRealTimers(); });

  it('usuário inexistente → conjunto vazio', async () => {
    const { service } = montar(null);
    expect((await service.areasEfetivas('x')).size).toBe(0);
  });

  it('consulta o banco uma vez e serve do cache dentro de 60 s', async () => {
    const { service, findFirst } = montar({ roles: [{ role: RoleUsuario.OPERADOR }], permissoesArea: [] });
    const a = await service.areasEfetivas('u1');
    const b = await service.areasEfetivas('u1');
    expect(a.has(AreaSistema.COMERCIAL)).toBe(true);
    expect(b.has(AreaSistema.COMERCIAL)).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('o chamador não corrompe o cache ao mexer no Set devolvido', async () => {
    const { service } = montar({ roles: [{ role: RoleUsuario.OPERADOR }], permissoesArea: [] });
    (await service.areasEfetivas('u1')).add(AreaSistema.CONFIGURACOES);
    expect((await service.areasEfetivas('u1')).has(AreaSistema.CONFIGURACOES)).toBe(false);
  });

  it('expira depois do TTL', async () => {
    const { service, findFirst } = montar({ roles: [{ role: RoleUsuario.OPERADOR }], permissoesArea: [] });
    await service.areasEfetivas('u1');
    jest.advanceTimersByTime(TTL_CACHE_AREAS_MS + 1);
    await service.areasEfetivas('u1');
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('invalidar(usuario) após mutação faz a próxima leitura ir ao banco e refletir a exceção', async () => {
    const { service, findFirst } = montar({ roles: [{ role: RoleUsuario.OPERADOR }], permissoesArea: [] });
    expect((await service.areasEfetivas('u1')).has(AreaSistema.ANALISE_CADASTRO)).toBe(false);
    // Admin concede a exceção...
    findFirst.mockResolvedValue({ roles: [{ role: RoleUsuario.OPERADOR }], permissoesArea: [{ area: AreaSistema.ANALISE_CADASTRO, concedida: true }] });
    // ...sem invalidar, o cache ainda responde o antigo (dentro do TTL)
    expect((await service.areasEfetivas('u1')).has(AreaSistema.ANALISE_CADASTRO)).toBe(false);
    service.invalidar('u1');
    expect((await service.areasEfetivas('u1')).has(AreaSistema.ANALISE_CADASTRO)).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('invalidar() sem usuário (matriz mudou) limpa todo mundo', async () => {
    const { service, findFirst } = montar({ roles: [{ role: RoleUsuario.OPERADOR }], permissoesArea: [] });
    await service.areasEfetivas('u1');
    await service.areasEfetivas('u2');
    service.invalidar();
    await service.areasEfetivas('u1');
    await service.areasEfetivas('u2');
    expect(findFirst).toHaveBeenCalledTimes(4);
  });
});

// Auto-bloqueio (doc 06 §13.3, aplicado 13/11/2026): nunca sem administrador
// ATIVO com a área CONFIGURACOES. Conta pura + guarda com simulação da mutação.
describe('haAdminComConfiguracoes / exigirAdminComConfiguracoes (doc 06 §13.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { haAdminComConfiguracoes, SemAdminComConfiguracoesError } = require('./permissoes.service') as typeof import('./permissoes.service');
  const MATRIZ_ADMIN = [{ papel: RoleUsuario.ADMIN, area: AreaSistema.CONFIGURACOES, permitido: true }];
  const admin = (extra: Partial<{ id: string; ativo: boolean; deletedAt: Date | null; papeis: RoleUsuario[]; excecoes: { area: AreaSistema; concedida: boolean }[] }> = {}) => ({
    id: 'a1', ativo: true, deletedAt: null, papeis: [RoleUsuario.ADMIN], excecoes: [], ...extra,
  });

  it('admin ativo com a área pela matriz → ok', () => {
    expect(haAdminComConfiguracoes([admin()], MATRIZ_ADMIN)).toBe(true);
  });

  it('matriz do ADMIN sem CONFIGURACOES e ninguém por exceção → sem admin', () => {
    expect(haAdminComConfiguracoes([admin()], [{ ...MATRIZ_ADMIN[0], permitido: false }])).toBe(false);
    // ...mas um admin com a área por EXCEÇÃO salva
    expect(haAdminComConfiguracoes([admin({ excecoes: [{ area: AreaSistema.CONFIGURACOES, concedida: true }] })], [{ ...MATRIZ_ADMIN[0], permitido: false }])).toBe(true);
  });

  it('exceção retirando a área do único admin → sem admin; inativo e excluído não contam; DIRETOR com a área não conta', () => {
    expect(haAdminComConfiguracoes([admin({ excecoes: [{ area: AreaSistema.CONFIGURACOES, concedida: false }] })], MATRIZ_ADMIN)).toBe(false);
    expect(haAdminComConfiguracoes([admin({ ativo: false })], MATRIZ_ADMIN)).toBe(false);
    expect(haAdminComConfiguracoes([admin({ deletedAt: new Date() })], MATRIZ_ADMIN)).toBe(false);
    expect(haAdminComConfiguracoes([admin({ papeis: [RoleUsuario.DIRETOR] })], [{ papel: RoleUsuario.DIRETOR, area: AreaSistema.CONFIGURACOES, permitido: true }])).toBe(false);
  });

  it('a guarda aplica a mutação numa cópia e lança só quando ela deixaria o sistema sem admin', async () => {
    const usuarios = [
      { id: 'a1', ativo: true, deletedAt: null, roles: [{ role: RoleUsuario.ADMIN }], permissoesArea: [] },
      { id: 'o1', ativo: true, deletedAt: null, roles: [{ role: RoleUsuario.OPERADOR }], permissoesArea: [] },
    ];
    const prisma = {
      db: {
        usuario: { findMany: jest.fn().mockResolvedValue(usuarios), findFirst: jest.fn() },
        permissaoPapelArea: { findMany: jest.fn().mockResolvedValue(MATRIZ_ADMIN) },
      },
    };
    const service = new PermissoesService(prisma as never);
    // desativar o único admin → lança
    await expect(service.exigirAdminComConfiguracoes(({ usuarios: us }) => { us.find((u) => u.id === 'a1')!.ativo = false; }))
      .rejects.toBeInstanceOf(SemAdminComConfiguracoesError);
    // tirar CONFIGURACOES da matriz do ADMIN → lança
    await expect(service.exigirAdminComConfiguracoes(({ matriz }) => { matriz[0].permitido = false; }))
      .rejects.toBeInstanceOf(SemAdminComConfiguracoesError);
    // desativar o operador → passa
    await expect(service.exigirAdminComConfiguracoes(({ usuarios: us }) => { us.find((u) => u.id === 'o1')!.ativo = false; }))
      .resolves.toBeUndefined();
    // promover o operador a ADMIN e então desativar o a1 → passa (sobra o o1)
    await expect(service.exigirAdminComConfiguracoes(({ usuarios: us }) => {
      us.find((u) => u.id === 'o1')!.papeis = [RoleUsuario.ADMIN];
      us.find((u) => u.id === 'a1')!.ativo = false;
    })).resolves.toBeUndefined();
    // o estado real não foi tocado pelas simulações
    expect(usuarios[0].ativo).toBe(true);
  });
});
