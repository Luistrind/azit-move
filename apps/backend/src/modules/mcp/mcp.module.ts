import { Module } from '@nestjs/common';
import { AnaliseModule } from '../analise/analise.module';
import { McpController } from './mcp.controller';
import { McpAzitService } from './mcp.service';

// Connector MCP do Azit Hub para o claude.ai (14/09) — o relatório cadastral
// pode ser gerado na conversa do claude.ai (assinatura) e salvo de volta aqui.
@Module({
  imports: [AnaliseModule],
  controllers: [McpController],
  providers: [McpAzitService],
})
export class McpModule {}
