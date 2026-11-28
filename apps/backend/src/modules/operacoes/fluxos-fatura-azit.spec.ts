import { Prisma } from '@prisma/client';
import { BaixaContaService } from '../faturamento/baixa-conta.service';
import { contaFixture, F4 } from '../faturamento/conta.fixture-spec';
import { bancoFrouxo, contaFaturaCom, F2ComParcial, intencoesStub, semAzit } from './azit.fixture-spec';
import { NovacaoDecomposicaoService } from './novacao-decomposicao.service';
import { QuitacaoService } from './quitacao.service';
import { RenegociacaoService } from './renegociacao.service';
import { RescisaoService } from './rescisao.service';
import { SinistroService } from './sinistro.service';

// Acordo, novação, rescisão, quitação e sinistro com fatura do modelo AZIT PAGA
// EM PARTE (doc 02 §32.12 item 12). Caso do roteiro do Vicente: fatura de
// R$ 1.049,00 vencida em 02/11, R$ 540,00 pagos em 07/11 pela baixa da conta,
// conta feita em 09/11. O motor diz que faltam R$ 532,08 (531,73 do veículo +
// 0,35 de atualização desde o pagamento). Antes da correção os fluxos pegavam o
// nominal da parcela do veículo (749,00) + mora desde o vencimento = R$ 765,73,
// e a quitação/sinistro gravavam a fatura como PAGA por cima do já pago.
// Cada teste roda o fluxo DUAS vezes: sem o saldo do motor (o comportamento
// antigo, que cobrava em dobro) e com ele.

const dec = (reais: number) => new Prisma.Decimal(reais.toFixed(2));
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const taxas = { taxaMultaAtraso: dec(2), taxaJurosAtraso: dec(1) };

