import { dataHojeBrasil, somarDiasISO } from '@azit/utils';
import { ConferenciaAsaasService } from './conferencia-asaas.service';
import {
  ACAO_LOG_CONFERENCIA,
  ConferenciaAsaasAutomaticaService,
  ENTIDADE_LOG_CONFERENCIA,
  HORARIO_CONFERENCIA_ASAAS_AUTOMATICA,
  ROTA_CONFERENCIA,
  type RodadaConferenciaAsaas,
} from './conferencia-asaas-automatica.service';

// Conferência AUTOMÁTICA diária (doc 02 §27.9.1, 18/11/2026 — incidente da v1.9.0,
// casos Leonardo/fatura 191 e Pedro Jose/fatura 49). Sem banco, sem Redis, sem
// Asaas: Prisma, leitura e filas são dublês; a ConferenciaAsaasService é a REAL
// (a rodada reaproveita conferir + reconciliar, não tem caminho próprio).
// Garante: (1) o cron só enfileira, com chave do dia; (2) o alcance cobre vencida,
// vence hoje e a vencer, e deixa de fora o Pix sob demanda; (3) só o que está
// pago no Asaas vai ao `conciliar`; o resto só é listado; (4) rodar duas vezes no
// dia não enfileira duas conciliações; (5) a rodada é registrada e avisa.

const decimal = (s: string) => ({ toString: () => s });
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const hoje = dataHojeBrasil();
const ontem = somarDiasISO(hoje, -1);
const amanha = somarDiasISO(hoje, 7);

function fatura(id: string, numero: number, vencimento: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    numero,
    contaId: `conta_${id}`,
    status: 'FECHADA',
    dataVencimento: dia(vencimento),
    valorTotal: decimal('997.00'),
    valorPago: null,
    asaasChargeId: `pay_${id}`,
    conta: { titularId: `tit_${id}`, titular: { nome: `Cliente ${numero}` } },
    ...extra,
  };
}

const cobranca = (id: string, vencimento: string, status: string, extra: Record<string, unknown> = {}) => ({
  id: `pay_${id}`,
  status,
  dueDate: vencimento,
  value: 997,
  deleted: false,
  ...(status === 'RECEIVED' ? { clientPaymentDate: ontem, paymentDate: ontem } : {}),
  ...extra,
});

// Fila que se comporta como o BullMQ quanto ao jobId: o repetido é ignorado.
function filaComJobId() {
  const ids = new Set<string>();
  const jobs: { nome: string; dados: unknown; opts?: { jobId?: string } }[] = [];
  const add = jest.fn(async (nome: string, dados: unknown, opts?: { jobId?: string }) => {
    if (opts?.jobId && ids.has(opts.jobId)) return undefined;
    if (opts?.jobId) ids.add(opts.jobId);
    jobs.push({ nome, dados, opts });
    return undefined;
  });
  return { add, jobs };
}

function montar(opts: { faturas: ReturnType<typeof fatura>[]; cobrancas: Record<string, unknown>; ambiente?: 'simulado' | 'sandbox' | 'producao'; logs?: unknown[] }) {
  const faturas = opts.faturas;
  const logs: { depois: unknown; createdAt: Date }[] = (opts.logs ?? []).map((d, i) => ({ depois: d, createdAt: new Date(2026, 0, 1 + i) }));
  const prisma = {
    db: {
      fatura: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: jest.fn(async (args: any) => {
          if (args?.where?.id?.in) return faturas.filter((f) => args.where.id.in.includes(f.id)).map((f) => ({ id: f.id, status: f.status }));
          return faturas;
        }),
        findFirst: jest.fn(async (args: { where: { id: string } }) => faturas.find((f) => f.id === args.where.id) ?? null),
      },
      logAuditoria: {
        create: jest.fn(async ({ data }: { data: { depois: unknown } }) => {
          logs.push({ depois: data.depois, createdAt: new Date() });
          return data;
        }),
        findFirst: jest.fn(async () => (logs.length ? logs[logs.length - 1] : null)),
        findMany: jest.fn(async ({ take }: { take: number }) => [...logs].reverse().slice(0, take)),
      },
    },
  };
  const lerCobranca = jest.fn(async (id: string) => {
    if (!(id in opts.cobrancas)) throw new Error(`Asaas GET /payments/${id} retornou 500: indisponível`);
    return opts.cobrancas[id];
  });
  const leitura = { ambiente: opts.ambiente ?? 'producao', lerCobranca };
  const filaRecebido = filaComJobId();
  const filaConferencia = filaComJobId();
  const notificacao = { emitir: jest.fn(async () => undefined) };
  const conferencia = new ConferenciaAsaasService(prisma as never, leitura as never, filaRecebido as never);
  const service = new ConferenciaAsaasAutomaticaService(prisma as never, conferencia, notificacao as never, filaConferencia as never);
  return { service, conferencia, prisma, lerCobranca, filaRecebido, filaConferencia, notificacao, logs };
}

