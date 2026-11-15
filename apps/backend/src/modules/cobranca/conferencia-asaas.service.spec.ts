import { UnprocessableEntityException } from '@nestjs/common';
import { ConferenciaAsaasService } from './conferencia-asaas.service';

// Conferência Asaas × sistema (doc 02 §27.9, 12/11/2026). Sem banco, sem Redis,
// sem Asaas: Prisma, leitura e fila são dublês. O que se garante aqui:
// (1) `reconciliar` enfileira o MESMO payload do webhook, montado da cobrança
//     lida ao vivo (data que o cliente pagou, valor pago em centavos);
// (2) só `paga_no_asaas` enfileira — tudo o mais é 422 e a fila não é tocada;
// (3) `conferir` lê cada cobrança uma vez (cache curto) e classifica.

const decimal = (s: string) => ({ toString: () => s });
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function montar(opts: { ambiente?: 'simulado' | 'sandbox' | 'producao'; faturas?: unknown[]; cobrancas?: Record<string, unknown | null> } = {}) {
  const faturas = opts.faturas ?? [];
  const prisma = {
    db: {
      fatura: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: jest.fn(async (_args: any) => faturas),
        findFirst: jest.fn(async (args: { where: { id: string } }) => (faturas as { id: string }[]).find((f) => f.id === args.where.id) ?? null),
      },
    },
  };
  const lerCobranca = jest.fn(async (id: string) => {
    const c = opts.cobrancas ?? {};
    if (!(id in c)) throw new Error(`Asaas GET /payments/${id} retornou 500: indisponível`);
    return c[id];
  });
  const leitura = { ambiente: opts.ambiente ?? 'producao', lerCobranca };
  const fila = { add: jest.fn(async () => undefined) };
  const service = new ConferenciaAsaasService(prisma as never, leitura as never, fila as never);
  return { service, prisma, fila, lerCobranca };
}

const faturaBase = {
  id: 'fat_1',
  numero: 7,
  contaId: 'conta_1',
  status: 'FECHADA',
  dataVencimento: dia('2026-11-05'),
  valorTotal: decimal('997.00'),
  asaasChargeId: 'pay_1',
  conta: { titularId: 'tit_1', titular: { nome: 'Antônio Silva' } },
};

describe('ConferenciaAsaasService.reconciliar — payload do job', () => {
  it('paga no Asaas: enfileira "conciliar" na fila do webhook com a data que o cliente pagou e o valor pago em centavos', async () => {
    const { service, fila } = montar({
      faturas: [faturaBase],
      cobrancas: { pay_1: { id: 'pay_1', status: 'RECEIVED', dueDate: '2026-11-05', value: 1004.37, clientPaymentDate: '2026-11-09', paymentDate: '2026-11-10', confirmedDate: '2026-11-10', deleted: false } },
    });
    const r = await service.reconciliar('fat_1');
    expect(fila.add).toHaveBeenCalledTimes(1);
    expect(fila.add).toHaveBeenCalledWith('conciliar', { faturaId: 'fat_1', paymentDate: '2026-11-09', dueDate: '2026-11-05', valor: 100437 });
    expect(r).toEqual({ enfileirado: true, statusAsaas: 'RECEIVED', job: { faturaId: 'fat_1', paymentDate: '2026-11-09', dueDate: '2026-11-05', valor: 100437 } });
  });

  it('sem clientPaymentDate usa paymentDate (compensação); CONFIRMED também conta como pago', async () => {
    const { service, fila } = montar({
      faturas: [faturaBase],
      cobrancas: { pay_1: { id: 'pay_1', status: 'CONFIRMED', dueDate: '2026-11-05', value: 997, clientPaymentDate: null, paymentDate: '2026-11-11', deleted: false } },
    });
    await service.reconciliar('fat_1');
    expect(fila.add).toHaveBeenCalledWith('conciliar', { faturaId: 'fat_1', paymentDate: '2026-11-11', dueDate: '2026-11-05', valor: 99700 });
  });

  it.each([
    ['PENDING (ok)', { status: 'PENDING', dueDate: '2026-11-05', value: 997 }, 'ok'],
    ['OVERDUE com vencimento alterado', { status: 'OVERDUE', dueDate: '2026-11-19', value: 997 }, 'vencimento_diferente'],
    ['OVERDUE com valor alterado', { status: 'OVERDUE', dueDate: '2026-11-05', value: 1200 }, 'valor_diferente'],
    ['REFUNDED', { status: 'REFUNDED', dueDate: '2026-11-05', value: 997 }, 'estornada_no_asaas'],
    ['DELETED', { status: 'DELETED', dueDate: '2026-11-05', value: 997 }, 'removida_no_asaas'],
    ['404', null, 'removida_no_asaas'],
  ])('%s → 422 nao_paga_no_asaas e a fila não é tocada', async (_n, cobranca, classificacao) => {
    const { service, fila } = montar({ faturas: [faturaBase], cobrancas: { pay_1: cobranca && { id: 'pay_1', deleted: false, ...cobranca } } });
    await expect(service.reconciliar('fat_1')).rejects.toMatchObject({
      response: { erro: 'nao_paga_no_asaas', classificacao, statusAsaas: cobranca ? cobranca.status : null },
    });
    expect(fila.add).not.toHaveBeenCalled();
  });

  it('fatura já paga aqui, sem cobrança, ou Asaas simulado → 422 sem ler o Asaas nem enfileirar', async () => {
    const paga = montar({ faturas: [{ ...faturaBase, status: 'PAGA' }] });
    await expect(paga.service.reconciliar('fat_1')).rejects.toMatchObject({ response: { erro: 'fatura_nao_aberta' } });
    const semCobranca = montar({ faturas: [{ ...faturaBase, asaasChargeId: null }] });
    await expect(semCobranca.service.reconciliar('fat_1')).rejects.toMatchObject({ response: { erro: 'sem_cobranca' } });
    const simulado = montar({ ambiente: 'simulado', faturas: [faturaBase] });
    await expect(simulado.service.reconciliar('fat_1')).rejects.toBeInstanceOf(UnprocessableEntityException);
    for (const m of [paga, semCobranca, simulado]) {
      expect(m.lerCobranca).not.toHaveBeenCalled();
      expect(m.fila.add).not.toHaveBeenCalled();
    }
  });

  it('fatura inexistente → 404', async () => {
    const { service } = montar();
    await expect(service.reconciliar('nada')).rejects.toMatchObject({ response: { erro: 'nao_encontrado' } });
  });
});

