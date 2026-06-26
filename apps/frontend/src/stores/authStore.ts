import { create } from 'zustand';

// Sessão do usuário interno (Doc 6). Os tokens vivem no localStorage (lidos pelos
// interceptors do axios); o store mantém o estado reativo da UI.
export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  roles: string[];
}

const ACCESS_KEY = 'azit_token';
const REFRESH_KEY = 'azit_refresh';
const USER_KEY = 'azit_user';

function lerUsuario(): UsuarioSessao | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UsuarioSessao;
  } catch {
    return null;
  }
}

interface AuthState {
  usuario: UsuarioSessao | null;
  isAuthenticated: boolean;
  setSessao: (params: {
    accessToken: string;
    refreshToken: string;
    usuario: UsuarioSessao;
  }) => void;
  limpar: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  usuario: lerUsuario(),
  isAuthenticated: !!localStorage.getItem(ACCESS_KEY),

  setSessao: ({ accessToken, refreshToken, usuario }) => {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(usuario));
    set({ usuario, isAuthenticated: true });
  },

  limpar: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    set({ usuario: null, isAuthenticated: false });
  },
}));

// Helpers de token usados pelos interceptors (fora do React).
export const tokenStorage = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  setAccess: (t: string) => localStorage.setItem(ACCESS_KEY, t),
  setRefresh: (t: string) => localStorage.setItem(REFRESH_KEY, t),
};
