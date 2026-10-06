import { describe, expect, it } from 'vitest';
import { camposFaltantesTermos, extrairTermosDoTexto, parcelamentoDosTermos, reaisTextoParaCentavos, termosEfetivos, TERMOS_VAZIOS } from './legado-termos';
import { contextoDosTermos, interpretarCobrancaLegada, partesRotuladas } from './legado-interpretacao';
import { conciliarLegado, type CobrancaConciliavel } from './legado-conciliacao';

// Texto no formato que o pdf-parse devolve para o modelo Mod06 (quebras de
// linha no meio das frases, rodapé de página, carimbo da assinatura). Dados
// pessoais FICTÍCIOS; a redação das cláusulas é a real.
const TEXTO_MOD06 = `CONTRATO DE PROMESSA DE COMPRA E VENDA DE VEÍCULO AUTOMOTOR
Nº202510002
Partes:
VENDEDOR: (POP CARROS) AZIT COMERCIO DE VEICULOS LTDA, pessoa jurídica de
direito privado, inscrita no CNPJ/MF sob o nº 57.265.780/0001-19, doravante denominada simplesmente “VENDEDOR”;
COMPRADOR:
A) Fulano Exemplo da Silva, brasileiro, solteiro, motorista de aplicativo, portador do CPF nº
529.982.247-25 e RG nº 12345678 SSP ES, residente e domiciliado na Rua Exemplo, 1, Vitória/ES, contato
WhatsApp 27 99999 0000, e-mail fulano@exemplo.com, doravante denominado
simplesmente “COMPRADOR”.
2. OBJETO DO CONTRATO
2.1. O presente Contrato tem por objeto a promessa de compra e venda do veículo automotor,
de propriedade do VENDEDOR, com as seguintes características:
Marca/Modelo: HYUNDAI/HB20S 1.0 COMFORT
Ano de Fabricação/Modelo: 2023/2024
Cor: Cinza
SuperSign: 58919783-9b8f-4688-a523-9f35aa437902

-- 1 of 16 --

Placa: SII 9B17
Chassi: 9BHCP41AARP486763
RENAVAM: 01363735141
Origem: Locadora
Tipo de Combustível: Flex
Quilometragem: 47.860
3. VALOR E FORMA DE PAGAMENTO
3.1. Valor Total:
O valor total da compra e venda do veículo objeto deste contrato é de R$160.430,00 (cento e
sessenta mil, quatrocentos e trinta reais).
3.2. Condições de Pagamento:
a) Entrada: R$2.500,00 (dois mil e quinhentos reais), pagos pelo COMPRADOR no ato da
assinatura deste contrato, a título de entrada.
b) Parcelas: R$ 155.430,00 (cento e cinquenta e cinco mil, quatrocentos e trinta reais), pagos
em 165 (cento e sessenta e cinco) parcelas semanais, iguais e sucessivas, no valor inicial de
R$ 942,00 (novecentos e quarenta e dois reais) cada, vencendo-se a primeira em 01/10/2025 e
as demais no mesmo dia das semanas subsequentes.
c) Parcelas Intermediárias: R$ 2.500,00 (dois mil e quinhentos reais), pagos em 5 (cinco)
parcelas semanais e sucessivas de R$ 500,00 (quinhentos reais) cada, vencendo-se a primeira
em 08/10/2025 e as demais no mesmo dia das semanas subsequentes.
3.3. Atualização Monetária:
As parcelas serão reajustadas anualmente, com base na variação acumulada do IPCA (Índice
Nacional de Preços ao Consumidor Amplo) dos últimos 12 (doze) meses.
3.6. Penalidades por Atraso:
Em caso de atraso no pagamento de qualquer parcela, incidirá multa de 2% (dois por cento)
sobre o valor em atraso, acrescida de juros moratórios de 1% (um por cento) ao mês.
5.2. Prazo da Garantia:
A garantia tem validade total, já incluindo a garantia legal e contratual, de 90 (noventa) dias
corridos, contados a partir da data da entrega do veículo ao COMPRADOR.
16. GARANTIA SOLIDÁRIA DO INTERVENIENTE GARANTIDOR (quando houver)
17. RESOLUÇÃO DE CONFLITOS
Vitória/ES, 01 de Outubro de 2025.
___________________________________________
`;