beforeAll(() => { jest.useFakeTimers({ now: new Date('2026-11-09T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });

// A parcela do veículo, como o banco a tem: nominal cheio, em aberto, na fatura f2.
const parcelaVeiculo = { id: 'f2:pv', contratoId: 'c-veiculo', display: '22/104', numero: 22, valorNominal: dec(749), valorPago: dec(233.5), dataVencimento: dia('2026-11-02'), faturaId: 'f2', acordoId: null };

describe('ACORDO — elegiveisConta', () => {
  const montar = (contaFatura: unknown) => {
    const { db } = bancoFrouxo({
      conta: { findFirst: jest.fn().mockResolvedValue({ id: 'conta-1', titularId: 'tit-1', contratosCredito: [{ id: 'c-veiculo', numero: '2026050012', ...taxas, ativo: { descricao: 'Hyundai HB20S' } }] }) },
      parcela: { findMany: jest.fn().mockResolvedValue([parcelaVeiculo]) },
    });
    return new RenegociacaoService({ db } as never, {} as never, {} as never, {} as never, contaFatura as never, intencoesStub() as never);
  };

  it('ANTES (sem o saldo do motor): 765,73 — nominal cheio + mora desde o vencimento', async () => {
    const r = await montar(semAzit()).elegiveisConta('conta-1');
    expect(r.valorTotal).toBe(76573);
  });

  it('DEPOIS: 532,08 — o saldo do motor, com a atualização só desde o pagamento', async () => {
    const r = await montar(contaFaturaCom()).elegiveisConta('conta-1');
    expect(r.valorTotal).toBe(53208);
    expect(r.valorNominalTotal).toBe(53173);
    expect(r.encargosMoraTotal).toBe(35);
    expect(r.contratos[0].parcelas[0]).toMatchObject({ id: 'f2:pv', valorNominal: 53173, encargoMora: 35, valorAtualizado: 53208, diasAtraso: 7 });
    expect(r.faturas[0]).toMatchObject({ faturaId: 'f2', valorAtualizado: 53208 });
  });
});

describe('NOVAÇÃO — decomporConta', () => {
  const montar = (contaFatura: unknown, itemSemParcela = false) => {
    const { db } = bancoFrouxo({
      conta: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conta-1', titularId: 'tit-1', titular: { nome: 'Carlos' },
          contratosCredito: [{ id: 'c-veiculo', numero: '2026050012', ativoId: 'a1', status: 'ATIVO', periodicidade: 'SEMANAL', ...taxas, taxaDescontoQuitacao: null, catalogoVersaoRef: null, ativo: { descricao: 'Hyundai HB20S' } }],
        }),
      },
      parcela: {
        findMany: jest.fn().mockResolvedValue([
          { ...parcelaVeiculo, itemContratado: { origem: 'VENDA', acordoOrigemId: null, descricao: 'Veículo' }, itensFatura: [{ tipo: 'PRINCIPAL', valor: dec(699) }, { tipo: 'SERVICO', valor: dec(50) }] },
        ]),
      },
      fatura: {
        findMany: jest.fn().mockResolvedValue(
          itemSemParcela ? [{ id: 'f2', numero: 22, dataVencimento: dia('2026-11-02'), itensFatura: [{ id: 'f2:reemb', tipo: 'SERVICO', descricao: 'Taxa de boleto e PIX', valor: dec(120) }] }] : [],
        ),
      },
    });
    return new NovacaoDecomposicaoService({ db } as never, {} as never, contaFatura as never);
  };

  it('ANTES: 765,73 (veículo 699 + proteção 50, cada um com mora de 7 dias)', async () => {
    expect((await montar(semAzit()).decomporConta('conta-1')).totalGeral).toBe(76573);
  });

  it('DEPOIS: 532,08 — só o que falta do veículo; a proteção, já quitada pela cascata, não entra', async () => {
    const r = await montar(contaFaturaCom()).decomporConta('conta-1');
    expect(r.totalGeral).toBe(53208);
    const comps = r.memoria.componentes.map((c) => [c.produto, c.valorNominal, c.valor]);
    expect(comps).toEqual([['veiculo', 53173, 53208]]);
  });

  it('item SEM parcela de fatura AZIT que a cascata já quitou não volta para a novação', async () => {
    // Sem o motor: R$ 120,00 + mora entrariam de novo. (Na fixture, f2:reemb é tratado como item sem parcela.)
    const conta = contaFixture([F2ComParcial()]);
    conta.faturas[0].itens = conta.faturas[0].itens.map((it) => (it.id === 'f2:reemb' ? { ...it, parcelaId: null } : it));
    const antes = await montar(semAzit(), true).decomporConta('conta-1');
    expect(antes.totalGeral).toBeGreaterThan(76573 + 12000);
    const depois = await montar(contaFaturaCom(conta), true).decomporConta('conta-1');
    expect(depois.totalGeral).toBe(53208);
  });
});

describe('RESCISÃO — acerto e efetivação', () => {
  const contrato = {
    id: 'c-veiculo', numero: '2026050012', status: 'ATIVO', ativoId: 'a1', contaId: 'conta-1', valorEntradaPago: dec(5000), ...taxas,
    recuperacaoIniciadaEm: null, veiculoBloqueadoEm: null, conta: { titularId: 'tit-1', titular: { nome: 'Carlos' } }, ativo: { descricao: 'HB20S', placa: 'RQT4F21', modelo: 'HB20S' },
  };
  const montar = (contaFatura: unknown, definidos: Record<string, Record<string, jest.Mock>> = {}) => {
    const banco = bancoFrouxo({
      contratoCredito: { findFirst: jest.fn().mockResolvedValue(contrato), count: jest.fn().mockResolvedValue(1), update: jest.fn().mockResolvedValue({}) },
      parcela: { findMany: jest.fn().mockImplementation(async (a: { where: { status: unknown } }) => (a.where.status === null ? [parcelaVeiculo] : [])), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ...definidos,
    });
    const intencoes = intencoesStub();
    const service = new RescisaoService({ db: banco.db } as never, { registrarEfetivador: jest.fn() } as never, { removerCobranca: jest.fn() } as never, contaFatura as never, intencoes as never, { emitir: jest.fn() } as never);
    const carregar = (dataBase: string) => (service as unknown as { carregar(c: string, d: string): Promise<{ acerto: { dividaTotal: number; principalParcial: number; principalPago: number; vencidas: unknown[] }; saldoEmAberto: number }> }).carregar('c-veiculo', dataBase);
    return { service, carregar, intencoes, ...banco };
  };

  it('ANTES: dívida de 765,73 e a base dos 20% ignora o principal já pago da parcela em aberto', async () => {
    const { acerto } = await montar(semAzit()).carregar('2026-11-09');
    expect(acerto.dividaTotal).toBe(76573);
    expect(acerto.principalPago).toBe(500000);
  });

  it('DEPOIS: dívida de 532,08 (saldo do motor na data-base) e os 167,27 de principal já pagos entram na base', async () => {
    const m = montar(contaFaturaCom());
    const { acerto, saldoEmAberto } = await m.carregar('2026-11-09');
    expect(acerto.dividaTotal).toBe(53208);
    expect(acerto.vencidas).toEqual([expect.objectContaining({ id: 'f2:pv', valorNominal: 53173, encargo: 35, total: 53208 })]);
    expect(acerto.principalParcial).toBe(16727);
    expect(acerto.principalPago).toBe(516727);
    expect(saldoEmAberto).toBe(53173);
  });

  it('fatura mista: item deste contrato que JÁ recebeu pagamento não é apagado — fica pelo valor pago; e os Pix ativos da conta são cancelados', async () => {
    const m = montar(contaFaturaCom(), {
      rescisaoContrato: { findFirst: jest.fn().mockResolvedValue({ id: 'r1', dataBase: dia('2026-11-09') }), update: jest.fn().mockResolvedValue({}) },
      fatura: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'f2', numero: 22, status: 'FECHADA', asaasChargeId: null, itensFatura: [
            { id: 'f2:veiculo', valor: dec(699), parcelaId: 'f2:pv', parcela: { contratoId: 'c-veiculo' } }, // recebeu 167,27
            { id: 'f2:protecao', valor: dec(50), parcelaId: 'f2:pv', parcela: { contratoId: 'c-veiculo' } }, // recebeu 50,00 (quitado)
            { id: 'f2:sem-pg', valor: dec(30), parcelaId: 'f2:px', parcela: { contratoId: 'c-veiculo' } }, // nunca recebeu nada
            { id: 'f2:reemb', valor: dec(120), parcelaId: 'f2:pr', parcela: { contratoId: 'c-reemb' } }, // de OUTRO contrato
          ] },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      alocacaoPagamento: {
        groupBy: jest.fn().mockResolvedValue([
          { itemFaturaId: 'f2:veiculo', _sum: { valor: dec(167.27) } },
          { itemFaturaId: 'f2:protecao', _sum: { valor: dec(50) } },
        ]),
      },
    });
    const r = await m.service.efetivar('c-veiculo', 'u-luis');
    // Só o item SEM pagamento é apagado; antes eram apagados os três (e o rastro do Pix sumia).
    expect(m.chamadas.itemFatura.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['f2:sem-pg'] } } });
    expect(m.chamadas.itemFatura.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 'f2:veiculo' }, data: { valor: '167.27' } },
      { where: { id: 'f2:protecao' }, data: { valor: '50.00' } },
    ]);
    // Novo total = item do outro contrato (120,00) + o que já foi pago e fica registrado (217,27).
    expect(m.chamadas.fatura.update).toHaveBeenCalledWith({ where: { id: 'f2' }, data: { valorTotal: '337.27' } });
    expect(r?.avisos.join(' ')).toContain('continuam registrados');
    expect(m.intencoes.invalidarAtivasDaConta).toHaveBeenCalledWith('conta-1', expect.stringContaining('rescisão'));
  });
});

