import { Injectable, Logger, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// ============================================================
// CENTRAL DE INTEGRAÇÕES (decisão Luís 15/09): credenciais do Asaas e da
// ZapSign configuráveis pela tela (ADMIN/DIRETOR), write-only no banco.
//
// Precedência POR PROVEDOR: se a credencial do banco existir, o banco governa
// (chave + ambiente/URL); senão vale o ambiente (.env) — fallback que mantém
// o deploy atual funcionando sem mexer em nada. O segredo de webhook segue a
// mesma regra campo a campo (banco ?? env).
//
// Consumo SÍNCRONO por snapshot (stale-while-revalidate, TTL 60s): os
// services existentes (Asaas/ZapSign/webhooks) leem `asaas()`/`zapsign()`
// sem await; salvar pela tela invalida o snapshot na hora — a troca de
// credencial vale em segundos, sem redeploy.
// ============================================================

const URL_ASAAS_SANDBOX = 'https://api-sandbox.asaas.com/v3';
const URL_ASAAS_PRODUCAO = 'https://api.asaas.com/v3';
const URL_ZAPSIGN_SANDBOX = 'https://sandbox.api.zapsign.com.br/api/v1';
const URL_ZAPSIGN_PRODUCAO = 'https://api.zapsign.com.br/api/v1';

export interface CredencialAsaas {
  apiKey: string; // '' = modo simulado
  apiUrl: string;
  webhookSecret: string; // '' = sem segredo (produção recusa o webhook)
  ambiente: 'sandbox' | 'producao';
  fonte: 'banco' | 'env';
}

export interface CredencialZapSign {
  apiToken: string; // '' = provedor simulado
  apiUrl: string;
  webhookSecret: string;
  ambiente: 'sandbox' | 'producao';
  fonte: 'banco' | 'env';
}

type Linha = {
  id: string;
  asaasAmbiente: string;
  asaasApiKey: string | null;
  asaasWebhookSecret: string | null;
  zapsignAmbiente: string;
  zapsignApiToken: string | null;
  zapsignWebhookSecret: string | null;
  updatedAt: Date;
};

const TTL_MS = 60_000;
const final4 = (v: string | null | undefined) => (v ? `····${v.slice(-4)}` : null);

@Injectable()
export class IntegracoesService implements OnModuleInit {
  private readonly logger = new Logger(IntegracoesService.name);
  private linha: Linha | null = null;
  private carregadoEm = 0;
  private carregando: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.recarregar().catch((e) => this.logger.error(`integracoes: carga inicial falhou: ${(e as Error).message}`));
  }

  private async recarregar(): Promise<void> {
    this.linha = (await this.prisma.db.parametroIntegracao.findFirst()) as Linha | null;
    this.carregadoEm = Date.now();
  }

  private snapshot(): Linha | null {
    if (Date.now() - this.carregadoEm > TTL_MS && !this.carregando) {
      this.carregando = this.recarregar()
        .catch((e) => this.logger.warn(`integracoes: refresh falhou (mantendo snapshot): ${(e as Error).message}`))
        .finally(() => { this.carregando = null; });
    }
    return this.linha;
  }

  // --- Credenciais efetivas (sync) -------------------------------
  asaas(): CredencialAsaas {
    const l = this.snapshot();
    if (l?.asaasApiKey) {
      const ambiente = l.asaasAmbiente === 'producao' ? 'producao' : 'sandbox';
      return {
        apiKey: l.asaasApiKey,
        apiUrl: ambiente === 'producao' ? URL_ASAAS_PRODUCAO : URL_ASAAS_SANDBOX,
        webhookSecret: l.asaasWebhookSecret ?? this.config.get<string>('asaas.webhookSecret') ?? '',
        ambiente,
        fonte: 'banco',
      };
    }
    const urlEnv = this.config.get<string>('asaas.apiUrl') || URL_ASAAS_SANDBOX;
    return {
      apiKey: this.config.get<string>('asaas.apiKey') ?? '',
      apiUrl: urlEnv,
      webhookSecret: l?.asaasWebhookSecret ?? this.config.get<string>('asaas.webhookSecret') ?? '',
      ambiente: urlEnv.includes('sandbox') ? 'sandbox' : 'producao',
      fonte: 'env',
    };
  }

  zapsign(): CredencialZapSign {
    const l = this.snapshot();
    if (l?.zapsignApiToken) {
      const ambiente = l.zapsignAmbiente === 'producao' ? 'producao' : 'sandbox';
      return {
        apiToken: l.zapsignApiToken,
        apiUrl: ambiente === 'producao' ? URL_ZAPSIGN_PRODUCAO : URL_ZAPSIGN_SANDBOX,
        webhookSecret: l.zapsignWebhookSecret ?? process.env.ZAPSIGN_WEBHOOK_SECRET ?? '',
        ambiente,
        fonte: 'banco',
      };
    }
    const urlEnv = process.env.ZAPSIGN_API_URL || URL_ZAPSIGN_SANDBOX;
    return {
      apiToken: process.env.ZAPSIGN_API_TOKEN ?? '',
      apiUrl: urlEnv,
      webhookSecret: l?.zapsignWebhookSecret ?? process.env.ZAPSIGN_WEBHOOK_SECRET ?? '',
      ambiente: urlEnv.includes('sandbox') ? 'sandbox' : 'producao',
      fonte: 'env',
    };
  }

  // --- Tela ------------------------------------------------------
  // Status MASCARADO — a API nunca devolve o valor de um segredo.
  status() {
    const a = this.asaas();
    const z = this.zapsign();
    const l = this.linha;
    return {
      asaas: {
        ambiente: a.ambiente,
        fonte: a.fonte,
        simulado: !a.apiKey,
        apiKeyConfigurada: !!a.apiKey,
        apiKeyFinal: final4(a.apiKey || null),
        webhookSecretConfigurado: !!a.webhookSecret,
        webhookSecretFinal: final4(a.webhookSecret || null),
        webhookPath: '/api/v1/webhooks/asaas',
      },
      zapsign: {
        ambiente: z.ambiente,
        fonte: z.fonte,
        simulado: !z.apiToken,
        apiTokenConfigurado: !!z.apiToken,
        apiTokenFinal: final4(z.apiToken || null),
        webhookSecretConfigurado: !!z.webhookSecret,
        webhookSecretFinal: final4(z.webhookSecret || null),
        webhookPath: '/api/v1/webhooks/zapsign',
      },
      atualizadoEm: l?.updatedAt?.toISOString() ?? null,
    };
  }

  // Campo presente = grava; string vazia = LIMPA (volta ao fallback do env);
  // ausente = mantém. Auditado sempre com o valor mascarado.
  async atualizar(
    dto: {
      asaasAmbiente?: string;
      asaasApiKey?: string;
      asaasWebhookSecret?: string;
      zapsignAmbiente?: string;
      zapsignApiToken?: string;
      zapsignWebhookSecret?: string;
    },
    usuarioId?: string,
  ) {
    for (const amb of [dto.asaasAmbiente, dto.zapsignAmbiente]) {
      if (amb !== undefined && !['sandbox', 'producao'].includes(amb)) {
        throw new UnprocessableEntityException({ erro: 'ambiente_invalido', mensagem: "Ambiente deve ser 'sandbox' ou 'producao'" });
      }
    }
    const atual = this.linha ?? ((await this.prisma.db.parametroIntegracao.findFirst()) as Linha | null);
    const campo = (novo: string | undefined, velho: string | null) =>
      novo === undefined ? velho : (novo.trim() === '' ? null : novo.trim());
    const data = {
      asaasAmbiente: dto.asaasAmbiente ?? atual?.asaasAmbiente ?? 'sandbox',
      asaasApiKey: campo(dto.asaasApiKey, atual?.asaasApiKey ?? null),
      asaasWebhookSecret: campo(dto.asaasWebhookSecret, atual?.asaasWebhookSecret ?? null),
      zapsignAmbiente: dto.zapsignAmbiente ?? atual?.zapsignAmbiente ?? 'sandbox',
      zapsignApiToken: campo(dto.zapsignApiToken, atual?.zapsignApiToken ?? null),
      zapsignWebhookSecret: campo(dto.zapsignWebhookSecret, atual?.zapsignWebhookSecret ?? null),
    };
    const salvo = atual
      ? await this.prisma.db.parametroIntegracao.update({ where: { id: atual.id }, data })
      : await this.prisma.db.parametroIntegracao.create({ data });
    this.linha = salvo as Linha;
    this.carregadoEm = Date.now();
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'integracoes_alteradas',
        entidade: 'parametro_integracao',
        entidadeId: salvo.id,
        // NUNCA o valor — só o rastro mascarado do que mudou.
        depois: {
          asaasAmbiente: data.asaasAmbiente,
          asaasApiKey: final4(data.asaasApiKey),
          asaasWebhookSecret: final4(data.asaasWebhookSecret),
          zapsignAmbiente: data.zapsignAmbiente,
          zapsignApiToken: final4(data.zapsignApiToken),
          zapsignWebhookSecret: final4(data.zapsignWebhookSecret),
        } as Prisma.InputJsonValue,
      },
    });
    this.logger.warn(`Integrações alteradas (asaas: ${data.asaasAmbiente}/${final4(data.asaasApiKey) ?? 'env'} · zapsign: ${data.zapsignAmbiente}/${final4(data.zapsignApiToken) ?? 'env'})`);
    return this.status();
  }

  // Importa para o BANCO as credenciais que hoje só existem no ambiente
  // (.env/stack.env) — um clique e o operador nunca mais precisa caçar chave
  // em arquivo ou no painel do provedor. Só preenche campo VAZIO no banco
  // (nunca sobrescreve o que foi salvo pela tela); valores jamais expostos.
  async importarDoAmbiente(usuarioId?: string) {
    const atual = this.linha ?? ((await this.prisma.db.parametroIntegracao.findFirst()) as Linha | null);
    const dto: Parameters<IntegracoesService['atualizar']>[0] = {};
    const importados: string[] = [];

    const envAsaasKey = this.config.get<string>('asaas.apiKey') ?? '';
    const envAsaasUrl = this.config.get<string>('asaas.apiUrl') ?? '';
    const envAsaasSecret = this.config.get<string>('asaas.webhookSecret') ?? '';
    if (!atual?.asaasApiKey && envAsaasKey) {
      dto.asaasApiKey = envAsaasKey;
      dto.asaasAmbiente = envAsaasUrl && !envAsaasUrl.includes('sandbox') ? 'producao' : 'sandbox';
      importados.push('Asaas: API key (+ambiente)');
    }
    if (!atual?.asaasWebhookSecret && envAsaasSecret) {
      dto.asaasWebhookSecret = envAsaasSecret;
      importados.push('Asaas: segredo do webhook');
    }

    const envZsToken = process.env.ZAPSIGN_API_TOKEN ?? '';
    const envZsUrl = process.env.ZAPSIGN_API_URL ?? '';
    const envZsSecret = process.env.ZAPSIGN_WEBHOOK_SECRET ?? '';
    if (!atual?.zapsignApiToken && envZsToken) {
      dto.zapsignApiToken = envZsToken;
      dto.zapsignAmbiente = envZsUrl && !envZsUrl.includes('sandbox') ? 'producao' : 'sandbox';
      importados.push('ZapSign: API token (+ambiente)');
    }
    if (!atual?.zapsignWebhookSecret && envZsSecret) {
      dto.zapsignWebhookSecret = envZsSecret;
      importados.push('ZapSign: segredo do webhook');
    }

    if (importados.length === 0) {
      return { importados, status: this.status(), mensagem: 'Nada a importar — o ambiente não tem credencial que o banco já não tenha.' };
    }
    const status = await this.atualizar(dto, usuarioId);
    this.logger.warn(`Integrações importadas do ambiente: ${importados.join(' · ')}`);
    return { importados, status, mensagem: `Importado do ambiente: ${importados.join(' · ')}.` };
  }

  // Testa a credencial EFETIVA do Asaas com uma leitura inócua.
  async testarAsaas() {
    const a = this.asaas();
    if (!a.apiKey) {
      return { ok: false, simulado: true, ambiente: a.ambiente, mensagem: 'Sem API key configurada (banco e env vazios) — o Asaas está em modo simulado.' };
    }
    try {
      const resp = await fetch(`${a.apiUrl}/customers?limit=1`, { headers: { access_token: a.apiKey } });
      if (!resp.ok) {
        const corpo = await resp.text();
        return { ok: false, simulado: false, ambiente: a.ambiente, mensagem: `Asaas respondeu ${resp.status} — credencial inválida para este ambiente? ${corpo.slice(0, 160)}` };
      }
      const body = (await resp.json()) as { totalCount?: number };
      return { ok: true, simulado: false, ambiente: a.ambiente, fonte: a.fonte, mensagem: `Conexão OK no ambiente ${a.ambiente} (${body.totalCount ?? 0} cliente(s) na conta).` };
    } catch (e) {
      return { ok: false, simulado: false, ambiente: a.ambiente, mensagem: `Falha de rede ao chamar o Asaas: ${(e as Error).message}` };
    }
  }
}
