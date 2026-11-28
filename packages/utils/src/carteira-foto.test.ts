import { describe, it, expect } from 'vitest';
import { explicarMudancaDesdeFoto, FaturaAgora, FaturaFoto, MudancaDesdeFoto } from './carteira-visao';

// Foto de dezembro tirada em 01/12/2026 00:05 (Brasília) = 03:05Z.
const FOTO_EM = '2026-12-01T03:05:00.000Z';
const DIA_FOTO = '2026-12-01';
const HOJE = '2026-12-20';
const ANTES = '2026-11-20T15:00:00.000Z';
const DEPOIS = '2026-12-10T15:00:00.000Z';

const itensVenda = (valor: number) => [{ tipo: 'PRINCIPAL', descricao: 'Parcela · Compra Parcelada', valor, origemItem: 'VENDA', tipoContrato: 'veiculo' as const }];

const foto = (id: string, contaId: string, valor: number, over: Partial<FaturaFoto> = {}): FaturaFoto => ({
  id, contaId, status: 'ABERTA', vencimento: '2026-12-15', valorTotal: valor, valorPago: null, itens: itensVenda(valor), ...over,
});
const agora = (id: string, contaId: string, valor: number, over: Partial<FaturaAgora> = {}): FaturaAgora => ({
  id, contaId, status: 'FECHADA', vencimento: '2026-12-15', valorTotal: valor, valorPago: null, itens: itensVenda(valor), criadaEm: ANTES, noMes: true, ...over,
});

const grupo = (r: MudancaDesdeFoto, motivo: string, sentido: 'mais' | 'menos') => r.grupos.find((g) => g.motivo === motivo && g.sentido === sentido);
const somaGrupos = (r: MudancaDesdeFoto) => r.grupos.reduce((s, g) => s + g.valor, 0);