describe('extrairTermosDoTexto (modelo Mod06)', () => {
  const r = extrairTermosDoTexto(TEXTO_MOD06);
  it('reconhece o modelo e extrai número, data e comprador', () => {
    expect(r.modeloReconhecido).toBe(true);
    expect(r.termos.numeroOrigem).toBe('202510002');
    expect(r.termos.dataAssinatura).toBe('2025-10-01');
    expect(r.termos.compradorNome).toBe('Fulano Exemplo da Silva');
    expect(r.termos.compradorCpf).toBe('52998224725');
    expect(r.termos.garantidorCpf).toBeNull();
  });
  it('extrai o veículo inteiro, mesmo com a quebra de página no meio', () => {
    expect(r.termos.veiculo).toEqual({
      marca: 'HYUNDAI', modelo: 'HB20S 1.0 COMFORT', anoFabricacao: 2023, anoModelo: 2024, cor: 'Cinza',
      placa: 'SII9B17', chassi: '9BHCP41AARP486763', renavam: '01363735141', origem: 'locadora', combustivel: 'flex', quilometragem: 47860,
    });
  });
  it('extrai 3.1 e 3.2: total, entrada, parcelas (só o parcelamento) e intermediárias', () => {
    expect(r.termos.valorTotal).toBe(16_043_000);
    expect(r.termos.entradaValor).toBe(250_000);
    expect(r.termos.parcelas).toEqual({ total: 15_543_000, quantidade: 165, valor: 94_200, primeiraEm: '2025-10-01' });
    expect(r.termos.intermediarias).toEqual({ total: 250_000, quantidade: 5, valor: 50_000, primeiraEm: '2025-10-08' });
    // 165 × 942 = 155.430 — o contrato fecha
    expect(r.termos.parcelas.quantidade! * r.termos.parcelas.valor!).toBe(r.termos.parcelas.total);
  });
  it('extrai reajuste, multa, juros e garantia', () => {
    expect(r.termos.indiceReajuste).toBe('IPCA');
    expect(r.termos.multaAtrasoPct).toBe(2);
    expect(r.termos.jurosMensalPct).toBe(1);
    expect(r.termos.garantiaDias).toBe(90);
  });
  it('nada obrigatório falta neste contrato; seguro e taxa vêm com o padrão', () => {
    expect(r.faltantes).toEqual([]);
    expect(r.termos.seguroSemanal).toBe(5_000);
    expect(r.termos.taxaSemanal).toBe(500);
  });
  it('texto de outro modelo: não reconhece e lista o que falta', () => {
    const x = extrairTermosDoTexto('Recibo de sinal referente ao veículo Kwid, placa ABC1D23.');
    expect(x.modeloReconhecido).toBe(false);
    expect(x.faltantes).toContain('numeroOrigem');
    expect(x.faltantes).toContain('parcelas.valor');
  });
  it('reaisTextoParaCentavos', () => {
    expect(reaisTextoParaCentavos('R$ 1.423,07')).toBe(142_307);
    expect(reaisTextoParaCentavos('997')).toBe(99_700);
    expect(camposFaltantesTermos(TERMOS_VAZIOS).length).toBe(10);
  });
});

describe('interpretarCobrancaLegada', () => {
  const ctx = contextoDosTermos({ parcelas: { valor: 94_200 }, intermediarias: { valor: 50_000 }, entradaValor: 250_000, seguroSemanal: 5_000, taxaSemanal: 500 }, null);
  const interp = (descricao: string, valorOriginal: number, avulsa = false) => interpretarCobrancaLegada({ descricao, valorOriginal, avulsa, contexto: ctx });

  it('parcela padrão 997 = 942 + 50 + 5, sem dúvida', () => {
    expect(interp('Parcela semanal HB20 - R$ 942,00 parcela + R$ 50,00 seguro + R$ 5,00 taxa', 99_700)).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, seguro: 5_000, taxa: 500, intermediaria: 0, duvida: false });
  });
  it('parcela com a intermediária junto (997 + 500)', () => {
    expect(interp('Parcela semanal + intermediaria', 149_700)).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, intermediaria: 50_000, duvida: false });
  });
  it('intermediária cobrada à parte, pela descrição ou pelo valor', () => {
    expect(interp('Parcela intermediaria 2/5 (entrada diluida)', 50_000).tipo).toBe('intermediaria');
    expect(interp('', 50_000).tipo).toBe('intermediaria');
  });
  it('entrada no ato: sem dúvida quando o valor bate com o contrato', () => {
    expect(interp('ENTRADA HB20 - parte a vista', 250_000)).toMatchObject({ tipo: 'entrada', duvida: false });
    expect(interp('Entrada', 300_000)).toMatchObject({ tipo: 'entrada', duvida: false }); // parte da entrada — a conciliação soma
  });
  it('acordo e reembolso pela descrição', () => {
    expect(interp('ACORDO - 2 parcelas em atraso com desconto de juros', 150_000).tipo).toBe('acordo');
    expect(interp('Reembolso IPVA 2026 1/3', 45_000).tipo).toBe('reembolso');
    expect(interp('Manutencao - troca de pneus', 80_000).tipo).toBe('reembolso');
    expect(interp('Multa de transito AIT 123', 29_347).tipo).toBe('reembolso');
  });
  it('a multa contratual de 2% na descrição não vira reembolso', () => {
    expect(interp('Parcela semanal (multa de 2% em atraso)', 99_700).tipo).toBe('parcela');
  });
  it('seguro e taxa lidos da descrição quando diferentes do padrão', () => {
    const r = interp('Parcela R$ 942 + seguro R$ 60 + taxa R$ 5', 100_700);
    expect(r).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, seguro: 6_000, taxa: 500, duvida: false });
  });
  it('parcela fora do padrão fica em dúvida, com proposta de decomposição', () => {
    const r = interp('Parcela semanal', 80_000);
    expect(r.tipo).toBe('parcela');
    expect(r.duvida).toBe(true);
    expect(r.parcelamento).toBe(74_500);
  });
  it('sem descrição e sem padrão: outra, em dúvida', () => {
    expect(interp('', 12_345, true)).toMatchObject({ tipo: 'outra', duvida: true });
  });
  it('sem termos: infere a parcela contratual da parcela padrão cobrada (997 → 942)', () => {
    const c = contextoDosTermos(null, 99_700);
    expect(c.parcelaContratual).toBe(94_200);
    expect(interpretarCobrancaLegada({ descricao: null, valorOriginal: 99_700, avulsa: false, contexto: c })).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, duvida: false });
  });
});

