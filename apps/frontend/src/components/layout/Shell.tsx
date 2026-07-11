import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Toaster } from '../Toast';

// Shell da aplicação — Doc 3 §7.1. Sidebar + Topbar + área de scroll.
// O título da topbar é derivado da rota atual (mapa simples por enquanto).
const TITULOS: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Carteira Operacional', subtitle: 'Posição consolidada por titular' },
  '/regua': { title: 'Régua de Cobrança', subtitle: 'Gestão de inadimplência' },
  '/acordos': { title: 'Renegociações', subtitle: 'Acompanhamento de acordos e novações' },
  '/aprovacoes': { title: 'Central de Aprovações', subtitle: 'Solicitações pendentes de alçada' },
  '/configuracoes/alcadas': { title: 'Alçadas', subtitle: 'Matriz de aprovação por papel' },
  '/configuracoes/simulador': { title: 'Simulador', subtitle: 'Parâmetros versionados e ofertas fixas' },
  '/centros-custo': { title: 'Centros de custo', subtitle: 'Quanto gastamos × quanto recebemos, por ativo' },
};

export function Shell() {
  const { pathname } = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);
  const meta = pathname.startsWith('/contratos/')
    ? { title: 'Detalhe do contrato', subtitle: 'Cronograma e posição' }
    : TITULOS[pathname] ?? { title: 'Azit Move', subtitle: '' };

  // Fecha a gaveta ao navegar (mobile).
  useEffect(() => { setMenuAberto(false); }, [pathname]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Sidebar fixa no desktop */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Gaveta no mobile */}
      {menuAberto && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,16,41,.5)' }}
            onClick={() => setMenuAberto(false)}
          />
          <div className="relative z-10 h-full" onClick={() => setMenuAberto(false)}>
            <Sidebar />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={meta.title} subtitle={meta.subtitle} onMenu={() => setMenuAberto(true)} />
        <main
          className="flex-1 overflow-auto p-[14px] pb-[32px] lg:px-[26px] lg:pb-[40px] lg:pt-[24px]"
          style={{ background: 'var(--bg)' }}
        >
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
