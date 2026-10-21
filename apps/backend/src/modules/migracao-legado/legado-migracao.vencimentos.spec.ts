import { Prisma } from '@prisma/client';
import { nomeDiaSemanaISO, type DeclaracaoConciliacao, type TermosContratoLegado } from '@azit/utils';
import { LegadoConciliacaoService } from './legado-conciliacao.service';
import { LegadoMigracaoService, type PlanoMigracao } from './legado-migracao.service';

// Doc 02 §26.15 item 5 (decisão Luís 20/10/2026): parcela, fatura e recebível
// vencem no MESMO dia — o da cobrança real do Asaas; sem cobrança, a cadência
// continua da última data real. Casos de produção: Carmo 2026030001 (contrato
// segunda, cobrança SEXTA, acordo em andamento) e Gerci 2026090017 (1 dia).
// O planner roda inteiro (prévia) sobre a conciliação declarada, sem banco.

const HOJE = '2026-10-20'; // terça-feira

beforeAll(() => { jest.useFakeTimers({ now: new Date(`${HOJE}T15:00:00.000Z`), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }); });
afterAll(() => { jest.useRealTimers(); });

const dec = (v: number) => new Prisma.Decimal(v);
const dia = (iso: string) => new Date(`${iso}T03:00:00.000Z`);