describe('conciliarLegado', () => {
  const termos = {
    parcelas: { quantidade: 6, valor: 94_200, primeiraEm: '2026-08-05' },
    intermediarias: { quantidade: 2, valor: 50_000, primeiraEm: '2026-08-12' },
    entradaValor: 250_000,
    seguroSemanal: 5_000,
    taxaSemanal: 500,
  };
  const cob = (id: string, vencimento: string, valorOriginal: number, extra: Partial<CobrancaConciliavel> = {}): CobrancaConciliavel => ({
    id, vencimento, valorOriginal, valorPago: null, pagoEm: null, classe: 'pendente', tipo: 'parcela', intermediariaEmbutida: 0, descricao: null, ...extra,
  });
  const paga = (id: string, venc: string, valor: number, pagoEm = venc, valorPago = valor, extra: Partial<CobrancaConciliavel> = {}) => cob(id, venc, valor, { classe: 'paga', pagoEm, valorPago, ...extra });

  it('casa parcela a parcela, intermediária junto e à parte, entrada, encargo e futuras', () => {
    const r = conciliarLegado({ modo: 'DATA',
      termos, hoje: '2026-09-10',
      cobrancas: [
        paga('e', '2026-08-05', 250_000, '2026-08-05', 250_000, { tipo: 'entrada' }),
        paga('p1', '2026-08-05', 99_700),
        paga('p2', '2026-08-12', 149_700, '2026-08-12', 149_700, { intermediariaEmbutida: 50_000 }), // parcela + intermediária 1
        paga('p3', '2026-08-19', 99_700, '2026-08-25', 101_200), // paga com atraso e juros
        paga('i2', '2026-08-19', 50_000, '2026-08-19', 50_000, { tipo: 'intermediaria' }),
        cob('p4', '2026-08-26', 99_700, { classe: 'vencida' }),
        cob('p5', '2026-09-02', 90_000, { classe: 'vencida' }), // valor errado
        // p6 (09/09) não foi emitida; 16/09 seria futura (só 6 parcelas)
        paga('a', '2026-09-01', 30_000, '2026-09-01', 30_000, { tipo: 'acordo' }),
      ],
    });
    const porChave = Object.fromEntries(r.linhas.map((l) => [l.chave, l]));
    expect(porChave['entrada'].situacao).toBe('paga');
    expect(porChave['parcela:1'].situacao).toBe('paga');
    expect(porChave['parcela:2']).toMatchObject({ situacao: 'paga', esperadoValor: 149_700 });
    expect(porChave['parcela:3']).toMatchObject({ situacao: 'paga_com_encargo', encargo: 1_500 });
    expect(porChave['intermediaria:2']).toMatchObject({ situacao: 'paga', cobrancaId: 'i2' });
    expect(porChave['intermediaria:1']).toBeUndefined(); // veio embutida na parcela 2
    expect(porChave['parcela:4'].situacao).toBe('vencida');
    expect(porChave['parcela:5']).toMatchObject({ situacao: 'valor_diverge', divergencia: true });
    expect(porChave['parcela:6']).toMatchObject({ situacao: 'nao_cobrada', divergencia: true });
    expect(r.fora).toHaveLength(1);
    expect(r.fora[0]).toMatchObject({ cobrancaId: 'a', tipo: 'acordo', divergencia: false });
    expect(r.resumo).toMatchObject({
      parcelasEsperadas: 6, parcelasPagas: 3, parcelasVencidas: 1, parcelasNaoCobradas: 1, parcelasFuturas: 0,
      intermediariasEsperadas: 2, intermediariasPagas: 2, entradaPaga: true, encargosPagos: 1_500,
      saldoContratualRestante: 3 * 94_200, divergencias: 2, cobrancasForaDoCronograma: 1,
    });
  });

  it('tolera até 3 dias de diferença na data e marca futura o que ainda não venceu', () => {
    const r = conciliarLegado({
      termos: { ...termos, intermediarias: null, entradaValor: null }, hoje: '2026-08-14',
      cobrancas: [paga('p1', '2026-08-07', 99_700), cob('p2', '2026-08-12', 99_700)],
    });
    expect(r.linhas.find((l) => l.chave === 'parcela:1')?.situacao).toBe('paga');
    expect(r.linhas.find((l) => l.chave === 'parcela:2')?.situacao).toBe('pendente');
    expect(r.linhas.filter((l) => l.situacao === 'futura')).toHaveLength(4);
    expect(r.resumo.divergencias).toBe(0);
  });

  it('parcela cobrada em data sem correspondência no cronograma é divergência (fora)', () => {
    const r = conciliarLegado({ modo: 'DATA',
      termos: { ...termos, intermediarias: null, entradaValor: null }, hoje: '2026-08-06',
      cobrancas: [paga('p1', '2026-08-05', 99_700), paga('x', '2026-07-01', 99_700)],
    });
    expect(r.fora.find((f) => f.cobrancaId === 'x')?.divergencia).toBe(true);
    expect(r.resumo.divergencias).toBe(1);
  });

  it('entrada sem cobrança no Asaas não é divergência (paga no ato)', () => {
    const r = conciliarLegado({ termos: { ...termos, intermediarias: null }, hoje: '2026-08-06', cobrancas: [paga('p1', '2026-08-05', 99_700)] });
    expect(r.linhas[0]).toMatchObject({ chave: 'entrada', situacao: 'nao_cobrada', divergencia: false });
    expect(r.resumo.entradaPaga).toBeNull();
  });

  it('termos incompletos: resultado vazio e incompleta=true', () => {
    const r = conciliarLegado({ termos: { ...termos, parcelas: { quantidade: null, valor: null, primeiraEm: null } }, hoje: '2026-08-06', cobrancas: [] });
    expect(r.incompleta).toBe(true);
    expect(r.linhas).toEqual([]);
  });
});

