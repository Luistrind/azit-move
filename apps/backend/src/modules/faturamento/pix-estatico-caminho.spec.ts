import { IntencaoPagamentoProcessor } from './intencao-pagamento.processor';
import { PagamentoContaController } from './pagamento-conta.controller';

// Pix sob demanda por QR estático (doc 02 §32.4-A, 15/11): o job 'identificar'
// na fila e o simulador de desenvolvimento, que percorre o MESMO caminho do
// webhook (identificar pelo id do Pix → baixa pela conta).

describe('IntencaoPagamentoProcessor — job identificar', () => {
  it('entrega o aviso a quem acha a intenção; não aplica baixa por conta própria', async () => {
    const intencao = { identificarPagamento: jest.fn().mockResolvedValue({ resultado: 'baixa_enfileirada', intencaoId: 'int_1' }) };
    const baixa = { aplicarPagamentoDeIntencao: jest.fn() };
    const dados = { pagamentoId: 'pay_9', gatewayId: 'qr_abc123', valor: 107243, dataPagamento: '2026-11-09', recebidoEm: '2026-11-09T21:22:00.000Z', identificadorPix: 'E182' };
    const r = await new IntencaoPagamentoProcessor(intencao as never, baixa as never, {} as never).process({ name: 'identificar', data: dados } as never);
    expect(intencao.identificarPagamento).toHaveBeenCalledWith(dados);
    expect(r).toEqual({ resultado: 'baixa_enfileirada', intencaoId: 'int_1' });
    expect(baixa.aplicarPagamentoDeIntencao).not.toHaveBeenCalled();
  });

  it('dinheiro recebido que não deu para identificar NÃO fica só na fila: esgotadas as tentativas, a carteira é avisada', async () => {
    const notificacao = { emitir: jest.fn().mockResolvedValue(undefined) };
    const p = new IntencaoPagamentoProcessor({} as never, {} as never, notificacao as never);
    const job = (name: string, attemptsMade: number) => ({ name, data: { pagamentoId: 'pay_9', gatewayId: null, valor: 107243 }, opts: { attempts: 5 }, attemptsMade });
    await p.onFailed(job('identificar', 2) as never, new Error('Asaas fora do ar')); // ainda vai repetir
    await p.onFailed(job('cancelar', 5) as never, new Error('x')); // cancelamento não envolve dinheiro parado
    expect(notificacao.emitir).not.toHaveBeenCalled();
    await p.onFailed(job('identificar', 5) as never, new Error('Asaas fora do ar'));
    expect(notificacao.emitir).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'Pix recebido e NÃO aplicado à conta', tipo: 'FALHA', area: 'CARTEIRA_COBRANCA', corpo: expect.stringMatching(/pay_9 de R\$\s?1\.072,43 .* identificar de qual Pix/) }));
  });
});

describe('Simulador de pagamento do Pix (fora de produção)', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-09T21:22:00.000Z')));
  afterAll(() => jest.useRealTimers());

  function montar(intencaoNoBanco: unknown) {
    const intencao = { enfileirarIdentificacao: jest.fn().mockResolvedValue(undefined), enfileirarBaixa: jest.fn() };
    const prisma = { db: { intencaoPagamento: { findFirst: jest.fn().mockResolvedValue(intencaoNoBanco) } } };
    return { controller: new PagamentoContaController(intencao as never, prisma as never), intencao };
  }

  it('QR estático: enfileira a identificação com o id do Pix — o mesmo job do webhook, não a baixa direta', async () => {
    const { controller, intencao } = montar({ id: 'int_1', valor: { toString: () => '1072.43' }, gatewayId: 'qr_sim_intencao_int_1' });
    expect(await controller.simularPagamento('int_1')).toEqual({ enfileirado: true, intencaoId: 'int_1' });
    expect(intencao.enfileirarIdentificacao).toHaveBeenCalledWith({
      pagamentoId: 'pay_sim_int_1',
      gatewayId: 'qr_sim_intencao_int_1',
      valor: 107243,
      dataPagamento: '2026-11-09',
      recebidoEm: '2026-11-09T21:22:00.000Z',
      identificadorPix: 'SIMULADO-int_1',
    });
    expect(intencao.enfileirarBaixa).not.toHaveBeenCalled();
  });

  it('Pix inexistente → 404', async () => {
    await expect(montar(null).controller.simularPagamento('nao-existe')).rejects.toMatchObject({ response: { erro: 'nao_encontrado' } });
  });
});
