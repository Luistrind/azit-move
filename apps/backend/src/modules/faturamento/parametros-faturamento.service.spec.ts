import { Prisma } from '@prisma/client';
import { ParametrosFaturamentoService, PARAMETROS_FATURAMENTO_PADRAO } from './parametros-faturamento.service';

// Configurações › Faturamento (doc 02 §32.8): versionado, com a chave do Pix
// sob demanda DESLIGADA enquanto ninguém salvar nada. Sem banco.

const D = (v: number | string) => new Prisma.Decimal(v);

function montar(linhas: Record<string, unknown>[] = []) {
  const tabela = [...linhas];
  const parametroFaturamento = {
    findFirst: jest.fn().mockImplementation(async () => [...tabela].sort((a, b) => (b.versao as number) - (a.versao as number))[0] ?? null),
    findMany: jest.fn().mockImplementation(async () => [...tabela].sort((a, b) => (b.versao as number) - (a.versao as number))),
    create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const linha = {
        id: `pf-${data.versao as number}`,
        ...data,
        multaPadraoPct: D(data.multaPadraoPct as number),
        atualizacaoMesPadraoPct: D(data.atualizacaoMesPadraoPct as number),
        minimoParcialPct: D(data.minimoParcialPct as number),
        minimoParcialPiso: D(data.minimoParcialPiso as string),
        createdAt: new Date('2026-11-15T12:00:00Z'),
        criadoPor: { nome: 'Luís' },
      };
      tabela.push(linha);
      return linha;
    }),
  };
  const logAuditoria = { create: jest.fn().mockResolvedValue({}) };
  const fatura = { count: jest.fn().mockResolvedValue(0) };
  const prisma = { db: { parametroFaturamento, logAuditoria, fatura } };
  return { service: new ParametrosFaturamentoService(prisma as never), parametroFaturamento, logAuditoria };
}

describe('ParametrosFaturamentoService', () => {
  it('sem nada salvo valem os padrões provisórios, com o Pix sob demanda DESLIGADO', async () => {
    const { service } = montar();
    const p = await service.vigente();
    expect(p).toEqual(PARAMETROS_FATURAMENTO_PADRAO);
    expect(p.pixSobDemanda).toBe(false);
    expect(p).toMatchObject({ versao: 0, minimoParcialPct: 35, minimoParcialPiso: 20000, tetoIntencoesDia: 10, cascata: ['ENCARGOS', 'PROTECAO', 'ACESSORIOS', 'PRINCIPAL'] });
    expect(await service.pixSobDemandaLigado()).toBe(false);
  });

  it('salvar cria uma VERSÃO nova (não edita a anterior) e audita a virada da chave', async () => {
    const { service, parametroFaturamento, logAuditoria } = montar();
    const r1 = await service.salvar({ pixSobDemanda: true, motivo: 'Homologação da F2' }, 'u-luis');
    expect(parametroFaturamento.create).toHaveBeenCalledWith({ data: expect.objectContaining({ versao: 1, pixSobDemanda: true, minimoParcialPiso: '200.00', criadoPorId: 'u-luis', motivo: 'Homologação da F2' }) });
    expect(r1.vigente).toMatchObject({ versao: 1, pixSobDemanda: true });
    expect(logAuditoria.create).toHaveBeenCalledWith({ data: expect.objectContaining({ acao: 'pix_sob_demanda_ligado', entidade: 'parametro_faturamento' }) });

    const r2 = await service.salvar({ minimoParcialPct: 40, minimoParcialPiso: 25000 }, 'u-luis');
    expect(r2.vigente).toMatchObject({ versao: 2, pixSobDemanda: true, minimoParcialPct: 40, minimoParcialPiso: 25000 });
    expect(r2.historico.map((h) => h.versao)).toEqual([2, 1]);
    expect(logAuditoria.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ acao: 'parametros_faturamento_alterados' }) });
  });

  it('recusa cascata incompleta, percentual fora da faixa e salvar sem mudar nada', async () => {
    const { service, parametroFaturamento } = montar();
    await expect(service.salvar({ cascata: ['ENCARGOS', 'PRINCIPAL'] }, 'u')).rejects.toMatchObject({ response: { erro: 'validacao' } });
    await expect(service.salvar({ minimoParcialPct: 140 }, 'u')).rejects.toMatchObject({ response: { erro: 'validacao' } });
    await expect(service.salvar({ tetoIntencoesDia: 0 }, 'u')).rejects.toMatchObject({ response: { erro: 'validacao' } });
    await expect(service.salvar({ pixSobDemanda: false }, 'u')).rejects.toMatchObject({ response: { erro: 'sem_alteracao' } });
    expect(parametroFaturamento.create).not.toHaveBeenCalled();
  });

  it('a ordem da cascata é parâmetro: outra ordem vale para o motor', async () => {
    const { service } = montar();
    await service.salvar({ cascata: ['PROTECAO', 'ENCARGOS', 'ACESSORIOS', 'PRINCIPAL'] }, 'u');
    expect((await service.doMotor()).cascata).toEqual(['PROTECAO', 'ENCARGOS', 'ACESSORIOS', 'PRINCIPAL']);
  });
});
