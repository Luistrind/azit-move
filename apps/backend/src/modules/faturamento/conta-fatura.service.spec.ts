import { ContaFaturaService } from './conta-fatura.service';
import { contaFixture, F2, F3, faturaFixture } from './conta.fixture-spec';
import { contaFaturaCom, F2ComParcial } from '../operacoes/azit.fixture-spec';

// Saldo do motor POR PARCELA (doc 02 §32.12 item 12) — o que acordo, novação,
// rescisão e sinistro leem — e a guarda contra "fatura fantasma".

describe('ContaFaturaService.saldosEmAberto', () => {
  it('fatura paga em parte: a parcela do veículo deve 532,08; proteção quitada; principal já pago 167,27', async () => {
    const s = await contaFaturaCom().saldosEmAberto('conta-1', '2026-11-09');
    expect([...s.faturaIds]).toEqual(['f2']);
    expect(s.porParcela.get('f2:pv')).toMatchObject({
      faturaId: 'f2', faturaNumero: 22, face: 74900, saldoNominal: 53173, saldoProtecao: 0, multa: 0, atualizacao: 35, encargo: 35, total: 53208, principalPago: 16727,
    });
    expect(s.porParcela.get('f2:pr')).toMatchObject({ saldoNominal: 0, total: 0 });
  });

  it('sem pagamento: a soma das parcelas fecha no total da fatura (1.072,43) e o saldo é na DATA pedida', async () => {
    const servico = contaFaturaCom(contaFixture([F2(), F3()]));
    const s = await servico.saldosEmAberto('conta-1', '2026-11-09');
    const daF2 = ['f2:pv', 'f2:pr', 'f2:pa'].map((id) => s.porParcela.get(id)!);
    expect(daF2.reduce((t, p) => t + p.total, 0)).toBe(107243);
    expect(s.porParcela.get('f3:pv')).toMatchObject({ saldoNominal: 74900, encargo: 0, saldoProtecao: 5000 });
    // Data-base anterior (rescisão retroativa): menos dias de atualização.
    const antes = await servico.saldosEmAberto('conta-1', '2026-11-05');
    expect(antes.porParcela.get('f2:pv')!.total).toBeLessThan(s.porParcela.get('f2:pv')!.total);
  });

  it('item sem parcela vai para a lista própria; fatura já paga não entra', async () => {
    const f = F2();
    f.itens = f.itens.map((it) => (it.id === 'f2:reemb' ? { ...it, parcelaId: null } : it));
    const paga = faturaFixture('f1', 21, '2026-10-26', { status: 'PAGA' });
    const s = await contaFaturaCom(contaFixture([paga, f])).saldosEmAberto('conta-1', '2026-11-09');
    expect(s.semParcela.map((i) => [i.itemId, i.faturaNumero, i.saldo])).toEqual([['f2:reemb', 22, 12000]]);
    expect(s.faturaIds.has('f1')).toBe(false);
    expect(s.porParcela.has('f1:pv')).toBe(false);
  });
});

describe('ContaFaturaService — fatura fantasma fica fora da conta', () => {
  const coerente = (f: unknown) => (new ContaFaturaService({ db: {} } as never) as unknown as { coerente(f: unknown): boolean }).coerente(f);

  it('fatura que o banco diz PAGA sem os pagamentos que a quitam não entra (não reaparece em aberto na página)', () => {
    // Era o efeito da quitação/sinistro antigos: status PAGA, nenhum PagamentoFatura.
    expect(coerente(faturaFixture('f9', 30, '2026-11-02', { status: 'PAGA' }))).toBe(false);
    expect(coerente({ ...F2ComParcial(), status: 'PAGA' })).toBe(false);
  });

  it('fatura em aberto (FECHADA) e fatura paga COM os pagamentos registrados entram normalmente', () => {
    expect(coerente(F2ComParcial())).toBe(true);
    const quitada = faturaFixture('f8', 29, '2026-11-16', { status: 'PAGA' });
    quitada.motor.pagamentos = [{ data: '2026-11-09', valor: 104900, alocacoes: quitada.motor.itens.map((i) => ({ alvo: 'ITEM' as const, itemId: i.id, valor: i.valor, nivel: 1, quitou: true })) }];
    expect(coerente(quitada)).toBe(true);
  });
});
