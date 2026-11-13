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
