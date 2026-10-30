import { describe, it, expect } from 'vitest';
import {
  agregarVisaoCarteira,
  agregarVisaoMensal,
  chaveProdutoItemFatura,
  estadoFaturaVisao,
  variacaoPct,
  FaturaVisao,
  RecebimentoVisao,
} from './carteira-visao';

const HOJE = '2026-10-29';

const fat = (over: Partial<FaturaVisao> & { contaId: string; status: string; vencimento: string }): FaturaVisao => ({
  valorTotal: 99700,
  valorPago: null,
  itens: [
    { tipo: 'PRINCIPAL', descricao: 'Parcela 10/165 · Compra Parcelada HB20S', valor: 94200, origemItem: 'VENDA', tipoContrato: 'veiculo' },
    { tipo: 'SERVICO', descricao: 'Proteção veicular', valor: 5000 },
    { tipo: 'SERVICO', descricao: 'Taxa de boleto e PIX', valor: 500 },
  ],
  ...over,
});

describe('estadoFaturaVisao — estado runtime da fatura na visão (doc 02 §27)', () => {
  it('paga e paga em atraso são recebidas; renegociada e novada ficam fora', () => {
    expect(estadoFaturaVisao('PAGA', '2026-10-05', HOJE)).toBe('recebida');
    expect(estadoFaturaVisao('paga_em_atraso', '2026-10-05', HOJE)).toBe('recebida');
    expect(estadoFaturaVisao('RENEGOCIADA', '2026-10-05', HOJE)).toBe('fora');
    expect(estadoFaturaVisao('NOVADA', '2026-10-05', HOJE)).toBe('fora');
  });
  it('aberta/fechada: antes de hoje vencida; hoje e depois a vencer', () => {
    expect(estadoFaturaVisao('ABERTA', '2026-10-28', HOJE)).toBe('vencida');
    expect(estadoFaturaVisao('FECHADA', '2026-10-29', HOJE)).toBe('a_vencer');
    expect(estadoFaturaVisao('ABERTA', '2026-11-02', HOJE)).toBe('a_vencer');
  });
});

describe('chaveProdutoItemFatura — a linha nasce do item, não de lista fixa', () => {
  it('serviço é identificado pela descrição, sem a marca (legado)', () => {
    expect(chaveProdutoItemFatura({ tipo: 'SERVICO', descricao: 'Proteção veicular (legado)', valor: 5000 })).toEqual({ chave: 'protecao_veicular', rotulo: 'Proteção veicular', foraDoTeto: false });
    expect(chaveProdutoItemFatura({ tipo: 'servico', descricao: 'Clube de benefícios', valor: 5000 }).chave).toBe('clube_de_beneficios');
  });
  it('principal segue o contrato: veículo, reembolso, crédito; cota de acordo vence o tipo', () => {
    expect(chaveProdutoItemFatura({ tipo: 'PRINCIPAL', descricao: 'x', valor: 1, tipoContrato: 'veiculo' }).chave).toBe('compra_parcelada');
    expect(chaveProdutoItemFatura({ tipo: 'PRINCIPAL', descricao: 'x', valor: 1, tipoContrato: 'reembolso' }).chave).toBe('reembolso_parcelado');
    expect(chaveProdutoItemFatura({ tipo: 'PRINCIPAL', descricao: 'x', valor: 1, tipoContrato: 'credito' }).chave).toBe('credito_avulso');
    expect(chaveProdutoItemFatura({ tipo: 'PRINCIPAL', descricao: 'x', valor: 1, tipoContrato: 'veiculo', origemItem: 'ACORDO' }).chave).toBe('acordo');
  });
  it('sem contexto de parcela, a descrição decide (legado migrado)', () => {
    expect(chaveProdutoItemFatura({ tipo: 'PRINCIPAL', descricao: 'Renegociação parcela 2/4', valor: 1 }).chave).toBe('acordo');
    expect(chaveProdutoItemFatura({ tipo: 'PRINCIPAL', descricao: 'Reembolso Parcelado · IPVA 2/3', valor: 1 }).chave).toBe('reembolso_parcelado');
    expect(chaveProdutoItemFatura({ tipo: 'PRINCIPAL', descricao: 'Parcela 3/48', valor: 1 }).chave).toBe('compra_parcelada');
  });
  it('encargo fica fora do teto; intermediária tem linha própria', () => {
    expect(chaveProdutoItemFatura({ tipo: 'ENCARGO', descricao: 'Multa e juros de atraso (legado)', valor: 1 }).foraDoTeto).toBe(true);
    expect(chaveProdutoItemFatura({ tipo: 'INTERMEDIARIA', descricao: 'Intermediária 2 (entrada diluída)', valor: 1 }).chave).toBe('intermediaria');
  });
});