describe('Conferência automática — agendamento', () => {
  it('o cron SÓ enfileira, com chave do dia (fuso Brasil); não lê o Asaas nem o banco', async () => {
    const m = montar({ faturas: [fatura('a', 1, ontem)], cobrancas: {} });
    await m.service.cronConferencia();
    expect(m.filaConferencia.add).toHaveBeenCalledTimes(1);
    expect(m.filaConferencia.add).toHaveBeenCalledWith('rodar', { origem: 'agendada' }, expect.objectContaining({ jobId: `conferencia-asaas-${hoje}` }));
    expect(m.lerCobranca).not.toHaveBeenCalled();
    expect(m.prisma.db.fatura.findMany).not.toHaveBeenCalled();
    expect(m.filaRecebido.add).not.toHaveBeenCalled();
  });

  it('dois disparos no mesmo dia (réplicas) viram um job só', async () => {
    const m = montar({ faturas: [], cobrancas: {} });
    await m.service.cronConferencia();
    await m.service.cronConferencia();
    expect(m.filaConferencia.jobs).toHaveLength(1);
  });

  it('horário provisório: 3h30, antes da régua das 4h', () => {
    expect(HORARIO_CONFERENCIA_ASAAS_AUTOMATICA).toEqual({ hora: 3, minuto: 30 });
  });

  it('"Rodar agora" enfileira a mesma rodada, marcada como manual e com quem pediu', async () => {
    const m = montar({ faturas: [], cobrancas: {} });
    const r = await m.service.rodarAgora('usr_1');
    expect(r.enfileirado).toBe(true);
    expect(m.filaConferencia.add).toHaveBeenCalledWith('rodar', { origem: 'manual', usuarioId: 'usr_1' }, expect.objectContaining({ jobId: expect.stringMatching(new RegExp(`^conferencia-asaas-${hoje}-manual-`)) }));
  });
});

describe('Conferência automática — alcance', () => {
  it('lê toda fatura em aberto com cobrança, sem limite de vencimento, e deixa de fora o Pix sob demanda (AZIT)', async () => {
    const m = montar({ faturas: [], cobrancas: {} });
    await m.service.rodar({ origem: 'agendada' });
    const where = m.prisma.db.fatura.findMany.mock.calls[0][0].where;
    expect(where.dataVencimento).toBeUndefined();
    expect(where.status).toEqual({ in: ['ABERTA', 'FECHADA'] });
    expect(where.asaasChargeId).toEqual({ not: null });
    expect(where.modeloEncargo).toBe('ASAAS_NATIVO');
  });

  it('vencida, que vence hoje e a vencer: as três são lidas e as três, pagas no Asaas, são baixadas', async () => {
    const m = montar({
      faturas: [fatura('v', 191, ontem), fatura('h', 49, hoje), fatura('f', 50, amanha)],
      cobrancas: { pay_v: cobranca('v', ontem, 'RECEIVED'), pay_h: cobranca('h', hoje, 'RECEIVED'), pay_f: cobranca('f', amanha, 'CONFIRMED', { paymentDate: hoje }) },
    });
    const r = await m.service.rodar({ origem: 'agendada' });
    expect(r.lidas).toEqual({ total: 3, vencidas: 1, venceHoje: 1, aVencer: 1 });
    expect(r.baixadas.map((b) => [b.numero, b.situacao])).toEqual([[191, 'vencida'], [49, 'vence_hoje'], [50, 'a_vencer']]);
    expect(m.filaRecebido.jobs.map((j) => j.nome)).toEqual(['conciliar', 'conciliar', 'conciliar']);
  });

  it('a conferência da tela (sem `ate`) continua só até ontem', async () => {
    const m = montar({ faturas: [], cobrancas: {} });
    await m.conferencia.conferir();
    const where = m.prisma.db.fatura.findMany.mock.calls[0][0].where;
    expect(where.dataVencimento.lt).toEqual(dia(hoje));
  });
});

