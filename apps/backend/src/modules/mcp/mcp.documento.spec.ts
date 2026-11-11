import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAzitService } from './mcp.service';

// obter_documento em partes (11/11): o texto do PDF vem inteiro do servidor e a
// ferramenta pagina em ~100 mil chars, com cabeçalho "parte i de N"; imagens só
// na parte 1. Caso real: extrato Nubank de 53 páginas cortado em 50 mil.
type Handler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text?: string; data?: string }[]; isError?: boolean }>;

function capturarFerramentas(assistente: Partial<{ lerDocumento: unknown }>): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const spy = jest.spyOn(McpServer.prototype, 'registerTool').mockImplementation(((name: string, _cfg: unknown, cb: Handler) => {
    handlers.set(name, cb);
    return {} as never;
  }) as never);
  try {
    const servico = new McpAzitService({} as never, assistente as never, {} as never);
    servico.criarServidor();
  } finally {
    spy.mockRestore();
  }
  return handlers;
}

describe('obter_documento em partes', () => {
  const texto = Array.from({ length: 2600 }, (_, i) => `linha ${String(i).padStart(4, '0')} — lançamento de teste com cem caracteres mais ou menos para encher o extrato ok`).join('\n');
  const documento = { nome: 'extrato.pdf', tipoDeclarado: 'EXTRATO', media: 'application/pdf', base64: '', textoExtraido: texto, paginasImagem: ['IMG1'] };

  it('texto maior que uma parte vem paginado, com continuação indicada e imagem só na parte 1', async () => {
    const ferramentas = capturarFerramentas({ lerDocumento: jest.fn().mockResolvedValue(documento) });
    const obter = ferramentas.get('obter_documento')!;
    expect(texto.length).toBeGreaterThan(200_000);

    const p1 = await obter({ analiseId: 'a1', nome: 'extrato.pdf' });
    const t1 = p1.content.find((c) => c.type === 'text')!.text!;
    expect(t1).toContain('parte 1 de 3');
    expect(t1).toContain('continue com parte=2');
    expect(t1).toContain('linha 0000');
    expect(p1.content.some((c) => c.type === 'image')).toBe(true);

    const p3 = await obter({ analiseId: 'a1', nome: 'extrato.pdf', parte: 3 });
    const t3 = p3.content.find((c) => c.type === 'text')!.text!;
    expect(t3).toContain('parte 3 de 3');
    expect(t3).toContain('última parte');
    expect(t3).toContain('linha 2599');
    expect(p3.content.some((c) => c.type === 'image')).toBe(false);

    // Junta as partes = texto inteiro, sem perda.
    const p2 = await obter({ analiseId: 'a1', nome: 'extrato.pdf', parte: 2 });
    const corpo = (t: string) => t.split('\n').slice(1, -1).join('\n');
    expect(corpo(t1) + corpo(p2.content[0].text!) + corpo(t3)).toBe(texto);

    // parte além da última cai na última.
    const p9 = await obter({ analiseId: 'a1', nome: 'extrato.pdf', parte: 9 });
    expect(p9.content[0].text).toContain('parte 3 de 3');
  });

  it('texto curto: uma parte só, sem instrução de continuação', async () => {
    const ferramentas = capturarFerramentas({ lerDocumento: jest.fn().mockResolvedValue({ ...documento, textoExtraido: 'CNH texto curto', paginasImagem: [] }) });
    const r = await ferramentas.get('obter_documento')!({ analiseId: 'a1', nome: 'extrato.pdf' });
    expect(r.content[0].text).toContain('parte 1 de 1');
    expect(r.content[0].text).not.toContain('continue com');
  });
});
