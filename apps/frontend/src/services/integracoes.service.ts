import { api } from '../lib/api';

// Central de integrações (decisão 15/09): status MASCARADO — a API nunca
// devolve o valor de um segredo; a tela só envia (write-only).
export interface StatusProvedor {
  ambiente: 'sandbox' | 'producao';
  fonte: 'banco' | 'env';
  simulado: boolean;
  webhookSecretConfigurado: boolean;
  webhookSecretFinal: string | null;
  webhookPath: string;
}

export interface StatusIntegracoes {
  asaas: StatusProvedor & { apiKeyConfigurada: boolean; apiKeyFinal: string | null };
  zapsign: StatusProvedor & { apiTokenConfigurado: boolean; apiTokenFinal: string | null };
  // WhatsApp — Cloud API da Meta (doc 02 §22 item 7, §23). Os dois ids não são
  // segredo e vêm inteiros; token, chave secreta e token de verificação só o final.
  whatsapp: {
    fonte: 'banco' | 'env';
    simulado: boolean; // sem id do número + token de acesso
    phoneNumberId: string | null;
    wabaId: string | null;
    accessTokenConfigurado: boolean;
    accessTokenFinal: string | null;
    appSecretConfigurado: boolean;
    appSecretFinal: string | null;
    verifyTokenConfigurado: boolean;
    verifyTokenFinal: string | null;
    webhookPath: string;
  };
  // Entrar com Google (doc 06 v1.1 §2.2): informativo — o client id vem do
  // ambiente do servidor (stack.env), não é editável pela tela.
  google: { configurado: boolean; clientIdInicio: string | null; fonte: 'servidor'; console: string };
  atualizadoEm: string | null;
}

export interface AtualizarIntegracoes {
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
}

export const integracoesService = {
  async status(): Promise<StatusIntegracoes> {
    const { data } = await api.get<StatusIntegracoes>('/api/v1/integracoes');
    return data;
  },
  async atualizar(body: AtualizarIntegracoes): Promise<StatusIntegracoes> {
    const { data } = await api.put<StatusIntegracoes>('/api/v1/integracoes', body);
    return data;
  },
  async testarAsaas(): Promise<{ ok: boolean; simulado: boolean; ambiente: string; mensagem: string }> {
    const { data } = await api.post('/api/v1/integracoes/asaas/testar');
    return data;
  },
  // Lê o próprio número na Meta — não envia mensagem.
  async testarWhatsapp(): Promise<{ ok: boolean; simulado: boolean; mensagem: string }> {
    const { data } = await api.post('/api/v1/integracoes/whatsapp/testar');
    return data;
  },
};