describe('Conferência automática — só baixa o que está pago no Asaas', () => {
  const faturas = [
    fatura('pago', 1, ontem),
    fatura('ok', 2, ontem),
    fatura('removida', 3, ontem),
    fatura('valor', 4, hoje),
    fatura('estorno', 5, ontem),
    fatura('venc', 6, amanha),
    fatura('parcial', 7, ontem, { valorPago: decimal('500.00') }),
    fatura('falha', 8, ontem),
  ];
  const cobrancas = {
    pay_pago: cobranca('pago', ontem, 'RECEIVED'),
    pay_ok: cobranca('ok', ontem, 'OVERDUE'),
    pay_removida: null,
    pay_valor: cobranca('valor', hoje, 'PENDING', { value: 1200 }),
    pay_estorno: cobranca('estorno', ontem, 'REFUNDED'),
    pay_venc: cobranca('venc', somarDiasISO(amanha, 3), 'PENDING'),
    pay_parcial: cobranca('parcial', ontem, 'RECEIVED', { value: 500 }),
    // pay_falha ausente → 500 no Asaas
  };

  it('enfileira o MESMO `conciliar` do webhook só para a paga; o resto fica listado, sem tocar a fila', async () => {
    const m = montar({ faturas, cobrancas });
    const r = await m.service.rodar({ origem: 'agendada' });
    expect(m.filaRecebido.jobs).toEqual([
      { nome: 'conciliar', dados: { faturaId: 'pago', paymentDate: ontem, dueDate: ontem, valor: 99700 }, opts: { jobId: `conferencia-auto-${hoje}-pago` } },
    ]);
    expect(r.baixadas.map((b) => b.faturaId)).toEqual(['pago']);
    expect(r.baixadas[0]).toMatchObject({ pagoEm: ontem, valorPago: 99700, titular: 'Cliente 1' });
    expect(r.divergencias.map((d) => [d.faturaId, d.classificacao]).sort()).toEqual(
      [
        ['estorno', 'estornada_no_asaas'],
        ['parcial', 'pago_a_menor_ja_registrado'],
        ['removida', 'removida_no_asaas'],
        ['valor', 'valor_diferente'],
        ['venc', 'vencimento_diferente'],
      ].sort(),
    );
    expect(r.semLeitura.map((s) => s.faturaId)).toEqual(['falha']);
    expect(r.lidas.total).toBe(7); // a sem leitura não entra nas lidas
  });

  it('pago no Asaas, mas mudou entre a leitura e a releitura ao vivo: não baixa e registra o porquê', async () => {
    const m = montar({ faturas: [fatura('pago', 1, ontem)], cobrancas: { pay_pago: cobranca('pago', ontem, 'RECEIVED') } });
    let n = 0;
    m.lerCobranca.mockImplementation(async () => (n++ === 0 ? cobranca('pago', ontem, 'RECEIVED') : cobranca('pago', ontem, 'REFUNDED')));
    const r = await m.service.rodar({ origem: 'agendada' });
    expect(m.filaRecebido.add).not.toHaveBeenCalled();
    expect(r.baixadas).toHaveLength(0);
    expect(r.naoBaixadas).toEqual([expect.objectContaining({ faturaId: 'pago', motivo: 'Só se reconcilia o que o Asaas registra como pago' })]);
  });

  it('Asaas simulado: registra a rodada, não baixa nada e não toca o sino', async () => {
    const m = montar({ ambiente: 'simulado', faturas: [fatura('pago', 1, ontem)], cobrancas: { pay_pago: cobranca('pago', ontem, 'RECEIVED') } });
    const r = await m.service.rodar({ origem: 'agendada' });
    expect(m.filaRecebido.add).not.toHaveBeenCalled();
    expect(r.naoBaixadas).toHaveLength(1);
    expect(m.prisma.db.logAuditoria.create).toHaveBeenCalledTimes(1);
    expect(m.notificacao.emitir).not.toHaveBeenCalled();
  });
});

describe('Conferência automática — idempotência', () => {
  it('duas rodadas no mesmo dia, com a conciliação ainda na fila: um só `conciliar` por fatura', async () => {
    const m = montar({ faturas: [fatura('pago', 1, ontem)], cobrancas: { pay_pago: cobranca('pago', ontem, 'RECEIVED') } });
    await m.service.rodar({ origem: 'agendada' });
    await m.service.rodar({ origem: 'manual', usuarioId: 'usr_1' });
    expect(m.filaRecebido.add).toHaveBeenCalledTimes(2); // pediu duas vezes…
    expect(m.filaRecebido.jobs).toHaveLength(1); // …a fila guardou uma (mesma chave)
    expect(m.filaRecebido.add.mock.calls.map((c) => (c[2] as { jobId: string }).jobId)).toEqual([`conferencia-auto-${hoje}-pago`, `conferencia-auto-${hoje}-pago`]);
  });

  it('fatura já baixada aqui sai do alcance: a segunda rodada não pede nada', async () => {
    const faturas = [fatura('pago', 1, ontem)];
    const m = montar({ faturas, cobrancas: { pay_pago: cobranca('pago', ontem, 'RECEIVED') } });
    await m.service.rodar({ origem: 'agendada' });
    // o worker da conciliação baixou: a fatura deixa de ser ABERTA/FECHADA
    m.prisma.db.fatura.findMany.mockImplementationOnce(async () => []);
    const r2 = await m.service.rodar({ origem: 'manual' });
    expect(m.filaRecebido.add).toHaveBeenCalledTimes(1);
    expect(r2.baixadas).toHaveLength(0);
  });
});

