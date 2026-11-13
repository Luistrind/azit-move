// Mapeamento das variáveis de ambiente (Doc 4 §9.1).
export interface AppConfig {
  nodeEnv: string;
  // Ambiente de NEGÓCIO (17/09): producao | homologacao | desenvolvimento.
  // NODE_ENV fica 'production' também no homolog (build/performance); é o
  // AMBIENTE que libera as ferramentas de teste (/dev/*) só na homologação.
  ambiente: 'producao' | 'homologacao' | 'desenvolvimento';
  port: number;
  frontendUrl: string;
  databaseUrl: string;
  redisUrl: string;
  jwt: { secret: string; accessExpiresIn: string; refreshExpiresInDays: number };
  asaas: { apiUrl: string; apiKey: string; webhookSecret: string };
  pophub: { webhookSecret: string };
  zapi: { instanceId: string; token: string; clientToken: string };
  // Assistente de análise (IA — 14/09): API do Claude (Anthropic).
  anthropic: { apiKey: string; modelo: string };
  // Connector MCP do claude.ai (14/09): segredo da URL do endpoint.
  mcp: { secret: string };
  // Entrar com Google (doc 06 v1.1 §2.2): id do cliente OAuth "Azit Hub Web"
  // (público; não há client secret no fluxo de ID token). Vazio = botão não aparece.
  google: { clientId: string };
  // Endereço público do Hub (links dos e-mails, doc 06 §12.4). APP_URL, senão
  // FRONTEND_URL (já é a URL pública nos stacks), senão o Vite local.
  appUrl: string;
  // Alertas por e-mail (doc 06 v1.1 §12.4). `transporte` escolhe o caminho:
  //   smtp-relay = relay SMTP do Workspace (smtp-relay.gmail.com:587, STARTTLS,
  //                liberado por IP no Admin — o escolhido, deploy/AMBIENTES.md §1.7);
  //   gmail-api  = API do Gmail com conta de serviço (exige a chave JSON, que a
  //                organização bloqueia por política — alternativa);
  //   nenhum     = padrão: a fila registra "não configurado" e segue.
  email: {
    transporte: 'smtp-relay' | 'gmail-api' | 'nenhum';
    remetente: string;
    serviceAccountJson: string;
    smtpHost: string;
    smtpPort: number;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  ambiente:
    process.env.AMBIENTE === 'homologacao'
      ? 'homologacao'
      : (process.env.NODE_ENV ?? 'development') === 'production'
        ? 'producao'
        : 'desenvolvimento',
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
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    modelo: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
  },
  mcp: { secret: process.env.MCP_SECRET ?? '' },
  google: { clientId: process.env.GOOGLE_CLIENT_ID ?? '' },
  appUrl: (process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  email: {
    transporte: (['smtp-relay', 'gmail-api'] as const).find((t) => t === (process.env.EMAIL_TRANSPORTE ?? '').trim()) ?? 'nenhum',
    remetente: (process.env.EMAIL_REMETENTE ?? '').trim(),
    serviceAccountJson: (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '').trim(),
    smtpHost: (process.env.SMTP_HOST ?? '').trim() || 'smtp-relay.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10) || 587,
  },
});