describe('QUITAÇÃO ANTECIPADA — parcela em fatura AZIT já disponível', () => {
  const montar = (faturasPix: unknown[]) => {
    const { db, chamadas } = bancoFrouxo({
      contratoCredito: { findFirst: jest.fn().mockResolvedValue({ id: 'c-veiculo', taxaDescontoQuitacao: dec(1), periodicidade: 'SEMANAL', catalogoVersaoRef: null }) },
      parcela: { findMany: jest.fn().mockResolvedValue([parcelaVeiculo]), count: jest.fn().mockResolvedValue(1) },
      fatura: { findMany: jest.fn().mockResolvedValue(faturasPix), update: jest.fn().mockResolvedValue({}) },
    });
    return { service: new QuitacaoService({ db } as never, {} as never), chamadas };
  };

  it('ANTES a quitação cobrava 749,00 e gravava a fatura PAGA por cima dos 540 já pagos; AGORA recusa e explica o caminho', async () => {
    const { service, chamadas } = montar([{ id: 'f2', numero: 22 }]);
    await expect(service.simular('c-veiculo')).rejects.toMatchObject({ status: 422, response: { erro: 'parcela_em_fatura_pix_sob_demanda' } });
    await expect(service.quitar('c-veiculo', undefined, 'u-luis')).rejects.toMatchObject({ response: { mensagem: expect.stringContaining('#22') } });
    expect(chamadas.fatura.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['f2'] }, modeloEncargo: 'AZIT', status: 'FECHADA' } }));
    expect(chamadas.fatura.update).toBeUndefined(); // nenhuma fatura virou PAGA (a gravação nem foi alcançada)
    expect(chamadas.parcela?.update).toBeUndefined();
  });

  it('AVALIAR o contrato (valor presente da carteira, §27.8) não esbarra na trava — produção 27/11: os cartões da carteira de clientes ficavam vazios', async () => {
    const { service } = montar([{ id: 'f2', numero: 22 }]);
    const sim = await service.simular('c-veiculo', undefined, { avaliacao: true });
    expect(sim.valorNominalTotal).toBe(74900);
    await expect(service.quitar('c-veiculo', undefined, 'u-luis')).rejects.toMatchObject({ response: { erro: 'parcela_em_fatura_pix_sob_demanda' } }); // executar continua travado
  });

  it('parcela fora de fatura AZIT em aberto continua antecipável como sempre', async () => {
    const { service } = montar([]);
    const sim = await service.simular('c-veiculo');
    expect(sim.parcelas).toHaveLength(1);
    expect(sim.valorNominalTotal).toBe(74900);
  });
});

