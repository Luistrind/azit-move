import { describe, it, expect } from 'vitest';
import {
  aplicarPagamentoNaConta,
  cascataValida,
  CASCATA_PADRAO,
  encargoAte,
  grupoCascataDoItem,
  minimoParcialFatura,
  PARAMETROS_MOTOR_PADRAO,
  projetarConta,
  projetarEstados,
  reconstituirFatura,
  regraParcial,
  totalDevidoEm,
  validarValorPagamento,
  type FaturaMotor,
  type GrupoCascata,
  type ItemMotor,
  type PagamentoMotor,
} from './fatura-motor';
import { chaveProdutoItemFatura } from './carteira-visao';

// Cenário do protótipo v3 conferido pelo Vicente (doc 02 §32.4): hoje =
// 09/11/2026; fatura de face R$ 1.049,00; multa 2%; atualização 1% a.m.
const HOJE = '2026-11-09';
const P = PARAMETROS_MOTOR_PADRAO;

function itens(prefixo: string): ItemMotor[] {
  const taxa = { multaPct: 2, atualizacaoMesPct: 1 };
  return [
    { id: `${prefixo}:veiculo`, grupo: 'PRINCIPAL', valor: 69900, ...taxa },
    { id: `${prefixo}:protecao`, grupo: 'PROTECAO', valor: 5000, ...taxa },
    { id: `${prefixo}:reemb`, grupo: 'ACESSORIOS', valor: 12000, ...taxa },
    { id: `${prefixo}:acordo`, grupo: 'ACESSORIOS', valor: 18000, ...taxa },
  ];
}
const fatura = (id: string, vencimento: string, pagamentos: PagamentoMotor[] = []): FaturaMotor => ({ id, vencimento, itens: itens(id), pagamentos });
const F1 = () => fatura('f1', '2026-10-26');
const F2 = () => fatura('f2', '2026-11-02');
const F3 = () => fatura('f3', '2026-11-09');
const F4 = () => fatura('f4', '2026-11-16');

describe('encargo da fatura AZIT (§32.4)', () => {
  it('vencida em 02/11 sem pagamento = R$ 1.072,43 (multa 20,98 + 7 dias 2,45)', () => {
    const k = projetarConta([F2()], HOJE);
    const f = k.faturas[0];
    expect(f.encargo).toMatchObject({ multa: 2098, atualizacao: 245, dias: 7 });
    expect(f.totalHoje).toBe(107243);
    expect(f.situacao).toBe('vencida');
  });

  it('fatura que vence hoje e fatura a vencer não têm encargo', () => {
    const k = projetarConta([F3(), F4()], HOJE);
    expect(k.faturas.map((f) => [f.situacao, f.totalHoje])).toEqual([['hoje', 104900], ['aberta', 104900]]);
  });

  it('D-03: R$ 540 pagos em 07/11 → em 09/11 correm 2 dias sobre 531,73 = 0,35; total 532,08', () => {
    const k = projetarConta([F2()], HOJE, [{ data: '2026-11-07', valor: 54000 }]);
    const f = k.faturas[0];
    expect(f.saldoNominal).toBe(53173);
    expect(f.encargo).toMatchObject({ multa: 0, atualizacao: 35, dias: 2, desde: '2026-11-07', multaJaPaga: true });
    expect(f.totalHoje).toBe(53208);
    expect(f.situacao).toBe('parcial');
    // O que os R$ 540 quitaram: multa 20,98 + 5 dias 1,75 + proteção + acessórios + 167,27 do principal.
    const quitou = Object.fromEntries(f.pagamentos[0].alocacoes.map((a) => [a.itemId ?? a.alvo, a.valor]));
    expect(quitou).toEqual({ MULTA: 2098, ATUALIZACAO: 175, 'f2:protecao': 5000, 'f2:reemb': 12000, 'f2:acordo': 18000, 'f2:veiculo': 16727 });
  });

  it('pagar R$ 600 em 09/11 na vencida → saldo 472,43; as duas partes somam 1.072,43', () => {
    const k = projetarConta([F2()], HOJE, [{ data: HOJE, valor: 60000 }]);
    expect(k.faturas[0].totalHoje).toBe(47243);
    expect(60000 + k.faturas[0].totalHoje).toBe(107243);
  });

  it('parcial de 540 em 07/11 + quitação em 09/11 = 1.072,08; encargos pagos 20,98 e 2,10', () => {
    const k = projetarConta([F2()], HOJE, [
      { data: '2026-11-07', valor: 54000 },
      { data: HOJE, valor: 53208 },
    ]);
    const f = k.faturas[0];
    expect(f.situacao).toBe('paga');
    expect(f.pagoTotal).toBe(107208);
    expect(f.encargosPagos).toEqual({ multa: 2098, atualizacao: 210 });
    expect(f.totalHoje).toBe(0);
  });

  it('multa é única: parcial que não cobre o encargo deixa o resto pendente, sem multa nova', () => {
    const e = reconstituirFatura(F2());
    aplicarPagamentoNaConta([e], { data: '2026-11-07', valor: 1000 }); // R$ 10 — menos que o encargo de 22,73
    // Rateio no nível dos encargos: multa 20,98 e atualização 1,75 na proporção; o último absorve o centavo.
    expect(e.encargosPagos).toEqual({ multa: 923, atualizacao: 77 });
    expect(e.pendente).toEqual({ multa: 1175, atualizacao: 98 });
    const enc = encargoAte(e, HOJE);
    expect(enc.multaNova).toBe(0); // não há multa nova
    expect(enc.multa).toBe(1175);
    expect(enc.atualizacao).toBe(98 + 70); // pendente + 2 dias sobre 1.049,00
  });

  it('pagamento ANTES do vencimento não antecipa a contagem da atualização', () => {
    const e = reconstituirFatura(F2());
    aplicarPagamentoNaConta([e], { data: '2026-10-30', valor: 40000 });
    // Sem encargo no dia do pagamento: proteção 50 + acessórios 300 + 50 do principal.
    expect(e.saldos.get('f2:veiculo')).toBe(64900);
    const enc = encargoAte(e, HOJE);
    expect(enc.dias).toBe(7); // desde o vencimento (02/11), não desde 30/10
    expect(enc.multaNova).toBe(1298); // 2% de 649,00
    expect(enc.atualizacaoNova).toBe(151); // 649,00 × 1%/30 × 7
  });

  it('itens de contratos com percentuais diferentes: cada saldo com a sua taxa', () => {
    const f: FaturaMotor = {
      id: 'x', vencimento: '2026-11-02', pagamentos: [],
      itens: [
        { id: 'a', grupo: 'PRINCIPAL', valor: 100000, multaPct: 2, atualizacaoMesPct: 1 },
        { id: 'b', grupo: 'ACESSORIOS', valor: 50000, multaPct: 0, atualizacaoMesPct: 3 },
      ],
    };
    const enc = encargoAte(reconstituirFatura(f), HOJE);
    expect(enc.multa).toBe(2000);
    expect(enc.atualizacao).toBe(Math.round(100000 * 0.01 / 30 * 7 + 50000 * 0.03 / 30 * 7));
  });
});

