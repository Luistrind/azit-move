import { describe, expect, it } from 'vitest';
import { decidirConferenciaAutomatica, divergenciasNovas } from './conferencia-asaas';

// Conferência automática diária (doc 02 §27.9.1, 18/11/2026).
describe('decidirConferenciaAutomatica', () => {
  it('paga no Asaas e sem nada imputado aqui → baixar', () => {
    expect(decidirConferenciaAutomatica({ classificacao: 'paga_no_asaas', valorPagoAqui: null, valorPagoAsaas: 99700 })).toBe('baixar');
    expect(decidirConferenciaAutomatica({ classificacao: 'paga_no_asaas', valorPagoAqui: 0, valorPagoAsaas: 99700 })).toBe('baixar');
  });

  it('paga no Asaas com o MESMO valor já imputado aqui como parcial → fica para o operador', () => {
    expect(decidirConferenciaAutomatica({ classificacao: 'paga_no_asaas', valorPagoAqui: 50000, valorPagoAsaas: 50000 })).toBe('pago_a_menor_ja_registrado');
  });

  it('paga no Asaas com valor diferente do imputado aqui (outro pagamento) → baixar', () => {
    expect(decidirConferenciaAutomatica({ classificacao: 'paga_no_asaas', valorPagoAqui: 30000, valorPagoAsaas: 99700 })).toBe('baixar');
  });

  it.each(['removida_no_asaas', 'estornada_no_asaas', 'vencimento_diferente', 'valor_diferente'] as const)(
    '%s → divergência (nunca corrige sozinha)',
    (classificacao) => {
      expect(decidirConferenciaAutomatica({ classificacao, valorPagoAqui: null, valorPagoAsaas: 99700 })).toBe('divergencia');
    },
  );

  it('ok → ok', () => {
    expect(decidirConferenciaAutomatica({ classificacao: 'ok', valorPagoAqui: null, valorPagoAsaas: 99700 })).toBe('ok');
  });
});

describe('divergenciasNovas', () => {
  const a = { faturaId: 'f1', classificacao: 'removida_no_asaas' };
  const b = { faturaId: 'f2', classificacao: 'valor_diferente' };

  it('sem rodada anterior, todas são novas', () => {
    expect(divergenciasNovas([a, b], null)).toEqual([a, b]);
  });

  it('a que já estava na rodada anterior não é nova; outra classificação da mesma fatura é', () => {
    const b2 = { faturaId: 'f2', classificacao: 'vencimento_diferente' };
    expect(divergenciasNovas([a, b2], [a, b])).toEqual([b2]);
  });
});
