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
  whatsapp: {
    fonte: 'banco' | 'env';
    simulado: boolean;
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
  async testarWhatsapp(): Promise<{ ok: boolean; simulado: boolean; mensagem: string }> {
    const { data } = await api.post('/api/v1/integracoes/whatsapp/testar');
    return data;
  },
  async testarAsaas(): Promise<{ ok: boolean; simulado: boolean; ambiente: string; mensagem: string }> {
    const { data } = await api.post('/api/v1/integracoes/asaas/testar');
    return data;
  },
};
