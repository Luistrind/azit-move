import { Prisma } from '@prisma/client';
import { AnaliseService } from './analise.service';

// Liberação preenchida pelo sistema (decisão Luís 28/10/2026, doc 02 §14):
// renda apurada ← "Média 3M" do relatório da IA; identidade ← Camada 1;
// CNH ← anexo da proposta. Sem banco — Prisma dublado em memória.
// Caso de referência: Jeferson Pereira Ribeiro (aprovado pelo COCAD, travado
// só pela renda apurada que o relatório já trazia).

const HOJE = '2026-10-28';
beforeAll(() => { jest.useFakeTimers({ now: new Date(`${HOJE}T15:00:00.000Z`), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });

const RELATORIO = `JEFERSON PEREIRA RIBEIRO | Análise cadastral

Cadastro: 39 anos, Cariacica/ES, CPF regular e CNH válida.

Renda bruta Uber: jul R$ 7.812,40 | ago R$ 8.102,15 | set R$ 7.590,30. Média 3M: R$ 7.834,95/mês.

Resumo objetivo: R$ 7,8 mil/mês | 1 apontamento | sem protestos.`;

type Participante = Record<string, unknown> & { id: string; titularId: string };

function participante(over: Partial<Participante> = {}): Participante {
  return {
    id: 'p1', analiseId: 'an-1', titularId: 't1', papel: 'COMPRADOR_PRINCIPAL',
    rendaDeclarada: new Prisma.Decimal('9000'), rendaPresumida: null, rendaApurada: null,
    rendaParcialmenteComprovada: false, identidadeValidada: false, cnhValida: false,
    documentoAlternativo: false, atividadeComprovada: false, evidenciaAtividade: null,
    processosRelevantes: false, observacoes: null,
    rendaApuradaOrigem: null, identidadeValidadaOrigem: null, cnhValidaOrigem: null,
    titular: { nome: 'Jeferson Pereira Ribeiro', cpfCnpj: '12251049711' },
    ...over,
  };
}

const EM_27 = new Date('2026-10-27T12:00:00.000Z');
function consulta(tipo: string, resultado: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return { id: `c-${tipo}`, analiseId: 'an-1', titularId: 't1', tipo, fornecedor: 'BigDataCorp', protocolo: null, dataConsulta: EM_27, situacao: 'CONCLUIDA', motivoFalha: null, tentativas: 1, resultado, ...over };
}

function analise(over: Record<string, unknown> = {}) {
  return {
    id: 'an-1', propostaId: 'pr-1', status: 'APROVADO_COCAD', condutorPrincipalTitularId: 't1',
    aprovadaEm: new Date('2026-10-27T20:00:00.000Z'), aprovadaPor: 'luis', aprovacaoId: null,
    resumoIa: { status: 'concluido', texto: RELATORIO, modelo: 'claude-opus-5', geradoEm: '2026-10-27T18:30:00.000Z' },
    parametroVersao: {
      id: 'v1', politicaVersao: '1.0', validadeConsultaDias: 30, validadeAprovacaoDiasUteis: 10,
      comprometimentoAlcada: new Prisma.Decimal('0.40'), scoreQuodMinimo: 600, restritivoNaoFinanceiroMax: new Prisma.Decimal('500'),
      fatorSemanal: new Prisma.Decimal('4.3452'), fatorQuinzenal: new Prisma.Decimal('2.1726'),
    },
    proposta: {
      id: 'pr-1', titularId: 't1', frequencia: 'SEMANAL', valorParcela: new Prisma.Decimal('999.98'),
      parecerOperador: 'Cliente indicado pelo Wallace; trabalha de Uber há 3 anos.',
      documentos: [{ id: 'd1', propostaId: 'pr-1', titularId: 't1', tipo: 'CNH', arquivoRef: 'CNH (4).pdf', dataAnexo: new Date('2026-10-27T11:00:00.000Z') }],
    },
    participantes: [participante()],
    autorizacoes: [], pendencias: [], ressalvas: [], alertasFraude: [], transicoes: [],
    consultas: [
      consulta('CAMADA1', { status: 'aprovado', nomeOficial: 'JEFERSON PEREIRA RIBEIRO', situacaoCpf: 'REGULAR', indicacaoObito: false, simulado: false }),
      consulta('SCORE_QUOD', { score: 892, simulado: false }),
      consulta('RESTRITIVOS', { restritivosFinanceiros: 636763, restritivosNaoFinanceiros: 0, protestoChequeExecucao: false, simulado: false }),
      consulta('PROCESSOS', { processosTotal: 1, processosComoReu: 0, simulado: false, bruto: { result: { Processes: { TotalLawsuits: 1, Lawsuits: [{ Number: '0001', MainSubject: 'Reclamação Trabalhista', Status: 'ATIVO', Parties: [{ Doc: '12251049711', Polarity: 'ACTIVE' }] }] } } } }),
    ],
    ...over,
  };
}

function montar(estado: ReturnType<typeof analise>) {
  const auditorias: { acao: string; depois?: Record<string, unknown> }[] = [];
  const participanteUpdates: Record<string, unknown>[] = [];
  const agregados: Record<string, unknown>[] = [];
  const statusMudancas: string[] = [];
  const prisma = {
    db: {
      analiseCadastro: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(estado)),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve({ status: estado.status, propostaId: estado.propostaId })),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          if ('status' in data) { estado.status = data.status as string; statusMudancas.push(data.status as string); } else agregados.push(data);
          return Promise.resolve({});
        }),
      },
      participanteAnalise: {
        update: jest.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          participanteUpdates.push(data);
          const p = estado.participantes.find((x) => x.id === where.id) as Participante;
          for (const [k, v] of Object.entries(data)) {
            if (v === undefined) continue;
            p[k] = /^renda(Declarada|Presumida|Apurada)$/.test(k) && typeof v === 'string' ? new Prisma.Decimal(v) : v;
          }
          return Promise.resolve({ ...p, titular: undefined });
        }),
      },
      transicaoAnalise: { create: jest.fn().mockResolvedValue({}) },
      proposta: { update: jest.fn().mockResolvedValue({}) },
      logAuditoria: {
        create: jest.fn().mockImplementation(({ data }: { data: { acao: string; depois?: Record<string, unknown> } }) => { auditorias.push(data); return Promise.resolve({}); }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  };
  const service = new AnaliseService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { service, prisma, auditorias, participanteUpdates, agregados, statusMudancas, estado };
}