// Casos reais da produção (23/09): descrição estruturada com despesa junto da
// parcela, e entrada paga em várias transações.
describe('casos reais 23/09 — composição e entrada composta', () => {
  const ctx = contextoDosTermos({ parcelas: { valor: 94_200 }, intermediarias: { valor: 50_000 }, entradaValor: 250_000, seguroSemanal: 5_000, taxaSemanal: 500 }, null);
  const interp = (descricao: string, valorOriginal: number) => interpretarCobrancaLegada({ descricao, valorOriginal, avulsa: false, contexto: ctx });

  it('parcela + manutenção na mesma cobrança: é PARCELA, com a despesa como extra', () => {
    const r = interp('Contrato - Parcela semanal: R$ 942,00 / Proteção Veicular - Repasse: R$ 50,00 / Taxas Boleto Pix - Repasse: R$ 5,00 / Manutenção Periodica R$ 225,75', 122_275);
    expect(r).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, seguro: 5_000, taxa: 500, extra: 22_575, extraRotulo: 'Manutenção Periodica', duvida: false });
    const r2 = interp('Contrato - Parcela semanal: R$ 942,00 / Proteção Veicular - Repasse: R$ 50,00 / Taxas Boleto Pix - Repasse: R$ 5,00 / Manutenção Corretiva R$ 331,36 - 01/04.', 132_836);
    expect(r2).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, extra: 33_136, duvida: false });
  });
  it('vale o valor do CONTRATO, não o padrão 997: parcela contratual de 1.100 lida da descrição não fica em dúvida', () => {
    const c2 = contextoDosTermos({ parcelas: { valor: 110_000 }, intermediarias: null, entradaValor: null, seguroSemanal: 5_000, taxaSemanal: 500 }, null);
    const r = interpretarCobrancaLegada({ descricao: 'Contrato - Parcela semanal: R$ 1.100,00 / Proteção Veicular: R$ 50,00 / Taxa Pix: R$ 5,00', valorOriginal: 115_500, avulsa: false, contexto: c2 });
    expect(r).toMatchObject({ tipo: 'parcela', parcelamento: 110_000, seguro: 5_000, taxa: 500, duvida: false });
  });
  it('partes soltas ("R$ 50 seguro + R$ 5 taxa") não passam pelo parser estruturado', () => {
    expect(partesRotuladas('Parcela semanal HB20 - R$ 942,00 parcela + R$ 50,00 seguro + R$ 5,00 taxa')).toEqual([]);
  });
  it('reserva da placa e complemento de entrada são partes da entrada', () => {
    expect(interp('Taxa de reserva da Placa: SIQ 4E66', 50_000).tipo).toBe('entrada');
    expect(interp('Complemento de entrada da Placa: SIQ 4E66.', 50_000).tipo).toBe('entrada');
  });

  it('conciliação: entrada em 3 transações soma 2.500 = paga, sem divergência; parcela com manutenção casa pela composição', () => {
    const termos = { parcelas: { quantidade: 3, valor: 94_200, primeiraEm: '2025-09-09' }, intermediarias: null, entradaValor: 250_000, seguroSemanal: 5_000, taxaSemanal: 500 };
    const base = { valorPago: null as number | null, pagoEm: null as string | null, classe: 'paga' as const, intermediariaEmbutida: 0, parcelamento: null as number | null, extra: 0, extraRotulo: null as string | null, encargoEmbutido: 0, descricao: null as string | null };
    const r = conciliarLegado({
      termos, hoje: '2025-10-01',
      cobrancas: [
        { ...base, id: 'e1', vencimento: '2025-08-30', valorOriginal: 50_000, valorPago: 50_000, pagoEm: '2025-08-30', tipo: 'entrada' },
        { ...base, id: 'e2', vencimento: '2025-09-01', valorOriginal: 150_000, valorPago: 150_000, pagoEm: '2025-09-01', tipo: 'entrada' },
        { ...base, id: 'e3', vencimento: '2025-09-02', valorOriginal: 50_000, valorPago: 50_000, pagoEm: '2025-09-02', tipo: 'entrada' },
        { ...base, id: 'p1', vencimento: '2025-09-09', valorOriginal: 99_700, valorPago: 99_700, pagoEm: '2025-09-09', tipo: 'parcela', parcelamento: 94_200 },
        { ...base, id: 'p2', vencimento: '2025-09-16', valorOriginal: 122_275, valorPago: 122_275, pagoEm: '2025-09-16', tipo: 'parcela', parcelamento: 94_200, extra: 22_575, extraRotulo: 'Manutenção Periodica' },
        { ...base, id: 'p3', vencimento: '2025-09-23', valorOriginal: 99_700, valorPago: 99_700, pagoEm: '2025-09-23', tipo: 'parcela', parcelamento: 94_200 },
      ],
    });
    const entrada = r.linhas.find((l) => l.chave === 'entrada')!;
    expect(entrada).toMatchObject({ situacao: 'paga', divergencia: false, cobradoValor: 250_000, pagoValor: 250_000 });
    expect(entrada.partes.map((x) => x.valor)).toEqual([50_000, 150_000, 50_000]);
    const p2 = r.linhas.find((l) => l.chave === 'parcela:2')!;
    expect(p2).toMatchObject({ situacao: 'paga', divergencia: false, cobradoValor: 122_275, esperadoValor: 99_700 });
    expect(p2.componentes).toMatchObject({ extra: 22_575, extraRotulo: 'Manutenção Periodica' });
    expect(r.fora).toHaveLength(0);
    expect(r.resumo).toMatchObject({ parcelasPagas: 3, entradaPaga: true, divergencias: 0 });
  });

  it('conciliação: entrada que soma menos que o contrato diverge, e as partes ficam visíveis', () => {
    const termos = { parcelas: { quantidade: 1, valor: 94_200, primeiraEm: '2025-09-09' }, intermediarias: null, entradaValor: 250_000, seguroSemanal: 5_000, taxaSemanal: 500 };
    const base = { valorPago: null as number | null, pagoEm: null as string | null, classe: 'paga' as const, intermediariaEmbutida: 0, parcelamento: null as number | null, extra: 0, extraRotulo: null as string | null, encargoEmbutido: 0, descricao: null as string | null };
    const r = conciliarLegado({ termos, hoje: '2025-10-01', cobrancas: [{ ...base, id: 'e1', vencimento: '2025-09-01', valorOriginal: 150_000, valorPago: 150_000, pagoEm: '2025-09-01', tipo: 'entrada' }] });
    const entrada = r.linhas.find((l) => l.chave === 'entrada')!;
    expect(entrada).toMatchObject({ situacao: 'valor_diverge', divergencia: true, cobradoValor: 150_000 });
    expect(entrada.partes).toHaveLength(1);
  });
});

