import { Prisma } from '@prisma/client';
import { ContaFaturaService, type ContaCarregada } from './conta-fatura.service';
import { IntencaoPagamentoService } from './intencao-pagamento.service';
import { AGORA, contaFixture, F2, F3, F4, HOJE } from './conta.fixture-spec';

// Intenção de pagamento (doc 02 §32.4-A): VÁRIAS ativas por conta no dia, uma
// por valor (regra 15/11 — gerar um Pix novo não cancela os anteriores), reuso
// por valor, teto diário de valores distintos, virada do dia e validação do
// valor no servidor. Gateway e banco dublados.

type Linha = { id: string; contaId: string; valor: Prisma.Decimal; dia: string; situacao: string; gatewayId: string | null; pixCopiaECola: string | null; pixQrCodeImagem: string | null; simulado: boolean; outroValor: boolean; faturasPretendidas: unknown; validoAte: Date; createdAt: Date };

function montar(conta: ContaCarregada, existentes: Partial<Linha>[] = []) {
  const tabela: Linha[] = existentes.map((e, i) => ({
    id: `int-${i}`, contaId: 'conta-1', valor: new Prisma.Decimal('0'), dia: HOJE, situacao: 'ATIVA', gatewayId: `pay-${i}`, pixCopiaECola: `codigo-${i}`,
    pixQrCodeImagem: null, simulado: false, outroValor: false, faturasPretendidas: [], validoAte: new Date(), createdAt: new Date(2026, 10, 9, 8, i), ...e,
  }));
  const casa = (l: Linha, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const atual = (l as unknown as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && 'lt' in v) return (atual as string) < (v as { lt: string }).lt;
      if (v && typeof v === 'object' && 'in' in v) return (v as { in: unknown[] }).in.includes(atual);
      if (v && typeof v === 'object' && 'not' in v) return atual !== (v as { not: unknown }).not;
      return atual === v;
    });
  const intencaoPagamento = {
    findFirst: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => [...tabela].reverse().find((l) => casa(l, where)) ?? null),
    findMany: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => tabela.filter((l) => casa(l, where))),
    count: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => tabela.filter((l) => casa(l, where)).length),
    updateMany: jest.fn().mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Linha> }) => {
      const alvo = tabela.filter((l) => casa(l, where));
      alvo.forEach((l) => Object.assign(l, data));
      return { count: alvo.length };
    }),
    create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const l = { ...data, valor: new Prisma.Decimal(data.valor as string), createdAt: new Date() } as unknown as Linha;
      tabela.push(l);
      return l;
    }),
  };
  const db = { intencaoPagamento, $queryRaw: jest.fn().mockResolvedValue([]), $transaction: jest.fn() };
  db.$transaction.mockImplementation((fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  const prisma = { db };
  const contaFatura = new ContaFaturaService(prisma as never);
  jest.spyOn(contaFatura, 'carregar').mockResolvedValue(conta);
  let seq = 0;
  const gateway = {
    nome: 'teste',
    simulado: false,
    criarPix: jest.fn().mockImplementation(async (p: { referencia: string; valor: number }) => ({ gatewayId: `pay-novo-${++seq}`, copiaECola: `pix-${p.valor}`, qrCodeImagem: null, simulado: false })),
    cancelarPix: jest.fn().mockResolvedValue({ cancelado: true, pago: false }),
    consultarPix: jest.fn().mockResolvedValue({ existe: true, pago: false, valor: 0, dataPagamento: null, pagamentoId: null }),
    interpretarWebhook: jest.fn(),
    pixDoPagamento: jest.fn().mockResolvedValue(null),
    chaveRecebimento: jest.fn(),
  };
  const fila = { add: jest.fn().mockResolvedValue({}) };
  const service = new IntencaoPagamentoService(prisma as never, contaFatura, gateway as never, fila as never);
  return { service, gateway, fila, tabela, intencaoPagamento };
}

describe('IntencaoPagamentoService', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(AGORA));
  afterAll(() => jest.useRealTimers());

  it('cria o Pix do valor exato, com referência intencao:<id>, válido até 23h59 de hoje, e o retrato das faturas', async () => {
    const { service, gateway, tabela } = montar(contaFixture([F2(), F3()]));
    const r = await service.criar({ contaId: 'conta-1', valor: 212143, origem: 'PAGINA_PUBLICA' });
    expect(gateway.criarPix).toHaveBeenCalledWith(expect.objectContaining({ valor: 212143, dia: HOJE, titularId: 'tit-1', referencia: `intencao:${r.id}`, descricaoCurta: 'Azit Move faturas 22 a 23' }));
    expect(r).toMatchObject({ valor: 212143, pixCopiaECola: 'pix-212143', outroValor: false, reaproveitada: false });
    expect(r.validoAte.toISOString()).toBe('2026-11-10T02:59:59.999Z');
    expect(r.faturas).toEqual([
      { faturaId: 'f2', numero: 22, vencimento: '2026-11-02', valor: 107243 },
      { faturaId: 'f3', numero: 23, vencimento: '2026-11-09', valor: 104900 },
    ]);
    expect(tabela).toHaveLength(1);
    expect(tabela[0]).toMatchObject({ situacao: 'ATIVA', dia: HOJE, origem: 'PAGINA_PUBLICA', gatewayId: 'pay-novo-1' });
  });

  it('REUSO: pedir de novo o mesmo valor no mesmo dia devolve a intenção ativa, sem criar outro Pix', async () => {
    const { service, gateway, tabela } = montar(contaFixture([F2()]));
    const a = await service.criar({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' });
    const b = await service.criar({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' });
    expect(b.id).toBe(a.id);
    expect(b.reaproveitada).toBe(true);
    expect(gateway.criarPix).toHaveBeenCalledTimes(1);
    expect(tabela).toHaveLength(1);
  });

  it('VÁRIAS ATIVAS, uma por valor (regra 15/11): outro valor NÃO cancela nem substitui o anterior', async () => {
    const { service, gateway, fila, tabela } = montar(contaFixture([F2()]));
    const a = await service.criar({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' });
    const b = await service.criar({ contaId: 'conta-1', valor: 60000, origem: 'PAGINA_PUBLICA' });
    expect(b.outroValor).toBe(true);
    // As duas continuam ATIVAS; nada vai para o gateway nem para a fila de cancelamento.
    expect(tabela.map((l) => [l.id, l.situacao])).toEqual([[a.id, 'ATIVA'], [b.id, 'ATIVA']]);
    expect(gateway.cancelarPix).not.toHaveBeenCalled();
    expect(gateway.consultarPix).not.toHaveBeenCalled();
    expect(fila.add).not.toHaveBeenCalled();
    expect((await service.ativasDaConta('conta-1')).map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('o cliente muda de ideia e VOLTA a uma opção já gerada: recebe o mesmo Pix, mesmo não sendo o mais recente', async () => {
    const { service, gateway, tabela } = montar(contaFixture([F2()]));
    const a = await service.criar({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' });
    const b = await service.criar({ contaId: 'conta-1', valor: 60000, origem: 'PAGINA_PUBLICA' });
    const c = await service.criar({ contaId: 'conta-1', valor: 70000, origem: 'PAGINA_PUBLICA' });
    const deNovoA = await service.criar({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' });
    const deNovoB = await service.criar({ contaId: 'conta-1', valor: 60000, origem: 'PAGINA_PUBLICA' });
    expect(deNovoA).toMatchObject({ id: a.id, pixCopiaECola: a.pixCopiaECola, reaproveitada: true });
    expect(deNovoB).toMatchObject({ id: b.id, reaproveitada: true });
    expect(gateway.criarPix).toHaveBeenCalledTimes(3); // um Pix por valor, nunca dois do mesmo
    expect(tabela.map((l) => [l.id, l.situacao])).toEqual([[a.id, 'ATIVA'], [b.id, 'ATIVA'], [c.id, 'ATIVA']]);
  });

  it('corrida do MESMO valor: vale a intenção que já está gravada e só o Pix em dobro vai para a fila de cancelamento', async () => {
    const { service, gateway, fila, tabela, intencaoPagamento } = montar(contaFixture([F2()]));
    // Enquanto o gateway respondia ao 2º pedido, o 1º (mesmo valor) foi gravado.
    const ativasAntes = intencaoPagamento.findMany.getMockImplementation()!;
    let chamadas = 0;
    intencaoPagamento.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      chamadas++;
      // 1ª leitura (reuso) e 2ª (teto do dia) do 2º pedido ainda não enxergam a concorrente.
      return chamadas <= 2 ? [] : ativasAntes(args);
    });
    tabela.push({ id: 'int-concorrente', contaId: 'conta-1', valor: new Prisma.Decimal('1072.43'), dia: HOJE, situacao: 'ATIVA', gatewayId: 'pay-concorrente', pixCopiaECola: 'codigo-concorrente', pixQrCodeImagem: null, simulado: false, outroValor: false, faturasPretendidas: [], validoAte: new Date(), createdAt: new Date() });
    const r = await service.criar({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' });
    expect(r).toMatchObject({ id: 'int-concorrente', pixCopiaECola: 'codigo-concorrente', reaproveitada: true });
    expect(tabela).toHaveLength(1); // não gravou uma 2ª ativa do mesmo valor
    expect(gateway.criarPix).toHaveBeenCalledTimes(1);
    expect(fila.add).toHaveBeenCalledWith('cancelar', { intencaoId: 'int-concorrente', gatewayId: 'pay-novo-1' }, { jobId: 'cancelar-pay-novo-1' });
  });

  it('job cancelar: cancela no gateway; gateway sem confirmar LANÇA (a fila repete); Pix já pago vira baixa', async () => {
    const ok = montar(contaFixture([F2()]));
    await expect(ok.service.cancelarSubstituida({ intencaoId: 'int-a', gatewayId: 'pay-a' })).resolves.toEqual({ resultado: 'cancelado' });
    expect(ok.gateway.cancelarPix).toHaveBeenCalledWith('pay-a');

    const falhou = montar(contaFixture([F2()]));
    falhou.gateway.cancelarPix.mockResolvedValueOnce({ cancelado: false, pago: false });
    await expect(falhou.service.cancelarSubstituida({ intencaoId: 'int-a', gatewayId: 'pay-a' })).rejects.toThrow('não confirmou o cancelamento');
    const fora = montar(contaFixture([F2()]));
    fora.gateway.cancelarPix.mockRejectedValueOnce(new Error('Asaas GET /payments/pay-a não respondeu em 8 s'));
    await expect(fora.service.cancelarSubstituida({ intencaoId: 'int-a', gatewayId: 'pay-a' })).rejects.toThrow('não respondeu em 8 s');

    const pago = montar(contaFixture([F2()]));
    pago.gateway.cancelarPix.mockResolvedValueOnce({ cancelado: false, pago: true });
    pago.gateway.consultarPix.mockResolvedValueOnce({ existe: true, pago: true, valor: 107243, dataPagamento: '2026-11-09', pagamentoId: 'pay-a' });
    await expect(pago.service.cancelarSubstituida({ intencaoId: 'int-a', gatewayId: 'pay-a' })).resolves.toEqual({ resultado: 'ja_pago' });
    expect(pago.fila.add).toHaveBeenCalledWith('baixar', expect.objectContaining({ intencaoId: 'int-a', pagamentoId: 'pay-a', valor: 107243, origem: 'GATEWAY' }), { jobId: 'baixa-pay-a' });
  });

  it('valor fora da regra é recusado no servidor, sem tocar no gateway', async () => {
    const { service, gateway } = montar(contaFixture([F2(), F3()]));
    await expect(service.criar({ contaId: 'conta-1', valor: 50000, origem: 'PAGINA_PUBLICA' })).rejects.toMatchObject({ response: { erro: 'valor_invalido', motivo: 'abaixo_do_minimo' } });
    await expect(service.criar({ contaId: 'conta-1', valor: 999999, origem: 'PAGINA_PUBLICA' })).rejects.toMatchObject({ response: { erro: 'valor_invalido', motivo: 'acima_do_total' } });
    expect(gateway.criarPix).not.toHaveBeenCalled();
  });

  it('fatura a vencer não trava o parcial da única vencida (D-07)', async () => {
    const { service } = montar(contaFixture([F2(), F4()]));
    const r = await service.criar({ contaId: 'conta-1', valor: 36715, origem: 'PAGINA_PUBLICA' });
    expect(r).toMatchObject({ valor: 36715, outroValor: true });
    expect(r.faturas).toEqual([{ faturaId: 'f2', numero: 22, vencimento: '2026-11-02', valor: 36715 }]);
  });

  it('CONTA MISTA (provisório §32.4-A): só a fatura AZIT mais antiga, sozinha; nada de várias nem de outro valor', async () => {
    const mista = contaFixture([F2(), F3()], { abertasModeloAntigo: [{ id: 'old', numero: 20, vencimento: '2026-10-19', valor: 104900, tokenPublico: 'tk-old' }] });
    const { service } = montar(mista);
    await expect(service.criar({ contaId: 'conta-1', valor: 212143, origem: 'PAGINA_PUBLICA' })).rejects.toMatchObject({ response: { erro: 'valor_invalido' } });
    await expect(service.criar({ contaId: 'conta-1', valor: 150000, origem: 'PAGINA_PUBLICA' })).rejects.toMatchObject({ response: { erro: 'valor_invalido' } });
    await expect(service.criar({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' })).resolves.toMatchObject({ valor: 107243 });
  });

  it('TETO diário de VALORES DISTINTOS por conta: voltar a um valor já pedido não conta', async () => {
    const conta = contaFixture([F2()]);
    conta.parametros.tetoIntencoesDia = 2;
    const { service, gateway, tabela } = montar(conta);
    await service.criar({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' });
    await service.criar({ contaId: 'conta-1', valor: 60000, origem: 'PAGINA_PUBLICA' });
    await expect(service.criar({ contaId: 'conta-1', valor: 70000, origem: 'PAGINA_PUBLICA' })).rejects.toMatchObject({ response: { erro: 'limite_pix_dia' }, status: 429 });
    // Pedir de novo QUALQUER valor já gerado hoje NÃO conta: reaproveita.
    await expect(service.criar({ contaId: 'conta-1', valor: 60000, origem: 'PAGINA_PUBLICA' })).resolves.toMatchObject({ reaproveitada: true });
    await expect(service.criar({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' })).resolves.toMatchObject({ reaproveitada: true });
    expect(gateway.criarPix).toHaveBeenCalledTimes(2);
    // Valor já pedido hoje cuja intenção deixou de valer (um pagamento entrou): pode ser gerado de novo sem estourar o teto.
    tabela.forEach((l) => { l.situacao = 'SUBSTITUIDA'; });
    await expect(service.criar({ contaId: 'conta-1', valor: 60000, origem: 'PAGINA_PUBLICA' })).resolves.toMatchObject({ reaproveitada: false });
    await expect(service.criar({ contaId: 'conta-1', valor: 80000, origem: 'PAGINA_PUBLICA' })).rejects.toMatchObject({ response: { erro: 'limite_pix_dia' } });
  });

  it('falha do gateway: 503 com orientação, nada gravado e as intenções que já existiam continuam ativas', async () => {
    const { service, gateway, fila, tabela } = montar(contaFixture([F2()]));
    const a = await service.criar({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' });
    gateway.criarPix.mockRejectedValueOnce(new Error('timeout'));
    await expect(service.criar({ contaId: 'conta-1', valor: 60000, origem: 'PAGINA_PUBLICA' })).rejects.toMatchObject({ response: { erro: 'pix_indisponivel' }, status: 503 });
    expect(tabela.map((l) => [l.id, l.situacao])).toEqual([[a.id, 'ATIVA']]);
    expect(gateway.cancelarPix).not.toHaveBeenCalled();
    expect(fila.add).not.toHaveBeenCalled();
  });

  it('VIRADA DO DIA: expira TODAS as ativas de ontem e cancela os Pix; a de hoje fica', async () => {
    const { service, gateway, tabela } = montar(contaFixture([F2()]), [
      { id: 'ontem', dia: '2026-11-08', gatewayId: 'pay-ontem' },
      { id: 'ontem-outro-valor', dia: '2026-11-08', gatewayId: 'pay-ontem-2' },
      { id: 'hoje', dia: HOJE, gatewayId: 'pay-hoje' },
    ]);
    // A de ontem já não vale para a página mesmo antes de o job rodar (Regra 7).
    expect((await service.ativasDaConta('conta-1')).map((i) => i.id)).toEqual(['hoje']);
    const r = await service.expirarVencidas();
    expect(r).toEqual({ expiradas: 2, pagasEncontradas: 0 });
    expect(tabela.map((l) => [l.id, l.situacao])).toEqual([['ontem', 'EXPIRADA'], ['ontem-outro-valor', 'EXPIRADA'], ['hoje', 'ATIVA']]);
    expect(gateway.cancelarPix.mock.calls.map((c) => c[0])).toEqual(['pay-ontem', 'pay-ontem-2']);
  });

  it('corrida entre cancelar e pagar: Pix expirado que o gateway diz PAGO vira baixa na fila (o dinheiro manda)', async () => {
    const { service, gateway, fila } = montar(contaFixture([F2()]), [{ id: 'ontem', dia: '2026-11-08', gatewayId: 'pay-ontem' }]);
    gateway.cancelarPix.mockResolvedValueOnce({ cancelado: false, pago: true });
    gateway.consultarPix.mockResolvedValueOnce({ existe: true, pago: true, valor: 107243, dataPagamento: '2026-11-08', pagamentoId: 'pay-ontem' });
    const r = await service.expirarVencidas();
    expect(r).toEqual({ expiradas: 1, pagasEncontradas: 1 });
    expect(fila.add).toHaveBeenCalledWith('baixar', expect.objectContaining({ intencaoId: 'ontem', pagamentoId: 'pay-ontem', valor: 107243, dataPagamento: '2026-11-08', origem: 'GATEWAY' }), { jobId: 'baixa-pay-ontem' });
  });

  it('operação que muda a dívida (acordo, novação, rescisão, sinistro): TODOS os Pix ativos da conta deixam de valer, com o cancelamento na fila', async () => {
    const { service, gateway, fila, tabela } = montar(contaFixture([F2()]), [
      { id: 'a', situacao: 'ATIVA', gatewayId: 'pay-a' },
      { id: 'b', situacao: 'ATIVA', dia: '2026-11-08', gatewayId: 'pay-b' }, // de ontem, ainda não expirada pelo job
      { id: 'c', situacao: 'PAGA', gatewayId: 'pay-c' },
    ]);
    expect(await service.invalidarAtivasDaConta('conta-1', 'acordo efetivado')).toBe(2);
    expect(tabela.map((l) => [l.id, l.situacao])).toEqual([['a', 'SUBSTITUIDA'], ['b', 'SUBSTITUIDA'], ['c', 'PAGA']]);
    expect(fila.add.mock.calls).toEqual([
      ['cancelar', { intencaoId: 'a', gatewayId: 'pay-a' }, { jobId: 'cancelar-pay-a' }],
      ['cancelar', { intencaoId: 'b', gatewayId: 'pay-b' }, { jobId: 'cancelar-pay-b' }],
    ]);
    expect(gateway.cancelarPix).not.toHaveBeenCalled(); // fora do caminho de quem efetivou
    expect(await service.invalidarAtivasDaConta('conta-1', 'de novo')).toBe(0);
  });

  describe('pagamento de QR ESTÁTICO: o gateway avisa sem a referência da intenção (15/11)', () => {
    const aviso = { pagamentoId: 'pay_9', valor: 107243, dataPagamento: '2026-11-09', recebidoEm: '2026-11-09T21:22:00.000Z', identificadorPix: 'E182' };

    it('o webhook só enfileira a identificação (jobId pelo pagamento: RECEIVED e CONFIRMED não viram dois jobs)', async () => {
      const { service, fila } = montar(contaFixture([F2()]));
      await service.enfileirarIdentificacao({ ...aviso, gatewayId: 'qr_abc123' });
      expect(fila.add).toHaveBeenCalledWith('identificar', { ...aviso, gatewayId: 'qr_abc123' }, { jobId: 'identificar-pay_9' });
    });

    it('com o id do QR: acha a intenção pelo id do Pix e manda para a MESMA baixa pela conta, sem perguntar ao gateway', async () => {
      const { service, gateway, fila } = montar(contaFixture([F2()]), [{ id: 'a', gatewayId: 'qr_outro' }, { id: 'b', gatewayId: 'qr_abc123' }]);
      expect(await service.identificarPagamento({ ...aviso, gatewayId: 'qr_abc123' })).toEqual({ resultado: 'baixa_enfileirada', intencaoId: 'b' });
      expect(gateway.pixDoPagamento).not.toHaveBeenCalled();
      expect(fila.add).toHaveBeenCalledTimes(1);
      expect(fila.add).toHaveBeenCalledWith(
        'baixar',
        { intencaoId: 'b', pagamentoId: 'pay_9', valor: 107243, dataPagamento: '2026-11-09', recebidoEm: '2026-11-09T21:22:00.000Z', identificadorPix: 'E182', origem: 'GATEWAY' },
        { jobId: 'baixa-pay_9' }, // idempotente pelo id do pagamento, igual aos outros caminhos
      );
    });

    it('intenção já expirada ou cancelada também é achada: o dinheiro manda', async () => {
      const { service, fila } = montar(contaFixture([F2()]), [{ id: 'velha', situacao: 'EXPIRADA', dia: '2026-11-08', gatewayId: 'qr_abc123' }]);
      expect(await service.identificarPagamento({ ...aviso, gatewayId: 'qr_abc123' })).toMatchObject({ resultado: 'baixa_enfileirada', intencaoId: 'velha' });
      expect(fila.add).toHaveBeenCalledWith('baixar', expect.objectContaining({ intencaoId: 'velha' }), expect.anything());
    });

    it('aviso SEM o id do QR: o worker pergunta ao gateway de qual Pix veio o pagamento', async () => {
      const { service, gateway, fila } = montar(contaFixture([F2()]), [{ id: 'b', gatewayId: 'qr_abc123' }]);
      gateway.pixDoPagamento.mockResolvedValueOnce('qr_abc123');
      expect(await service.identificarPagamento({ ...aviso, gatewayId: null })).toEqual({ resultado: 'baixa_enfileirada', intencaoId: 'b' });
      expect(gateway.pixDoPagamento).toHaveBeenCalledWith('pay_9');
      expect(fila.add).toHaveBeenCalledWith('baixar', expect.objectContaining({ intencaoId: 'b', pagamentoId: 'pay_9' }), expect.anything());
    });

    it('Pix que não é de nenhuma intenção daqui (outro ambiente, Pix avulso na chave): nada é enfileirado nem criado', async () => {
      const { service, fila, intencaoPagamento } = montar(contaFixture([F2()]), [{ id: 'b', gatewayId: 'qr_abc123' }]);
      expect(await service.identificarPagamento({ ...aviso, gatewayId: 'qr_de_outro_ambiente' })).toEqual({ resultado: 'pix_desconhecido' });
      expect(await service.identificarPagamento({ ...aviso, gatewayId: null })).toEqual({ resultado: 'sem_pix_de_origem' }); // o gateway diz que não veio de QR
      expect(fila.add).not.toHaveBeenCalled();
      expect(intencaoPagamento.create).not.toHaveBeenCalled();
      expect(intencaoPagamento.updateMany).not.toHaveBeenCalled();
    });
  });

  it('conferência do operador enfileira só o que o gateway confirma como pago', async () => {
    const { service, gateway, fila } = montar(contaFixture([F2()]), [
      { id: 'a', situacao: 'EXPIRADA', gatewayId: 'pay-a' },
      { id: 'b', situacao: 'ATIVA', gatewayId: 'pay-b' },
      { id: 'c', situacao: 'PAGA', gatewayId: 'pay-c' },
    ]);
    gateway.consultarPix.mockImplementation(async (id: string) => (id === 'pay-a' ? { existe: true, pago: true, valor: 54000, dataPagamento: '2026-11-07', pagamentoId: 'pay-a' } : { existe: true, pago: false, valor: 0, dataPagamento: null, pagamentoId: id }));
    const r = await service.conferirConta('conta-1');
    expect(r).toEqual({ conferidas: 2, enfileiradas: 1, simulado: false });
    expect(fila.add).toHaveBeenCalledTimes(1);
    expect(fila.add).toHaveBeenCalledWith('baixar', expect.objectContaining({ intencaoId: 'a', pagamentoId: 'pay-a', origem: 'CONFERENCIA' }), expect.anything());
  });
});
