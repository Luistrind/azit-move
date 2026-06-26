import { describe, it, expect } from 'vitest';
import {
  limparDocumento,
  validarCPF,
  validarCNPJ,
  validarDocumento,
} from './documento';

describe('limparDocumento', () => {
  it('remove máscara e mantém só dígitos', () => {
    expect(limparDocumento('529.982.247-25')).toBe('52998224725');
    expect(limparDocumento('11.222.333/0001-81')).toBe('11222333000181');
  });
});

describe('validarCPF', () => {
  it('aceita CPF válido (com e sem máscara)', () => {
    expect(validarCPF('529.982.247-25')).toBe(true);
    expect(validarCPF('52998224725')).toBe(true);
  });
  it('rejeita dígito verificador errado', () => {
    expect(validarCPF('52998224724')).toBe(false);
  });
  it('rejeita sequência repetida e comprimento errado', () => {
    expect(validarCPF('11111111111')).toBe(false);
    expect(validarCPF('123')).toBe(false);
  });
});

describe('validarCNPJ', () => {
  it('aceita CNPJ válido (com e sem máscara)', () => {
    expect(validarCNPJ('11.222.333/0001-81')).toBe(true);
    expect(validarCNPJ('11222333000181')).toBe(true);
  });
  it('rejeita dígito verificador errado', () => {
    expect(validarCNPJ('11222333000180')).toBe(false);
  });
  it('rejeita sequência repetida e comprimento errado', () => {
    expect(validarCNPJ('00000000000000')).toBe(false);
    expect(validarCNPJ('123')).toBe(false);
  });
});

describe('validarDocumento', () => {
  it('infere CPF/CNPJ pelo comprimento', () => {
    expect(validarDocumento('52998224725')).toBe(true);
    expect(validarDocumento('11222333000181')).toBe(true);
  });
  it('respeita o tipo exigido', () => {
    expect(validarDocumento('52998224725', 'pf')).toBe(true);
    expect(validarDocumento('52998224725', 'pj')).toBe(false);
    expect(validarDocumento('11222333000181', 'pj')).toBe(true);
  });
});
