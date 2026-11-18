import { describe, expect, it } from 'vitest';
import { mensagemDeAcordoReembolso, textoDoAceiteWhatsapp } from './reembolso-de-acordo';

describe('mensagem do "de acordo" do Reembolso Parcelado', () => {
  const base = { nomeCliente: 'Marcos Vinícius Almeida', fornecedorNome: 'Oficina Central', finalidade: 'troca de embreagem', valorPagoAoFornecedor: 100000, numeroParcelas: 12, valorParcela: 11500, totalAPagar: 138000, periodicidade: 'semanal' };

  it('traz as duas pontas — o que pagamos ao fornecedor e o que o cliente paga — e pede a resposta', () => {
    const m = mensagemDeAcordoReembolso(base).replace(/ /g, ' '); // o formatador usa espaço que não quebra depois de R$
    expect(m).toContain('Olá, Marcos!');
    expect(m).toContain('pagamos R$ 1.000,00 à vista a Oficina Central (troca de embreagem)');
    expect(m).toContain('12 parcelas semanais de R$ 115,00');
    expect(m).toContain('Total: R$ 1.380,00');
    expect(m).toContain('responda *DE ACORDO*');
  });

  it('não usa vocabulário financeiro e concorda no singular', () => {
    const m = mensagemDeAcordoReembolso({ ...base, numeroParcelas: 1, periodicidade: 'mensal', finalidade: '' });
    expect(m).toContain('1 parcela mensal de');
    expect(m).not.toContain('()');
    expect(m.toLowerCase()).not.toMatch(/juros|taxa|financ/);
  });

  it('texto do aceite para o dossiê: quem registrou, a mensagem e a resposta', () => {
    const t = textoDoAceiteWhatsapp({ confirmadoPeloOperadorEm: '2026-11-18T12:00:00.000Z', mensagemEnviada: 'Olá!', respostaCliente: 'De acordo' }, 'Arthur', '18/11/2026 09:00');
    expect(t).toContain('Registrado por Arthur em 18/11/2026 09:00.');
    expect(t).toContain('Olá!');
    expect(t).toContain('De acordo');
    expect(textoDoAceiteWhatsapp({ confirmadoPeloOperadorEm: 'x' }, 'Arthur', 'hoje')).toContain('não foi registrado');
  });
});
