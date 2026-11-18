import { montarLinkFatura } from './fatura-link';

// Link público da Fatura Azit (doc 02 §32.7). 18/11: produção subiu sem o
// endereço-base e a tela entregou um link com localhost — sem endereço, não há link.
describe('montarLinkFatura', () => {
  it('monta endereço-base + token, sem barra em dobro', () => {
    expect(montarLinkFatura('https://fatura.azitmove.com.br/', 'abc')).toBe('https://fatura.azitmove.com.br/abc');
  });
  it('sem token ou sem endereço-base configurado, não existe link', () => {
    expect(montarLinkFatura('https://fatura.azitmove.com.br', null)).toBeNull();
    expect(montarLinkFatura('', 'abc')).toBeNull();
    expect(montarLinkFatura('   ', 'abc')).toBeNull();
  });
});
