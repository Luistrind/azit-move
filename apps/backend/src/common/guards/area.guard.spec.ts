import 'reflect-metadata';
import { Controller, ExecutionContext, ForbiddenException, Get } from '@nestjs/common';
import { AreaSistema } from '@prisma/client';
import { Area, AreaLivre } from '../decorators/area.decorator';
import { Public } from '../decorators/public.decorator';
import { AreaGuard } from './area.guard';

// AreaGuard (doc 06 §7.5): tem área; não tem; método sobrepõe classe; @AreaLivre;
// @Public; resposta 403 com `area`. PermissoesService é dublê — sem banco.

@Area(AreaSistema.ANALISE_CADASTRO)
@Controller()
class AnaliseFake {
  @Get('analises') listar() { return 1; }

  @Area(AreaSistema.ANALISE_CADASTRO, AreaSistema.APROVACOES)
  @Get('analises/:id') dossie() { return 1; }

  @AreaLivre('teste: método livre numa classe com área')
  @Get('livre') livre() { return 1; }

  @Public()
  @Get('publica') publica() { return 1; }
}

@Controller()
class SemClassificacaoFake {
  @Get('x') x() { return 1; }
}

function contexto(classe: new () => object, metodo: string, user: { id: string } | undefined) {
  return {
    getHandler: () => (classe.prototype as Record<string, unknown>)[metodo],
    getClass: () => classe,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardCom(areas: AreaSistema[]) {
  const areasEfetivas = jest.fn().mockResolvedValue(new Set(areas));
  return { guard: new AreaGuard({ areasEfetivas } as never), areasEfetivas };
}

describe('AreaGuard', () => {
  it('libera quem tem a área da classe', async () => {
    const { guard } = guardCom([AreaSistema.ANALISE_CADASTRO]);
    await expect(guard.canActivate(contexto(AnaliseFake, 'listar', { id: 'u' }))).resolves.toBe(true);
  });

  it('nega quem não tem: 403 acesso_negado com a área', async () => {
    const { guard } = guardCom([AreaSistema.COMERCIAL]);
    const erro = await guard.canActivate(contexto(AnaliseFake, 'listar', { id: 'u' })).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect((erro as ForbiddenException).getResponse()).toEqual({
      erro: 'acesso_negado',
      mensagem: 'Sem acesso à área Análise de cadastro',
      area: 'ANALISE_CADASTRO',
    });
  });

  it('método sobrepõe a classe: basta UMA das áreas do método', async () => {
    const { guard } = guardCom([AreaSistema.APROVACOES]);
    await expect(guard.canActivate(contexto(AnaliseFake, 'dossie', { id: 'u' }))).resolves.toBe(true);
    // ...e a mesma pessoa continua barrada na rota que só tem a área da classe
    await expect(guard.canActivate(contexto(AnaliseFake, 'listar', { id: 'u' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('o 403 aponta a primeira área listada (a dona)', async () => {
    const { guard } = guardCom([]);
    const erro = await guard.canActivate(contexto(AnaliseFake, 'dossie', { id: 'u' })).catch((e: ForbiddenException) => e);
    expect((erro as ForbiddenException).getResponse()).toMatchObject({ area: 'ANALISE_CADASTRO' });
  });

  it('@AreaLivre no método libera sem consultar áreas', async () => {
    const { guard, areasEfetivas } = guardCom([]);
    await expect(guard.canActivate(contexto(AnaliseFake, 'livre', { id: 'u' }))).resolves.toBe(true);
    expect(areasEfetivas).not.toHaveBeenCalled();
  });

  it('@Public ignora o guard', async () => {
    const { guard, areasEfetivas } = guardCom([]);
    await expect(guard.canActivate(contexto(AnaliseFake, 'publica', undefined))).resolves.toBe(true);
    expect(areasEfetivas).not.toHaveBeenCalled();
  });

  it('rota sem classificação é negada (fail-closed)', async () => {
    const { guard } = guardCom([AreaSistema.COMERCIAL]);
    await expect(guard.canActivate(contexto(SemClassificacaoFake, 'x', { id: 'u' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sem usuário autenticado numa rota com área → 403', async () => {
    const { guard } = guardCom([AreaSistema.ANALISE_CADASTRO]);
    await expect(guard.canActivate(contexto(AnaliseFake, 'listar', undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('as áreas vêm do PermissoesService pelo id do usuário, nunca do token', async () => {
    const { guard, areasEfetivas } = guardCom([AreaSistema.ANALISE_CADASTRO]);
    await guard.canActivate(contexto(AnaliseFake, 'listar', { id: 'u-42' }));
    expect(areasEfetivas).toHaveBeenCalledWith('u-42');
  });
});