describe('explicarMudancaDesdeFoto — foto do início do mês (doc 02 §27.12)', () => {
  it('nada mudou: teto igual e nenhuma linha na ponte', () => {
    const r = explicarMudancaDesdeFoto([foto('f1', 'c1', 99700)], [agora('f1', 'c1', 99700, { status: 'PAGA' })], FOTO_EM, DIA_FOTO, HOJE);
    expect(r).toMatchObject({ tetoFoto: 99700, tetoAgora: 99700, diferenca: 0, grupos: [] });
  });

  it('cada motivo cai na sua linha e a soma bate EXATAMENTE com a diferença do teto', () => {
    const naFoto = [
      foto('fNov', 'c1', 90000), // vira NOVADA
      foto('fAc', 'c2', 80000), // vira RENEGOCIADA
      foto('fRes', 'c3', 70000), // vira RESCINDIDA
      foto('fData', 'c4', 60000), // vencimento vai para janeiro
      foto('fDel', 'c5', 50000), // some
      foto('fVal', 'c6', 40000), // valor muda (item que começa)
      foto('fPaga', 'c7', 30000), // quitação antecipada: fica PAGA — não move o teto
      foto('fFora', 'c8', 20000, { status: 'NOVADA' }), // já estava fora na foto: não conta
    ];
    const atual = [
      agora('fNov', 'c1', 90000, { status: 'NOVADA' }),
      agora('fAc', 'c2', 80000, { status: 'RENEGOCIADA' }),
      agora('fRes', 'c3', 70000, { status: 'RESCINDIDA' }),
      agora('fData', 'c4', 60000, { vencimento: '2027-01-05', noMes: false }),
      agora('fVal', 'c6', 45000, { itens: [...itensVenda(40000), { tipo: 'SERVICO', descricao: 'Proteção veicular', valor: 5000 }] }),
      agora('fPaga', 'c7', 30000, { status: 'PAGA' }),
      // contrato novo (criado depois da foto)
      agora('fNovo', 'c9', 99700, { criadaEm: DEPOIS }),
      // contrato nascido da novação de c1
      agora('fNovNova', 'c1', 85000, { criadaEm: DEPOIS, itens: [{ tipo: 'PRINCIPAL', descricao: 'Parcela', valor: 85000, origemItem: 'VENDA', tipoContrato: 'veiculo', deNovacao: true }] }),
      // parcela de acordo de c2 em fatura nova
      agora('fAcNova', 'c2', 30000, { criadaEm: DEPOIS, itens: [{ tipo: 'PRINCIPAL', descricao: 'Parcela do acordo', valor: 30000, origemItem: 'ACORDO' }] }),
      // fatura que já existia (vencia em novembro) e agora vence em dezembro
      agora('fVeio', 'c10', 25000, { criadaEm: ANTES }),
    ];
    const r = explicarMudancaDesdeFoto(naFoto, atual, FOTO_EM, DIA_FOTO, HOJE);
    expect(r.tetoFoto).toBe(90000 + 80000 + 70000 + 60000 + 50000 + 40000 + 30000);
    expect(r.tetoAgora).toBe(45000 + 30000 + 99700 + 85000 + 30000 + 25000);
    expect(somaGrupos(r)).toBe(r.diferenca);

    expect(grupo(r, 'novacao', 'menos')).toMatchObject({ valor: -90000, faturas: -1, clientes: 1 });
    expect(grupo(r, 'novacao', 'mais')).toMatchObject({ valor: 85000, faturas: 1 });
    expect(grupo(r, 'acordo', 'menos')).toMatchObject({ valor: -80000, faturas: -1 });
    expect(grupo(r, 'acordo', 'mais')).toMatchObject({ valor: 30000, faturas: 1 });
    expect(grupo(r, 'rescisao', 'menos')).toMatchObject({ valor: -70000, faturas: -1 });
    expect(grupo(r, 'data', 'menos')).toMatchObject({ valor: -60000, faturas: -1 });
    expect(grupo(r, 'data', 'mais')).toMatchObject({ valor: 25000, faturas: 1 });
    expect(grupo(r, 'removida', 'menos')).toMatchObject({ valor: -50000, faturas: -1 });
    expect(grupo(r, 'valor', 'mais')).toMatchObject({ valor: 5000, faturas: 0 });
    expect(grupo(r, 'contrato_novo', 'mais')).toMatchObject({ valor: 99700, faturas: 1, contas: [{ contaId: 'c9', valor: 99700, faturas: 1 }] });
    // a fatura quitada (PAGA) não aparece em lugar nenhum
    expect(r.grupos.flatMap((g) => g.contas).some((c) => c.contaId === 'c7')).toBe(false);
  });

  it('parcela de acordo somada a uma fatura que já estava na foto é "acordo", o resto da diferença é "valor"', () => {
    const r = explicarMudancaDesdeFoto(
      [foto('f1', 'c1', 99700)],
      [agora('f1', 'c1', 99700 + 20000 - 5000, { itens: [...itensVenda(94700), { tipo: 'PRINCIPAL', descricao: 'Parcela do acordo', valor: 20000, origemItem: 'ACORDO' }] })],
      FOTO_EM, DIA_FOTO, HOJE,
    );
    expect(grupo(r, 'acordo', 'mais')).toMatchObject({ valor: 20000 });
    expect(grupo(r, 'valor', 'menos')).toMatchObject({ valor: -5000 });
    expect(somaGrupos(r)).toBe(r.diferenca);
  });

  it('fatura nova com partes de novação e de venda conta UMA vez, no motivo que mais pesa', () => {
    const r = explicarMudancaDesdeFoto([], [
      agora('f1', 'c1', 100000, { criadaEm: DEPOIS, itens: [
        { tipo: 'PRINCIPAL', descricao: 'Parcela', valor: 70000, deNovacao: true },
        { tipo: 'SERVICO', descricao: 'Proteção veicular', valor: 30000 },
      ] }),
    ], FOTO_EM, DIA_FOTO, HOJE);
    expect(grupo(r, 'novacao', 'mais')).toMatchObject({ valor: 70000, faturas: 1 });
    expect(grupo(r, 'contrato_novo', 'mais')).toMatchObject({ valor: 30000, faturas: 0 });
    expect(r.diferenca).toBe(100000);
  });

  it('vencida na foto (status aberto) conta; vencimento hoje não muda o que conta', () => {
    const r = explicarMudancaDesdeFoto(
      [foto('f1', 'c1', 50000, { vencimento: '2026-12-01' })],
      [agora('f1', 'c1', 50000, { vencimento: '2026-12-01' })],
      FOTO_EM, DIA_FOTO, HOJE,
    );
    expect(r).toMatchObject({ tetoFoto: 50000, tetoAgora: 50000, grupos: [] });
  });
});