describe('baixa pela conta, da mais antiga para a mais nova (§32.4-A, §32.6-A)', () => {
  it('três faturas (26/10, 02/11, 09/11) = R$ 3.196,31; após R$ 2.000 = R$ 1.196,31', () => {
    const antes = projetarConta([F3(), F1(), F2()], HOJE); // ordem de entrada não importa
    expect(antes.faturas.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(antes.totalAberto).toBe(319631);
    expect(antes.acumulado).toEqual([107488, 214731, 319631]);
    const depois = projetarConta([F1(), F2(), F3()], HOJE, [{ data: HOJE, valor: 200000 }]);
    expect(depois.totalAberto).toBe(119631);
    expect(depois.faturas.map((f) => f.situacao)).toEqual(['paga', 'parcial', 'hoje']);
  });

  it('duas faturas (02/11, 09/11) com R$ 1.272,43 → a de 09/11 fica em R$ 849,00', () => {
    const estados = [F2(), F3()].map(reconstituirFatura);
    const r = aplicarPagamentoNaConta(estados, { data: HOJE, valor: 127243 });
    expect(r.excedente).toBe(0);
    expect(r.baixas.map((b) => [b.faturaId, b.valor, b.quitouFatura, b.emAtraso])).toEqual([
      ['f2', 107243, true, true],
      ['f3', 20000, false, false],
    ]);
    // Na de 09/11: Proteção 50 inteira; Reembolso 60 e Acordo 90 no rateio do nível.
    expect(r.baixas[1].alocacoes).toEqual([
      { alvo: 'ITEM', itemId: 'f3:protecao', valor: 5000, nivel: 2, quitou: true },
      { alvo: 'ITEM', itemId: 'f3:reemb', valor: 6000, nivel: 3, quitou: false },
      { alvo: 'ITEM', itemId: 'f3:acordo', valor: 9000, nivel: 3, quitou: false },
    ]);
    const k = projetarEstados(estados, HOJE);
    expect(k.abertas.map((f) => [f.id, f.totalHoje])).toEqual([['f3', 84900]]);
  });

  it('excedente: pago além de tudo o que a conta deve fica registrado, não some', () => {
    const estados = [F2(), F3()].map(reconstituirFatura);
    const r = aplicarPagamentoNaConta(estados, { data: HOJE, valor: 107243 + 104900 + 1234 });
    expect(r.excedente).toBe(1234);
    expect(r.baixas.every((b) => b.quitouFatura)).toBe(true);
    // Conta sem nada em aberto: o pagamento inteiro é excedente.
    expect(aplicarPagamentoNaConta(estados, { data: HOJE, valor: 500 })).toEqual({ baixas: [], excedente: 500 });
  });

  it('centavo do rateio: o último item do nível absorve a diferença e a soma fecha', () => {
    const f: FaturaMotor = {
      id: 'r', vencimento: '2026-11-16', pagamentos: [],
      itens: ['a', 'b', 'c'].map((id) => ({ id, grupo: 'ACESSORIOS' as GrupoCascata, valor: 3333, multaPct: 2, atualizacaoMesPct: 1 })),
    };
    const r = aplicarPagamentoNaConta([reconstituirFatura(f)], { data: HOJE, valor: 1000 });
    expect(r.baixas[0].alocacoes.map((a) => a.valor)).toEqual([333, 333, 334]);
    expect(r.baixas[0].alocacoes.reduce((s, a) => s + a.valor, 0)).toBe(1000);
  });

  it('a cascata é parâmetro: outra ordem muda quem recebe primeiro, sem if', () => {
    const principalPrimeiro: GrupoCascata[] = ['PRINCIPAL', 'ENCARGOS', 'PROTECAO', 'ACESSORIOS'];
    const r = aplicarPagamentoNaConta([reconstituirFatura(F3())], { data: HOJE, valor: 70000 }, principalPrimeiro);
    expect(r.baixas[0].alocacoes).toEqual([
      { alvo: 'ITEM', itemId: 'f3:veiculo', valor: 69900, nivel: 1, quitou: true },
      { alvo: 'ITEM', itemId: 'f3:protecao', valor: 100, nivel: 3, quitou: false },
    ]);
    expect(cascataValida(principalPrimeiro)).toBe(true);
    expect(cascataValida(['ENCARGOS', 'PROTECAO'])).toBe(false);
    expect(cascataValida(['ENCARGOS', 'ENCARGOS', 'PROTECAO', 'PRINCIPAL'])).toBe(false);
  });

  it('refazer a conta usa as alocações GRAVADAS: trocar a cascata depois não reescreve o passado', () => {
    const estados = [reconstituirFatura(F2())];
    const r = aplicarPagamentoNaConta(estados, { data: '2026-11-07', valor: 54000 });
    const gravado: PagamentoMotor = { data: '2026-11-07', valor: 54000, alocacoes: r.baixas[0].alocacoes };
    const refeito = reconstituirFatura(fatura('f2', '2026-11-02', [gravado]));
    expect(totalDevidoEm(refeito, HOJE)).toBe(53208);
    expect(refeito.multaLancada).toBe(true);
    expect(refeito.atualizacaoDesde).toBe('2026-11-07');
    expect(refeito.encargosPagos).toEqual({ multa: 2098, atualizacao: 175 });
  });
});

describe('pagar outro valor e seleção padrão (§32.6, §32.6-A)', () => {
  it('mínimo do parcial = maior entre 35% do valor de face e R$ 200 → R$ 367,15', () => {
    expect(minimoParcialFatura(104900, P)).toBe(36715);
    expect(minimoParcialFatura(40000, P)).toBe(20000); // 35% = 140 → vale o piso
  });

  it('uma fatura: mínimo FAT004 sobre a face, no primeiro parcial e nos seguintes', () => {
    expect(regraParcial(projetarConta([F2()], HOJE), P)).toEqual({ tipo: 'uma', minimo: 36715, maximo: 107243 });
    const depois = projetarConta([F2()], HOJE, [{ data: '2026-11-07', valor: 54000 }]);
    expect(regraParcial(depois, P)).toEqual({ tipo: 'uma', minimo: 36715, maximo: 53208 });
  });

  it('saldo já menor ou igual ao mínimo: não há parcial, só o total', () => {
    const k = projetarConta([F2()], HOJE, [{ data: HOJE, valor: 80000 }]);
    expect(k.faturas[0].totalHoje).toBe(27243);
    expect(regraParcial(k, P)).toEqual({ tipo: 'sem-parcial', minimo: 27243, maximo: 27243 });
  });

  it('duas ou mais vencidas ou de hoje: o mínimo é a mais antiga INTEIRA', () => {
    const k = projetarConta([F2(), F3()], HOJE);
    expect(regraParcial(k, P)).toEqual({ tipo: 'antiga', minimo: 107243, maximo: 212143 });
    expect(k.selecaoPadrao).toBe(2);
  });

  it('fatura a vencer não trava o parcial da única vencida, e fica fora da seleção padrão', () => {
    const k = projetarConta([F2(), F4()], HOJE);
    expect(regraParcial(k, P)).toEqual({ tipo: 'uma', minimo: 36715, maximo: 212143 });
    expect(k.selecaoPadrao).toBe(1);
    expect(k.totalVencido).toBe(107243);
    expect(k.totalAberto - k.totalVencido).toBe(104900);
    // Só a vencer: a seleção padrão é a mais antiga.
    expect(projetarConta([F4()], HOJE).selecaoPadrao).toBe(1);
  });

  it('conta sem nada em aberto não tem regra', () => {
    expect(regraParcial(projetarConta([], HOJE), P)).toBeNull();
  });

  it('validação do valor: "da mais antiga até…" exato ou outro valor dentro da regra', () => {
    const duas = projetarConta([F2(), F3()], HOJE);
    expect(validarValorPagamento(duas, P, 107243)).toEqual({ ok: true, outroValor: false, faturasCobertas: 1 });
    expect(validarValorPagamento(duas, P, 212143)).toEqual({ ok: true, outroValor: false, faturasCobertas: 2 });
    expect(validarValorPagamento(duas, P, 127243)).toEqual({ ok: true, outroValor: true, faturasCobertas: 1 });
    expect(validarValorPagamento(duas, P, 50000)).toMatchObject({ ok: false, motivo: 'abaixo_do_minimo' });
    expect(validarValorPagamento(duas, P, 212144)).toMatchObject({ ok: false, motivo: 'acima_do_total' });

    const uma = projetarConta([F2()], HOJE);
    expect(validarValorPagamento(uma, P, 36715)).toEqual({ ok: true, outroValor: true, faturasCobertas: 0 });
    expect(validarValorPagamento(uma, P, 36714)).toMatchObject({ ok: false, motivo: 'abaixo_do_minimo' });

    const quase = projetarConta([F2()], HOJE, [{ data: HOJE, valor: 80000 }]);
    expect(validarValorPagamento(quase, P, 27243)).toMatchObject({ ok: true, outroValor: false }); // quitação abaixo do mínimo
    expect(validarValorPagamento(quase, P, 20000)).toMatchObject({ ok: false, motivo: 'sem_parcial' });
    expect(validarValorPagamento(projetarConta([], HOJE), P, 100)).toMatchObject({ ok: false, motivo: 'nada_em_aberto' });
  });
});

describe('grupo da cascata sai da classificação única do item (§32.3 → §32.5)', () => {
  const grupo = (i: Parameters<typeof chaveProdutoItemFatura>[0]) => grupoCascataDoItem(chaveProdutoItemFatura(i));
  it('proteção, acessórios e principal', () => {
    expect(grupo({ tipo: 'SERVICO', descricao: 'Proteção veicular', valor: 5000, tipoContrato: 'veiculo' })).toBe('PROTECAO');
    expect(grupo({ tipo: 'PRINCIPAL', descricao: 'Parcela 3/48', valor: 1, tipoContrato: 'veiculo' })).toBe('PRINCIPAL');
    expect(grupo({ tipo: 'INTERMEDIARIA', descricao: 'Intermediária 2', valor: 1 })).toBe('PRINCIPAL');
    expect(grupo({ tipo: 'PRINCIPAL', descricao: 'x', valor: 1, tipoContrato: 'veiculo', origemItem: 'ACORDO' })).toBe('ACESSORIOS');
    expect(grupo({ tipo: 'PRINCIPAL', descricao: 'x', valor: 1, tipoContrato: 'reembolso' })).toBe('ACESSORIOS');
    expect(grupo({ tipo: 'SERVICO', descricao: 'Taxa de boleto e PIX', valor: 500 })).toBe('ACESSORIOS');
    expect(grupo({ tipo: 'SERVICO', descricao: 'Pró-rata 2 diárias', valor: 1, tipoContrato: 'veiculo' })).toBe('ACESSORIOS');
    expect(grupo({ tipo: 'ENCARGO', descricao: 'Multa e juros de atraso (legado)', valor: 1 })).toBe('ENCARGOS');
  });
  it('provisório (Regra 12): termo de novação é principal; crédito avulso é acessório', () => {
    expect(grupo({ tipo: 'PRINCIPAL', descricao: 'x', valor: 1, tipoContrato: 'termo_novacao' })).toBe('PRINCIPAL');
    expect(grupo({ tipo: 'PRINCIPAL', descricao: 'x', valor: 1, tipoContrato: 'credito' })).toBe('ACESSORIOS');
  });
  it('a cascata padrão é Encargos → Proteção → Acessórios → Principal', () => {
    expect(CASCATA_PADRAO).toEqual(['ENCARGOS', 'PROTECAO', 'ACESSORIOS', 'PRINCIPAL']);
  });
});
