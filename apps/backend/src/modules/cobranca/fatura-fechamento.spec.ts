import { FaturaService } from './fatura.service';

// Fechamento D-5 com a chave do Pix sob demanda (doc 02 §32.4-A).
//   · DESLIGADA (padrão): REGRESSÃO — idêntico ao comportamento anterior: fecha
//     e enfileira a cobrança no Asaas, sem tocar no modelo da fatura.
//   · LIGADA: fecha no modelo AZIT e NÃO enfileira cobrança.
// Sem banco.

function montar(pixSobDemanda: boolean, faturas: { id: string; tokenPublico?: string | null }[] = [{ id: 'f1', tokenPublico: 'tk1' }, { id: 'f2', tokenPublico: 'tk2' }]) {
  const fatura = {
    findMany: jest.fn().mockResolvedValue(faturas),
    update: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn(),
  };
  const filaCobranca = { add: jest.fn().mockResolvedValue({}) };
  const notificacao = { emitir: jest.fn().mockResolvedValue({}) };
  const asaas = { criarCobranca: jest.fn(), criarCliente: jest.fn(), clienteReutilizavel: jest.fn() };
  const parametros = { pixSobDemandaLigado: jest.fn().mockResolvedValue(pixSobDemanda) };
  const service = new FaturaService(
    { db: { fatura } } as never,
    asaas as never,
    { get: () => '' } as never,
    notificacao as never,
    parametros as never,
    {} as never, // ContaFaturaService — não usado no fechamento
    {} as never, // IntencaoPagamentoService — idem
    filaCobranca as never,
    { add: jest.fn() } as never,
  );
  return { service, fatura, filaCobranca, notificacao, asaas };
}

describe('FaturaService.fechar — chave do Pix sob demanda', () => {
  it('REGRESSÃO, chave desligada: fecha e enfileira a cobrança de cada fatura, sem mexer no modelo', async () => {
    const { service, fatura, filaCobranca } = montar(false);
    const ref = new Date('2026-11-15T06:00:00Z');
    const r = await service.fechar(ref);
    expect(r).toEqual({ fechadas: 2, modelo: 'ASAAS_NATIVO' });
    expect(fatura.findMany).toHaveBeenCalledWith({ where: { status: 'ABERTA', dataFechamento: { lte: ref } }, select: { id: true, tokenPublico: true } });
    expect(fatura.update.mock.calls).toEqual([
      [{ where: { id: 'f1' }, data: { status: 'FECHADA' } }],
      [{ where: { id: 'f2' }, data: { status: 'FECHADA' } }],
    ]);
    expect(filaCobranca.add.mock.calls).toEqual([
      ['gerar', { faturaId: 'f1' }],
      ['gerar', { faturaId: 'f2' }],
    ]);
  });

  it('chave ligada: fecha no modelo AZIT e NÃO enfileira cobrança', async () => {
    const { service, fatura, filaCobranca } = montar(true);
    const r = await service.fechar();
    expect(r).toEqual({ fechadas: 2, modelo: 'AZIT' });
    expect(fatura.update.mock.calls.map((c) => c[0].data)).toEqual([
      { status: 'FECHADA', modeloEncargo: 'AZIT' },
      { status: 'FECHADA', modeloEncargo: 'AZIT' },
    ]);
    expect(filaCobranca.add).not.toHaveBeenCalled();
  });

  it('chave ligada: fatura sem link público ganha o token no fechamento (é o único caminho de pagamento)', async () => {
    const { service, fatura } = montar(true, [{ id: 'f1', tokenPublico: null }]);
    await service.fechar();
    const data = fatura.update.mock.calls[0][0].data as { status: string; modeloEncargo: string; tokenPublico: string };
    expect(data).toMatchObject({ status: 'FECHADA', modeloEncargo: 'AZIT' });
    expect(data.tokenPublico).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('fatura AZIT sem cobrança não é pendência', () => {
  it('a varredura só olha o modelo antigo: nada reenfileirado, nenhum alerta', async () => {
    const { service, fatura, filaCobranca, notificacao } = montar(true, []);
    const r = await service.varrerCobrancasPendentes();
    expect(fatura.findMany.mock.calls[0][0].where).toEqual({ status: 'FECHADA', asaasChargeId: null, modeloEncargo: 'ASAAS_NATIVO', deletedAt: null });
    expect(r).toEqual({ reenfileiradas: 0, vencidasSemCobranca: 0, possivelFilaParada: 0 });
    expect(filaCobranca.add).not.toHaveBeenCalled();
    expect(notificacao.emitir).not.toHaveBeenCalled();
  });

  it('job de cobrança que sobrou na fila não cria cobrança para fatura AZIT', async () => {
    const { service, fatura, asaas } = montar(true);
    fatura.findFirst.mockResolvedValue({ id: 'f1', asaasChargeId: null, modeloEncargo: 'AZIT', conta: { titular: {} }, parcelas: [], itensFatura: [] });
    await service.gerarCobranca('f1');
    expect(asaas.criarCobranca).not.toHaveBeenCalled();
    expect(fatura.update).not.toHaveBeenCalled();
  });

  it('"Emitir cobrança" manual é recusada para fatura AZIT, com explicação', async () => {
    const { service, fatura, asaas } = montar(true);
    fatura.findFirst.mockResolvedValue({ id: 'f1', status: 'FECHADA', asaasChargeId: null, modeloEncargo: 'AZIT', conta: { titular: {} }, parcelas: [], itensFatura: [] });
    await expect(service.emitirCobrancaManual('f1', {})).rejects.toMatchObject({ response: { erro: 'fatura_pix_sob_demanda' } });
    expect(asaas.criarCobranca).not.toHaveBeenCalled();
  });
});

describe('conciliação antiga não toca em fatura AZIT', () => {
  it('job conciliar de fatura AZIT é ignorado — a baixa dela é pela conta', async () => {
    const { service, fatura } = montar(true);
    fatura.findFirst.mockResolvedValue({ id: 'f1', status: 'FECHADA', modeloEncargo: 'AZIT', parcelas: [] });
    const r = await service.conciliarPagamento({ faturaId: 'f1', paymentDate: '2026-11-09', dueDate: '2026-11-09', valor: 104900 });
    expect(r).toEqual({ resultado: 'modelo_azit_baixa_pela_conta' });
    expect(fatura.update).not.toHaveBeenCalled();
  });
});