// Cobrança como vem do banco (CobrancaLegada), em REAIS.
function cobranca(id: string, vencimento: string, estado: 'paga' | 'pendente', valor = 997) {
  return {
    id, casoId: 'caso1', asaasPaymentId: id, assinaturaId: 'sub_1',
    valor: dec(valor), valorPago: estado === 'paga' ? dec(valor) : null, valorOriginal: dec(valor), encargoPago: null,
    vencimento: dia(vencimento), pagoEm: estado === 'paga' ? dia(vencimento) : null,
    status: estado === 'paga' ? 'RECEIVED' : vencimento < HOJE ? 'OVERDUE' : 'PENDING',
    tipo: 'BOLETO', descricao: 'Parcela', invoiceUrl: null, deletada: false, bruto: {},
    tipoInterpretado: 'parcela', interpretacao: null, interpretadoPor: 'regra', interpretadoEm: null, duvida: false, interpretacaoObs: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function termos(primeiraEm: string, quantidade: number): TermosContratoLegado {
  return {
    numeroOrigem: '2026030001', dataAssinatura: primeiraEm, compradorNome: 'Cliente Teste', compradorCpf: '12345678909', garantidorNome: null, garantidorCpf: null,
    veiculo: { marca: 'Fiat', modelo: 'Mobi', anoFabricacao: 2022, anoModelo: 2022, cor: 'Prata', placa: 'ABC1D23', chassi: '9BD000000X0000000', renavam: null, origem: null, combustivel: null, quilometragem: null },
    valorTotal: quantidade * 94_200, entradaValor: 0,
    parcelas: { total: null, quantidade, valor: 94_200, primeiraEm }, intermediarias: null,
    seguroSemanal: 5_000, taxaSemanal: 500, parcelaIncluiServicos: false,
    indiceReajuste: null, multaAtrasoPct: 2, jurosMensalPct: 1, garantiaDias: 90, observacoes: null,
  };
}

function montar(caso: { termos: TermosContratoLegado; cobrancas: ReturnType<typeof cobranca>[]; declaracao: DeclaracaoConciliacao }) {
  const casoBanco = {
    id: 'caso1', status: 'VALIDADO', contratoId: null, nome: 'Cliente Teste', cpfCnpj: '12345678909', asaasCustomerId: 'cus_1', assinaturaId: 'sub_1',
    telefone: null, email: null, contratoPdfRef: 'contrato.pdf', modoVencimentos: 'CONTRATO',
    termos: caso.termos, cobrancas: caso.cobrancas,
    divergenciasReconhecidas: null, vinculosManuais: null, modoConciliacao: null, acordosConfirmados: null,
    conciliacaoDeclarada: { ...caso.declaracao, em: `${HOJE}T12:00:00.000Z`, por: 'luis', origem: 'teste' },
  };
  const prisma = {
    db: {
      casoMigracaoLegado: { findUnique: jest.fn().mockResolvedValue(casoBanco) },
      titular: { findUnique: jest.fn().mockResolvedValue(null) },
      estruturaJuridica: { findFirst: jest.fn().mockResolvedValue({ id: 'estrutura-azit' }) },
      ativo: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
      contratoCredito: { findFirst: jest.fn().mockResolvedValue(null) },
      versaoParametrosSimulacao: { findFirst: jest.fn().mockResolvedValue(null) },
    },
  };
  const conciliacao = new LegadoConciliacaoService(prisma as never);
  const fipe = { consultar: jest.fn().mockResolvedValue({ ok: false, motivo: 'sem FIPE no teste' }) };
  const catalogoFonte = { compraParcelada: jest.fn().mockRejectedValue(new Error('sem catálogo')) };
  // Fila de pagamento recebido (8º parâmetro, branch fix/legado-cobranca-ja-paga): o planejamento não enfileira nada — stub.
  return new LegadoMigracaoService(prisma as never, conciliacao, {} as never, {} as never, {} as never, fipe as never, catalogoFonte as never, { add: jest.fn() } as never);
}

const porParcela = (plano: PlanoMigracao) => Object.fromEntries(plano.faturas.filter((f) => f.parcela).map((f) => [f.parcela!.numero, f]));
const semana = (iso: string) => nomeDiaSemanaISO(iso);

// Em TODO plano: parcela, fatura e recebível (dataPrevista = parcela.vencimento na gravação) no mesmo dia.
function conferirParcelaIgualFatura(plano: PlanoMigracao) {
  for (const f of plano.faturas) if (f.parcela) expect(f.parcela.vencimento).toBe(f.vencimento);
  for (const p of plano.vencimentos.parcelas) expect(porParcela(plano)[p.numero].vencimento).toBe(p.efetivo);
}

describe('prévia da migração — vencimentos (doc 02 §26.15 item 5)', () => {
  it('Carmo: contrato na segunda, cobrança na SEXTA, acordo em andamento cobrindo 3 parcelas — tudo vence na sexta, inclusive as futuras, e as cotas caem nas faturas das parcelas', async () => {
    // Contrato: 8 parcelas semanais a partir de segunda 14/09. Cobranças reais nas sextas
    // (produção: faturas de 23/10 e 30/10, cotas do acordo em sextas).
    const svc = montar({
      termos: termos('2026-09-14', 8),
      cobrancas: [
        cobranca('pay_1', '2026-09-18', 'paga'), cobranca('pay_2', '2026-09-25', 'paga'),
        cobranca('pay_3', '2026-10-02', 'pendente'), // vencida, coberta pelo acordo (apagada na migração)
        cobranca('pay_6', '2026-10-23', 'pendente'), // a vencer, emitida pela assinatura
        cobranca('pay_ac0', '2026-10-16', 'paga', 500), // entrada do acordo
      ],
      declaracao: {
        periodicidade: 'semanal',
        parcelas: [
          { numero: 1, vencimento: '2026-09-14', situacao: 'paga', cobrancas: ['pay_1'] },
          { numero: 2, vencimento: '2026-09-21', situacao: 'paga', cobrancas: ['pay_2'] },
          { numero: 3, vencimento: '2026-09-28', situacao: 'em_acordo', cobrancas: ['pay_3'] },
          { numero: 4, vencimento: '2026-10-05', situacao: 'em_acordo' },
          { numero: 5, vencimento: '2026-10-12', situacao: 'em_acordo' },
          { numero: 6, vencimento: '2026-10-19', situacao: 'pendente', cobrancas: ['pay_6'] },
          { numero: 7, vencimento: '2026-10-26', situacao: 'futura' },
          { numero: 8, vencimento: '2026-11-02', situacao: 'futura' },
        ],
        acordoEmAndamento: { parcelasCobertas: [3, 4, 5], entrada: { valor: 50_000, pagoEm: '2026-10-16', cobrancas: ['pay_ac0'] }, parcelas: { quantidade: 3, valor: 90_000, primeiraEm: '2026-10-23' } },
      },
    });
    const plano = await svc.previa('caso1');
    conferirParcelaIgualFatura(plano);

    const f = porParcela(plano);
    expect(Object.keys(f)).toHaveLength(8);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => f[n].vencimento)).toEqual(['2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06']);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(semana(f[n].vencimento)).toBe('sexta-feira');
      expect(semana(f[n].parcela!.vencimentoContrato)).toBe('segunda-feira');
    }
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => f[n].parcela!.origemVencimento)).toEqual(['cobranca', 'cobranca', 'cobranca', 'cadencia', 'cadencia', 'cobranca', 'cadencia', 'cadencia']);

    // Status e corte no Asaas não mudam: paga, coberta (cobrança antiga apagada), a vencer substituída e emitida na hora (D-5).
    expect(f[1].status).toBe('PAGA');
    expect(f[3]).toMatchObject({ status: 'RENEGOCIADA', removerChargeId: 'pay_3', asaasChargeId: null });
    expect(f[4].status).toBe('RENEGOCIADA');
    expect(f[6]).toMatchObject({ status: 'ABERTA', substituirChargeId: 'pay_6', emitirAgora: true });
    expect(f[7].status).toBe('ABERTA');

    // Cotas do acordo (sextas 23/10, 30/10, 06/11) caem nas faturas das parcelas 6, 7 e 8 — nenhuma fatura só do acordo.
    expect(plano.acordo).toMatchObject({ numeroParcelas: 3, primeiraEm: '2026-10-23', ultimaEm: '2026-11-06', cobertas: [3, 4, 5] });
    expect(plano.faturas.filter((x) => x.origem.startsWith('acordo:'))).toHaveLength(0);
    expect(plano.acordo!.cotas.map((c) => plano.faturas[c.faturaIdx].parcela!.numero)).toEqual([6, 7, 8]);
    expect(f[7].itens.some((i) => i.descricao === 'Renegociação parcela 2/3')).toBe(true);

    // Prévia: data do contrato × efetiva por parcela, com aviso.
    expect(plano.vencimentos.divergentes).toBe(8);
    expect(plano.vencimentos.aviso).toContain('contrato: segunda-feira · cobrança: sexta-feira');
    expect(plano.vencimentos.aviso).toContain('seguirão sexta-feira');
    expect(plano.vencimentos.parcelas[3]).toEqual({ numero: 4, contrato: '2026-10-05', efetivo: '2026-10-09', origem: 'cadencia', diverge: true, status: 'RENEGOCIADA' });
    // A data do papel fica como 1ª parcela do contrato.
    expect(plano.contrato.dataPrimeiraParcela).toBe('2026-09-14');
    expect(plano.resumo).toMatchObject({ faturasPagas: 2, faturasRenegociadas: 3, faturasAbertas: 3, substituidas: 1, emitidasAgora: 1, removidas: 1 });
  });

  it('Gerci: cobrança um dia depois do contrato (segunda → terça) — a parcela segue a terça, e a futura sem cobrança também', async () => {
    const svc = montar({
      termos: termos('2026-09-14', 8),
      cobrancas: [
        cobranca('pay_1', '2026-09-15', 'paga'), cobranca('pay_2', '2026-09-22', 'paga'), cobranca('pay_3', '2026-09-29', 'paga'),
        cobranca('pay_4', '2026-10-06', 'paga'), cobranca('pay_5', '2026-10-13', 'paga'),
        cobranca('pay_6', '2026-10-20', 'pendente'), cobranca('pay_7', '2026-10-27', 'pendente'),
      ],
      declaracao: {
        parcelas: [
          { numero: 1, vencimento: '2026-09-14', situacao: 'paga', cobrancas: ['pay_1'] },
          { numero: 2, vencimento: '2026-09-21', situacao: 'paga', cobrancas: ['pay_2'] },
          { numero: 3, vencimento: '2026-09-28', situacao: 'paga', cobrancas: ['pay_3'] },
          { numero: 4, vencimento: '2026-10-05', situacao: 'paga', cobrancas: ['pay_4'] },
          { numero: 5, vencimento: '2026-10-12', situacao: 'paga', cobrancas: ['pay_5'] },
          { numero: 6, vencimento: '2026-10-19', situacao: 'pendente', cobrancas: ['pay_6'] },
          { numero: 7, vencimento: '2026-10-26', situacao: 'pendente', cobrancas: ['pay_7'] },
          { numero: 8, vencimento: '2026-11-02', situacao: 'futura' },
        ],
      },
    });
    const plano = await svc.previa('caso1');
    conferirParcelaIgualFatura(plano);
    const f = porParcela(plano);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => f[n].vencimento)).toEqual(['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']);
    expect(f[8].parcela).toMatchObject({ vencimentoContrato: '2026-11-02', origemVencimento: 'cadencia' });
    expect(plano.vencimentos.divergentes).toBe(8);
    expect(plano.vencimentos.aviso).toContain('contrato: segunda-feira · cobrança: terça-feira');
    // Hoje (20/10) a parcela 6 vence: a vencer, substituída e emitida na hora; nada em atraso.
    expect(f[6]).toMatchObject({ status: 'ABERTA', substituirChargeId: 'pay_6', emitirAgora: true });
    expect(plano.contrato.dataPrimeiraParcela).toBe('2026-09-14');
  });

  it('sem divergência: cobrança no dia do contrato — nada muda e não há aviso', async () => {
    const datas = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
    const svc = montar({
      termos: termos('2026-09-14', 6),
      cobrancas: datas.map((v, i) => cobranca(`pay_${i + 1}`, v, 'paga')),
      declaracao: {
        parcelas: datas.map((v, i) => ({ numero: i + 1, vencimento: v, situacao: 'paga' as const, cobrancas: [`pay_${i + 1}`] })),
      },
    });
    const plano = await svc.previa('caso1');
    conferirParcelaIgualFatura(plano);
    const f = porParcela(plano);
    expect([1, 2, 3, 4, 5, 6].map((n) => f[n].vencimento)).toEqual(datas);
    expect(plano.vencimentos).toMatchObject({ divergentes: 0, aviso: null });
    expect(plano.vencimentos.parcelas.every((p) => !p.diverge && p.origem === 'cobranca')).toBe(true);
    expect(plano.resumo.faturasPagas).toBe(6);
  });

  it('mensal (Kaique): a parcela sem cobrança mantém o dia do mês da última cobrança real', async () => {
    const svc = montar({
      termos: termos('2026-07-12', 4),
      cobrancas: [cobranca('pay_1', '2026-07-15', 'paga'), cobranca('pay_2', '2026-08-15', 'paga')],
      declaracao: {
        periodicidade: 'mensal',
        parcelas: [
          { numero: 1, vencimento: '2026-07-12', situacao: 'paga', cobrancas: ['pay_1'] },
          { numero: 2, vencimento: '2026-08-12', situacao: 'paga', cobrancas: ['pay_2'] },
          { numero: 3, vencimento: '2026-09-12', situacao: 'vencida' },
          { numero: 4, vencimento: '2026-10-12', situacao: 'vencida' },
        ],
      },
    });
    const plano = await svc.previa('caso1');
    conferirParcelaIgualFatura(plano);
    const f = porParcela(plano);
    expect([1, 2, 3, 4].map((n) => f[n].vencimento)).toEqual(['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15']);
    expect(plano.vencimentos.aviso).toContain('contrato: dia 12 · cobrança: dia 15');
    expect(plano.contrato.periodicidade).toBe('mensal');
  });
});