// Caso real 23/09: parcela reemitida por atraso, com juros embutidos no valor
// e "Multa e juros por atraso" sem valor na descrição.
describe('parcela reemitida por atraso', () => {
  const ctx = contextoDosTermos({ parcelas: { valor: 94_200 }, intermediarias: null, entradaValor: null, seguroSemanal: 5_000, taxaSemanal: 500 }, null);
  it('leitura: é PARCELA com o encargo embutido (não reembolso)', () => {
    const r = interpretarCobrancaLegada({ descricao: 'Contrato - Parcela semanal: R$ 942,00 / Proteção Veicular - Repasse: R$ 50,00 / Taxas Boleto Pix - Repasse: R$ 5,00 / Multa e juros por atraso.', valorOriginal: 102_691, avulsa: false, contexto: ctx });
    expect(r).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, seguro: 5_000, taxa: 500, extra: 0, encargo: 2_991, duvida: false });
  });
  it('conciliação: a reemitida (venc. +7 dias) fecha a parcela vazia da semana anterior; a paga adiantada fica na sua', () => {
    const termos = { parcelas: { quantidade: 3, valor: 94_200, primeiraEm: '2026-01-29' }, intermediarias: null, entradaValor: null, seguroSemanal: 5_000, taxaSemanal: 500 };
    const base = { valorPago: null as number | null, pagoEm: null as string | null, classe: 'paga' as const, intermediariaEmbutida: 0, parcelamento: 94_200 as number | null, extra: 0, extraRotulo: null as string | null, encargoEmbutido: 0, descricao: null as string | null, tipo: 'parcela' as const };
    const r = conciliarLegado({ modo: 'DATA',
      termos, hoje: '2026-03-01',
      cobrancas: [
        { ...base, id: 'p16', vencimento: '2026-01-29', valorOriginal: 99_700, valorPago: 99_700, pagoEm: '2026-01-29' },
        // parcela 17 (05/02) não foi paga; reemitida em 12/02 com juros
        { ...base, id: 'p17r', vencimento: '2026-02-12', valorOriginal: 102_691, valorPago: 102_691, pagoEm: '2026-02-12', encargoEmbutido: 2_991 },
        // parcela 18 (12/02) paga adiantada em 06/02
        { ...base, id: 'p18', vencimento: '2026-02-12', valorOriginal: 99_700, valorPago: 99_700, pagoEm: '2026-02-06' },
      ],
    });
    const l = Object.fromEntries(r.linhas.map((x) => [x.chave, x]));
    expect(l['parcela:1'].situacao).toBe('paga');
    expect(l['parcela:2']).toMatchObject({ cobrancaId: 'p17r', situacao: 'paga_com_encargo', encargo: 2_991, divergencia: false });
    expect(l['parcela:2'].observacao).toContain('reemitida');
    expect(l['parcela:3']).toMatchObject({ cobrancaId: 'p18', situacao: 'paga' });
    expect(r.fora).toHaveLength(0);
    expect(r.resumo).toMatchObject({ parcelasPagas: 3, divergencias: 0, encargosPagos: 2_991 });
  });
});

// Caso real 23/09 (parcela 37): reemitida com juros no valor, SEM aviso na descrição.
describe('juros embutidos sem aviso na descrição', () => {
  const ctx = contextoDosTermos({ parcelas: { valor: 94_200 }, intermediarias: null, entradaValor: null, seguroSemanal: 5_000, taxaSemanal: 500 }, null);
  const desc = 'Contrato - Parcela semanal: R$ 942,00 / Proteção Veicular - Repasse: R$ 50,00 / Taxas Boleto Pix - Repasse: R$ 5,00.';
  it('1.017,27 com partes de 997: parcela, juros 20,27, sem dúvida', () => {
    expect(interpretarCobrancaLegada({ descricao: desc, valorOriginal: 101_727, avulsa: false, contexto: ctx })).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, encargo: 2_027, duvida: false });
  });
  it('resto acima de 20% das partes não vira juros de graça: fica em dúvida', () => {
    const r = interpretarCobrancaLegada({ descricao: desc, valorOriginal: 150_000, avulsa: false, contexto: ctx });
    expect(r.duvida).toBe(true);
  });
});

