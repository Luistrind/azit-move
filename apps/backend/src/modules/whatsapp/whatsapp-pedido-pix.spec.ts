import { componentesPedidoPix } from './whatsapp-meta.service';

// Formato do modelo "detalhes do pedido" com Pix (doc 02 §28.6) — o que a Meta
// espera no botão order_details: pedido em BRL com offset 100, um item, e o
// código Pix copia e cola com recebedor e chave.
describe('componentesPedidoPix', () => {
  const agora = new Date('2026-11-22T15:00:00Z');
  const pedido = {
    referencia: 'int_0123456789abcdef01234567',
    itemNome: 'Fatura nº 1',
    valorCentavos: 174376,
    codigoPix: '00020101021226800014br.gov.bcb.pix',
    recebedor: 'AZIT COMERCIO DE VEICULOS LTDA',
    chave: 'financeiro@azitmove.com.br',
    tipoChave: 'EMAIL',
    expiraEm: new Date('2026-11-27T02:59:59.999Z'),
  };

  it('corpo com as variáveis e botão order_details com o Pix', () => {
    const [corpo, botao] = componentesPedidoPix(['Tatiani', '1', 'R$ 1.743,76', '26/11/2026', 'https://fatura.azitmove.com.br/abc'], pedido, agora) as Record<string, any>[];
    expect(corpo).toEqual({ type: 'body', parameters: ['Tatiani', '1', 'R$ 1.743,76', '26/11/2026', 'https://fatura.azitmove.com.br/abc'].map((text) => ({ type: 'text', text })) });
    expect(botao).toMatchObject({ type: 'button', sub_type: 'order_details', index: 0 });
    const od = botao.parameters[0].action.order_details;
    expect(od).toMatchObject({ reference_id: pedido.referencia, currency: 'BRL', payment_type: 'br', total_amount: { value: 174376, offset: 100 } });
    expect(od.order).toMatchObject({ status: 'pending', subtotal: { value: 174376, offset: 100 }, tax: { value: 0, offset: 100 } });
    expect(od.order.items).toEqual([{ retailer_id: pedido.referencia, name: 'Fatura nº 1', amount: { value: 174376, offset: 100 }, quantity: 1 }]);
    expect(od.order.expiration.timestamp).toBe(String(Math.floor(pedido.expiraEm.getTime() / 1000)));
    expect(od.payment_settings).toEqual([
      { type: 'pix_dynamic_code', pix_dynamic_code: { code: pedido.codigoPix, merchant_name: 'AZIT COMERCIO DE VEICULOS LTDA', key: 'financeiro@azitmove.com.br', key_type: 'EMAIL' } },
    ]);
  });

  it('sem validade quando falta menos de 5 minutos (mínimo da Meta); tipo de chave desconhecido vira EVP', () => {
    const [, botao] = componentesPedidoPix([], { ...pedido, tipoChave: 'OUTRO', expiraEm: new Date(agora.getTime() + 60_000) }, agora) as Record<string, any>[];
    const od = botao.parameters[0].action.order_details;
    expect(od.order.expiration).toBeUndefined();
    expect(od.payment_settings[0].pix_dynamic_code.key_type).toBe('EVP');
  });
});
