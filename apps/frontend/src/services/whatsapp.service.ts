import { api } from '../lib/api';

// Canal WhatsApp (doc 02 §23): parâmetros versionados — chave geral dos envios
// automáticos, números autorizados fora de produção e o modelo de cada momento.
// Nenhum segredo trafega aqui (credenciais ficam em Configuração › Integrações).

export interface ModeloWhatsapp {
  momento: string; // D_MENOS_2 | D_ZERO | D_MAIS_2
  nome: string;
  idioma: string;
  // O que precisa existir na Meta para ESTE ambiente.
  cadastro: {
    categoria: string;
    corpo: string;
    variaveis: string[];
    botaoTexto: string;
    botaoUrl: string;
    botaoVariavel: string;
  };
}

// Modelo "detalhes do pedido" com o Pix copia e cola (doc 02 §28.6): botão fixo
// da Meta, link da fatura inteiro no texto — o mesmo modelo nos dois ambientes.
export interface ModeloPixWhatsapp {
  momento: string; // D_MENOS_2 | D_ZERO
  nome: string;
  idioma: string;
  cadastro: { categoria: string; corpo: string; variaveis: string[]; botaoTexto: string };
}

export interface ParametrosWhatsapp {
  versao: number; // 0 = padrões, nunca salvo
  ativo: boolean;
  numerosAutorizados: string[];
  modelos: ModeloWhatsapp[]; // D-2, D0 e D+2 (atraso)
  pix: { ativo: boolean; recebedor: string; modelos: ModeloPixWhatsapp[] };
  janela: { inicio: number; fim: number };
  alteradoEm: string | null;
  alteradoPor: string | null;
  ambiente: { producao: boolean; credencialConfigurada: boolean };
}

export interface SalvarParametrosWhatsapp {
  ativo?: boolean;
  numerosAutorizados?: string[];
  modeloD2Nome?: string;
  modeloD2Idioma?: string;
  modeloD0Nome?: string;
  modeloD0Idioma?: string;
  modeloAtrasoNome?: string;
  modeloAtrasoIdioma?: string;
  modeloPixD2Nome?: string;
  modeloPixD0Nome?: string;
  modeloPixIdioma?: string;
  pixNoLembrete?: boolean;
  recebedorPix?: string;
}

export const whatsappService = {
  async parametros(): Promise<ParametrosWhatsapp> {
    const { data } = await api.get<ParametrosWhatsapp>('/api/v1/whatsapp/parametros');
    return data;
  },
  async salvarParametros(body: SalvarParametrosWhatsapp): Promise<ParametrosWhatsapp> {
    const { data } = await api.put<ParametrosWhatsapp>('/api/v1/whatsapp/parametros', body);
    return data;
  },
};
