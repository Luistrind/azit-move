import { Prisma } from '@prisma/client';
import { AprovacaoService } from './aprovacao.service';

// Central de Aprovações (21/10/2026): "sua vez" calculada por quem olha e o
// pedir complemento (doc 02 §7.9-A — decisão Luís 21/10: sem prazo). Sem banco.

const HOJE = '2026-10-21';
beforeAll(() => { jest.useFakeTimers({ now: new Date(`${HOJE}T15:00:00.000Z`), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });

const USUARIOS: Record<string, string> = { joao: 'João Pedro', luis: 'Luís', vicente: 'Vicente' };

function aprovacao(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ap-1', tipoOperacao: 'acordo', referenciaTipo: 'acordo', referenciaId: 'ac-1', titularId: 't-wallace',
    valor: new Prisma.Decimal('4188.00'), resumo: 'Renegociação de 4 fatura(s)', payload: { excecoes: [] },
    solicitanteId: 'joao', status: 'PENDENTE', createdAt: new Date('2026-10-21T13:05:00.000Z'), updatedAt: new Date(),
    operacao: { nome: 'Acordo de pagamento', aprovacoesNecessarias: 2 },
    solicitante: { nome: 'João Pedro' },
    decisoes: [] as { usuarioId: string; decisao: string; parecer: string | null; createdAt: Date; usuario: { nome: string } }[],
    complementos: [] as unknown[],
    ...over,
  };
}

function montar(registro: ReturnType<typeof aprovacao>, alcadaOk = true) {
  const complementosCriados: Record<string, unknown>[] = [];
  const prisma = {
    db: {
      aprovacao: {
        findMany: jest.fn().mockResolvedValue([registro]),
        findFirst: jest.fn().mockImplementation(() => Promise.resolve({
          ...registro,
          complementos: (registro.complementos as { respondidoEm: Date | null }[]).filter((c) => !c.respondidoEm),
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      aprovacaoDecisao: { create: jest.fn().mockResolvedValue({}) },
      aprovacaoComplemento: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { complementosCriados.push(data); return Promise.resolve({ id: 'cp-1', ...data }); }),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'cp-1', aprovacaoId: 'ap-1', pedidoPorId: 'luis', ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      titular: { findMany: jest.fn().mockResolvedValue([{ id: 't-wallace', nome: 'Wallace G. Teixeira' }]) },
      conta: { findMany: jest.fn().mockResolvedValue([]) },
      tituloPagar: { findMany: jest.fn().mockResolvedValue([]) },
      orcamentoFornecedor: { findMany: jest.fn().mockResolvedValue([]) },
      fornecedorFin: { findMany: jest.fn().mockResolvedValue([]) },
      lotePagamento: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };
  const alcada = { verificar: jest.fn().mockResolvedValue({ aprovado: alcadaOk }) };
  const notificacao = { emitir: jest.fn().mockResolvedValue(undefined) };
  const service = new AprovacaoService(prisma as never, alcada as never, notificacao as never);
  return { service, prisma, notificacao, complementosCriados };
}

describe('AprovacaoService — vez de quem olha (Central, 21/10)', () => {
  it('acordo 1 de 2 aprovado pelo Luís: é a vez do Vicente decidir; faltam 1', async () => {
    const reg = aprovacao({ decisoes: [{ usuarioId: 'luis', decisao: 'APROVADA', parecer: 'Dentro da política.', createdAt: new Date('2026-10-21T14:20:00.000Z'), usuario: { nome: USUARIOS.luis } }] });
    const { service } = montar(reg);
    const [vicente] = await service.pendentes('vicente');
    expect(vicente.minha.vez).toBe('decidir');
    expect(vicente.aprovacoesFaltando).toBe(1);
    expect(vicente.contraparte).toEqual({ tipo: 'titular', id: 't-wallace', nome: 'Wallace G. Teixeira' });
    const [luis] = await service.pendentes('luis');
    expect(luis.minha.vez).toBe('voce_decidiu');
    const [joao] = await service.pendentes('joao');
    expect(joao.minha.vez).toBe('voce_solicitou');
  });

  it('alçada que não cobre o valor: a vez é de recomendar', async () => {
    const { service } = montar(aprovacao(), false);
    const [item] = await service.pendentes('vicente');
    expect(item.minha.vez).toBe('recomendar');
  });

  it('complemento aberto: o solicitante responde, os demais aguardam', async () => {
    const reg = aprovacao({
      complementos: [{
        id: 'cp-1', aprovacaoId: 'ap-1', pergunta: 'O cliente confirmou a data da entrada?', pedidoPorId: 'luis', pedidoPor: { nome: USUARIOS.luis },
        resposta: null, respondidoPorId: null, respondidoPor: null, respondidoEm: null, createdAt: new Date('2026-10-21T14:00:00.000Z'),
      }],
    });
    const { service } = montar(reg);
    const [joao] = await service.pendentes('joao');
    expect(joao.minha.vez).toBe('responder_complemento');
    expect(joao.complementoAberto?.pergunta).toBe('O cliente confirmou a data da entrada?');
    const [vicente] = await service.pendentes('vicente');
    expect(vicente.minha.vez).toBe('aguardando_complemento');
  });
});

describe('AprovacaoService — pedir complemento (doc 02 §7.9-A, decisão Luís 21/10)', () => {
  it('cria a pergunta SEM prazo e alerta o solicitante com link para o dossiê', async () => {
    const { service, complementosCriados, notificacao } = montar(aprovacao());
    const r = await service.pedirComplemento('ap-1', 'luis', 'O cliente confirmou a data da entrada?');
    expect(complementosCriados[0]).toMatchObject({ aprovacaoId: 'ap-1', pedidoPorId: 'luis', pergunta: 'O cliente confirmou a data da entrada?' });
    expect(complementosCriados[0]).not.toHaveProperty('prazo');
    expect(r).toEqual({ id: 'cp-1' });
    expect(notificacao.emitir).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 'joao', rota: '/aprovacoes/ap-1', corpo: 'O cliente confirmou a data da entrada?' }));
  });

  it('segregação: quem solicitou não pede complemento da própria solicitação', async () => {
    const { service } = montar(aprovacao());
    await expect(service.pedirComplemento('ap-1', 'joao', 'Pergunta qualquer')).rejects.toMatchObject({ response: { erro: 'segregacao' } });
  });

  it('com complemento aberto: aprovar é bloqueado, reprovar com parecer segue possível', async () => {
    const reg = aprovacao({ complementos: [{ id: 'cp-1', respondidoEm: null }] });
    const { service, prisma } = montar(reg);
    await expect(service.decidir('ap-1', 'vicente', 'aprovar')).rejects.toMatchObject({ response: { erro: 'aguardando_complemento' } });
    await expect(service.decidir('ap-1', 'vicente', 'reprovar')).rejects.toMatchObject({ response: { erro: 'parecer_obrigatorio' } });
    const r = await service.decidir('ap-1', 'vicente', 'reprovar', 'Cliente não confirmou a entrada.');
    expect(r.status).toBe('reprovada');
    expect(prisma.db.aprovacao.update).toHaveBeenCalledWith({ where: { id: 'ap-1' }, data: { status: 'REPROVADA' } });
  });

  it('só o solicitante responde; a resposta fecha o complemento e avisa quem perguntou', async () => {
    const reg = aprovacao({ complementos: [{ id: 'cp-1', respondidoEm: null }] });
    const { service, prisma, notificacao } = montar(reg);
    await expect(service.responderComplemento('ap-1', 'vicente', 'Sim')).rejects.toMatchObject({ response: { erro: 'nao_solicitante' } });
    await service.responderComplemento('ap-1', 'joao', 'Confirmou: paga na quinta, 23/10.');
    expect(prisma.db.aprovacaoComplemento.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cp-1' }, data: expect.objectContaining({ resposta: 'Confirmou: paga na quinta, 23/10.', respondidoPorId: 'joao' }) }));
    expect(notificacao.emitir).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 'luis', titulo: 'Complemento respondido' }));
  });
});
