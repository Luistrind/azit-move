import { AssinaturaService } from './assinatura.service';

// Assinatura digital ZapSign (doc 02 §21) — cancelamento do documento quando o
// contrato não efetivado é cancelado (caso Tatiana, 27/10/2026: o link antigo
// seguia assinável) e carimbo do pacote só nos contratos vivos. Sem banco,
// sem ZapSign real.

function documento(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'doc-1', contratoCreditoId: 'c-old', provedor: 'zapsign', docToken: 'tok-123', status: 'enviado', simulado: false,
    enviadoEm: new Date('2026-10-27T12:00:00.000Z'), concluidoEm: null, motivoRecusa: null, pdfAssinadoRef: null,
    signatarios: [
      { papel: 'titular', nome: 'Tatiana Helmer da Costa', signerToken: 's1', signUrl: 'u1' },
      { papel: 'azit', nome: 'João Pedro', signerToken: 's2', signUrl: 'u2' },
    ],
    ...over,
  };
}

function montar(doc: ReturnType<typeof documento> | null) {
  const prisma = {
    db: {
      documentoAssinatura: {
        findFirst: jest.fn().mockResolvedValue(doc),
        update: jest.fn().mockResolvedValue({}),
      },
      contratoCredito: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      logAuditoria: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  const zapSign = { configurado: true, cancelarDocumento: jest.fn().mockResolvedValue(undefined), detalharDocumento: jest.fn(), baixarArquivo: jest.fn() };
  const notificacao = { emitir: jest.fn().mockResolvedValue(undefined) };
  const contrato = { registrarAoCancelar: jest.fn() };
  const service = new AssinaturaService(prisma as never, zapSign as never, notificacao as never, contrato as never);
  return { service, prisma, zapSign, notificacao, contrato };
}

describe('AssinaturaService — cancelar o documento ao cancelar o contrato (27/10)', () => {
  it('registra o hook no ContratoService ao iniciar o módulo', () => {
    const { service, contrato } = montar(null);
    service.onModuleInit();
    expect(contrato.registrarAoCancelar).toHaveBeenCalledTimes(1);
    expect(typeof contrato.registrarAoCancelar.mock.calls[0][0]).toBe('function');
  });

  it('documento enviado: cancela na ZapSign, marca cancelado com o motivo e audita', async () => {
    const { service, prisma, zapSign } = montar(documento());
    const r = await service.cancelarDocumentoDoContrato('c-old', 'Contrato cancelado: trocar datas', 'u-luis');

    expect(r).toBe(true);
    expect(zapSign.cancelarDocumento).toHaveBeenCalledWith('tok-123');
    expect(prisma.db.documentoAssinatura.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { status: 'cancelado', motivoRecusa: 'Contrato cancelado: trocar datas' },
    });
    expect(prisma.db.logAuditoria.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ usuarioId: 'u-luis', acao: 'assinatura_digital_cancelada', entidade: 'contrato_credito', entidadeId: 'c-old', antes: { docToken: 'tok-123', status: 'enviado' } }),
    });
  });

  it('ZapSign falha → warn e o espelho local é cancelado mesmo assim', async () => {
    const { service, prisma, zapSign } = montar(documento({ status: 'parcialmente_assinado' }));
    zapSign.cancelarDocumento.mockRejectedValue(new Error('ZapSign respondeu HTTP 500 ao cancelar'));

    const r = await service.cancelarDocumentoDoContrato('c-old', 'Expirado', undefined);

    expect(r).toBe(true);
    expect(prisma.db.documentoAssinatura.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'cancelado', motivoRecusa: 'Expirado' } }));
    expect(prisma.db.logAuditoria.create).toHaveBeenCalledTimes(1);
  });

  it('documento simulado (sem token na ZapSign) só cancela localmente', async () => {
    const { service, prisma, zapSign } = montar(documento({ simulado: true, docToken: 'sim-1' }));
    await service.cancelarDocumentoDoContrato('c-old', 'x');
    expect(zapSign.cancelarDocumento).not.toHaveBeenCalled();
    expect(prisma.db.documentoAssinatura.update).toHaveBeenCalledTimes(1);
  });

  it.each(['assinado', 'cancelado', 'recusado'])('documento %s fica como está (histórico não se apaga)', async (status) => {
    const { service, prisma, zapSign } = montar(documento({ status }));
    const r = await service.cancelarDocumentoDoContrato('c-old', 'x');
    expect(r).toBe(false);
    expect(zapSign.cancelarDocumento).not.toHaveBeenCalled();
    expect(prisma.db.documentoAssinatura.update).not.toHaveBeenCalled();
  });

  it('contrato sem documento: nada a fazer', async () => {
    const { service, zapSign } = montar(null);
    expect(await service.cancelarDocumentoDoContrato('c-sem-doc', 'x')).toBe(false);
    expect(zapSign.cancelarDocumento).not.toHaveBeenCalled();
  });

  it('reenviar usa o mesmo núcleo: cancela na ZapSign e marca substituído antes de enviar de novo', async () => {
    const { service, prisma, zapSign } = montar(documento());
    const enviar = jest.spyOn(service, 'enviar').mockResolvedValue({ existe: true } as never);
    await service.reenviar('c-old', 'u-luis');
    expect(zapSign.cancelarDocumento).toHaveBeenCalledWith('tok-123');
    expect(prisma.db.documentoAssinatura.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'cancelado', motivoRecusa: 'Substituído por reenvio (instrumento alterado antes da assinatura)' },
    }));
    expect(enviar).toHaveBeenCalledWith('c-old', 'u-luis');
  });
});

describe('AssinaturaService.processarEvento — carimbo do pacote ignora contrato encerrado (27/10)', () => {
  it('doc_signed pelo titular carimba só os contratos vivos do pacote da proposta', async () => {
    const doc = documento({ contrato: { id: 'c-new', numero: '2026100006', propostaPacoteId: 'prop-1' }, contratoCreditoId: 'c-new' });
    const { service, prisma } = montar(doc);

    await service.processarEvento({ event_type: 'doc_signed', token: 'tok-123', signer_who_signed: { token: 's1' } });

    expect(prisma.db.contratoCredito.updateMany).toHaveBeenCalledWith({
      where: { propostaPacoteId: 'prop-1', status: { not: 'ENCERRADO' } },
      data: { assinaturaTitularEm: expect.any(Date) },
    });
  });
});
