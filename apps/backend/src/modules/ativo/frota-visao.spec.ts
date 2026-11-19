import { Prisma } from '@prisma/client';
import { FrotaVisaoService } from './frota-visao.service';

// Frota e ficha do veículo (doc 02 §25.7). Sem banco: o que se confere é a
// regra de cada leitura — situação do contrato (igual à régua), pendências
// abertas e retornos gerados.

const dia = (iso: string) => new Date(`${iso}T03:00:00Z`);
const dec = (v: number) => new Prisma.Decimal(v);

function ativo(id: string, contrato?: { id: string; numero: string; titular: string }) {
  return {
    id,
    tipo: 'VEICULO',
    varianteCatalogo: 'carro',
    descricao: `Carro ${id}`,
    marca: 'Fiat',
    modelo: 'Mobi',
    anoFabricacao: 2022,
    anoModelo: 2023,
    cor: 'Branco',
    placa: `ABC${id}`,
    chassi: null,
    renavam: null,
    origem: null,
    combustivel: null,
    quilometragemEntrada: null,
    valorAquisicao: dec(52000),
    valorVenda: dec(61900),
    pacoteOfertaId: null,
    ofertaFixaId: null,
    status: contrato ? 'EM_CONTRATO' : 'DISPONIVEL',
    observacao: null,
    reservadoEm: null,
    estruturaJuridica: null,
    reservadoProposta: null,
    contratosCredito: contrato ? [{ id: contrato.id, numero: contrato.numero, conta: { titular: { id: `t-${id}`, nome: contrato.titular } } }] : [],
    createdAt: dia('2026-02-12'),
    updatedAt: dia('2026-02-12'),
  };
}

function montar(p: {
  ativos: ReturnType<typeof ativo>[];
  contratosCarro?: { id: string; numero: string; ativoId: string; contaId: string; veiculoBloqueadoEm: Date | null }[];
  semVeiculo?: { id: string; contaId: string }[];
  acordos?: { contaId: string }[];
  vencidas?: { contratoId: string; _min: { dataVencimento: Date } }[];
  ocorrencias?: unknown[];
  posicoes?: { ativoId: string; totalGasto: number; recebido: number; aReceber: number }[];
}) {
  const db = {
    ativo: {
      count: jest.fn(async () => p.ativos.length),
      findMany: jest.fn(async () => p.ativos),
    },
    contratoCredito: {
      findMany: jest.fn(async ({ where }: { where: { ativoId?: unknown } }) =>
        where.ativoId === null ? (p.semVeiculo ?? []) : (p.contratosCarro ?? []),
      ),
    },
    acordo: { findMany: jest.fn(async () => p.acordos ?? []) },
    parcela: { groupBy: jest.fn(async () => p.vencidas ?? []) },
    ocorrenciaVeiculo: { findMany: jest.fn(async () => p.ocorrencias ?? []) },
  };
  const centroCusto = { posicaoDosAtivos: jest.fn(async () => p.posicoes ?? []) };
  const svc = new FrotaVisaoService({ db } as never, centroCusto as never);
  return { svc, db };
}

describe('FrotaVisaoService — lista da frota', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-19T15:00:00Z'));
  });
  afterAll(() => jest.useRealTimers());

  it('atraso do carro soma o contrato sem veículo da mesma conta (mesma regra da régua)', async () => {
    const { svc } = montar({
      ativos: [ativo('1', { id: 'k1', numero: '2026030014', titular: 'Marcos' })],
      contratosCarro: [{ id: 'k1', numero: '2026030014', ativoId: '1', contaId: 'c1', veiculoBloqueadoEm: null }],
      semVeiculo: [{ id: 'rp1', contaId: 'c1' }],
      // O carro está em dia; o reembolso da mesma conta venceu há 9 dias.
      vencidas: [{ contratoId: 'rp1', _min: { dataVencimento: dia('2026-11-10') } }],
    });
    const r = await svc.lista({ offset: 0, limit: 20 });
    expect(r.data[0].contrato).toMatchObject({ situacao: 'em_atraso', diasAtraso: 9, bloqueioDisponivel: true });
  });

  it('abaixo do limiar de bloqueio, o atraso não libera o bloqueio', async () => {
    const { svc } = montar({
      ativos: [ativo('1', { id: 'k1', numero: '1', titular: 'Marcos' })],
      contratosCarro: [{ id: 'k1', numero: '1', ativoId: '1', contaId: 'c1', veiculoBloqueadoEm: null }],
      vencidas: [{ contratoId: 'k1', _min: { dataVencimento: dia('2026-11-16') } }],
    });
    const r = await svc.lista({ offset: 0, limit: 20 });
    expect(r.data[0].contrato).toMatchObject({ situacao: 'em_atraso', diasAtraso: 3, bloqueioDisponivel: false });
  });

  it('em dia, em acordo e bloqueado seguem a situação da carteira', async () => {
    const { svc } = montar({
      ativos: [ativo('1', { id: 'k1', numero: '1', titular: 'A' }), ativo('2', { id: 'k2', numero: '2', titular: 'B' }), ativo('3', { id: 'k3', numero: '3', titular: 'C' })],
      contratosCarro: [
        { id: 'k1', numero: '1', ativoId: '1', contaId: 'c1', veiculoBloqueadoEm: null },
        { id: 'k2', numero: '2', ativoId: '2', contaId: 'c2', veiculoBloqueadoEm: null },
        { id: 'k3', numero: '3', ativoId: '3', contaId: 'c3', veiculoBloqueadoEm: dia('2026-11-12') },
      ],
      acordos: [{ contaId: 'c2' }],
    });
    const r = await svc.lista({ offset: 0, limit: 20 });
    expect(r.data.map((l) => l.contrato?.situacao)).toEqual(['em_dia', 'em_acordo', 'bloqueada']);
  });

  it('veículo sem contrato ativo não tem situação de contrato', async () => {
    const { svc } = montar({ ativos: [ativo('9')] });
    const r = await svc.lista({ offset: 0, limit: 20 });
    expect(r.data[0].contrato).toBeNull();
    expect(r.data[0].pendencias).toEqual({ quantidade: 0, valor: 0, proximoPrazo: null });
  });

  it('pendências: soma o valor com desconto e acha o prazo mais próximo', async () => {
    const { svc } = montar({
      ativos: [ativo('1')],
      ocorrencias: [
        { ativoId: '1', status: 'REGISTRADA', valor: dec(195.23), valorComDesconto: null, dataVencimento: new Date('2026-11-22T00:00:00Z'), prazoIndicacao: new Date('2026-11-30T00:00:00Z'), prazoComprovante: null },
        { ativoId: '1', status: 'REGISTRADA', valor: dec(162.79), valorComDesconto: dec(130.23), dataVencimento: null, prazoIndicacao: new Date('2026-11-21T00:00:00Z'), prazoComprovante: null },
      ],
    });
    const r = await svc.lista({ offset: 0, limit: 20 });
    expect(r.data[0].pendencias).toEqual({ quantidade: 2, valor: 32546, proximoPrazo: { tipo: 'indicacao', data: '2026-11-21' } });
  });

  it('retornos gerados: recebido sobre o investido', async () => {
    const { svc } = montar({
      ativos: [ativo('1')],
      posicoes: [{ ativoId: '1', totalGasto: 5_385_000, recebido: 3_630_710, aReceber: 10_222_463 }],
    });
    const r = await svc.lista({ offset: 0, limit: 20 });
    expect(r.data[0].retorno).toEqual({ investido: 5_385_000, recebido: 3_630_710, aReceber: 10_222_463, percentual: 67 });
  });
});