describe('ConferenciaAsaasService.conferir', () => {
  const faturas = [
    faturaBase,
    { ...faturaBase, id: 'fat_2', numero: 8, asaasChargeId: 'pay_2', dataVencimento: dia('2026-11-02'), valorTotal: decimal('1096.64') },
    { ...faturaBase, id: 'fat_3', numero: 9, asaasChargeId: 'pay_3', status: 'ABERTA' },
    { ...faturaBase, id: 'fat_4', numero: 10, asaasChargeId: 'pay_falha' },
  ];
  const cobrancas = {
    pay_1: { id: 'pay_1', status: 'RECEIVED', dueDate: '2026-11-05', value: 997, clientPaymentDate: '2026-11-06', paymentDate: '2026-11-07', deleted: false, invoiceUrl: 'https://asaas/i/1', originalValue: null },
    pay_2: { id: 'pay_2', status: 'OVERDUE', dueDate: '2026-11-02', value: 1096.64, deleted: false },
    pay_3: null,
  };

  it('lê cada cobrança, monta a linha lado a lado, classifica, conta e separa as falhas de leitura', async () => {
    const { service, prisma, lerCobranca } = montar({ faturas, cobrancas });
    const r = await service.conferir('2026-11-01', '2026-11-30');

    // filtro: em aberto aqui, com cobrança, vencimento no período
    const where = prisma.db.fatura.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['ABERTA', 'FECHADA'] });
    expect(where.asaasChargeId).toEqual({ not: null });
    expect(where.dataVencimento).toEqual({ gte: dia('2026-11-01'), lt: dia('2026-12-01') });

    expect(r.periodo).toEqual({ de: '2026-11-01', ate: '2026-11-30' });
    expect(r.ambiente).toBe('producao');
    expect(r.total).toBe(3);
    expect(r.falhas).toEqual([{ faturaId: 'fat_4', asaasChargeId: 'pay_falha', erro: expect.stringContaining('500') }]);
    expect(r.porClassificacao).toEqual({ paga_no_asaas: 1, removida_no_asaas: 1, estornada_no_asaas: 0, vencimento_diferente: 0, valor_diferente: 0, ok: 1 });

    expect(r.linhas[0]).toEqual({
      faturaId: 'fat_1', numero: 7, contaId: 'conta_1', titularId: 'tit_1', titular: 'Antônio Silva',
      statusAqui: 'FECHADA', situacaoAqui: expect.stringMatching(/^(vencida|a_vencer)$/), vencimentoAqui: '2026-11-05', valorAqui: 99700, asaasChargeId: 'pay_1',
      asaas: { id: 'pay_1', status: 'RECEIVED', vencimento: '2026-11-05', valor: 99700, valorOriginal: null, dataPagamento: '2026-11-06', deleted: false, invoiceUrl: 'https://asaas/i/1' },
      classificacao: 'paga_no_asaas',
    });
    expect(r.linhas[1]).toMatchObject({ faturaId: 'fat_2', valorAqui: 109664, asaas: { status: 'OVERDUE', valor: 109664 }, classificacao: 'ok' });
    expect(r.linhas[2]).toMatchObject({ faturaId: 'fat_3', statusAqui: 'ABERTA', asaas: null, classificacao: 'removida_no_asaas' });
    expect(lerCobranca).toHaveBeenCalledTimes(4);
  });

  it('sem período: até ontem (fuso Brasil), sem limite inferior', async () => {
    const { service, prisma } = montar();
    const r = await service.conferir();
    const where = prisma.db.fatura.findMany.mock.calls[0][0].where;
    expect(where.dataVencimento.gte).toBeUndefined();
    expect(where.dataVencimento.lt).toEqual(dia(r.hoje)); // < hoje ⇔ ≤ ontem
    expect(r.periodo.de).toBeNull();
    expect(r.periodo.ate < r.hoje).toBe(true);
    expect(r.total).toBe(0);
  });

  it('cache curto: a segunda conferência não volta ao Asaas; reconciliar lê ao vivo e invalida', async () => {
    const { service, lerCobranca, fila } = montar({ faturas: [faturaBase], cobrancas: { pay_1: cobrancas.pay_1 } });
    await service.conferir();
    await service.conferir();
    expect(lerCobranca).toHaveBeenCalledTimes(1);
    await service.reconciliar('fat_1');
    expect(lerCobranca).toHaveBeenCalledTimes(2);
    expect(fila.add).toHaveBeenCalledTimes(1);
    await service.conferir();
    expect(lerCobranca).toHaveBeenCalledTimes(3);
  });
});
