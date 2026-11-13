import { describe, it, expect } from 'vitest';
import {
  DOMINIOS_WORKSPACE, ehEmailWorkspace, mesmaCaixaWorkspace, partesEmail, variantesEmailWorkspace,
} from './acesso';

describe('acesso — dois domínios, mesma caixa (doc 06 v1.1 §2.1)', () => {
  it('os dois domínios do Workspace são os conhecidos', () => {
    expect([...DOMINIOS_WORKSPACE]).toEqual(['azit.com.br', 'azitmove.com.br']);
  });

  it('mesma parte local nos dois domínios é a mesma caixa', () => {
    expect(mesmaCaixaWorkspace('joao@azit.com.br', 'joao@azitmove.com.br')).toBe(true);
    expect(mesmaCaixaWorkspace('JOAO@AzitMove.com.br', ' joao@azit.com.br ')).toBe(true);
  });

  it('parte local diferente não é a mesma caixa', () => {
    expect(mesmaCaixaWorkspace('joao@azit.com.br', 'maria@azitmove.com.br')).toBe(false);
  });

  it('domínio de fora não vira alias, nem com a mesma parte local', () => {
    expect(mesmaCaixaWorkspace('joao@azit.com.br', 'joao@gmail.com')).toBe(false);
    expect(mesmaCaixaWorkspace('joao@outra.com.br', 'joao@azitmove.com.br')).toBe(false);
    // fora do Workspace só a igualdade exata conta
    expect(mesmaCaixaWorkspace('joao@outra.com.br', 'Joao@outra.com.br')).toBe(true);
  });

  it('entrada que não é e-mail nunca casa', () => {
    expect(mesmaCaixaWorkspace('joao', 'joao@azit.com.br')).toBe(false);
    expect(partesEmail('@azit.com.br')).toBeNull();
    expect(partesEmail('joao@')).toBeNull();
  });

  it('ehEmailWorkspace reconhece só os dois domínios', () => {
    expect(ehEmailWorkspace('x@azit.com.br')).toBe(true);
    expect(ehEmailWorkspace('x@azitmove.com.br')).toBe(true);
    expect(ehEmailWorkspace('x@gmail.com')).toBe(false);
    expect(ehEmailWorkspace('x@azit.com.br.evil.com')).toBe(false);
  });

  it('variantes: e-mail do Workspace vira as duas grafias; de fora, só ele', () => {
    expect(variantesEmailWorkspace('Luis@AzitMove.com.br')).toEqual(['luis@azit.com.br', 'luis@azitmove.com.br']);
    expect(variantesEmailWorkspace('x@gmail.com')).toEqual(['x@gmail.com']);
  });
});
