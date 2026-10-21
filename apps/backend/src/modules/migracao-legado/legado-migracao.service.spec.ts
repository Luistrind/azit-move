import { LegadoMigracaoService } from './legado-migracao.service';

// Corte das cobranças antigas na migração do legado (doc 02 §26.5 item 2).
// Caso real 20/10/2026 (Carmo, Jonathan, Felipe): a cobrança foi PAGA no Asaas
// entre a coleta do caso e a migração; o DELETE era recusado, a fatura nascia
// FECHADA/vencida e ninguém conciliava (pagamento anterior à fatura, sem webhook).
// Agora a migração lê a cobrança ao vivo antes de apagar.

type Dubles = ReturnType<typeof montar>;

// Dia da migração fixo (fuso Brasil): a regra de 21/10 depende de "hoje" (§26.15 item 6).
const HOJE = '2026-10-21';
beforeAll(() => { jest.useFakeTimers({ now: new Date(`${HOJE}T15:00:00.000Z`), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });

function montar(ambiente: 'sandbox' | 'simulado' = 'sandbox') {
  const prisma = {
    db: {
      fatura: {
        update: jest.fn().mockResolvedValue({}),
        // Depois do gerarCobranca: o id da cobrança NOVA gravado na fatura.
        findUnique: jest.fn().mockResolvedValue({ asaasChargeId: 'pay_novo' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      logAuditoria: { create: jest.fn().mockResolvedValue({}) },
      casoMigracaoLegado: {
        findUnique: jest.fn().mockResolvedValue({ migracaoResumo: { faturas: 3 }, nome: 'Cliente Teste' }),
        update: jest.fn().mockResolvedValue({}),
      },
    },
  };
  const asaasLeitura = { ambiente, requisicao: jest.fn(), listarCobrancas: jest.fn().mockResolvedValue([]) };
  const notificacao = { emitir: jest.fn().mockResolvedValue(undefined) };
  const fatura = { gerarCobranca: jest.fn().mockResolvedValue(undefined) };
  const fila = { add: jest.fn().mockResolvedValue(undefined) };
  const svc = new LegadoMigracaoService(
    prisma as never,
    {} as never,
    asaasLeitura as never,
    notificacao as never,
    fatura as never,
    {} as never,
    {} as never,
    fila as never,
  );
  // Os métodos são privados (internos ao corte); o teste os alcança por índice.
  const s = svc as unknown as {
    substituirCobrancas: (casoId: string, lista: { faturaId: string; chargeId: string; emitirAgora: boolean; vencimento: string }[]) => Promise<{ apagadas: number; emitidasAgora: number; conciliadas: string[]; mantidas: { vencimento: string; chargeId: string; erro: string }[] }>;
    limparCobrancasOrfas: (casoId: string, usuarioId: string) => Promise<{ apagadas: number; erro: string | null; vencimentos: string[] }>;
    conciliarAmarradasJaPagas: (casoId: string, lista: { faturaId: string; chargeId: string; vencimento: string }[]) => Promise<{ conciliadas: string[]; erros: { vencimento: string; chargeId: string; erro: string }[] }>;
  };
  return { prisma, asaasLeitura, notificacao, fatura, fila, s };
}

const PAGA_NO_ASAAS = { status: 'RECEIVED', value: 997, dueDate: '2026-10-19', clientPaymentDate: '2026-10-18', paymentDate: '2026-10-19' };
const PENDENTE_NO_ASAAS = { status: 'PENDING', value: 997, dueDate: '2026-10-26' };

// GET devolve a cobrança informada; DELETE devolve vazio (ou falha, se pedido).
function asaasResponde(d: Dubles, leitura: unknown, falhaDelete?: string) {
  d.asaasLeitura.requisicao.mockImplementation((metodo: string) => {
    if (metodo === 'GET') return Promise.resolve(leitura);
    if (falhaDelete) return Promise.reject(new Error(falhaDelete));
    return Promise.resolve({});
  });
}

const chamadas = (d: Dubles, metodo: string) => d.asaasLeitura.requisicao.mock.calls.filter((c: unknown[]) => c[0] === metodo);

describe('substituirCobrancas — cobrança antiga a vencer', () => {
  it('JÁ PAGA no Asaas: não apaga, amarra a fatura e enfileira a mesma conciliação do webhook', async () => {
    const d = montar();
    asaasResponde(d, PAGA_NO_ASAAS);
    const r = await d.s.substituirCobrancas('caso1', [{ faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: false, vencimento: '2026-10-19' }]);

    expect(chamadas(d, 'GET')).toEqual([['GET', '/payments/pay_1']]);
    expect(chamadas(d, 'DELETE')).toHaveLength(0);
    expect(d.prisma.db.fatura.update).toHaveBeenCalledWith({ where: { id: 'fat1' }, data: { status: 'FECHADA', asaasChargeId: 'pay_1' } });
    // Mesmo payload do webhook/conferir-pagamento: data em que o cliente pagou, valor em centavos.
    expect(d.fila.add).toHaveBeenCalledWith('conciliar', { faturaId: 'fat1', paymentDate: '2026-10-18', dueDate: '2026-10-19', valor: 99_700 });
    expect(d.fatura.gerarCobranca).not.toHaveBeenCalled();
    expect(r).toMatchObject({ apagadas: 0, emitidasAgora: 0, conciliadas: ['2026-10-19'], mantidas: [] });
    // Resumo do caso: contagem que a bancada exibe.
    const resumo = d.prisma.db.casoMigracaoLegado.update.mock.calls[0][0].data.migracaoResumo;
    expect(resumo).toMatchObject({ faturas: 3, conciliadasNaMigracao: 1, conciliadasNaMigracaoVencimentos: ['2026-10-19'], cobrancasApagadas: 0, cobrancasMantidas: [] });
    expect(d.notificacao.emitir).not.toHaveBeenCalled();
  });

  it('já paga mesmo em D-5 (emitirAgora): não emite cobrança nova por cima da paga', async () => {
    const d = montar();
    asaasResponde(d, { ...PAGA_NO_ASAAS, status: 'CONFIRMED', clientPaymentDate: null, paymentDate: '2026-10-19' });
    const r = await d.s.substituirCobrancas('caso1', [{ faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: true, vencimento: '2026-10-19' }]);
    expect(d.fatura.gerarCobranca).not.toHaveBeenCalled();
    expect(chamadas(d, 'DELETE')).toHaveLength(0);
    expect(d.fila.add).toHaveBeenCalledWith('conciliar', expect.objectContaining({ faturaId: 'fat1', paymentDate: '2026-10-19' }));
    expect(r.conciliadas).toEqual(['2026-10-19']);
    expect(r.emitidasAgora).toBe(0);
  });

  it('PENDENTE no Asaas: segue o fluxo atual — apaga e, no D-5, fecha e emite agora', async () => {
    const d = montar();
    asaasResponde(d, PENDENTE_NO_ASAAS);
    const r = await d.s.substituirCobrancas('caso1', [
      { faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: true, vencimento: '2026-10-26' },
      { faturaId: 'fat2', chargeId: 'pay_2', emitirAgora: false, vencimento: '2026-11-02' },
    ]);
    expect(chamadas(d, 'DELETE')).toEqual([['DELETE', '/payments/pay_1'], ['DELETE', '/payments/pay_2']]);
    expect(d.prisma.db.fatura.update).toHaveBeenCalledTimes(1);
    expect(d.prisma.db.fatura.update).toHaveBeenCalledWith({ where: { id: 'fat1' }, data: { status: 'FECHADA' } });
    expect(d.fatura.gerarCobranca).toHaveBeenCalledWith('fat1');
    expect(d.fila.add).not.toHaveBeenCalled();
    expect(r).toMatchObject({ apagadas: 2, emitidasAgora: 1, conciliadas: [], mantidas: [] });
    // §26.15 item 6: no D-5 a nova é CRIADA antes de a antiga ser apagada.
    const ordemDelete = d.asaasLeitura.requisicao.mock.invocationCallOrder[d.asaasLeitura.requisicao.mock.calls.findIndex((c: unknown[]) => c[0] === 'DELETE' && c[1] === '/payments/pay_1')];
    expect(d.fatura.gerarCobranca.mock.invocationCallOrder[0]).toBeLessThan(ordemDelete);
  });

  it('erro real no DELETE: a fatura fica FECHADA amarrada à cobrança antiga (mantida) e a carteira é avisada', async () => {
    const d = montar();
    asaasResponde(d, PENDENTE_NO_ASAAS, 'Asaas 400: cobrança não pode ser removida');
    const r = await d.s.substituirCobrancas('caso1', [{ faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: false, vencimento: '2026-10-26' }]);
    expect(d.prisma.db.fatura.update).toHaveBeenCalledWith({ where: { id: 'fat1' }, data: { status: 'FECHADA', asaasChargeId: 'pay_1' } });
    expect(d.fila.add).not.toHaveBeenCalled();
    expect(r.apagadas).toBe(0);
    expect(r.mantidas).toEqual([{ vencimento: '2026-10-26', chargeId: 'pay_1', erro: 'Asaas 400: cobrança não pode ser removida' }]);
    expect(d.notificacao.emitir).toHaveBeenCalledTimes(1);
    const resumo = d.prisma.db.casoMigracaoLegado.update.mock.calls[0][0].data.migracaoResumo;
    expect(resumo).toMatchObject({ conciliadasNaMigracao: 0, cobrancasMantidas: r.mantidas });
  });

  it('leitura ao vivo falhou: não decide pela leitura, tenta o DELETE normalmente', async () => {
    const d = montar();
    d.asaasLeitura.requisicao.mockImplementation((metodo: string) => (metodo === 'GET' ? Promise.reject(new Error('timeout')) : Promise.resolve({})));
    const r = await d.s.substituirCobrancas('caso1', [{ faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: false, vencimento: '2026-10-26' }]);
    expect(chamadas(d, 'DELETE')).toHaveLength(1);
    expect(r).toMatchObject({ apagadas: 1, conciliadas: [], mantidas: [] });
  });

  it('Asaas simulado: nada é lido nem apagado no Asaas; a fatura segue como aberta', async () => {
    const d = montar('simulado');
    const r = await d.s.substituirCobrancas('caso1', [{ faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: false, vencimento: '2026-10-26' }]);
    expect(d.asaasLeitura.requisicao).not.toHaveBeenCalled();
    expect(d.fila.add).not.toHaveBeenCalled();
    expect(r.apagadas).toBe(1);
  });
});

describe('conciliarAmarradasJaPagas — fatura vencida amarrada à cobrança antiga', () => {
  it('Asaas já diz paga: enfileira a conciliação e soma à contagem já gravada pela substituição', async () => {
    const d = montar();
    d.prisma.db.casoMigracaoLegado.findUnique.mockResolvedValue({ migracaoResumo: { conciliadasNaMigracao: 1, conciliadasNaMigracaoVencimentos: ['2026-10-19'] } });
    asaasResponde(d, { ...PAGA_NO_ASAAS, status: 'RECEIVED_IN_CASH', dueDate: '2026-10-12', clientPaymentDate: '2026-10-15' });
    const r = await d.s.conciliarAmarradasJaPagas('caso1', [{ faturaId: 'fatV', chargeId: 'pay_v', vencimento: '2026-10-12' }]);
    expect(chamadas(d, 'DELETE')).toHaveLength(0);
    expect(d.prisma.db.fatura.update).toHaveBeenCalledWith({ where: { id: 'fatV' }, data: { status: 'FECHADA', asaasChargeId: 'pay_v' } });
    expect(d.fila.add).toHaveBeenCalledWith('conciliar', { faturaId: 'fatV', paymentDate: '2026-10-15', dueDate: '2026-10-12', valor: 99_700 });
    expect(r).toEqual({ conciliadas: ['2026-10-12'], erros: [] });
    const resumo = d.prisma.db.casoMigracaoLegado.update.mock.calls[0][0].data.migracaoResumo;
    expect(resumo).toMatchObject({ conciliadasNaMigracao: 2, conciliadasNaMigracaoVencimentos: ['2026-10-19', '2026-10-12'], conciliacoesNaoEnfileiradas: [] });
  });

  it('ainda em aberto (OVERDUE): fica amarrada como hoje, sem fila e sem mexer no resumo', async () => {
    const d = montar();
    asaasResponde(d, { status: 'OVERDUE', value: 997, dueDate: '2026-10-12' });
    const r = await d.s.conciliarAmarradasJaPagas('caso1', [{ faturaId: 'fatV', chargeId: 'pay_v', vencimento: '2026-10-12' }]);
    expect(d.fila.add).not.toHaveBeenCalled();
    expect(d.prisma.db.fatura.update).not.toHaveBeenCalled();
    expect(d.prisma.db.casoMigracaoLegado.update).not.toHaveBeenCalled();
    expect(r).toEqual({ conciliadas: [], erros: [] });
  });

  it('fila indisponível: registra o erro no resumo para o operador usar "Conferir pagamento"', async () => {
    const d = montar();
    asaasResponde(d, PAGA_NO_ASAAS);
    d.fila.add.mockRejectedValue(new Error('Redis fora'));
    const r = await d.s.conciliarAmarradasJaPagas('caso1', [{ faturaId: 'fatV', chargeId: 'pay_v', vencimento: '2026-10-12' }]);
    expect(r.conciliadas).toEqual([]);
    expect(r.erros).toEqual([{ vencimento: '2026-10-12', chargeId: 'pay_v', erro: 'Redis fora' }]);
    const resumo = d.prisma.db.casoMigracaoLegado.update.mock.calls[0][0].data.migracaoResumo;
    expect(resumo).toMatchObject({ conciliadasNaMigracao: 0, conciliacoesNaoEnfileiradas: r.erros });
  });
});

// Doc 02 §26.15 item 6 (decisão Luís 21/10/2026, caso Jucileno 2026090011): a migração apagou a
// cobrança ANTES de criar a substituta, o Asaas recusou recriar (`invalid_dueDate`) e a fatura
// ficou presa a uma cobrança cancelada. Agora: vencida/hoje/amanhã não é tocada; criar antes de apagar.
describe('substituirCobrancas — criar antes de apagar, nunca a que vence até amanhã', () => {
  it('criação da nova falhou: a antiga NÃO é apagada, fica amarrada e o erro vai ao resumo', async () => {
    const d = montar();
    asaasResponde(d, PENDENTE_NO_ASAAS);
    d.fatura.gerarCobranca.mockRejectedValue(new Error('Asaas 400: invalid_dueDate'));
    const r = await d.s.substituirCobrancas('caso1', [{ faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: true, vencimento: '2026-10-24' }]);
    expect(chamadas(d, 'DELETE')).toHaveLength(0);
    expect(d.prisma.db.fatura.update).toHaveBeenLastCalledWith({ where: { id: 'fat1' }, data: { status: 'FECHADA', asaasChargeId: 'pay_1' } });
    expect(r).toMatchObject({ apagadas: 0, emitidasAgora: 0, mantidas: [{ vencimento: '2026-10-24', chargeId: 'pay_1', erro: 'Asaas 400: invalid_dueDate' }] });
    const resumo = d.prisma.db.casoMigracaoLegado.update.mock.calls[0][0].data.migracaoResumo;
    expect(resumo).toMatchObject({ cobrancasApagadas: 0, cobrancasMantidas: r.mantidas });
    expect(d.notificacao.emitir).toHaveBeenCalledTimes(1);
  });

  it('gerarCobranca não gravou cobrança nova na fatura: a antiga não é apagada', async () => {
    const d = montar();
    asaasResponde(d, PENDENTE_NO_ASAAS);
    d.prisma.db.fatura.findUnique.mockResolvedValue({ asaasChargeId: null });
    const r = await d.s.substituirCobrancas('caso1', [{ faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: true, vencimento: '2026-10-24' }]);
    expect(chamadas(d, 'DELETE')).toHaveLength(0);
    expect(d.prisma.db.fatura.update).toHaveBeenLastCalledWith({ where: { id: 'fat1' }, data: { status: 'FECHADA', asaasChargeId: 'pay_1' } });
    expect(r.mantidas[0]).toMatchObject({ chargeId: 'pay_1', erro: 'a cobrança nova não foi criada no Asaas' });
  });

  it('nova criada mas a antiga não saiu: desfaz a nova (nunca duas vivas) e amarra a antiga', async () => {
    const d = montar();
    d.asaasLeitura.requisicao.mockImplementation((metodo: string, rota: string) => {
      if (metodo === 'GET') return Promise.resolve(PENDENTE_NO_ASAAS);
      if (rota === '/payments/pay_1') return Promise.reject(new Error('Asaas 400: não pode ser removida'));
      return Promise.resolve({});
    });
    const r = await d.s.substituirCobrancas('caso1', [{ faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: true, vencimento: '2026-10-24' }]);
    expect(chamadas(d, 'DELETE')).toEqual([['DELETE', '/payments/pay_1'], ['DELETE', '/payments/pay_novo']]);
    expect(d.prisma.db.fatura.update).toHaveBeenLastCalledWith({ where: { id: 'fat1' }, data: { status: 'FECHADA', asaasChargeId: 'pay_1' } });
    expect(r).toMatchObject({ apagadas: 0, emitidasAgora: 0, mantidas: [{ chargeId: 'pay_1', erro: 'Asaas 400: não pode ser removida' }] });
  });

  it.each([['ontem', '2026-10-20'], ['hoje', '2026-10-21'], ['amanhã', '2026-10-22']])('segunda trava — vence %s: não cria nem apaga, fica amarrada', async (_q, vencimento) => {
    const d = montar();
    asaasResponde(d, { ...PENDENTE_NO_ASAAS, dueDate: vencimento });
    const r = await d.s.substituirCobrancas('caso1', [{ faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: true, vencimento }]);
    expect(chamadas(d, 'DELETE')).toHaveLength(0);
    expect(d.fatura.gerarCobranca).not.toHaveBeenCalled();
    expect(d.prisma.db.fatura.update).toHaveBeenCalledWith({ where: { id: 'fat1' }, data: { status: 'FECHADA', asaasChargeId: 'pay_1' } });
    expect(r.mantidas).toEqual([{ vencimento, chargeId: 'pay_1', erro: expect.stringContaining('vence até amanhã') }]);
  });

  it('depois de amanhã (D+2) no D-5: substituída — nova criada, antiga apagada', async () => {
    const d = montar();
    asaasResponde(d, { ...PENDENTE_NO_ASAAS, dueDate: '2026-10-23' });
    const r = await d.s.substituirCobrancas('caso1', [{ faturaId: 'fat1', chargeId: 'pay_1', emitirAgora: true, vencimento: '2026-10-23' }]);
    expect(d.fatura.gerarCobranca).toHaveBeenCalledWith('fat1');
    expect(chamadas(d, 'DELETE')).toEqual([['DELETE', '/payments/pay_1']]);
    expect(r).toMatchObject({ apagadas: 1, emitidasAgora: 1, mantidas: [] });
  });
});

describe('limparCobrancasOrfas — nunca a amarrada nem a que vence até amanhã', () => {
  it('apaga só a órfã de D+2 em diante sem fatura que a referencie', async () => {
    const d = montar();
    d.prisma.db.casoMigracaoLegado.findUnique.mockResolvedValue({ id: 'caso1', status: 'MIGRADO', asaasCustomerId: 'cus_1', nome: 'Cliente Teste', migracaoResumo: {} });
    const pendente = (id: string, dueDate: string, externalReference: string | null = null) => ({ id, dueDate, status: 'PENDING', deleted: false, externalReference });
    d.asaasLeitura.listarCobrancas.mockResolvedValue([
      pendente('pay_ontem', '2026-10-20'),
      pendente('pay_hoje', '2026-10-21'),
      pendente('pay_amanha', '2026-10-22'),
      pendente('pay_amarrada', '2026-10-28'), // fatura FECHADA amarrada (DELETE falhou na migração) — sem externalReference
      pendente('pay_orfa', '2026-10-29'),
      pendente('pay_sistema', '2026-10-30', 'fatura-x'),
    ]);
    d.prisma.db.fatura.findMany.mockResolvedValue([{ asaasChargeId: 'pay_amarrada' }]);
    d.asaasLeitura.requisicao.mockResolvedValue({});
    const r = await d.s.limparCobrancasOrfas('caso1', 'usuario1');
    expect(d.prisma.db.fatura.findMany).toHaveBeenCalledWith({ where: { asaasChargeId: { in: ['pay_amarrada', 'pay_orfa'] } }, select: { asaasChargeId: true } });
    expect(chamadas(d, 'DELETE')).toEqual([['DELETE', '/payments/pay_orfa']]);
    expect(r).toEqual({ apagadas: 1, erro: null, vencimentos: ['2026-10-29'] });
  });
});
