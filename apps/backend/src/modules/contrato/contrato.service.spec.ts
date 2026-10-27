import { ContratoService } from './contrato.service';

// Cancelamento de contrato NÃO efetivado (doc 02 §21.1) — caso Tatiana, 27/10/2026:
// o contrato 2026100005 (aguardando assinatura, instrumento na ZapSign) foi
// cancelado para trocar as datas e reformalizado como 2026100006. O cancelamento
// precisa avisar quem registrou hook (assinatura digital → cancela na ZapSign) e
// nunca pode travar por falha desse hook. Sem banco.

const contrato = { id: 'c-old', numero: '2026100005', status: 'AGUARDANDO_ASSINATURA', ativoId: 'ativo-1', propostaPacoteId: 'prop-1', contaId: 'conta-1' };

function montar() {
  const tx = {
    contratoCredito: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    ativo: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    documentoAssinatura: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    proposta: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    logAuditoria: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    db: {
      contratoCredito: {
        findFirst: jest.fn().mockResolvedValue(contrato),
        findMany: jest.fn().mockResolvedValue([{ id: 'c-old', ativoId: 'ativo-1' }]),
      },
      $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    },
  };
  const service = new ContratoService(prisma as never);
  return { service, prisma, tx };
}

describe('ContratoService.cancelarNaoEfetivado — hooks de cancelamento (27/10)', () => {
  it('chama o hook registrado para cada contrato do pacote, com motivo e usuário, antes de encerrar', async () => {
    const { service, tx } = montar();
    const ordem: string[] = [];
    const hook = jest.fn().mockImplementation(async () => { ordem.push('hook'); });
    tx.contratoCredito.updateMany.mockImplementation(async () => { ordem.push('encerra'); return { count: 1 }; });
    service.registrarAoCancelar(hook);

    const r = await service.cancelarNaoEfetivado('c-old', 'Trocar datas de entrada e 1ª parcela', 'u-luis');

    expect(r).toEqual({ resultado: 'cancelado', numero: '2026100005', contratosCancelados: 1 });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith('c-old', 'Trocar datas de entrada e 1ª parcela', 'u-luis');
    expect(ordem).toEqual(['hook', 'encerra']);
    expect(tx.contratoCredito.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c-old'] } },
      data: expect.objectContaining({ status: 'ENCERRADO', motivoEncerramento: 'CANCELAMENTO' }),
    });
    // Rede de segurança local continua: documento vivo que sobrar vira cancelado.
    expect(tx.documentoAssinatura.updateMany).toHaveBeenCalledWith({
      where: { contratoCreditoId: { in: ['c-old'] }, status: { in: ['enviado', 'parcialmente_assinado'] } },
      data: { status: 'cancelado' },
    });
    // Proposta volta a ser reformalizável.
    expect(tx.proposta.updateMany).toHaveBeenCalledWith({
      where: { contratoGeradoId: 'c-old' },
      data: { contratoGeradoId: null, status: 'EM_FORMALIZACAO' },
    });
  });

  it('falha do hook (ZapSign fora do ar) NÃO impede o cancelamento', async () => {
    const { service, tx } = montar();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    service.registrarAoCancelar(async () => { throw new Error('ZapSign respondeu HTTP 500'); });

    const r = await service.cancelarNaoEfetivado('c-old', 'Trocar datas', 'u-luis');

    expect(r.resultado).toBe('cancelado');
    expect(tx.contratoCredito.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.ativo.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['ativo-1'] }, status: 'EM_CONTRATO' }, data: { status: 'DISPONIVEL' } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ZapSign respondeu HTTP 500'));
    warn.mockRestore();
  });

  it('cancelamento dedicado (novação) tem precedência e os hooks genéricos não rodam', async () => {
    const { service, tx } = montar();
    const hook = jest.fn().mockResolvedValue(undefined);
    service.registrarAoCancelar(hook);
    service.registrarCancelamentoDedicado(async () => true);

    const r = await service.cancelarNaoEfetivado('c-old', 'Reprovada');

    expect(r).toEqual({ resultado: 'cancelado', numero: '2026100005' });
    expect(hook).not.toHaveBeenCalled();
    expect(tx.contratoCredito.updateMany).not.toHaveBeenCalled();
  });

  it('contrato ATIVO não pode ser cancelado por esta rotina', async () => {
    const { service, prisma } = montar();
    prisma.db.contratoCredito.findFirst.mockResolvedValue({ ...contrato, status: 'ATIVO' });
    await expect(service.cancelarNaoEfetivado('c-old', 'x')).rejects.toMatchObject({ response: { erro: 'estado_invalido' } });
  });
});
