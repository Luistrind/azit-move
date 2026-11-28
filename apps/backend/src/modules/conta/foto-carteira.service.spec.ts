import { Prisma } from '@prisma/client';
import { FotoCarteiraService } from './foto-carteira.service';
import type { FaturaCarregada } from './carteira-visao.service';

// Foto do início do mês (doc 02 §27.12): uma por mês, nunca recalculada; a
// comparação usa a foto guardada × as faturas de agora.

const fatura = (over: Partial<FaturaCarregada> = {}): FaturaCarregada => ({
  id: 'f1', criadaEm: '2026-11-20T15:00:00.000Z', contaId: 'c1', titularId: 't1', titular: 'Ana', bloqueada: false,
  status: 'ABERTA', vencimento: '2026-12-15', dataPagamento: null, valorTotal: 99700, valorPago: null,
  itens: [{ tipo: 'PRINCIPAL', descricao: 'Parcela', valor: 99700, origemItem: 'VENDA', tipoContrato: 'veiculo' }],
  ...over,
});

function montar(opts: { faturasMes?: FaturaCarregada[]; faturasPorId?: FaturaCarregada[] } = {}) {
  type Foto = { id: string; mes: string; tiradaEm: Date; faturas: Record<string, unknown>[] };
  const fotos: Foto[] = [];
  const db = {
    fotoCarteira: {
      findUnique: jest.fn(async ({ where, include }: { where: { mes: string }; include?: { faturas?: boolean } }) => {
        const f = fotos.find((x) => x.mes === where.mes);
        if (!f) return null;
        return include?.faturas ? f : { ...f, _count: { faturas: f.faturas.length } };
      }),
      create: jest.fn(async ({ data }: { data: { mes: string; faturas: { create: Record<string, unknown>[] } } }) => {
        if (fotos.some((x) => x.mes === data.mes)) throw new Prisma.PrismaClientKnownRequestError('único', { code: 'P2002', clientVersion: 'teste' });
        const f = { id: `foto${fotos.length + 1}`, mes: data.mes, tiradaEm: new Date('2026-12-01T03:05:00.000Z'), faturas: data.faturas.create };
        fotos.push(f);
        return f;
      }),
      delete: jest.fn(async ({ where }: { where: { mes: string } }) => { fotos.splice(fotos.findIndex((x) => x.mes === where.mes), 1); }),
    },
    conta: { findMany: jest.fn(async () => []) },
  };
  const visao = {
    faturasDoPeriodo: jest.fn(async () => opts.faturasMes ?? [fatura()]),
    faturasPorIds: jest.fn(async () => opts.faturasPorId ?? []),
  };
  const service = new FotoCarteiraService({ db } as never, visao as never);
  return { service, db, visao, fotos };
}

describe('FotoCarteiraService — foto do início do mês (doc 02 §27.12)', () => {
  it('tira a foto uma vez por mês: a segunda chamada não mexe (é foto)', async () => {
    const m = montar();
    await expect(m.service.tirarFoto('2026-12')).resolves.toMatchObject({ criada: true, faturas: 1 });
    expect(m.fotos[0].faturas[0]).toMatchObject({ faturaId: 'f1', contaId: 'c1', status: 'ABERTA', valorTotal: '997.00', valorPago: null });
    expect((m.fotos[0].faturas[0].vencimento as Date).toISOString()).toBe('2026-12-15T00:00:00.000Z');
    await expect(m.service.tirarFoto('2026-12')).resolves.toMatchObject({ criada: false, faturas: 1 });
    expect(m.db.fotoCarteira.create).toHaveBeenCalledTimes(1);
    expect(m.visao.faturasDoPeriodo).toHaveBeenCalledWith('2026-12-01', '2026-12-31');
  });

  it('mês sem foto responde foto: null (novembro/2026)', async () => {
    await expect(montar().service.comparar('2026-11')).resolves.toEqual({ mes: '2026-11', foto: null });
  });

  it('compara a foto com agora: fatura que mudou de mês sai como "data" e o nome vem junto', async () => {
    const m = montar();
    await m.service.tirarFoto('2026-12');
    m.visao.faturasDoPeriodo.mockResolvedValueOnce([]); // nada vence mais em dezembro
    m.visao.faturasPorIds.mockResolvedValueOnce([fatura({ vencimento: '2027-01-05' })]);
    const r = await m.service.comparar('2026-12');
    expect(m.visao.faturasPorIds).toHaveBeenCalledWith(['f1']);
    expect(r.foto?.inicio.teto).toMatchObject({ valor: 99700, faturas: 1, clientes: 1 });
    expect(r.foto?.ponte).toMatchObject({ tetoFoto: 99700, tetoAgora: 0, diferenca: -99700 });
    expect(r.foto?.ponte.grupos).toEqual([
      expect.objectContaining({ motivo: 'data', sentido: 'menos', valor: -99700, faturas: -1, contas: [{ contaId: 'c1', titularId: 't1', titular: 'Ana', valor: -99700, faturas: -1 }] }),
    ]);
  });

  it('refazer (só ferramenta de teste) troca a foto do mês', async () => {
    const m = montar();
    await m.service.tirarFoto('2026-12');
    m.visao.faturasDoPeriodo.mockResolvedValueOnce([fatura(), fatura({ id: 'f2', contaId: 'c2' })]);
    await expect(m.service.tirarFoto('2026-12', { refazer: true })).resolves.toMatchObject({ criada: true, faturas: 2 });
    expect(m.fotos).toHaveLength(1);
  });
});