describe('AnaliseService — preenchimento pelo sistema (28/10/2026)', () => {
  it('caso Jeferson: abrir o dossiê preenche renda (IA), identidade (Camada 1) e CNH (anexo) com a origem', async () => {
    const { service, participanteUpdates, agregados, auditorias } = montar(analise());
    const d = await service.dossie('an-1');
    const p = d.participantes[0];
    expect(p.rendaApurada).toBe(783_495);
    expect(p.rendaApuradaOrigem).toContain('apurada pela IA em 27/10/2026');
    expect(p.rendaApuradaOrigem).toContain('Média 3M: R$ 7.834,95');
    expect(p.identidadeValidada).toBe(true);
    expect(p.identidadeValidadaOrigem).toContain('validada pela consulta Camada 1 de 27/10/2026');
    expect(p.cnhValida).toBe(true);
    expect(p.cnhValidaOrigem).toContain('CNH anexada na proposta em 27/10/2026');
    expect(p.cnhValidaOrigem).toContain('não há consulta de CNH');
    // Uma escrita por participante; agregados recalculados com a renda nova.
    expect(participanteUpdates).toHaveLength(1);
    expect(agregados.at(-1)).toMatchObject({ rendaApuradaTotal: '7834.95' });
    expect(auditorias.map((a) => a.acao)).toContain('analise_preenchido_pelo_sistema');
    // Observação do vendedor chega ao dossiê.
    expect(d.observacaoVendedor).toBe('Cliente indicado pelo Wallace; trabalha de Uber há 3 anos.');
    // Pacote mínimo fecha: nada mais trava a liberação.
    expect(d.pacoteMinimo.filter((x) => !x.ok)).toEqual([]);
    // Processo trabalhista com o cliente como autor: não sugere COC-06.
    expect(p.processosSugestao?.sugerir).toBe(false);
  });

  it('é idempotente: o segundo dossiê não escreve nada', async () => {
    const { service, participanteUpdates } = montar(analise());
    await service.dossie('an-1');
    await service.dossie('an-1');
    expect(participanteUpdates).toHaveLength(1);
  });

  it('liberar roda o preenchimento antes do gate e libera o caso Jeferson', async () => {
    const { service, statusMudancas } = montar(analise());
    await service.liberar('an-1', 'luis');
    expect(statusMudancas).toContain('LIBERADO_PARA_FORMALIZACAO');
  });

  it('sem "Média 3M" no relatório a renda fica vazia e liberar lista o item que falta', async () => {
    const { service } = montar(analise({ resumoIa: { status: 'concluido', texto: 'Renda bruta: não identificada. Média 3M: não calculável — renda não apurada.' } }));
    await expect(service.liberar('an-1', 'luis')).rejects.toMatchObject({
      response: { erro: 'pacote_incompleto', itens: [{ item: 'Renda apurada de todos os compradores', ok: false }] },
    });
  });

  it('campo já tocado pelo analista (origem dele) não é sobrescrito pelo sistema', async () => {
    const { service, participanteUpdates } = montar(analise({
      participantes: [participante({ identidadeValidadaOrigem: 'desmarcada pelo analista em 27/10/2026', cnhValidaOrigem: 'desmarcada pelo analista em 27/10/2026', rendaApuradaOrigem: 'informada pelo analista em 27/10/2026' })],
    }));
    const d = await service.dossie('an-1');
    expect(d.participantes[0].identidadeValidada).toBe(false);
    expect(d.participantes[0].cnhValida).toBe(false);
    expect(d.participantes[0].rendaApurada).toBeNull();
    expect(participanteUpdates).toHaveLength(0);
  });

  it('Camada 1 simulada ou com nome diferente não valida identidade', async () => {
    const simulada = montar(analise({ consultas: [consulta('CAMADA1', { nomeOficial: 'JEFERSON PEREIRA RIBEIRO', situacaoCpf: 'REGULAR', indicacaoObito: false, simulado: true })] }));
    expect((await simulada.service.dossie('an-1')).participantes[0].identidadeValidada).toBe(false);
    const outroNome = montar(analise({ consultas: [consulta('CAMADA1', { nomeOficial: 'JEFERSON PEREIRA DOS SANTOS', situacaoCpf: 'REGULAR', indicacaoObito: false, simulado: false })] }));
    expect((await outroNome.service.dossie('an-1')).participantes[0].identidadeValidada).toBe(false);
  });

  it('renda preenchida pela IA: o analista só altera com justificativa, e a origem passa a ser dele', async () => {
    const { service, estado } = montar(analise());
    await service.dossie('an-1');
    await expect(service.atualizarParticipante('an-1', 't1', { rendaApurada: 700_000 }, 'luis')).rejects.toMatchObject({ response: { erro: 'justificativa_obrigatoria' } });
    await service.atualizarParticipante('an-1', 't1', { rendaApurada: 700_000, justificativaRendaApurada: 'extrato Neon mostra média menor' }, 'luis');
    const p = estado.participantes[0] as Participante;
    expect(p.rendaApurada?.toString()).toBe('7000');
    expect(p.rendaApuradaOrigem).toBe('alterada pelo analista em 28/10/2026 — extrato Neon mostra média menor');
    // Desmarcar identidade registra a origem do analista — e o sistema não volta a marcar.
    await service.atualizarParticipante('an-1', 't1', { identidadeValidada: false }, 'luis');
    expect(p.identidadeValidadaOrigem).toBe('desmarcada pelo analista em 28/10/2026');
    const d = await service.dossie('an-1');
    expect(d.participantes[0].identidadeValidada).toBe(false);
  });

  it('processo de busca e apreensão ativo com o cliente no polo passivo vira sugestão — sem marcar sozinho', async () => {
    const { service } = montar(analise({
      consultas: [
        consulta('CAMADA1', { nomeOficial: 'JEFERSON PEREIRA RIBEIRO', situacaoCpf: 'REGULAR', indicacaoObito: false, simulado: false }),
        consulta('PROCESSOS', { processosTotal: 1, processosComoReu: 1, simulado: false, bruto: { result: { Processes: { Lawsuits: [{ Number: '0002', MainSubject: 'Busca e Apreensão em Alienação Fiduciária', Status: 'EM ANDAMENTO', Parties: [{ Doc: '122.510.497-11', Polarity: 'PASSIVE' }] }] } } } }),
      ],
    }));
    const p = (await service.dossie('an-1')).participantes[0];
    expect(p.processosSugestao?.sugerir).toBe(true);
    expect(p.processosSugestao?.processos[0]).toMatchObject({ numero: '0002', poloPassivo: true });
    expect(p.processosRelevantes).toBe(false);
  });
});
