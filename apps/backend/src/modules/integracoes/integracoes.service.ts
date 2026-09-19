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

// WhatsApp Business Platform — Cloud API oficial da Meta (doc 02 §23, 19/09):
// número dedicado às notificações formais de cobrança (POP-COB-001).
export interface CredencialWhatsApp {
  phoneNumberId: string; // '' = sem provedor (simulado fora de produção)
  wabaId: string;
  accessToken: string;
  appSecret: string; // assinatura X-Hub-Signature-256 do webhook
  verifyToken: string; // handshake GET do webhook
  graphUrl: string;
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
  whatsappPhoneNumberId: string | null;
  whatsappWabaId: string | null;
  whatsappAccessToken: string | null;
  whatsappAppSecret: string | null;
  whatsappVerifyToken: string | null;
  updatedAt: Date;
};

// Versão da Graph API — configurável porque a Meta aposenta versões (~2 anos).
const GRAPH_URL = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'}`;

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

  private adocaoPendente = true;

  async onModuleInit() {
    await this.recarregar().catch((e) =>
      // Deploy: o backend novo pode subir ANTES do migrate criar a tabela —
      // não é erro fatal, a adoção acontece no primeiro refresh bem-sucedido.
      this.logger.warn(`integracoes: carga inicial adiada (${(e as Error).message})`),
    );
  }

  private async recarregar(): Promise<void> {
    this.linha = (await this.prisma.db.parametroIntegracao.findFirst()) as Linha | null;
    this.carregadoEm = Date.now();
    // Bootstrap (decisão Luís 15-16/09): o sistema já fica com as credenciais
    // do ambiente CADASTRADAS e ativas na central — o operador nunca precisa
    // caçar chave em arquivo. Roda na primeira carga bem-sucedida (mesmo que
    // seja depois da migração, sem exigir restart). Só preenche o que estiver
    // vazio no banco; o que foi salvo pela tela manda sempre.
    if (this.adocaoPendente) {
      this.adocaoPendente = false;
      await this.adotarDoAmbiente().catch((e) => {
        this.adocaoPendente = true; // tenta de novo no próximo refresh
        this.logger.warn(`integracoes: adoção do ambiente adiada (${(e as Error).message})`);
      });
    }
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

  // Campo a campo banco ?? env (o número e o token andam juntos: sem os dois
  // não há provedor). A fonte reporta de onde veio o token.
  whatsapp(): CredencialWhatsApp {
    const l = this.snapshot();
    const env = process.env;
    return {
      phoneNumberId: l?.whatsappPhoneNumberId ?? env.WHATSAPP_PHONE_NUMBER_ID ?? '',
      wabaId: l?.whatsappWabaId ?? env.WHATSAPP_WABA_ID ?? '',
      accessToken: l?.whatsappAccessToken ?? env.WHATSAPP_ACCESS_TOKEN ?? '',
      appSecret: l?.whatsappAppSecret ?? env.WHATSAPP_APP_SECRET ?? '',
      verifyToken: l?.whatsappVerifyToken ?? env.WHATSAPP_VERIFY_TOKEN ?? '',
      graphUrl: GRAPH_URL,
      fonte: l?.whatsappAccessToken ? 'banco' : 'env',
    };
  }

  // --- Tela ------------------------------------------------------
  // Status MASCARADO — a API nunca devolve o valor de um segredo.
  status() {
    const a = this.asaas();
    const z = this.zapsign();
    const w = this.whatsapp();
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
      whatsapp: {
        fonte: w.fonte,
        simulado: !(w.phoneNumberId && w.accessToken),
        // O id do número e da conta não são segredos — exibidos por inteiro.
        phoneNumberId: w.phoneNumberId || null,
        wabaId: w.wabaId || null,
        accessTokenConfigurado: !!w.accessToken,
        accessTokenFinal: final4(w.accessToken || null),
        appSecretConfigurado: !!w.appSecret,
        appSecretFinal: final4(w.appSecret || null),
        verifyTokenConfigurado: !!w.verifyToken,
        verifyTokenFinal: final4(w.verifyToken || null),
        webhookPath: '/api/v1/webhooks/whatsapp',
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
      whatsappPhoneNumberId?: string;
      whatsappWabaId?: string;
      whatsappAccessToken?: string;
      whatsappAppSecret?: string;
      whatsappVerifyToken?: string;
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
      whatsappPhoneNumberId: campo(dto.whatsappPhoneNumberId, atual?.whatsappPhoneNumberId ?? null),
      whatsappWabaId: campo(dto.whatsappWabaId, atual?.whatsappWabaId ?? null),
      whatsappAccessToken: campo(dto.whatsappAccessToken, atual?.whatsappAccessToken ?? null),
      whatsappAppSecret: campo(dto.whatsappAppSecret, atual?.whatsappAppSecret ?? null),
      whatsappVerifyToken: campo(dto.whatsappVerifyToken, atual?.whatsappVerifyToken ?? null),
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
          whatsappPhoneNumberId: data.whatsappPhoneNumberId,
          whatsappAccessToken: final4(data.whatsappAccessToken),
          whatsappAppSecret: final4(data.whatsappAppSecret),
          whatsappVerifyToken: final4(data.whatsappVerifyToken),
        } as Prisma.InputJsonValue,
      },
    });
    this.logger.warn(`Integrações alteradas (asaas: ${data.asaasAmbiente}/${final4(data.asaasApiKey) ?? 'env'} · zapsign: ${data.zapsignAmbiente}/${final4(data.zapsignApiToken) ?? 'env'})`);
    return this.status();
  }

  // Adoção automática no boot: traz para a central o que existe no ambiente
  // (.env / stack.env) — assim a tela já nasce com os tokens certos
  // cadastrados e ativos. Só preenche campo VAZIO no banco (o que foi salvo
  // pela tela nunca é sobrescrito); valores jamais expostos ou logados.
  async adotarDoAmbiente(usuarioId?: string) {
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

    const envWa: [keyof typeof dto & keyof Linha, string | undefined, string][] = [
      ['whatsappPhoneNumberId', process.env.WHATSAPP_PHONE_NUMBER_ID, 'WhatsApp: id do número'],
      ['whatsappWabaId', process.env.WHATSAPP_WABA_ID, 'WhatsApp: id da conta'],
      ['whatsappAccessToken', process.env.WHATSAPP_ACCESS_TOKEN, 'WhatsApp: token de acesso'],
      ['whatsappAppSecret', process.env.WHATSAPP_APP_SECRET, 'WhatsApp: segredo do app'],
      ['whatsappVerifyToken', process.env.WHATSAPP_VERIFY_TOKEN, 'WhatsApp: token de verificação'],
    ];
    for (const [campo, valor, rotulo] of envWa) {
      if (!atual?.[campo] && valor) {
        dto[campo] = valor;
        importados.push(rotulo);
      }
    }

    if (importados.length === 0) return { importados };
    await this.atualizar(dto, usuarioId);
    this.logger.log(`Integrações: credenciais do ambiente adotadas na central (${importados.join(' · ')})`);
    return { importados };
  }

  // Testa a credencial EFETIVA do WhatsApp lendo o próprio número na Meta
  // (inócuo: não envia mensagem). Confirma número, nome verificado e qualidade.
  async testarWhatsapp() {
    const w = this.whatsapp();
    if (!w.phoneNumberId || !w.accessToken) {
      return { ok: false, simulado: true, mensagem: 'Informe o id do número e o token de acesso — sem eles as notificações ficam em modo simulado (fora de produção) ou retidas (produção).' };
    }
    try {
      const resp = await fetch(`${w.graphUrl}/${w.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, {
        headers: { Authorization: `Bearer ${w.accessToken}` },
      });
      const body = (await resp.json()) as { display_phone_number?: string; verified_name?: string; quality_rating?: string; error?: { message?: string } };
      if (!resp.ok) {
        return { ok: false, simulado: false, mensagem: `A Meta respondeu ${resp.status}: ${body.error?.message ?? 'credencial inválida'}` };
      }
      return {
        ok: true,
        simulado: false,
        mensagem: `Conexão OK — número ${body.display_phone_number ?? '?'} (${body.verified_name ?? 'sem nome verificado'}), qualidade ${body.quality_rating ?? 'n/d'}.`,
      };
    } catch (e) {
      return { ok: false, simulado: false, mensagem: `Falha de rede ao chamar a Meta: ${(e as Error).message}` };
    }
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
