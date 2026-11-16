import { Prisma } from '@prisma/client';
import { FaturaService } from './fatura.service';

// Lista de faturas da ficha do titular (16/11): abre na página da fatura mais
// antiga em aberto e cada linha diz o que falta pagar hoje. Sem banco.

function linha(id: string, status: string, o: Partial<{ modeloEncargo: string; valorTotal: number; valorPago: number | null; venc: string }> = {}) {
  return {
    id,
    numero: Number(id.replace(/\D/g, '')) || 1,
    periodoReferencia: new Date(`${o.venc ?? '2026-11-02'}T00:00:00Z`),
    dataVencimento: new Date(`${o.venc ?? '2026-11-02'}T00:00:00Z`),
    dataFechamento: null,
    dataPagamento: null,
    status,
    valorTotal: new Prisma.Decimal(o.valorTotal ?? 804.98),
    valorPago: o.valorPago == null ? null : new Prisma.Decimal(o.valorPago),
    asaasChargeId: null,
    modeloEncargo: o.modeloEncargo ?? 'ASAAS_NATIVO',
    tokenPublico: null,
    itensFatura: [],
  };
}

function montar(p: { total: number; antesDaAberta?: number | null; pagina?: ReturnType<typeof linha>[]; totalHoje?: Record<string, number> }) {
  const fatura = {
    // 1ª contagem = total da lista; 2ª = ocultas; 3ª (só com fatura em aberto) = quantas vêm antes dela.
    count: jest.fn().mockResolvedValueOnce(p.total).mockResolvedValueOnce(0).mockResolvedValueOnce(p.antesDaAberta ?? 0),
    findFirst: jest.fn().mockResolvedValue(p.antesDaAberta == null ? null : { dataVencimento: new Date('2026-11-16T00:00:00Z') }),
    findMany: jest.fn().mockResolvedValue(p.pagina ?? []),
  };
  const contaFatura = {
    carregar: jest.fn().mockResolvedValue({ faturas: [] }),
    projetar: jest.fn().mockReturnValue({ faturas: Object.entries(p.totalHoje ?? {}).map(([id, totalHoje]) => ({ id, totalHoje })) }),
  };
  const service = new FaturaService(
    { db: { fatura } } as never,
    {} as never,
    { get: () => '' } as never,
    {} as never,
    {} as never,
    contaFatura as never,
    {} as never,
    { add: jest.fn() } as never,
    { add: jest.fn() } as never,
  );
  return { service, fatura, contaFatura };
}

describe('FaturaService.faturasDaConta — página atual e o que falta hoje', () => {
  it("'atual' abre na página da fatura mais antiga em aberto", async () => {
    const { service, fatura } = montar({ total: 209, antesDaAberta: 20 });
    const r = await service.faturasDaConta('c1', 'atual', 8);
    expect(r.page).toBe(3); // 20 faturas antes → a 21ª está na 3ª página de 8
    expect(fatura.findMany.mock.calls[0][0]).toMatchObject({ skip: 16, take: 8 });
  });

  it("'atual' sem nada em aberto abre na última página", async () => {
    const { service, fatura } = montar({ total: 20, antesDaAberta: null });
    const r = await service.faturasDaConta('c1', 'atual', 8);
    expect(r.page).toBe(3);
    expect(fatura.count).toHaveBeenCalledTimes(2);
  });

  it('página pedida além do fim fica na última; abaixo de 1 fica na primeira', async () => {
    expect((await montar({ total: 20 }).service.faturasDaConta('c1', 99, 8)).page).toBe(3);
    expect((await montar({ total: 20 }).service.faturasDaConta('c1', 0, 8)).page).toBe(1);
  });

  it('falta hoje: fatura AZIT fechada usa o total do motor; as demais em aberto, face menos o pago; paga não tem', async () => {
    const { service, contaFatura } = montar({
      total: 4,
      pagina: [
        linha('f1', 'PAGA', { valorPago: 900 }),
        linha('f2', 'FECHADA', { modeloEncargo: 'AZIT', valorPago: 95.02 }),
        linha('f3', 'FECHADA', { valorPago: 100 }),
        linha('f4', 'ABERTA'),
      ],
      totalHoje: { f2: 73_415 },
    });
    const r = await service.faturasDaConta('c1', 1, 8);
    expect(r.data.map((f) => [f.id, f.valorPago, f.faltaHoje])).toEqual([
      ['f1', 90_000, null],
      ['f2', 9_502, 73_415],
      ['f3', 10_000, 70_498],
      ['f4', 0, 80_498],
    ]);
    expect(contaFatura.carregar).toHaveBeenCalledTimes(1);
  });

  it('sem fatura AZIT fechada na página, não carrega a conta no motor', async () => {
    const { service, contaFatura } = montar({ total: 2, pagina: [linha('f1', 'PAGA', { valorPago: 804.98 }), linha('f2', 'ABERTA')] });
    await service.faturasDaConta('c1', 1, 8);
    expect(contaFatura.carregar).not.toHaveBeenCalled();
  });
});
