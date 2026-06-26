import { api } from '../lib/api';
import { UsuarioSessao, tokenStorage } from '../stores/authStore';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  usuario: UsuarioSessao;
}

// Chamadas de autenticação ao backend (Doc 6 §10).
export const authService = {
  async login(email: string, senha: string): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>('/api/v1/auth/login', {
      email,
      senha,
    });
    return data;
  },

  async logout(): Promise<void> {
    const refreshToken = tokenStorage.getRefresh();
    if (refreshToken) {
      // best-effort: revoga o refresh no servidor; ignora falha de rede.
      await api.post('/api/v1/auth/logout', { refreshToken }).catch(() => undefined);
    }
  },
};
