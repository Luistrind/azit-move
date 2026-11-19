import { OcorrenciaService } from './ocorrencia.service';

// Reabrir ocorrência (doc 02 §25.7): a que virou item de fatura não reabre; a
// que a Azit tinha assumido volta desfazendo o custo lançado no veículo.

function montar(o: { status: string; lancamentoCustoId?: string | null }) {
  const db = {
    ocorrenciaVeiculo: {
      findFirst: jest.fn(async () => ({ id: 'oc1', ativoId: 'a1', ativo: { id: 'a1', placa: 'ABC1D23' }, contrato: null, lancamentoCustoId: null, ...o })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'oc1', status: data.status })),
    },
    lancamentoCustoAtivo: { update: jest.fn(async (_args: unknown) => ({})) },
    logAuditoria: { create: jest.fn(async (_args: { data: Record<string, unknown> }) => ({})) },
  };
  const svc = new OcorrenciaService({ db } as never, { emitir: jest.fn() } as never);
  return { svc, db };
}

describe('OcorrenciaService.reabrir', () => {
  it('assumida pela Azit: desfaz o custo do veículo e desliga o vínculo', async () => {
    const { svc, db } = montar({ status: 'ASSUMIDA_AZIT', lancamentoCustoId: 'lc1' });
    await svc.reabrir('oc1', 'assumida por engano', 'u1');
    expect(db.lancamentoCustoAtivo.update).toHaveBeenCalledWith({ where: { id: 'lc1' }, data: { deletedAt: expect.any(Date) } });
    const dados = db.ocorrenciaVeiculo.update.mock.calls[0][0].data;
    expect(dados).toMatchObject({ status: 'REGISTRADA', lancamentoCusto: { disconnect: true } });
    expect(db.logAuditoria.create.mock.calls[0][0].data).toMatchObject({ acao: 'ocorrencia_reaberta', depois: { custoDesfeito: 'lc1' } });
  });

  it('cancelada: reabre sem mexer em custo', async () => {
    const { svc, db } = montar({ status: 'CANCELADA' });
    await svc.reabrir('oc1', '', 'u1');
    expect(db.lancamentoCustoAtivo.update).not.toHaveBeenCalled();
    expect(db.ocorrenciaVeiculo.update.mock.calls[0][0].data).not.toHaveProperty('lancamentoCusto');
  });

  it('repassada (já é item de fatura) não reabre', async () => {
    const { svc } = montar({ status: 'REPASSADA' });
    await expect(svc.reabrir('oc1', '', 'u1')).rejects.toMatchObject({ response: { erro: 'ja_repassada' } });
  });
});