describe('SINISTRO — indenização sobre parcela de fatura AZIT', () => {
  const montar = (conta = contaFixture([F2ComParcial()]), abertas: unknown[] = [parcelaVeiculo]) => {
    const banco = bancoFrouxo({
      contratoCredito: { findFirst: jest.fn().mockResolvedValue({ id: 'c-veiculo', contaId: 'conta-1', ativoId: null }), update: jest.fn().mockResolvedValue({}) },
      parcela: { findMany: jest.fn().mockResolvedValue(abertas), update: jest.fn().mockResolvedValue({}), aggregate: jest.fn().mockResolvedValue({ _sum: { valorNominal: dec(1000) } }) },
    });
    const contaFatura = contaFaturaCom(conta);
    const intencoes = intencoesStub();
    const baixa = new BaixaContaService({ db: banco.db } as never, contaFatura, { emitir: jest.fn() } as never, intencoes as never);
    const service = new SinistroService({ db: banco.db } as never, contaFatura, baixa, intencoes as never);
    return { service, intencoes, ...banco };
  };

  it('cobre o que FALTA da parcela (531,73), registra o pagamento na fatura, SOMA ao valorPago e não marca PAGA com encargo pendente', async () => {
    const m = montar();
    const r = await m.service.registrar('c-veiculo', 60000, 'u-luis');
    // Antes: exigia e amortizava os 749,00 cheios (com 600,00 de indenização não quitaria nada).
    expect(r).toMatchObject({ amortizado: 53173, parcelasQuitadas: 1, sobraAoCliente: 6827 });
    expect(m.chamadas.pagamentoFatura.create).toHaveBeenCalledWith({
      data: {
        faturaId: 'f2', valor: '531.73', dataPagamento: dia('2026-11-09'), origem: 'SINISTRO',
        alocacoes: { create: [{ itemFaturaId: 'f2:veiculo', tipoEncargo: null, valor: '531.73', nivel: 4, quitou: true }] },
      },
    });
    // Parcela: soma ao que já tinha sido pago em parte (233,50 + 531,73), não regrava.
    expect(m.chamadas.parcela.update).toHaveBeenCalledWith({ where: { id: 'f2:pv' }, data: expect.objectContaining({ status: 'PAGA_ANTECIPADA', valorPago: '765.23' }) });
    // Fatura: 540,00 + 531,73; continua em aberto — falta a atualização de 0,35 (antes: PAGA com valorPago 749,00).
    expect(m.chamadas.fatura.update.mock.calls.map((c) => c[0])).toEqual([{ where: { id: 'f2' }, data: { valorPago: '1071.73' } }]);
    expect(m.intencoes.invalidarAtivasDaConta).toHaveBeenCalledWith('conta-1', 'sinistro registrado');
  });

  it('fatura com parcela de OUTRO contrato não vira PAGA inteira: só os itens da parcela indenizada são baixados', async () => {
    // Fatura a vencer, sem pagamento: veículo+proteção (este contrato), reembolso (outro contrato) e acordo.
    const m = montar(contaFixture([F4()]), [{ ...parcelaVeiculo, id: 'f4:pv', faturaId: 'f4', valorPago: null, dataVencimento: dia('2026-11-16') }]);
    await m.service.registrar('c-veiculo', 80000, 'u-luis');
    const criado = m.chamadas.pagamentoFatura.create.mock.calls[0][0] as { data: { valor: string; alocacoes: { create: { itemFaturaId: string }[] } } };
    expect(criado.data.valor).toBe('749.00');
    expect(criado.data.alocacoes.create.map((a) => a.itemFaturaId).sort()).toEqual(['f4:protecao', 'f4:veiculo']);
    expect(m.chamadas.fatura.update.mock.calls[0][0]).toEqual({ where: { id: 'f4' }, data: { valorPago: '749.00' } }); // sem status PAGA
  });
});
