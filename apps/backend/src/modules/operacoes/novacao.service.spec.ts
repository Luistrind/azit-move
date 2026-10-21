import { Prisma } from '@prisma/client';
import { formatCurrency } from '@azit/utils';
import { NovacaoService } from './novacao.service';

// Detalhe da novação (tela Renegociações, 21/10/2026): origens liquidadas com o
// que foi extinto, snapshot (termos + simulação), contratos novos com assinatura
// e cronograma, recebimento inicial e trilha. Fixture inspirada na Idanilza
// (2026100003 veículo + Termo, assinada na ZapSign, ativa). Sem banco.

const HOJE = '2026-10-21';
beforeAll(() => { jest.useFakeTimers({ now: new Date(`${HOJE}T15:00:00.000Z`), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });

const dec = (reais: number) => new Prisma.Decimal(reais.toFixed(2));
const dia = (iso: string) => new Date(`${iso}T03:00:00.000Z`);

function contrato(p: { id: string; numero: string; status: string; ativo?: { descricao: string; placa: string | null } | null; numeroParcelas: number; valorParcela: number; valorTotal: number; primeira: string; periodicidade?: string; encerradoEm?: string; createdAt?: string; documentoAssinatura?: unknown }) {
  return {
    id: p.id, numero: p.numero, status: p.status, ativo: p.ativo ?? null, numeroParcelas: p.numeroParcelas,
    valorParcelaInicial: dec(p.valorParcela), valorTotal: dec(p.valorTotal), dataPrimeiraParcela: dia(p.primeira), periodicidade: p.periodicidade ?? 'MENSAL',
    dataEncerramento: p.encerradoEm ? new Date(p.encerradoEm) : null, createdAt: new Date(p.createdAt ?? '2026-10-10T14:30:00.000Z'),
    documentoAssinatura: p.documentoAssinatura ?? null,
  };
}

function parcelaNova(contratoId: string, n: number, total: number, venc: string, valor: number, paga: boolean) {
  return {
    id: `${contratoId}-${n}`, contratoId, itemContratadoId: `item-${contratoId}`, numero: n, totalParcelas: total, display: `${n}/${total}`,
    valorNominal: dec(valor), dataVencimento: new Date(`${venc}T00:00:00.000Z`), dataPagamento: paga ? new Date(`${venc}T00:00:00.000Z`) : null,
    valorPago: paga ? dec(valor) : null, valorEncargo: null, status: paga ? 'PAGA' : null, faturaId: null, acordoId: null,
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}

const documento = {
  id: 'doc-1', contratoCreditoId: 'c1', provedor: 'zapsign', docToken: 'tok', status: 'assinado', simulado: false,
  enviadoEm: new Date('2026-10-10T14:35:00.000Z'), concluidoEm: new Date('2026-10-12T09:00:00.000Z'), motivoRecusa: null, pdfAssinadoRef: null,
  signatarios: [
    { papel: 'titular', nome: 'Idanilza Pereira Braga Gonçalves', signerToken: 's1', signUrl: 'u', visualizouEm: '2026-10-11T20:00:00.000Z', assinouEm: '2026-10-11T20:10:00.000Z' },
    { papel: 'azit', nome: 'João Pedro', signerToken: 's2', signUrl: 'u', assinouEm: '2026-10-12T09:00:00.000Z' },
  ],
  createdAt: new Date(), updatedAt: new Date(),
};

const simulacao = {
  frequencia: 'mensal', dataBase: '2026-10-10T12:00:00.000Z', dataPrimeiraParcela: '2026-10-30', prazoMeses: 18,
  decomposicao: { parteVeiculo: { vencido: 400_000, futuro: 3_000_000, deAcordos: 113_390, total: 3_513_390 }, demaisProdutos: { porProduto: [{ produto: 'seguro', total: 11_248 }], total: 11_248 }, totalGeral: 3_524_638 },
  taxaInicial: 0, valorParcela: 240_000, valorParcelaTotal: 249_180, contrato2: { totalParcelas: 1, antecipacaoTransicao: 237_932, totalComposto: 11_248 }, contrato1: { totalParcelas: 17, totalComposto: 4_236_060 }, totalAPagar: 4_485_240, excecoes: [],
};

const origemVeiculo = contrato({ id: 'o1', numero: '202509030', status: 'ENCERRADO', ativo: { descricao: 'Chevrolet Onix 2021', placa: 'IDA1N23' }, numeroParcelas: 48, valorParcela: 999, valorTotal: 47_952, primeira: '2025-09-15', encerradoEm: '2026-10-12T09:30:00.000Z' });
const origemRp = contrato({ id: 'o2', numero: '202509030-RP1', status: 'ENCERRADO', numeroParcelas: 6, valorParcela: 150, valorTotal: 900, primeira: '2026-06-01', encerradoEm: '2026-10-12T09:30:00.000Z' });
const c1 = contrato({ id: 'c1', numero: '2026100003', status: 'ATIVO', ativo: { descricao: 'Chevrolet Onix 2021', placa: 'IDA1N23' }, numeroParcelas: 17, valorParcela: 2491.8, valorTotal: 44_739.92, primeira: '2026-11-30', documentoAssinatura: documento });
const c2 = contrato({ id: 'c2', numero: '2026100004', status: 'ATIVO', numeroParcelas: 1, valorParcela: 2491.8, valorTotal: 112.48, primeira: '2026-10-30' });

const novacao = {
  id: 'nv-1', status: 'ATIVO', contaId: 'conta-ida', operadorId: 'u-luis', observacao: null, deletedAt: null,
  snapshotJson: { dataBase: '2026-10-10T12:00:00.000Z', dto: { prazoMeses: 18, frequencia: 'mensal', recebimentoInicial: 0, dataPrimeiraParcela: '2026-10-30' }, simulacao },
  saldoVeiculo: dec(35_133.9), saldoDemais: dec(112.48), valorParcela: dec(2491.8), recebimentoInicial: dec(0), asaasChargeIdRecebimento: null,
  contratoVeiculoId: 'c1', contratoTermoId: 'c2', dataAssinatura: new Date('2026-10-12T09:00:00.000Z'), dataAtivacao: new Date('2026-10-12T09:30:00.000Z'),
  createdAt: new Date('2026-10-10T12:00:00.000Z'), updatedAt: new Date('2026-10-12T09:30:00.000Z'),
  conta: { id: 'conta-ida', titular: { id: 't-ida', nome: 'Idanilza Pereira Braga Gonçalves' } },
  operador: { nome: 'Luís' },
  contratoVeiculo: c1, contratoTermo: c2, contratosOrigem: [origemVeiculo, origemRp],
};

function montar(nv: unknown) {
  const prisma = {
    db: {
      novacao: { findFirst: jest.fn().mockResolvedValue(nv) },
      parcela: {
        aggregate: jest.fn().mockImplementation(({ where }: { where: { contratoId: string } }) =>
          Promise.resolve(where.contratoId === 'o1' ? { _count: { _all: 38 }, _sum: { valorNominal: dec(37_962) } } : { _count: { _all: 4 }, _sum: { valorNominal: dec(600) } })),
        findMany: jest.fn().mockImplementation(({ where }: { where: { contratoId: string } }) =>
          Promise.resolve(where.contratoId === 'c2'
            ? [parcelaNova('c2', 1, 1, '2026-10-30', 112.48, false)]
            : Array.from({ length: 17 }, (_, i) => parcelaNova('c1', i + 1, 17, `2026-${String(11 + Math.floor(i / 12)).padStart(2, '0')}-30`.replace(/2026-(1[3-9])/, (_m, mm) => `2027-${String(Number(mm) - 12).padStart(2, '0')}`), 2491.8, false)))),
      },
      acordo: { findMany: jest.fn().mockImplementation(({ where }: { where: { OR: { contratoId?: string }[] } }) =>
        Promise.resolve(where.OR[0].contratoId === 'o1' ? [{ id: 'ac-old', numeroParcelasNovas: 6, valorParcelaNova: dec(300) }] : [])) },
      fatura: { count: jest.fn().mockResolvedValue(7) },
      aprovacao: { findFirst: jest.fn().mockResolvedValue({
        id: 'ap-nv', status: 'APROVADA', resumo: 'Novação da conta — R$ 35.246,38 reorganizados em 2 contratos · parcela única R$ 2.491,80 (mensal) · Termo 1p + veículo 17p',
        createdAt: new Date('2026-10-10T12:00:05.000Z'), updatedAt: new Date('2026-10-10T14:00:00.000Z'), solicitante: { nome: 'Luís' },
        decisoes: [
          { decisao: 'APROVADA', parecer: null, createdAt: new Date('2026-10-10T13:00:00.000Z'), usuario: { nome: 'Arthur' } },
          { decisao: 'APROVADA', parecer: 'ok', createdAt: new Date('2026-10-10T14:00:00.000Z'), usuario: { nome: 'Vicente' } },
        ],
      }) },
      logAuditoria: { findMany: jest.fn().mockResolvedValue([
        { id: 'log-1', usuarioId: 'u-luis', acao: 'novacao_primeira_parcela_alterada', entidade: 'novacao', entidadeId: 'nv-1', antes: { dataPrimeiraParcela: '2026-10-27T03:00:00.000Z' }, depois: { dataPrimeiraParcela: '2026-10-30', assinaturaReenviada: true }, createdAt: new Date('2026-10-10T16:00:00.000Z') },
        { id: 'log-2', usuarioId: 'u-luis', acao: 'novacao_ativada', entidade: 'novacao', entidadeId: 'nv-1', antes: null, depois: {}, createdAt: new Date('2026-10-12T09:30:00.000Z') },
      ]) },
      usuario: { findMany: jest.fn().mockResolvedValue([{ id: 'u-luis', nome: 'Luís' }]) },
    },
  };
  const service = new NovacaoService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { service, prisma };
}

describe('detalhe da novação (Idanilza — veículo + Termo, ativa)', () => {
  it('traz origens liquidadas, termos e simulação do snapshot, contratos novos com assinatura e cronograma, e a trilha completa', async () => {
    const { service, prisma } = montar(novacao);
    const d = await service.detalhar('nv-1');

    expect(d.status).toBe('ativo');
    expect(d.contratoUnico).toBe(false);
    expect(d.titular.nome).toBe('Idanilza Pereira Braga Gonçalves');
    expect(d.saldoVeiculo).toBe(3_513_390);
    expect(d.saldoDemais).toBe(11_248);
    expect(d.valorParcela).toBe(249_180);

    // Origens: o que cada contrato tinha em aberto ao ser extinto.
    expect(d.origens).toEqual([
      { id: 'o1', numero: '202509030', descricao: 'Chevrolet Onix 2021', placa: 'IDA1N23', encerradoEm: '2026-10-12T09:30:00.000Z', parcelasNovadas: 38, valorNominalNovado: 3_796_200, acordosNovados: [{ id: 'ac-old', plano: `6× ${formatCurrency(30_000)}` }] },
      { id: 'o2', numero: '202509030-RP1', descricao: 'Reembolso Parcelado', placa: null, encerradoEm: '2026-10-12T09:30:00.000Z', parcelasNovadas: 4, valorNominalNovado: 60_000, acordosNovados: [] },
    ]);
    expect(prisma.db.parcela.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { contratoId: 'o1', status: 'NOVADA' } }));
    expect(d.faturasNovadas).toBe(7);

    // Termos e simulação congelados.
    expect(d.termos).toEqual({ prazoMeses: 18, numeroParcelasVeiculo: null, frequencia: 'mensal', desconto: 0, acrescimo: 0, acrescimoMotivo: null, trocaAtivoId: null, dataPrimeiraParcela: '2026-10-30' });
    expect(d.simulacao?.decomposicao.totalGeral).toBe(3_524_638);

    // Contratos novos: Termo primeiro (1 parcela em 30/10), veículo 17× a partir de 30/11.
    expect(d.contratoTermo).toMatchObject({ papel: 'termo', numero: '2026100004', descricao: 'Termo de Regularização de Débitos', numeroParcelas: 1, valorParcela: 249_180, dataPrimeiraParcela: '2026-10-30', periodicidade: 'mensal', cronograma: { total: 1, pagas: 0, vencidas: 0, aVencer: 1, proximoVencimento: '2026-10-30' } });
    expect(d.contratoVeiculo).toMatchObject({ papel: 'veiculo', numero: '2026100003', placa: 'IDA1N23', numeroParcelas: 17, cronograma: { total: 17, pagas: 0, vencidas: 0, aVencer: 17, proximoVencimento: '2026-11-30' } });
    // Assinatura: instrumento único anexado ao veículo vale para os dois contratos.
    expect(d.contratoVeiculo?.assinatura).toMatchObject({ status: 'assinado', simulado: false, enviadoEm: '2026-10-10T14:35:00.000Z', concluidoEm: '2026-10-12T09:00:00.000Z' });
    expect(d.contratoVeiculo?.assinatura?.signatarios).toEqual([
      { papel: 'titular', nome: 'Idanilza Pereira Braga Gonçalves', visualizouEm: '2026-10-11T20:00:00.000Z', assinouEm: '2026-10-11T20:10:00.000Z' },
      { papel: 'azit', nome: 'João Pedro', visualizouEm: null, assinouEm: '2026-10-12T09:00:00.000Z' },
    ]);
    expect(d.contratoTermo?.assinatura?.status).toBe('assinado');

    expect(d.recebimentoInicial).toEqual({ valor: 0, cobrancaAsaasId: null, pagoEm: null, situacao: 'sem_recebimento' });

    // Trilha em ordem cronológica, texto humano, sem ids.
    expect(d.trilha.map((e) => e.titulo)).toEqual([
      'Proposta de novação criada',
      'Enviada à Central de Aprovações',
      'Arthur aprovou',
      'Vicente aprovou',
      'Contratos 2026100003 (veículo) e 2026100004 (Termo) criados',
      'Instrumento enviado para assinatura (ZapSign)',
      '1ª parcela alterada antes da assinatura',
      'Idanilza Pereira Braga Gonçalves assinou',
      'João Pedro assinou',
      'Instrumento assinado por todos',
      'Novação ativada',
    ]);
    expect(d.trilha[0].detalhe).toBe(`${formatCurrency(3_524_638)} reorganizados · parcela única ${formatCurrency(249_180)} (mensal) · veículo + Termo`);
    expect(d.trilha[6]).toMatchObject({ por: 'Luís', detalhe: 'de 27/10/2026 para 30/10/2026 · instrumento regenerado e reenviado' });
    expect(d.trilha[10].detalhe).toBe('2 contrato(s) de origem encerrado(s) por novação, 42 parcela(s) e 7 fatura(s) extintas, 1 acordo(s) absorvido(s); cronograma(s) do(s) contrato(s) novo(s) gerado(s)');
    for (const e of d.trilha) expect(`${e.titulo} ${e.detalhe ?? ''}`).not.toMatch(/\b(nv|ac|c|o)-[a-z0-9]+\b/);
  });

  it('aguardando recebimento inicial: situação da cobrança e sem ativação', async () => {
    const pendente = { ...novacao, status: 'AGUARDANDO_RECEBIMENTO', dataAtivacao: null, recebimentoInicial: dec(500), asaasChargeIdRecebimento: 'pay_rec', contratosOrigem: [] };
    const { service } = montar(pendente);
    const d = await service.detalhar('nv-1');
    expect(d.recebimentoInicial).toEqual({ valor: 50_000, cobrancaAsaasId: 'pay_rec', pagoEm: null, situacao: 'aguardando' });
    expect(d.origens).toEqual([]);
    expect(d.trilha.map((e) => e.titulo)).not.toContain('Novação ativada');
    expect(d.trilha.find((e) => e.titulo === 'Instrumento assinado por todos')?.detalhe).toBe(`Cobrança do recebimento inicial (${formatCurrency(50_000)}) gerada no Asaas — o pagamento ativa a novação`);
  });

  it('contrato único (adaptação 13/10): um contrato, sem Termo', async () => {
    const unico = { ...novacao, snapshotJson: { ...novacao.snapshotJson, dto: { ...novacao.snapshotJson.dto, contratoUnico: true } }, contratoTermoId: null, contratoTermo: null };
    const { service } = montar(unico);
    const d = await service.detalhar('nv-1');
    expect(d.contratoUnico).toBe(true);
    expect(d.contratoTermo).toBeNull();
    expect(d.trilha.map((e) => e.titulo)).toContain('Contrato 2026100003 criado (contrato único)');
    expect(d.trilha[0].detalhe).toContain('contrato único');
  });

  it('novação inexistente → 404', async () => {
    const { service } = montar(null);
    await expect(service.detalhar('x')).rejects.toMatchObject({ response: { erro: 'nao_encontrado' } });
  });
});