describe('agregarVisaoCarteira — teto = pagas + vencidas + a vencer (por vencimento)', () => {
  const faturas: FaturaVisao[] = [
    fat({ contaId: 'A', status: 'PAGA', vencimento: '2026-10-05', valorPago: 99700 }),
    fat({ contaId: 'A', status: 'PAGA_EM_ATRASO', vencimento: '2026-10-12', valorPago: 101727 }), // 2.027 de encargo pago por fora
    fat({ contaId: 'B', status: 'ABERTA', vencimento: '2026-10-26' }), // vencida
    fat({ contaId: 'B', status: 'FECHADA', vencimento: '2026-10-29' }), // vence hoje → a vencer
    fat({ contaId: 'C', status: 'RENEGOCIADA', vencimento: '2026-10-19' }), // fora
    {
      contaId: 'C', status: 'PAGA', vencimento: '2026-10-20', valorTotal: 170330, valorPago: 174303,
      itens: [
        { tipo: 'PRINCIPAL', descricao: 'Parcela 15/48 · Compra Parcelada Ka', valor: 142000, tipoContrato: 'veiculo' },
        { tipo: 'PRINCIPAL', descricao: 'Reembolso Parcelado · regularização 7/12', valor: 28330, tipoContrato: 'reembolso' },
        { tipo: 'ENCARGO', descricao: 'Multa e juros de atraso (legado)', valor: 3973 },
      ],
    },
  ];
  const v = agregarVisaoCarteira(faturas, HOJE);

  it('soma valores, faturas e clientes distintos por estado; renegociada não entra', () => {
    expect(v.teto).toEqual({ valor: 99700 * 4 + 170330, faturas: 5, clientes: 3 });
    expect(v.pagas).toEqual({ valor: 99700 * 2 + 170330, faturas: 3, clientes: 2, valorPago: 99700 + 101727 + 174303 });
    expect(v.vencidas).toEqual({ valor: 99700, faturas: 1, clientes: 1 });
    expect(v.aVencer).toEqual({ valor: 99700, faturas: 1, clientes: 1 });
    expect(v.pagas.valor + v.vencidas.valor + v.aVencer.valor).toBe(v.teto.valor);
  });

  it('por produto: uma linha por chave, teto e pago do período; sem caixa, recebido é zero', () => {
    const chaves = v.porProduto.map((p) => p.chave);
    expect(chaves).toEqual(['compra_parcelada', 'reembolso_parcelado', 'protecao_veicular', 'taxa_de_boleto_e_pix']);
    const cp = v.porProduto.find((p) => p.chave === 'compra_parcelada')!;
    expect(cp.teto).toBe(94200 * 4 + 142000);
    expect(cp.pagoDoPeriodo).toBe(94200 * 2 + 142000);
    expect(cp.recebido).toBe(0);
    const rp = v.porProduto.find((p) => p.chave === 'reembolso_parcelado')!;
    expect(rp).toMatchObject({ teto: 28330, pagoDoPeriodo: 28330, rotulo: 'Reembolso Parcelado' });
    expect(v.recebido.valor).toBe(0);
    expect(v.encargosRecebidos).toBe(0);
  });

  it('recebido é CAIXA: faturas pagas no período de qualquer vencimento + entradas; encargo = excedente pago', () => {
    const periodo = { de: '2026-10-01', ate: '2026-10-31' };
    const recebimentos: RecebimentoVisao[] = [
      // fatura do período, paga em dia
      { contaId: 'A', origem: 'fatura', dataPagamento: '2026-10-05', valor: 99700, vencimento: '2026-10-05', valorTotal: 99700, itens: fat({ contaId: 'A', status: 'PAGA', vencimento: '2026-10-05' }).itens },
      // fatura de SETEMBRO paga em outubro, com 2.027 de encargo
      { contaId: 'A', origem: 'fatura', dataPagamento: '2026-10-12', valor: 101727, vencimento: '2026-09-28', valorTotal: 99700, itens: fat({ contaId: 'A', status: 'PAGA_EM_ATRASO', vencimento: '2026-09-28' }).itens },
      // entradas avulsas
      { contaId: 'D', origem: 'entrada_contrato', dataPagamento: '2026-10-08', valor: 399000 },
      { contaId: 'B', origem: 'entrada_acordo', dataPagamento: '2026-10-30', valor: 86108 },
    ];
    const c = agregarVisaoCarteira(faturas, HOJE, { recebimentos, periodo });
    expect(c.recebido).toEqual({
      valor: 99700 + 101727 + 399000 + 86108,
      recebimentos: 4,
      clientes: 3,
      faturasDoPeriodo: 99700,
      faturasDeOutrosPeriodos: 101727,
      entradas: 399000 + 86108,
      encargos: 2027,
    });
    expect(c.encargosRecebidos).toBe(2027);
    // por vencimento não muda com o caixa
    expect(c.pagas.valor + c.vencidas.valor + c.aVencer.valor).toBe(c.teto.valor);
    // por produto: recebido (caixa) soma os itens das DUAS faturas pagas; entradas são linhas sem teto, no fim
    const cp = c.porProduto.find((p) => p.chave === 'compra_parcelada')!;
    expect(cp.recebido).toBe(94200 * 2);
    expect(cp.pagoDoPeriodo).toBe(94200 * 2 + 142000);
    const ult = c.porProduto.slice(-2).map((p) => [p.chave, p.teto, p.recebido]);
    expect(ult).toEqual([['entrada_contrato', 0, 399000], ['entrada_acordo', 0, 86108]]);
  });

  it('período vazio devolve zeros, não erro', () => {
    const z = agregarVisaoCarteira([], HOJE);
    expect(z.teto).toEqual({ valor: 0, faturas: 0, clientes: 0 });
    expect(z.recebido.valor).toBe(0);
    expect(z.porProduto).toEqual([]);
  });
});

