import { api } from '../lib/api';

// Parâmetros da assinatura digital (doc 02 §21 F1.1): quem assina pela Azit,
// as duas testemunhas padrão e a chave do envio automático por WhatsApp.
export interface ParametrosAssinatura {
  id: string;
  azitNome: string;
  azitCpf: string;
  azitWhatsapp: string;
  testemunha1Nome: string;
  testemunha1Cpf: string;
  testemunha1Whatsapp: string;
  testemunha2Nome: string;
  testemunha2Cpf: string;
  testemunha2Whatsapp: string;
  envioAutomaticoWhatsapp: boolean;
}

export const assinaturaConfigService = {
  async obter(): Promise<ParametrosAssinatura> {
    const { data } = await api.get('/api/v1/assinatura/parametros');
    return data;
  },
  async salvar(body: Omit<ParametrosAssinatura, 'id'>): Promise<ParametrosAssinatura> {
    const { data } = await api.post('/api/v1/assinatura/parametros', body);
    return data;
  },
};
