import { Prisma } from '@prisma/client';
import { CustoRecuperacaoService } from './custo-recuperacao.service';

// Custos da recuperação (doc 02 §29.3, decisões Luís 20–21/11/2026). Sem banco:
// conferimos onde o custo cabe, o que grava, e quando o acerto é recalculado.
const dec = (reais: number) => new Prisma.Decimal(reais.toFixed(2));

const contratoAtivo = { id: 'c1', numero: '2026090001', status: 'ATIVO', motivoEncerramento: null, ativoId: 'a1' };
const custoGravado = {
  id: 'k1', ativoId: 'a1', contratoId: 'c1', tipo: 'avaria', descricao: 'Para-choque', valor: dec(1650), data: new Date('2026-11-18T00:00:00.000Z'),
  fornecedor: 'Oficina', situacao: 'ORCADO', quemPaga: 'CLIENTE', comprovanteRef: null, comprovanteNome: null, criadoPor: 'u1', deletedAt: null,
};

function montar(contrato: Record<string, unknown> = contratoAtivo, travado: string | null = null) {
  const prisma = {
    db: {
      contratoCredito: { findFirst: jest.fn().mockResolvedValue(contrato) },
      lancamentoCustoAtivo: {
        findMany: jest.fn().mockResolvedValue([custoGravado]),
        findFirst: jest.fn().mockResolvedValue(custoGravado),
        create: jest.fn().mockResolvedValue({ id: 'k9' }),
        update: jest.fn().mockResolvedValue({}),
      },
      usuario: { findMany: jest.fn().mockResolvedValue([{ id: 'u1', nome: 'Arthur' }]) },
      logAuditoria: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  const rescisao = { motivoCustosTravados: jest.fn().mockResolvedValue(travado), recalcularAposCusto: jest.fn().mockResolvedValue(null) };
  const service = new CustoRecuperacaoService(prisma as never, rescisao as never);
  return { service, prisma, rescisao };
}
const novo = { tipo: 'guincho', descricao: 'Guincho até o pátio', valor: 35_000, data: '2026-11-16', situacao: 'PAGO' as const, quemPaga: 'CLIENTE' as const };

describe('CustoRecuperacaoService', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-20T15:00:00.000Z')));
  afterAll(() => jest.useRealTimers());

  it('listar: custos do contrato com totais do cliente, do orçado e da Azit', async () => {
    const { service, prisma } = montar();
    prisma.db.lancamentoCustoAtivo.findMany.mockResolvedValue([custoGravado, { ...custoGravado, id: 'k2', tipo: 'limpeza', valor: dec(150), situacao: 'PAGO', quemPaga: 'AZIT' }]);
    const r = await service.listar('c1');
    expect(r.motivoSemLancamento).toBeNull();
    expect(r.custos[0]).toMatchObject({ id: 'k1', data: '2026-11-18', valor: 165_000, situacao: 'orcado', quemPaga: 'cliente', lancadoPor: 'Arthur' });
    expect(r.totais).toEqual({ cliente: 165_000, clienteOrcado: 165_000, azit: 15_000 });
  });

  it('lançar: vira lançamento de custo do VEÍCULO ligado ao contrato, e o acerto é recalculado quando é do cliente', async () => {
    const { service, prisma, rescisao } = montar();
    await service.lancar('c1', novo, 'u1');
    expect(prisma.db.lancamentoCustoAtivo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ativoId: 'a1', contratoId: 'c1', tipo: 'guincho', valor: '350.00', data: new Date('2026-11-16T00:00:00.000Z'), situacao: 'PAGO', quemPaga: 'CLIENTE', criadoPor: 'u1' }),
    });
    expect(rescisao.recalcularAposCusto).toHaveBeenCalledWith('c1', 'u1', expect.stringContaining('Custo lançado: Guincho / transporte'));
  });

  it('lançar custo que a Azit assume não mexe no acerto', async () => {
    const { service, rescisao } = montar();
    await service.lancar('c1', { ...novo, quemPaga: 'AZIT' }, 'u1');
    expect(rescisao.recalcularAposCusto).not.toHaveBeenCalled();
  });

  it('só cabe em contrato do veículo ativo ou rescindido; valida tipo, valor e data', async () => {
    await expect(montar({ ...contratoAtivo, ativoId: null }).service.lancar('c1', novo, 'u')).rejects.toMatchObject({ response: { erro: 'estado_invalido' } });
    await expect(montar({ ...contratoAtivo, status: 'ENCERRADO', motivoEncerramento: 'QUITACAO' }).service.lancar('c1', novo, 'u')).rejects.toMatchObject({ response: { erro: 'estado_invalido' } });
    const rescindido = montar({ ...contratoAtivo, status: 'ENCERRADO', motivoEncerramento: 'RESCISAO' });
    await expect(rescindido.service.lancar('c1', novo, 'u')).resolves.toBeDefined();
    const { service } = montar();
    await expect(service.lancar('c1', { ...novo, tipo: 'inventado' }, 'u')).rejects.toMatchObject({ response: { erro: 'tipo_invalido' } });
    await expect(service.lancar('c1', { ...novo, valor: 0 }, 'u')).rejects.toMatchObject({ response: { erro: 'valor_invalido' } });
    await expect(service.lancar('c1', { ...novo, data: '2026-11-21' }, 'u')).rejects.toMatchObject({ response: { erro: 'data_futura' } });
  });

  it('acerto liquidado: custo do cliente não entra, não muda e não sai; o da Azit ainda entra', async () => {
    const { service, prisma } = montar({ ...contratoAtivo, status: 'ENCERRADO', motivoEncerramento: 'RESCISAO' }, 'O saldo da rescisão já foi pago');
    await expect(service.lancar('c1', novo, 'u')).rejects.toMatchObject({ response: { erro: 'acerto_liquidado' } });
    await expect(service.alterar('k1', { valor: 158_000 }, 'u')).rejects.toMatchObject({ response: { erro: 'acerto_liquidado' } });
    await expect(service.remover('k1', 'u')).rejects.toMatchObject({ response: { erro: 'acerto_liquidado' } });
    expect(prisma.db.lancamentoCustoAtivo.update).not.toHaveBeenCalled();
    await expect(service.lancar('c1', { ...novo, quemPaga: 'AZIT' }, 'u')).resolves.toBeDefined();
  });

  it('alterar: orçamento vira nota — grava o valor novo e explica o ajuste', async () => {
    const { service, prisma, rescisao } = montar();
    await service.alterar('k1', { valor: 158_000, situacao: 'PAGO' }, 'u1');
    expect(prisma.db.lancamentoCustoAtivo.update).toHaveBeenCalledWith({ where: { id: 'k1' }, data: expect.objectContaining({ valor: '1580.00', situacao: 'PAGO', quemPaga: 'CLIENTE' }) });
    expect(rescisao.recalcularAposCusto).toHaveBeenCalledWith('c1', 'u1', expect.stringMatching(/Avaria \/ reparo: de R\$\s1\.650,00 para R\$\s1\.580,00 \(orçamento virou nota\)/));
  });

  it('remover: nada se apaga (soft delete) e o acerto é recalculado', async () => {
    const { service, prisma, rescisao } = montar();
    await service.remover('k1', 'u1');
    expect(prisma.db.lancamentoCustoAtivo.update).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { deletedAt: expect.any(Date) } });
    expect(rescisao.recalcularAposCusto).toHaveBeenCalledWith('c1', 'u1', expect.stringContaining('Custo retirado'));
  });
});