describe('agregarVisaoMensal — faturas pelo mês de vencimento, recebimentos pelo mês de pagamento', () => {
  it('separa por YYYY-MM e mantém o mesmo cálculo', () => {
    const m = agregarVisaoMensal([
      fat({ contaId: 'A', status: 'PAGA', vencimento: '2026-09-28' }),
      fat({ contaId: 'A', status: 'ABERTA', vencimento: '2026-11-02' }),
      fat({ contaId: 'B', status: 'PAGA', vencimento: '2026-09-07' }),
    ], HOJE, [
      // a fatura de 28/09 só entrou no caixa em outubro: setembro tem teto, outubro tem caixa
      { contaId: 'A', origem: 'fatura', dataPagamento: '2026-10-02', valor: 99700, vencimento: '2026-09-28', valorTotal: 99700 },
    ]);
    expect(m.map((x) => x.mes)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(m[0].teto).toEqual({ valor: 199400, faturas: 2, clientes: 2 });
    expect(m[0].recebido.valor).toBe(0);
    expect(m[1].teto.valor).toBe(0);
    expect(m[1].recebido).toMatchObject({ valor: 99700, faturasDeOutrosPeriodos: 99700, faturasDoPeriodo: 0 });
    expect(m[2].aVencer.faturas).toBe(1);
  });
});

describe('variacaoPct', () => {
  it('inteiro, com sinal; sem base devolve null', () => {
    expect(variacaoPct(110, 100)).toBe(10);
    expect(variacaoPct(90, 100)).toBe(-10);
    expect(variacaoPct(5, 0)).toBeNull();
  });
});

import { periodoDoMes, mesAnterior, mesSeguinte, periodoAnteriorMesmoTrecho } from './carteira-visao';

describe('períodos da visão — mesmo trecho do mês anterior (doc 02 §27.4)', () => {
  it('mês em curso: 1–29/out compara com 1–29/set', () => {
    expect(periodoAnteriorMesmoTrecho(periodoDoMes('2026-10'), '2026-10-29', '2026-10')).toEqual({
      atual: { de: '2026-10-01', ate: '2026-10-29' },
      anterior: { de: '2026-09-01', ate: '2026-09-29' },
    });
  });
  it('mês fechado compara inteiro com inteiro; fevereiro não transborda', () => {
    expect(periodoAnteriorMesmoTrecho(periodoDoMes('2026-09'), '2026-10-29', '2026-09')).toEqual({
      atual: { de: '2026-09-01', ate: '2026-09-30' },
      anterior: { de: '2026-08-01', ate: '2026-08-30' },
    });
    expect(periodoAnteriorMesmoTrecho(periodoDoMes('2026-03'), '2026-10-29', '2026-03')!.anterior).toEqual({ de: '2026-02-01', ate: '2026-02-28' });
  });
  it('semana em curso: 26–29/10 compara com 19–22/10', () => {
    expect(periodoAnteriorMesmoTrecho({ de: '2026-10-26', ate: '2026-11-01' }, '2026-10-29')).toEqual({
      atual: { de: '2026-10-26', ate: '2026-10-29' },
      anterior: { de: '2026-10-19', ate: '2026-10-22' },
    });
  });
  it('período futuro não compara', () => {
    expect(periodoAnteriorMesmoTrecho(periodoDoMes('2026-12'), '2026-10-29', '2026-12')).toBeNull();
  });
  it('mês anterior/seguinte viram o ano', () => {
    expect(mesAnterior('2026-01')).toBe('2025-12');
    expect(mesSeguinte('2026-12')).toBe('2027-01');
    expect(periodoDoMes('2026-02')).toEqual({ de: '2026-02-01', ate: '2026-02-28' });
  });
});
