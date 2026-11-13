import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { mensagemSemAcessoArea } from '@azit/types';
import { tokenStorage, useAuthStore } from '../stores/authStore';

// Instância axios — Doc 4 §5.3 + fluxo de refresh (Doc 6 §3.3).
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

// Injeta o access token em toda requisição.
api.interceptors.request.use((config) => {
  const token = tokenStorage.getAccess();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Coordena um único refresh em andamento para evitar tempestade de 401 concorrentes.
let refreshEmAndamento: Promise<string | null> | null = null;

async function renovarAccessToken(): Promise<string | null> {
  const refreshToken = tokenStorage.getRefresh();
  if (!refreshToken) return null;
  try {
    // Cliente axios cru (sem interceptors) para não recursar no 401.
    const resp = await axios.post(
      `${import.meta.env.VITE_API_URL}/api/v1/auth/refresh`,
      { refreshToken },
    );
    tokenStorage.setAccess(resp.data.accessToken);
    tokenStorage.setRefresh(resp.data.refreshToken);
    return resp.data.accessToken as string;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };
    const url = original?.url ?? '';
    const ehRotaAuth = url.includes('/auth/login') || url.includes('/auth/google') || url.includes('/auth/refresh');

    if (error.response?.status === 401 && original && !original._retry && !ehRotaAuth) {
      original._retry = true;
      if (!refreshEmAndamento) refreshEmAndamento = renovarAccessToken();
      const novoToken = await refreshEmAndamento;
      refreshEmAndamento = null;

      if (novoToken) {
        original.headers.Authorization = `Bearer ${novoToken}`;
        return api(original);
      }
      // Refresh falhou → encerra sessão e manda para o login.
      useAuthStore.getState().limpar();
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    // 403 por área de trabalho (doc 06 §7.5): a mensagem é uma só em toda a tela —
    // "Sem acesso à área X". Quem exibe erros usa mensagemErro(), que lê o campo `area`.
    const dados = error.response?.data as { erro?: string; area?: string } | undefined;
    if (error.response?.status === 403 && dados?.erro === 'acesso_negado' && dados.area) {
      error.message = mensagemSemAcessoArea(dados.area);
    }
    return Promise.reject(error);
  },
);
