import { describe, expect, it } from 'vitest';
import { escolherModeloFipe, valorFipeParaCentavos } from './fipe';

// Rótulos REAIS da FIPE (consulta de 01/10/2026).
const HB20S = ['HB20S Com. Plus Tech 1.0 TB Flex 12V Aut', 'HB20S Comfort 1.0  Flex 12V Mec.', 'HB20S Comfort 1.0 TB Flex 12V Aut.', 'HB20S Comfort Plus 1.0 Flex 12V Mec.', 'HB20S Comfort Plus 1.0 TB Flex 12V Aut', 'HB20S Vision 1.0 Flex 12V Mec.', 'HB20S Limited 1.0  Flex 12V Mec.'].map((Label, i) => ({ Label, Value: String(i) }));
const MOBI = ['MOBI DRIVE 1.0 Flex 6V 5p', 'MOBI EASY 1.0 Fire Flex 5p.', 'MOBI LIKE 1.0 Fire Flex 5p.', 'MOBI LIKE ON 1.0 Fire Flex 5p.', 'MOBI TREKKING 1.0 Flex 5p.'].map((Label, i) => ({ Label, Value: String(i) }));

describe('escolherModeloFipe', () => {
  it('"HB20S 1.0 COMFORT" casa com o Comfort 1.0 manual aspirado', () => {
    expect(escolherModeloFipe('HB20S 1.0 COMFORT', HB20S)?.modelo.Label).toBe('HB20S Comfort 1.0  Flex 12V Mec.');
  });
  it('"MOBI LIKE 1.0" não pega o LIKE ON', () => {
    expect(escolherModeloFipe('MOBI LIKE 1.0', MOBI)?.modelo.Label).toBe('MOBI LIKE 1.0 Fire Flex 5p.');
  });
  it('família diferente não casa (HB20 ≠ HB20S)', () => {
    expect(escolherModeloFipe('HB20 1.0 COMFORT', HB20S)).toBeNull();
  });
  it('palavra nossa que a FIPE não tem → null (não chuta)', () => {
    expect(escolherModeloFipe('HB20S 1.0 SUPER', HB20S)).toBeNull();
  });
  it('só a família não basta para escolher a versão', () => {
    expect(escolherModeloFipe('HB20S', HB20S)).toBeNull();
  });
  it('valor', () => {
    expect(valorFipeParaCentavos('R$ 75.358,00')).toBe(7_535_800);
    expect(valorFipeParaCentavos('')).toBeNull();
  });
});
