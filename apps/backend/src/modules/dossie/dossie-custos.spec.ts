import { htmlComprovantes, htmlCustosAcerto, type DadosCustosAcerto } from './dossie-html';

// Dossiê judicial: seção "Acerto da rescisão e custos da recuperação" (doc 02
// §29.3, 20–21/11/2026). O HTML é o que o Chromium vira em PDF — aqui só se
// confere que os números e as marcas certas estão no documento.
const cab = { numero: '2026050014', titular: 'Marcelo Antunes Reis', cpf: '123.456.789-09', veiculo: 'HB20S · placa RQF2C47', emitidoEm: '21/11/2026' };
const custos: DadosCustosAcerto['custos'] = [
  { tipo: 'Retomada (equipe)', descricao: 'Retirada em Cariacica', fornecedor: 'Recupera ES', data: '16/11/2026', valor: 80_000, orcado: false, anexo: 1 },
  { tipo: 'Avaria / reparo', descricao: 'Para-choque <dianteiro>', fornecedor: null, data: '18/11/2026', valor: 165_000, orcado: true, anexo: null },
];

describe('htmlCustosAcerto', () => {
  it('contrato ainda ativo: só a tabela de custos, com orçado marcado e o número do comprovante', () => {
    const html = htmlCustosAcerto({ cab, custos, totalCustos: 245_000, totalOrcado: 165_000, acerto: null });
    expect(html).toContain('Custos da recuperação · contrato 2026050014');
    expect(html).toContain('Comprovante 1');
    expect(html).toContain('Orçado');
    expect(html).toMatch(/Total <b>R\$\s2\.450,00<\/b>/);
    expect(html).toContain('Para-choque &lt;dianteiro&gt;'); // texto do operador é escapado
    expect(html).not.toContain('Crédito do cliente');
  });

  it('contrato rescindido: dívida (parcelas + custos + multas), crédito de 20% e o saldo devido', () => {
    const html = htmlCustosAcerto({
      cab, custos, totalCustos: 245_000, totalOrcado: 165_000,
      acerto: {
        dataBase: '16/11/2026', comoVoltou: 'retomado pela Azit', principalPago: 2_648_200, percentual: 20, credito: 529_640,
        vencidas: [{ item: 'Parcela 27/156', vencimento: '16/11/2026', dias: 0, valor: 99_200, encargo: 1_984, total: 101_184 }],
        dividaVencida: 99_200, encargos: 1_984, multas: [{ descricao: 'Multa AB123 · fato em 02/11/2026', valor: 29_347 }], multasVeiculo: 29_347,
        dividaTotal: 375_531, aDevolver: 154_109, saldo: 0, boleto: null,
      },
    });
    expect(html).toContain('Acerto da rescisão · contrato 2026050014');
    expect(html).toContain('retomado pela Azit');
    expect(html).toContain('Parcela 27/156');
    expect(html).toContain('Multa AB123');
    expect(html).toContain('A devolver ao cliente');
    expect(html).toContain('não são cobradas');
  });

  it('saldo devido: mostra o boleto único quando existe', () => {
    const html = htmlCustosAcerto({
      cab, custos: [], totalCustos: 0, totalOrcado: 0,
      acerto: {
        dataBase: '08/10/2026', comoVoltou: 'devolvido pelo cliente', principalPago: 344_200, percentual: 20, credito: 68_840,
        vencidas: [], dividaVencida: 188_400, encargos: 4_114, multas: [], multasVeiculo: 0, dividaTotal: 350_514, aDevolver: 0, saldo: 281_674,
        boleto: 'Boleto único do saldo emitido, no valor de R$ 2.816,74, com vencimento em 11/12/2026 — vencido sem pagamento.',
      },
    });
    expect(html).toContain('Saldo devido pelo cliente');
    expect(html).toContain('devolvido pelo cliente');
    expect(html).toContain('vencido sem pagamento');
  });
});

describe('htmlComprovantes', () => {
  it('duas imagens por página, cada uma com a sua legenda', () => {
    const html = htmlComprovantes(cab, [1, 2, 3].map((n) => ({ dataUrl: `data:image/png;base64,AAA${n}`, legenda: `Comprovante ${n} — Guincho` })));
    expect(html.match(/<section class="pag-capturas">/g)).toHaveLength(2);
    expect(html).toContain('Comprovante 3 — Guincho');
    expect(html).toContain('2 de 2');
  });
});
