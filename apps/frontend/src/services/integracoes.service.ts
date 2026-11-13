import type { EstadoEnvioEmail } from '@azit/types';
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
  // Entrar com Google (doc 06 v1.1 §2.2): informativo — o client id vem do
  // ambiente do servidor (stack.env), não é editável pela tela.
  google: { configurado: boolean; clientIdInicio: string | null; fonte: 'servidor'; console: string };
  atualizadoEm: string | null;
}

// E-mail (Gmail do Workspace — doc 06 v1.1 §12.4): estado do transporte e os
// últimos jobs da fila. A credencial nunca vem.
export interface EnvioEmailListado {
  id: string;
  para: string;
  assunto: string;
  origem: { tipo: string; id: string };
  estado: EstadoEnvioEmail;
  motivo: string | null;
  tentativas: number;
  em: string;
}
export interface StatusEmail {
  configurado: boolean;
  // Qual caminho está ativo (EMAIL_TRANSPORTE): relay SMTP do Workspace (escolhido),
  // API do Gmail (alternativa) ou nenhum.
  transporte: 'smtp-relay' | 'gmail-api' | 'nenhum' | 'duble';
  descricao: string;
  remetente: string | null;
  fonte: 'servidor';
  variaveis: string[];
  console: string;
  ultimos: EnvioEmailListado[];
}

export interface AtualizarIntegracoes {
  asaasAmbiente?: string;
  asaasApiKey?: string;
  asaasWebhookSecret?: string;
  zapsignAmbiente?: string;
  zapsignApiToken?: string;
  zapsignWebhookSecret?: string;
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
  async statusEmail(): Promise<StatusEmail> {
    const { data } = await api.get<StatusEmail>('/api/v1/integracoes/email');
    return data;
  },
  async testarAsaas(): Promise<{ ok: boolean; simulado: boolean; ambiente: string; mensagem: string }> {
    const { data } = await api.post('/api/v1/integracoes/asaas/testar');
    return data;
  },
};
