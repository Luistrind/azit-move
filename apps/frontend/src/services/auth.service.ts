import { api } from '../lib/api';
import { UsuarioSessao, tokenStorage } from '../stores/authStore';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  usuario: UsuarioSessao;
}

// Um registro de acesso (doc 06 v1.1 §2.5): forma, resultado, motivo (só o Admin
// vê), IP, agente e quando (instante ISO; a tela formata no fuso do Brasil).
export interface AcessoRegistrado {
  id: string;
  forma: string;
  sucesso: boolean;
  motivo: string | null;
  ip: string | null;
  agente: string | null;
  em: string;
}

export interface MeusAcessos {
  acessos: AcessoRegistrado[];
  sessoesAtivas: number;
  entrada: { permiteSenha: boolean; googleVinculado: boolean; email: string | null };
}

// Chamadas de autenticação ao backend (Doc 6 §10).
export const authService = {
  // O que a tela de login precisa antes de qualquer credencial: o client id do
  // Google deste ambiente (null = botão não aparece). Preferida sobre o
  // VITE_GOOGLE_CLIENT_ID de build para o mesmo build servir hml e prod.
  // `senhaDisponivel`: existe alguém ativo com senha liberada? Se não, a tela
  // nem oferece "entrar com senha" (regra: não mostrar o que não dá para fazer).
  async config(): Promise<{ googleClientId: string | null; senhaDisponivel: boolean }> {
    const { data } = await api.get<{ googleClientId: string | null; senhaDisponivel: boolean }>('/api/v1/auth/config');
    return data;
  },

  // Entrar com Google (doc 06 §2.2): manda o ID token do botão oficial.
  async loginGoogle(credential: string): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>('/api/v1/auth/google', { credential });
    return data;
  },

  // Entrar por senha — reserva, só para quem tem permiteSenha (doc 06 §2.3).
  async login(email: string, senha: string): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>('/api/v1/auth/login', {
      email,
      senha,
    });
    return data;
  },

  // Identidade completa do usuário logado (04/11) — re-hidrata a sessão.
  async me(): Promise<UsuarioSessao> {
    const { data } = await api.get<UsuarioSessao>('/api/v1/auth/me');
    return data;
  },

  // "Minha conta" (doc 06 §2.5): meus últimos acessos e sessões abertas.
  async meusAcessos(): Promise<MeusAcessos> {
    const { data } = await api.get<MeusAcessos>('/api/v1/me/acessos');
    return data;
  },

  // Encerra TODAS as minhas sessões (este navegador inclusive — a tela sai em seguida).
  async encerrarMinhasSessoes(): Promise<{ encerradas: number }> {
    const { data } = await api.post<{ encerradas: number }>('/api/v1/me/encerrar-sessoes');
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
