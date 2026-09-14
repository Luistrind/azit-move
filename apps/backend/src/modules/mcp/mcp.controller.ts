import { All, Controller, NotFoundException, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Public } from '../../common/decorators/public.decorator';
import { McpAzitService } from './mcp.service';

// Shapes mínimos do Fastify (o pacote não é dependência direta do backend).
type ReqFastify = { params: { secret: string }; body: unknown; raw: IncomingMessage };
type ResFastify = { raw: ServerResponse };

// Endpoint MCP (Streamable HTTP, modo stateless) para o connector do
// claude.ai. Autenticação PROVISÓRIA por segredo na URL (MCP_SECRET — 128+
// bits, comparação em tempo constante; sem o env a rota devolve 404):
// suficiente para o uso mono-usuário do Luís, MARCADA como substituível por
// OAuth quando o connector ganhar mais gente (Regra 12). O servidor MCP expõe
// só leitura de análise + gravação do resumo — nenhuma outra escrita.
@Controller('mcp')
export class McpController {
  constructor(
    private readonly config: ConfigService,
    private readonly mcp: McpAzitService,
  ) {}

  private validarSegredo(secret: string) {
    const esperado = this.config.get<string>('mcp.secret') ?? '';
    const a = Buffer.from(secret);
    const b = Buffer.from(esperado);
    if (!esperado || esperado.length < 24 || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new NotFoundException(); // esconde a existência da rota
    }
  }

  @Public()
  @All(':secret')
  async handle(@Req() req: ReqFastify, @Res() res: ResFastify) {
    this.validarSegredo(req.params.secret);
    // Stateless: servidor + transporte novos por request (recomendação do SDK).
    const server = this.mcp.criarServidor();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, res.raw, req.body);
  }
}