// Caso real 23/09 (José Luiz): separador "//", "$1.320.00", cota sem valor,
// parcela paga em duas transações ("Acordo semana do dia 26/02") e vínculo manual.
describe('caso José Luiz — //, $1.320.00, cota sem valor, parcela em partes, vínculo manual', () => {
  const ctx = contextoDosTermos({ parcelas: { valor: 94_200 }, intermediarias: null, entradaValor: null, seguroSemanal: 5_000, taxaSemanal: 500 }, null);
  const cabeca = 'Contrato - Parcela semanal: R$ 942,00 / Proteção Veicular - Repasse: R$ 50,00 / Taxas Boleto Pix - Repasse: R$ 5,00';
  const interp = (descricao: string, valorOriginal: number) => interpretarCobrancaLegada({ descricao, valorOriginal, avulsa: false, contexto: ctx });

  it('"// 1ª Cota do IPVA 2026" sem valor: a cota é o que sobra (260)', () => {
    expect(interp(`${cabeca}// 1ª Cota do IPVA 2026`, 125_700)).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, seguro: 5_000, taxa: 500, extra: 26_000, encargo: 0, duvida: false });
    expect(interp(`${cabeca}// 1ª Cota do IPVA 2026`, 125_700).extraRotulo).toMatch(/IPVA/);
  });
  it('"// Manutenção $1.320.00 (1/5)": o valor escrito é o total do parcelamento, a cota é o que sobra (310)', () => {
    expect(interp(`${cabeca}// Manutenção $1.320.00 (1/5)`, 130_700)).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, extra: 31_000, encargo: 0, duvida: false });
  });
  it('"// Parcelamenti $323,00": valor escrito fecha com o que sobra', () => {
    expect(interp(`${cabeca}// Parcelamenti $323,00`, 132_000)).toMatchObject({ tipo: 'parcela', parcelamento: 94_200, extra: 32_300, encargo: 0, duvida: false });
  });
  it('partesRotuladas lê "$1.320.00" como 1.320,00 e "//" como separador', () => {
    const p = partesRotuladas(`${cabeca}// Manutenção $1.320.00 (1/5)`);
    expect(p.map((x) => [x.papel, x.valor])).toEqual([['parcelamento', 94_200], ['seguro', 5_000], ['taxa', 500], ['extra', 132_000]]);
  });

  const termos = { parcelas: { quantidade: 3, valor: 94_200, primeiraEm: '2026-02-19' }, intermediarias: null, entradaValor: null, seguroSemanal: 5_000, taxaSemanal: 500 };
  const base = { valorPago: null as number | null, pagoEm: null as string | null, classe: 'paga' as const, intermediariaEmbutida: 0, parcelamento: null as number | null, extra: 0, extraRotulo: null as string | null, encargoEmbutido: 0, descricao: null as string | null, tipo: 'parcela' as const };
  const cobrancas: CobrancaConciliavel[] = [
    { ...base, id: 'p12', vencimento: '2026-02-19', valorOriginal: 99_700, valorPago: 99_700, pagoEm: '2026-02-19', parcelamento: 94_200 },
    // parcela 13 (26/02) paga em duas transações: 498,50 no dia + "Acordo semana do dia 26/02" 498,50 no dia seguinte
    { ...base, id: 'p13a', vencimento: '2026-02-26', valorOriginal: 49_850, valorPago: 49_850, pagoEm: '2026-02-26' },
    { ...base, id: 'p13b', vencimento: '2026-02-27', valorOriginal: 49_850, valorPago: 49_850, pagoEm: '2026-02-27', tipo: 'acordo' as const, descricao: 'Acordo semana do dia 26/02' },
    // parcela 14 (05/03) não cobrada; cobrança avulsa de 997 em 20/03 que só o operador sabe que é a 14
    { ...base, id: 'p14x', vencimento: '2026-03-20', valorOriginal: 99_700, valorPago: 99_700, pagoEm: '2026-03-20', tipo: 'outra' as const },
  ];

  it('conciliação: parcela 13 fecha com as duas partes, sem divergência', () => {
    const r = conciliarLegado({ termos, hoje: '2026-04-01', cobrancas });
    const l = Object.fromEntries(r.linhas.map((x) => [x.chave, x]));
    expect(l['parcela:1']).toMatchObject({ cobrancaId: 'p12', situacao: 'paga' });
    expect(l['parcela:2']).toMatchObject({ cobradoValor: 99_700, pagoValor: 99_700, situacao: 'paga', divergencia: false, cobrancaId: null });
    expect(l['parcela:2'].partes.map((x) => x.cobrancaId)).toEqual(['p13a', 'p13b']);
    expect(l['parcela:2'].observacao).toContain('2 transações');
    // a 14 continua sem cobrança; a de 20/03 (tipo outra) fica fora
    expect(l['parcela:3'].situacao).not.toBe('paga');
    expect(r.fora.map((x) => x.cobrancaId)).toEqual(['p14x']);
  });

  it('vínculo manual: a cobrança de 20/03 apontada para a parcela 14 fecha a linha, sem divergência', () => {
    const r = conciliarLegado({ termos, hoje: '2026-04-01', cobrancas, vinculosManuais: [{ cobrancaId: 'p14x', chave: 'parcela:3' }] });
    const l = Object.fromEntries(r.linhas.map((x) => [x.chave, x]));
    expect(l['parcela:3']).toMatchObject({ cobrancaId: 'p14x', cobradoValor: 99_700, situacao: 'paga', divergencia: false });
    expect(l['parcela:3'].observacao).toContain('vínculo manual');
    expect(r.fora).toHaveLength(0);
    expect(r.resumo.parcelasPagas).toBe(3);
  });

  it('vínculo manual com soma diferente do esperado: fecha mesmo assim, mas a observação avisa', () => {
    const cobs: CobrancaConciliavel[] = [{ ...base, id: 'd', vencimento: '2026-02-19', valorOriginal: 90_000, valorPago: 90_000, pagoEm: '2026-02-19', tipo: 'acordo' as const }];
    const r = conciliarLegado({ termos: { ...termos, parcelas: { ...termos.parcelas, quantidade: 1 } }, hoje: '2026-04-01', cobrancas: cobs, vinculosManuais: [{ cobrancaId: 'd', chave: 'parcela:1' }] });
    expect(r.linhas[0]).toMatchObject({ cobrancaId: 'd', situacao: 'paga', divergencia: false });
    expect(r.linhas[0].observacao).toContain('≠');
  });
});

// Caso real 01/10 (Ezequias): o carimbo da assinatura digital caiu dentro do
// trecho do modelo no texto extraído — o modelo vem do contrato, não do carimbo.
describe('modelo do veículo sem o carimbo da assinatura', () => {
  it('corta "Assinatura verificada • SuperSign" na mesma linha', () => {
    const texto = TEXTO_MOD06.replace('Marca/Modelo: HYUNDAI/HB20S 1.0 COMFORT', 'Marca/Modelo: HYUNDAI/HB20S 1.0 COMFORT Assinatura verificada • SuperSign 2024');
    const r = extrairTermosDoTexto(texto);
    expect(r.termos.veiculo.marca).toBe('HYUNDAI');
    expect(r.termos.veiculo.modelo).toBe('HB20S 1.0 COMFORT');
  });
  it('carimbo em linha própria, abaixo do modelo', () => {
    const texto = TEXTO_MOD06.replace('Marca/Modelo: HYUNDAI/HB20S 1.0 COMFORT', 'Marca/Modelo: HYUNDAI/HB20S 1.0 COMFORT\nBruna Gonçalves Brito Assinatura verificada • SuperSign 2024');
    expect(extrairTermosDoTexto(texto).termos.veiculo.modelo).toBe('HB20S 1.0 COMFORT');
  });
});

