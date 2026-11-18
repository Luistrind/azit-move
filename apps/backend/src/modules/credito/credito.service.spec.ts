import { Prisma } from '@prisma/client';
import { CreditoService } from './credito.service';

// Reembolso Parcelado vale pelo "de acordo" do cliente (doc 02 §18.7, 18/11):
// sem contrato nem assinatura. Sem banco — o que se confere é o caminho.

const dec = (v: number) => new Prisma.Decimal(v);

function montar(p: { contrato?: Record<string, unknown> | null; aprovacaoRp?: { payload: unknown } | null; titulos?: number } = {}) {
  const db = {
    titular: { findFirst: jest.fn().mockResolvedValue({ id: 't1', nome: 'Marcos Almeida' }) },
    conta: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
    fornecedorFin: { findFirst: jest.fn().mockResolvedValue({ id: 'f1', nome: 'Oficina Central' }) },
    contratoCredito: {
      findFirst: jest.fn().mockResolvedValue(p.contrato === undefined ? null : p.contrato),
      update: jest.fn().mockResolvedValue({}),
    },
    aprovacao: { findFirst: jest.fn().mockResolvedValue(p.aprovacaoRp === undefined ? { payload: { valorPrincipal: 100000, fornecedorId: 'f1' } } : p.aprovacaoRp) },
    tituloPagar: { count: jest.fn().mockResolvedValue(p.titulos ?? 0) },
  };
  const contrato = {
    criar: jest.fn().mockResolvedValue({ id: 'ct1', numero: '2026110020' }),
    alinharAoCicloDaConta: jest.fn().mockResolvedValue(undefined),
    ativarComCronograma: jest.fn().mockResolvedValue(undefined),
  };
  const aprovacao = { criar: jest.fn().mockResolvedValue({}), registrarEfetivador: jest.fn() };
  const contasPagar = { criarDesembolsoReembolso: jest.fn().mockResolvedValue({}) };
  const assinatura = { registrarPosAssinatura: jest.fn(), enviar: jest.fn(), cancelarDocumentoDoContrato: jest.fn().mockResolvedValue(true) };
  const notificacao = { emitir: jest.fn().mockResolvedValue(undefined) };
  const service = new CreditoService(
    { db } as never,
    contrato as never,
    aprovacao as never,
    { criarCobranca: jest.fn() } as never,
    {} as never,
    {} as never,
    contasPagar as never,
    assinatura as never,
    notificacao as never,
  );
  // Precificação e periodicidade têm testes próprios no catálogo; aqui o produto já vem resolvido.
  const interno = service as unknown as Record<string, jest.Mock>;
  jest.spyOn(interno, 'precificar').mockResolvedValue({ produto: 'reembolso_parcelado', limiteParcela: null, valorParcela: 11500, totalAPagar: 138000 } as never);
  jest.spyOn(interno, 'periodicidadeHerdada').mockResolvedValue('semanal' as never);
  return { service, db, contrato, aprovacao, contasPagar, assinatura };
}

const pedido = { descricao: 'Reembolso Parcelado — troca de embreagem', valor: 100000, numeroParcelas: 12, valorEntrada: 0, periodicidade: 'mensal' as const, fornecedorId: 'f1' };
const rpAprovado = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'ct1', numero: '2026110020', status, ativoId: null, valorEntrada: dec(0), valorTotal: dec(1380), snapshotJson: null,
  conta: { titular: { id: 't1', nome: 'Marcos Almeida' } }, ...extra,
});