describe('Conferência automática — registro e aviso', () => {
  it('cada rodada vira uma linha em logs_auditoria, com o dia, o que leu, o que baixou e o que ficou', async () => {
    const m = montar({ faturas: [fatura('pago', 191, ontem), fatura('removida', 3, ontem)], cobrancas: { pay_pago: cobranca('pago', ontem, 'RECEIVED'), pay_removida: null } });
    const r = await m.service.rodar({ origem: 'manual', usuarioId: 'usr_1' });
    expect(m.prisma.db.logAuditoria.create).toHaveBeenCalledWith({
      data: { usuarioId: 'usr_1', acao: ACAO_LOG_CONFERENCIA, entidade: ENTIDADE_LOG_CONFERENCIA, entidadeId: hoje, depois: r },
    });
    expect(r).toMatchObject({ dia: hoje, origem: 'manual', disparadaPor: 'usr_1', ambiente: 'producao', divergenciasNovas: 1 });
    expect(r.lidas.total).toBe(2);
  });

  it('avisa a Carteira quando baixa, com o cliente, a fatura e o valor; o aviso abre a conferência', async () => {
    const m = montar({ faturas: [fatura('pago', 191, ontem)], cobrancas: { pay_pago: cobranca('pago', ontem, 'RECEIVED') } });
    await m.service.rodar({ origem: 'agendada' });
    expect(m.notificacao.emitir).toHaveBeenCalledTimes(1);
    const aviso = (m.notificacao.emitir.mock.calls[0] as unknown[])[0] as { titulo: string; corpo: string; rota: string; area: string };
    expect(aviso.titulo).toBe('Conferência com o Asaas: 1 fatura paga lá foi baixada aqui');
    expect(aviso.corpo).toContain('Cliente 191 (fatura 191, R$');
    expect(aviso.rota).toBe(ROTA_CONFERENCIA);
    expect(aviso.area).toBe('CARTEIRA_COBRANCA');
  });

  it('tudo batendo: registra a rodada e não avisa', async () => {
    const m = montar({ faturas: [fatura('ok', 2, ontem)], cobrancas: { pay_ok: cobranca('ok', ontem, 'OVERDUE') } });
    await m.service.rodar({ origem: 'agendada' });
    expect(m.prisma.db.logAuditoria.create).toHaveBeenCalledTimes(1);
    expect(m.notificacao.emitir).not.toHaveBeenCalled();
  });

  it('divergência que já estava na rodada anterior não avisa de novo; nova divergência avisa', async () => {
    const m = montar({ faturas: [fatura('removida', 3, ontem)], cobrancas: { pay_removida: null } });
    await m.service.rodar({ origem: 'agendada' });
    expect(m.notificacao.emitir).toHaveBeenCalledTimes(1);
    const r2 = await m.service.rodar({ origem: 'agendada' });
    expect(r2.divergenciasNovas).toBe(0);
    expect(r2.divergencias).toHaveLength(1); // segue listada na tela
    expect(m.notificacao.emitir).toHaveBeenCalledTimes(1);
  });

  it('painel: a última rodada com a situação atual de cada baixa, e o resumo das anteriores', async () => {
    const faturas = [fatura('pago', 191, ontem)];
    const m = montar({ faturas, cobrancas: { pay_pago: cobranca('pago', ontem, 'RECEIVED') } });
    await m.service.rodar({ origem: 'agendada' });
    let p = await m.service.painel();
    expect(p.horario).toBe('3h30');
    expect(p.ultima?.baixadas[0].situacaoAgora).toBe('aguardando_conciliacao');
    faturas[0].status = 'PAGA_EM_ATRASO';
    p = await m.service.painel();
    expect(p.ultima?.baixadas[0].situacaoAgora).toBe('baixada');
    expect(p.anteriores).toEqual([]);
  });

  it('painel sem rodada nenhuma ainda', async () => {
    const m = montar({ faturas: [], cobrancas: {} });
    const p = await m.service.painel();
    expect(p.ultima).toBeNull();
    expect((m.logs as { depois: RodadaConferenciaAsaas }[]).length).toBe(0);
  });
});