// Caso real 01/10 (Rubens): "Ano de Fabricação/Modelo: 2023/24".
describe('ano modelo com dois dígitos', () => {
  it('2023/24 vira 2023 e 2024', () => {
    const r = extrairTermosDoTexto(TEXTO_MOD06.replace('2023/2024', '2023/24'));
    expect(r.termos.veiculo.anoFabricacao).toBe(2023);
    expect(r.termos.veiculo.anoModelo).toBe(2024);
  });
});

// Decisão Luís 02/10: contrato cuja parcela já vem CHEIA (997 = 942 + 50 + 5).
describe('parcela do contrato que já inclui seguro e taxa', () => {
  const base = { ...TERMOS_VAZIOS, valorTotal: 2_500_00 + 165 * 997_00, entradaValor: 2_500_00, parcelas: { total: 165 * 997_00, quantidade: 165, valor: 997_00, primeiraEm: '2025-10-16' }, seguroSemanal: 50_00, taxaSemanal: 5_00 };
  it('sem a marca: a parcela vale como está', () => {
    expect(parcelamentoDosTermos(base)).toBe(997_00);
    expect(termosEfetivos(base)).toBe(base);
  });
  it('com a marca: parcelamento 942, total parcelado e valor total sem os serviços', () => {
    const t = termosEfetivos({ ...base, parcelaIncluiServicos: true });
    expect(t.parcelas.valor).toBe(942_00);
    expect(t.parcelas.total).toBe(165 * 942_00);
    expect(t.valorTotal).toBe(2_500_00 + 165 * 942_00);
    expect(t.seguroSemanal).toBe(50_00);
    expect(t.parcelaIncluiServicos).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 06/10 (doc 02 §26.14): conciliação por SEQUÊNCIA e acordos agrupados
// ---------------------------------------------------------------------------
describe('conciliação por sequência e acordos (caso real 06/10)', () => {
  // Mobi: 642 + 50 + 5 = 697/semana, 1ª em 25/01/2026.
  const termos = { parcelas: { quantidade: 20, valor: 64_200, primeiraEm: '2026-01-25' }, intermediarias: null, entradaValor: null, seguroSemanal: 5_000, taxaSemanal: 500 };
  const base = { valorPago: null as number | null, pagoEm: null as string | null, classe: 'paga' as const, intermediariaEmbutida: 0, parcelamento: 64_200 as number | null, extra: 0, extraRotulo: null as string | null, encargoEmbutido: 0, descricao: null as string | null, tipo: 'parcela' as const };
  const semana = (n: number) => new Date(Date.UTC(2026, 0, 25) + (n - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
  const paga = (id: string, venc: string, extra: Partial<CobrancaConciliavel> = {}): CobrancaConciliavel => ({ ...base, id, vencimento: venc, valorOriginal: 69_700, valorPago: 69_700, pagoEm: venc, ...extra });

  it('leitura: "acordo de uma parcela semanal $265,12 (2/3)" junto da parcela vira componente de acordo', () => {
    const r = interpretarCobrancaLegada({
      descricao: 'Contrato - Parcela semanal: R$ 642,00 / Proteção Veicular - Repasse: R$ 50,00 / Taxas Boleto Pix - Repasse: R$ 5,00 / acordo de uma parcela semanal $265,12 (2/3)',
      valorOriginal: 96_212, avulsa: false,
      contexto: contextoDosTermos({ parcelas: { valor: 64_200 }, intermediarias: null, entradaValor: null, seguroSemanal: 5_000, taxaSemanal: 500 }, 69_700),
    });
    expect(r).toMatchObject({ tipo: 'parcela', parcelamento: 64_200, seguro: 5_000, taxa: 500, acordo: 26_512, acordoRef: { k: 2, n: 3 }, encargo: 0, duvida: false });
    const solta = interpretarCobrancaLegada({ descricao: 'Acordo de pagamento do dia 23/05/2026 (1/2)', valorOriginal: 45_000, avulsa: true, contexto: contextoDosTermos(null, 69_700) });
    expect(solta).toMatchObject({ tipo: 'acordo', acordo: 45_000, acordoRef: { k: 1, n: 2 } });
  });

  it('sequência: semana pulada (manutenção) não consome número; as seguintes deslocam e as futuras seguem da última cobrança', () => {
    // Semanas 1,2 cobradas; semana 3 pulada; semanas 4,5 cobradas → parcelas 3 e 4 (deslocadas 1 semana).
    const cobrancas = [paga('a', semana(1)), paga('b', semana(2)), paga('c', semana(4)), paga('d', semana(5), { classe: 'pendente', valorPago: null, pagoEm: null })];
    const r = conciliarLegado({ termos, hoje: semana(5), cobrancas });
    const l = Object.fromEntries(r.linhas.map((x) => [x.chave, x]));
    expect(r.modo).toBe('SEQUENCIA');
    expect(l['parcela:3']).toMatchObject({ cobrancaId: 'c', situacao: 'paga', deslocamentoDias: 7, confianca: 'media' });
    expect(l['parcela:3'].observacao).toContain('deslocado');
    expect(l['parcela:4']).toMatchObject({ cobrancaId: 'd', situacao: 'pendente' });
    // Parcela 5 ainda não emitida: uma semana depois da última cobrança real (semana 6), futura.
    expect(l['parcela:5']).toMatchObject({ esperadoEm: semana(6), situacao: 'futura', divergencia: false });
    expect(r.fora).toHaveLength(0);
    expect(r.resumo.deslocamentoSemanas).toBe(1);
    expect(r.resumo.linhasDecidir).toBe(0);
  });

  it('acordo: agrupa as (k/3) embutidas, propõe quantas parcelas cobre e, confirmado, ocupa o número logo antes de onde começou', () => {
    // Semanas 1..11 pagas; semana 12 NÃO cobrada (virou acordo); 13,14,15 cobradas com acordo (k/3) embutido; 16 normal.
    const cobrancas: CobrancaConciliavel[] = [];
    for (let n = 1; n <= 11; n++) cobrancas.push(paga(`p${n}`, semana(n)));
    for (let k = 1; k <= 3; k++) cobrancas.push(paga(`ac${k}`, semana(12 + k), { valorOriginal: 96_212, valorPago: 96_212, acordo: 26_512, acordoRef: { k, n: 3 }, descricao: `Contrato - Parcela semanal: R$ 642,00 / Proteção Veicular - Repasse: R$ 50,00 / Taxas Boleto Pix - Repasse: R$ 5,00 / acordo de uma parcela semanal $265,12 (${k}/3)` }));
    cobrancas.push(paga('p16', semana(16)));

    const antes = conciliarLegado({ termos, hoje: semana(17), cobrancas });
    expect(antes.acordos).toHaveLength(1);
    const g = antes.acordos[0];
    expect(g).toMatchObject({ total: 79_536, pago: 79_536, concluido: true, confirmado: null });
    expect(g.parcelas.map((x) => x.k)).toEqual([1, 2, 3]);
    // 795,36 = 1 × 697,00 + 98,36 de juros do acordo.
    expect(g.proposta).toMatchObject({ quantidade: 1, juros: 9_836, desconto: 0 });
    expect(g.proposta.texto).toContain('parcela 12');
    expect(antes.resumo.acordosSemConfirmar).toBe(1);
    // Sem confirmar: as compostas são parcelas 12,13,14 pela sequência (o acordo embutido é componente, não divergência).
    const la = Object.fromEntries(antes.linhas.map((x) => [x.chave, x]));
    expect(la['parcela:12']).toMatchObject({ cobrancaId: 'ac1', situacao: 'paga', divergencia: false });
    expect(la['parcela:12'].componentes?.acordo).toBe(26_512);

    const depois = conciliarLegado({ termos, hoje: semana(17), cobrancas, acordosConfirmados: [{ grupo: g.id, quantidade: 1 }] });
    const l = Object.fromEntries(depois.linhas.map((x) => [x.chave, x]));
    expect(l['parcela:12']).toMatchObject({ situacao: 'paga_por_acordo', acordoGrupo: g.id, pagoValor: 69_700, encargo: 9_836, divergencia: false, confianca: 'media' });
    expect(l['parcela:12'].partes.map((x) => x.cobrancaId)).toEqual(['ac1', 'ac2', 'ac3']);
    expect(l['parcela:13']).toMatchObject({ cobrancaId: 'ac1', situacao: 'paga', deslocamentoDias: 0 });
    expect(l['parcela:15']).toMatchObject({ cobrancaId: 'ac3', situacao: 'paga' });
    expect(l['parcela:16']).toMatchObject({ cobrancaId: 'p16', situacao: 'paga' });
    expect(depois.resumo.parcelasPagas).toBe(16);
    expect(depois.resumo.encargosPagos).toBe(9_836);
    expect(depois.resumo.acordosSemConfirmar).toBe(0);
    expect(depois.fora).toHaveLength(0);
  });

  it('acordo que cobre DUAS parcelas: proposta pelo valor (2 × 697 + juros) e, no modo DATA, aponta as duas mais antigas em aberto', () => {
    // Modo DATA: semanas 5 e 6 não cobradas; acordo avulso em 3 parcelas de 500 a partir da semana 8.
    const cobrancas: CobrancaConciliavel[] = [paga('p1', semana(1)), paga('p2', semana(2)), paga('p3', semana(3)), paga('p4', semana(4)), paga('p7', semana(7))];
    for (let k = 1; k <= 3; k++) cobrancas.push({ ...base, id: `ac${k}`, tipo: 'acordo', parcelamento: null, vencimento: semana(7 + k), valorOriginal: 50_000, valorPago: 50_000, pagoEm: semana(7 + k), acordo: 50_000, acordoRef: { k, n: 3 }, descricao: `Acordo das parcelas atrasadas (${k}/3)` });
    const r = conciliarLegado({ modo: 'DATA', termos: { ...termos, parcelas: { ...termos.parcelas, quantidade: 7 } }, hoje: semana(11), cobrancas });
    const g = r.acordos[0];
    expect(g.proposta).toMatchObject({ quantidade: 2, juros: 150_000 - 2 * 69_700, chaves: ['parcela:5', 'parcela:6'] });
    const c = conciliarLegado({ modo: 'DATA', termos: { ...termos, parcelas: { ...termos.parcelas, quantidade: 7 } }, hoje: semana(11), cobrancas, acordosConfirmados: [{ grupo: g.id, quantidade: 2, chaves: ['parcela:5', 'parcela:6'] }] });
    const l = Object.fromEntries(c.linhas.map((x) => [x.chave, x]));
    expect(l['parcela:5'].situacao).toBe('paga_por_acordo');
    expect(l['parcela:6'].situacao).toBe('paga_por_acordo');
    expect(l['parcela:5'].encargo + l['parcela:6'].encargo).toBe(150_000 - 2 * 69_700);
    expect(c.resumo.divergencias).toBe(0);
  });
});