describe('Reembolso Parcelado — vale pelo "de acordo" do cliente (doc 02 §18.7)', () => {
  describe('contratar', () => {
    it('sem o "de acordo" do cliente não vai para aprovação', async () => {
      const { service, contrato, aprovacao } = montar();
      await expect(service.originar('t1', { ...pedido }, 'u1')).rejects.toMatchObject({ response: { erro: 'sem_aceite_cliente' } });
      expect(contrato.criar).not.toHaveBeenCalled();
      expect(aprovacao.criar).not.toHaveBeenCalled();
    });

    it('com o "de acordo": grava a mensagem, a resposta e quem registrou no contrato, e pede a aprovação', async () => {
      const { service, db, aprovacao } = montar();
      const r = await service.originar('t1', { ...pedido, aceiteWhatsapp: true, mensagemWhatsapp: 'Olá, Marcos! …', respostaCliente: 'De acordo', observacao: 'Cliente antigo' }, 'u1');
      expect(r.status).toBe('aguardando_aprovacao');
      const gravado = db.contratoCredito.update.mock.calls[0][0].data;
      expect(gravado.solicitadoPor).toBe('u1');
      expect(gravado.snapshotJson.aceiteWhatsapp).toMatchObject({ confirmadoPor: 'u1', mensagemEnviada: 'Olá, Marcos! …', respostaCliente: 'De acordo' });
      expect(typeof gravado.snapshotJson.aceiteWhatsapp.confirmadoPeloOperadorEm).toBe('string');
      expect(aprovacao.criar.mock.calls[0][0]).toMatchObject({ tipoOperacao: 'reembolso_parcelado', payload: { valorPrincipal: 100000, fornecedorId: 'f1', observacao: 'Cliente antigo' } });
    });
  });

  describe('aprovação', () => {
    it('aprovado: ativa na hora — cronograma nas faturas e título ao fornecedor, sem passar por assinatura', async () => {
      const { service, db, contrato, contasPagar, assinatura } = montar({ contrato: rpAprovado('RASCUNHO') });
      const msg = await service.efetivar('ct1', 'aprovador');
      expect(contrato.alinharAoCicloDaConta).toHaveBeenCalledWith('ct1');
      expect(contrato.ativarComCronograma).toHaveBeenCalledWith('ct1');
      expect(contasPagar.criarDesembolsoReembolso.mock.calls[0][0]).toMatchObject({ id: 'ct1', valorCentavos: 100000, fornecedorId: 'f1', clienteNome: 'Marcos Almeida' });
      expect(assinatura.enviar).not.toHaveBeenCalled();
      const status = db.contratoCredito.update.mock.calls.map((c) => c[0].data.status);
      expect(status).not.toContain('AGUARDANDO_ASSINATURA');
      expect(msg).toContain('aprovado e ativado');
    });

    it('o título ao fornecedor nasce uma vez só', async () => {
      const { service, contasPagar } = montar({ contrato: rpAprovado('RASCUNHO'), titulos: 1 });
      await service.efetivar('ct1', 'aprovador');
      expect(contasPagar.criarDesembolsoReembolso).not.toHaveBeenCalled();
    });
  });

  describe('reembolso aprovado antes de 18/11, parado em "aguardando assinatura"', () => {
    it('registrar o "de acordo" cancela o termo em aberto, guarda o aceite sem apagar o termo antigo e ativa', async () => {
      const { service, db, contrato, contasPagar, assinatura } = montar({ contrato: rpAprovado('AGUARDANDO_ASSINATURA', { snapshotJson: { documento: 'TERMO ANTIGO' } }) });
      const r = await service.registrarDeAcordo('ct1', { aceiteWhatsapp: true, respostaCliente: 'de acordo' }, 'u2');
      expect(assinatura.cancelarDocumentoDoContrato).toHaveBeenCalledWith('ct1', expect.stringContaining('de acordo'), 'u2');
      const snap = db.contratoCredito.update.mock.calls[0][0].data.snapshotJson;
      expect(snap.documento).toBe('TERMO ANTIGO');
      expect(snap.aceiteWhatsapp).toMatchObject({ confirmadoPor: 'u2', respostaCliente: 'de acordo' });
      expect(contrato.ativarComCronograma).toHaveBeenCalledWith('ct1');
      expect(contasPagar.criarDesembolsoReembolso).toHaveBeenCalledTimes(1);
      expect(r).toEqual({ contratoId: 'ct1', numero: '2026110020', status: 'ativo' });
    });

    it('recusa sem a confirmação, em outro estado e em contrato que não é reembolso', async () => {
      const semFlag = montar({ contrato: rpAprovado('AGUARDANDO_ASSINATURA') });
      await expect(semFlag.service.registrarDeAcordo('ct1', { aceiteWhatsapp: false }, 'u2')).rejects.toMatchObject({ response: { erro: 'sem_aceite_cliente' } });
      const ativo = montar({ contrato: rpAprovado('ATIVO') });
      await expect(ativo.service.registrarDeAcordo('ct1', { aceiteWhatsapp: true }, 'u2')).rejects.toMatchObject({ response: { erro: 'estado_invalido' } });
      const veiculo = montar({ contrato: rpAprovado('AGUARDANDO_ASSINATURA'), aprovacaoRp: null });
      await expect(veiculo.service.registrarDeAcordo('ct1', { aceiteWhatsapp: true }, 'u2')).rejects.toMatchObject({ response: { erro: 'estado_invalido' } });
      expect(veiculo.contrato.ativarComCronograma).not.toHaveBeenCalled();
    });
  });
});
