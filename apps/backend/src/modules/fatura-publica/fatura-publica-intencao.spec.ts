import { ExecutionContext } from '@nestjs/common';
import { FaturaPublicaService } from './fatura-publica.service';
import { LimitePublicoGuard } from './limite-publico.guard';

// Rota pública POST /publico/faturas/:token/intencao (doc 02 §32.4-A): só
// fatura do modelo AZIT gera Pix sob demanda; o valor é validado no servidor
// (IntencaoPagamentoService) e a rota fica atrás do limite de requisições.

const TOKEN = 'a'.repeat(64);

function montarServico(fatura: Record<string, unknown> | null) {
  const prisma = { db: { fatura: { findFirst: jest.fn().mockResolvedValue(fatura) } } };
  const intencao = {
    criar: jest.fn().mockResolvedValue({
      id: 'int_1', valor: 107243, validoAte: new Date('2026-11-10T02:59:59.999Z'), pixCopiaECola: 'CODIGO', pixQrCodeImagem: null, simulado: false, outroValor: false,
      faturas: [{ faturaId: 'f2', numero: 22, vencimento: '2026-11-02', valor: 107243 }], reaproveitada: false,
    }),
  };
  const config = { get: (k: string) => (k === 'atendimentoWhatsapp' ? '(27) 99288-5193' : undefined) };
  const servico = new FaturaPublicaService(prisma as never, {} as never, config as never, {} as never, intencao as never);
  return { servico, intencao, prisma };
}

describe('FaturaPublicaService.criarIntencao', () => {
  it('fatura AZIT: pede o Pix da CONTA da fatura, com origem página pública, e não devolve id interno nem id de fatura', async () => {
    const { servico, intencao } = montarServico({ id: 'f2', contaId: 'conta-1', status: 'FECHADA', modeloEncargo: 'AZIT' });
    const r = await servico.criarIntencao(TOKEN, 107243);
    expect(intencao.criar).toHaveBeenCalledWith({ contaId: 'conta-1', valor: 107243, origem: 'PAGINA_PUBLICA' });
    expect(r).toEqual({
      valor: 107243, copiaECola: 'CODIGO', qrCodeImagem: null, validoAte: '2026-11-10T02:59:59.999Z', simulado: false, outroValor: false,
      faturas: [{ numero: 22, vencimento: '2026-11-02', valor: 107243 }],
    });
  });

  it('fatura do modelo antigo (cobrança no Asaas) não gera Pix sob demanda', async () => {
    const { servico, intencao } = montarServico({ id: 'f1', contaId: 'conta-1', status: 'FECHADA', modeloEncargo: 'ASAAS_NATIVO' });
    await expect(servico.criarIntencao(TOKEN, 104900)).rejects.toMatchObject({ response: { erro: 'modelo_antigo' }, status: 422 });
    expect(intencao.criar).not.toHaveBeenCalled();
  });

  it('link inválido, inexistente ou de fatura extinta: 404 sem revelar nada da conta, só o WhatsApp da Azit', async () => {
    const semFatura = montarServico(null);
    await expect(semFatura.servico.criarIntencao(TOKEN, 100)).rejects.toMatchObject({
      status: 404,
      response: { erro: 'fatura_indisponivel', atendimentoWhatsapp: '(27) 99288-5193', atendimentoWhatsappLink: '5527992885193' },
    });
    await expect(semFatura.servico.criarIntencao('token-curto', 100)).rejects.toMatchObject({ status: 404 });
    expect(semFatura.prisma.db.fatura.findFirst).toHaveBeenCalledTimes(1); // token malformado nem consulta o banco
    const novada = montarServico({ id: 'f9', contaId: 'conta-1', status: 'NOVADA', modeloEncargo: 'AZIT' });
    await expect(novada.servico.criarIntencao(TOKEN, 100)).rejects.toMatchObject({ status: 404 });
    expect(novada.intencao.criar).not.toHaveBeenCalled();
  });
});

describe('LimitePublicoGuard — gerar Pix tem limite próprio por token', () => {
  const ctx = (url: string, ip = '10.0.0.1') =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers: {}, ip, url, params: { token: TOKEN } }) }) }) as unknown as ExecutionContext;

  it('12 pedidos de Pix por minuto no mesmo link; o 13º recebe 429, e a leitura da página segue liberada', () => {
    const guard = new LimitePublicoGuard();
    for (let i = 0; i < 12; i++) expect(guard.canActivate(ctx(`/api/v1/publico/faturas/${TOKEN}/intencao`))).toBe(true);
    expect(() => guard.canActivate(ctx(`/api/v1/publico/faturas/${TOKEN}/intencao`))).toThrow(expect.objectContaining({ status: 429 }));
    expect(guard.canActivate(ctx(`/api/v1/publico/faturas/${TOKEN}`))).toBe(true);
  });

  it('o PDF com ?fatura=<nº> continua contado como PDF', () => {
    const guard = new LimitePublicoGuard();
    for (let i = 0; i < 10; i++) expect(guard.canActivate(ctx(`/api/v1/publico/faturas/${TOKEN}/pdf?fatura=3`, '10.0.0.2'))).toBe(true);
    expect(() => guard.canActivate(ctx(`/api/v1/publico/faturas/${TOKEN}/pdf?fatura=3`, '10.0.0.2'))).toThrow(expect.objectContaining({ status: 429 }));
  });
});
