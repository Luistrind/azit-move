import { compactarPayload } from './mcp.service';

// Payload bruto em partes (31/10): o modo compacto encurta textos longos e reduz
// as listas volumosas dos processos, sem tocar nos campos de identificação.
describe('compactarPayload', () => {
  it('encurta textos longos e mantém os curtos', () => {
    const longo = 'x'.repeat(1000);
    const r = compactarPayload({ Number: '0001', Texto: longo }) as Record<string, string>;
    expect(r.Number).toBe('0001');
    expect(r.Texto.startsWith('x'.repeat(400))).toBe(true);
    expect(r.Texto).toContain('[+600 chars]');
  });

  it('reduz Updates/Petitions/Decisions aos últimos 5 e anota os omitidos; outras listas ficam inteiras', () => {
    const lawsuit = {
      Number: '0002',
      Parties: Array.from({ length: 8 }, (_, i) => ({ Doc: String(i), Polarity: 'PASSIVE' })),
      Updates: Array.from({ length: 12 }, (_, i) => ({ Content: `andamento ${i}` })),
    };
    const r = compactarPayload({ result: { Processes: { Lawsuits: [lawsuit] } } }) as any;
    const l = r.result.Processes.Lawsuits[0];
    expect(l.Parties).toHaveLength(8);
    expect(l.Updates).toHaveLength(6);
    expect(l.Updates[0].Content).toBe('andamento 7');
    expect(l.Updates[5]._omitidos).toBe(7);
  });

  it('não altera números, booleanos e nulos', () => {
    expect(compactarPayload({ a: 1, b: true, c: null })).toEqual({ a: 1, b: true, c: null });
  });
});
