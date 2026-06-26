import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

// Nomes das 6 filas (Doc 4 §8.2). Os processadores entram conforme cada fluxo é
// construído nos blocos seguintes — aqui só registramos as filas (Bloco 0.7).
export const QUEUE_NAMES = {
  PAGAMENTO_RECEBIDO: 'pagamento-recebido',
  PAGAMENTO_VENCIDO: 'pagamento-vencido',
  FECHAR_FATURA: 'fechar-fatura',
  GERAR_COBRANCA_ASAAS: 'gerar-cobranca-asaas',
  NOTIFICAR_CLIENTE: 'notificar-cliente',
  REGUA_STEP: 'regua-step',
  EFETIVAR_ACORDO: 'efetivar-acordo',
} as const;

// Parse de REDIS_URL em opções de conexão (host/port/senha/db). Evita instanciar o
// ioredis aqui (o BullMQ traz a própria cópia) — apenas fornecemos as opções.
function redisConnectionFromUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 6379,
    ...(u.password ? { password: u.password } : {}),
    ...(u.pathname && u.pathname !== '/'
      ? { db: parseInt(u.pathname.slice(1), 10) }
      : {}),
    maxRetriesPerRequest: null, // exigido pelos workers do BullMQ
  };
}

@Module({
  imports: [
    // Conexão Redis compartilhada por todas as filas.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnectionFromUrl(
          config.get<string>('redisUrl') ?? 'redis://localhost:6379',
        ),
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.PAGAMENTO_RECEBIDO },
      { name: QUEUE_NAMES.PAGAMENTO_VENCIDO },
      { name: QUEUE_NAMES.FECHAR_FATURA },
      { name: QUEUE_NAMES.GERAR_COBRANCA_ASAAS },
      { name: QUEUE_NAMES.NOTIFICAR_CLIENTE },
      { name: QUEUE_NAMES.REGUA_STEP },
      { name: QUEUE_NAMES.EFETIVAR_ACORDO },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
