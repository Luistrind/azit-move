// Mapeamento das variáveis de ambiente (Doc 4 §9.1).
export interface AppConfig {
  nodeEnv: string;
  port: number;
  frontendUrl: string;
  databaseUrl: string;
  redisUrl: string;
  jwt: { secret: string; accessExpiresIn: string; refreshExpiresInDays: number };
  asaas: { apiUrl: string; apiKey: string; webhookSecret: string };
  pophub: { webhookSecret: string };
  zapi: { instanceId: string; token: string; clientToken: string };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    // Access token curto (Doc 6 §3.1); refresh longo e revogável (§3.2).
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresInDays: parseInt(process.env.JWT_REFRESH_EXPIRES_IN_DAYS ?? '7', 10),
  },
  asaas: {
    apiUrl: process.env.ASAAS_API_URL ?? '',
    apiKey: process.env.ASAAS_API_KEY ?? '',
    webhookSecret: process.env.ASAAS_WEBHOOK_SECRET ?? '',
  },
  pophub: { webhookSecret: process.env.POPHUB_WEBHOOK_SECRET ?? '' },
  zapi: {
    instanceId: process.env.ZAPI_INSTANCE_ID ?? '',
    token: process.env.ZAPI_TOKEN ?? '',
    clientToken: process.env.ZAPI_CLIENT_TOKEN ?? '',
  },
});
