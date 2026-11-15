import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { AreaSistema } from '@prisma/client';
import { ClasseController, classificarRota, ehController, rotasDoController, rotasSemClassificacao } from './area.classificacao';

// Varredura de TODOS os controllers (doc 06 §5.4 item 6, §7.5): a mesma conta que
// derruba o boot, sem subir a aplicação. Falha se alguém criar uma rota sem
// @Area / @AreaLivre / @Public. Carrega cada *.controller.ts de src/modules.

function arquivosController(dir: string, acc: string[] = []): string[] {
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (fs.statSync(p).isDirectory()) arquivosController(p, acc);
    else if (nome.endsWith('.controller.ts')) acc.push(p);
  }
  return acc;
}

const MODULOS = path.join(__dirname, '..', '..', 'modules');

function carregarControllers(): ClasseController[] {
  const classes: ClasseController[] = [];
  for (const arquivo of arquivosController(MODULOS)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(arquivo) as Record<string, unknown>;
    for (const exportado of Object.values(mod)) if (ehController(exportado)) classes.push(exportado);
  }
  return classes;
}

describe('classificação de área dos controllers', () => {
  const controllers = carregarControllers();

  it('encontrou os controllers do backend', () => {
    expect(controllers.length).toBeGreaterThanOrEqual(30);
    expect(controllers.map((c) => c.name)).toEqual(expect.arrayContaining(['AnaliseController', 'AuthController', 'UsuariosController']));
  });

  it('nenhuma rota ficou sem @Area, @AreaLivre ou @Public', () => {
    expect(rotasSemClassificacao(controllers)).toEqual([]);
  });

  it('o furo de 12/11 está fechado: toda rota de análise exige ANALISE_CADASTRO (ou é compartilhada com quem a consome)', () => {
    const analise = controllers.find((c) => c.name === 'AnaliseController')!;
    for (const metodo of rotasDoController(analise)) {
      const c = classificarRota((analise.prototype as Record<string, object>)[metodo], analise);
      expect(c?.tipo).toBe('area');
      if (c?.tipo === 'area') expect(c.areas[0]).toBe(AreaSistema.ANALISE_CADASTRO);
    }
  });

  it('apoio ao próprio usuário é @AreaLivre com justificativa', () => {
    for (const nome of ['AuthController', 'NotificacaoController', 'InicioController']) {
      const classe = controllers.find((c) => c.name === nome)!;
      const c = classificarRota(undefined, classe);
      expect(c?.tipo).toBe('livre');
      if (c?.tipo === 'livre') expect(c.justificativa.length).toBeGreaterThan(5);
    }
  });

  it('GET /me/areas é livre mesmo com o controller de usuários em CONFIGURACOES', () => {
    const usuarios = controllers.find((c) => c.name === 'UsuariosController')!;
    const proto = usuarios.prototype as Record<string, object>;
    expect(classificarRota(undefined, usuarios)).toEqual({ tipo: 'area', areas: [AreaSistema.CONFIGURACOES] });
    expect(classificarRota(proto.minhasAreas, usuarios)?.tipo).toBe('livre');
    expect(classificarRota(proto.listar, usuarios)).toEqual({ tipo: 'area', areas: [AreaSistema.CONFIGURACOES] });
  });

  it('webhook do Asaas e MCP ficam fora do JWT (@Public)', () => {
    for (const nome of ['WebhookController', 'McpController']) {
      const classe = controllers.find((c) => c.name === nome)!;
      for (const metodo of rotasDoController(classe)) {
        expect(classificarRota((classe.prototype as Record<string, object>)[metodo], classe)?.tipo).toBe('publica');
      }
    }
  });
});
