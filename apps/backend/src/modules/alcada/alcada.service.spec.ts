import { Prisma } from '@prisma/client';
import { AlcadaService, avaliarAlcada } from './alcada.service';

// Alçada (doc 02 §7.9): a CONTA é uma só (Regra 16) — `verificar` para quem está
// decidindo e `usuariosAptos` para quem deve ser avisado (doc 06 §12.2).

const D = (v: string) => new Prisma.Decimal(v);
const celulas = [
  { papel: 'APROVADOR', limiteMinimo: D('0'), limiteMaximo: D('5000'), ilimitado: false },
  { papel: 'DIRETOR', limiteMinimo: D('5000.01'), limiteMaximo: D('50000'), ilimitado: false },
  { papel: 'ADMIN', limiteMinimo: D('0'), limiteMaximo: D('0'), ilimitado: true },
];

describe('avaliarAlcada (conta única)', () => {
  it('sem papel: não aprova', () => {
    expect(avaliarAlcada([], celulas, 100_00).aprovado).toBe(false);
  });
  it('faixa do papel cobre o valor', () => {
    expect(avaliarAlcada(['APROVADOR'], celulas, 4_999_00)).toEqual({ aprovado: true, ilimitado: false, limiteMaximo: 500_000 });
  });
  it('acima da faixa: exige superior; abaixo da faixa: cabe a papel inferior', () => {
    expect(avaliarAlcada(['APROVADOR'], celulas, 6_000_00).motivo).toMatch(/excede/);
    expect(avaliarAlcada(['DIRETOR'], celulas, 100_00).motivo).toMatch(/abaixo/);
  });
  it('ilimitado vence qualquer faixa; vários papéis = o mais forte', () => {
    expect(avaliarAlcada(['ADMIN'], celulas, 9_999_999_00).ilimitado).toBe(true);
    expect(avaliarAlcada(['OPERADOR', 'DIRETOR'], celulas, 10_000_00).aprovado).toBe(true);
  });
});

describe('AlcadaService.usuariosAptos', () => {
  function montar(usuarios: { id: string; nome: string; email: string; roles: { role: string }[] }[]) {
    const prisma = {
      db: {
        alcada: { findMany: jest.fn().mockResolvedValue(celulas) },
        usuario: { findMany: jest.fn().mockResolvedValue(usuarios) },
        usuarioRole: { findMany: jest.fn() },
      },
    };
    return { service: new AlcadaService(prisma as never), prisma };
  }

  it('devolve só quem cobre o valor — a mesma conta de verificar', async () => {
    const { service, prisma } = montar([
      { id: 'u-apr', nome: 'Aprovador', email: 'aprovador@azit.com.br', roles: [{ role: 'APROVADOR' }] },
      { id: 'u-dir', nome: 'Diretor', email: 'diretor@azit.com.br', roles: [{ role: 'DIRETOR' }] },
      { id: 'u-adm', nome: 'Admin', email: 'admin@azit.com.br', roles: [{ role: 'ADMIN' }] },
    ]);
    const aptos = await service.usuariosAptos('acordo', 20_000_00);
    expect(aptos.map((u) => u.id)).toEqual(['u-dir', 'u-adm']);
    // só usuários ATIVOS com algum papel da matriz
    expect(prisma.db.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ativo: true }) }));
  });

  it('tipo sem célula ativa: ninguém é avisado', async () => {
    const { service, prisma } = montar([]);
    prisma.db.alcada.findMany.mockResolvedValueOnce([]);
    expect(await service.usuariosAptos('inexistente', 100)).toEqual([]);
    expect(prisma.db.usuario.findMany).not.toHaveBeenCalled();
  });
});
