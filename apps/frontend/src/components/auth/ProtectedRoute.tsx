import { ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { authService } from '../../services/auth.service';

// Guarda de rotas (Doc 7 item 1.7). Sem sessão → redireciona para /login,
// guardando a rota de origem para voltar após o login.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const usuario = useAuthStore((s) => s.usuario);
  const setUsuario = useAuthStore((s) => s.setUsuario);
  const location = useLocation();

  // Re-hidratação (04/11, caso real em produção): token guardado sem o usuário
  // (ou sem os papéis) deixava a sidebar no fallback e toda permissão de tela
  // falsa — botões como "Anexar extras" sumiam. Busca a identidade no backend;
  // token inválido cai no 401 → refresh → login, pelo interceptor.
  const precisaHidratar = isAuthenticated && (!usuario || !Array.isArray(usuario.roles));
  useEffect(() => {
    if (!precisaHidratar) return;
    let vivo = true;
    authService.me().then((u) => { if (vivo) setUsuario(u); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [precisaHidratar, setUsuario]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
