import { describe, expect, it } from 'vitest';
import { camposFaltantesTermos, extrairTermosDoTexto, reaisTextoParaCentavos, TERMOS_VAZIOS } from './legado-termos';
import { contextoDosTermos, interpretarCobrancaLegada } from './legado-interpretacao';
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
    expect(interp('Entrada', 300_000)).toMatchObject({ tipo: 'entrada', duvida: true });
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
    const r = conciliarLegado({
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
    const r = conciliarLegado({
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
