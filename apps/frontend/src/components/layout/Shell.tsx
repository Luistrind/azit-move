import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

// Shell da aplicação — Doc 3 §7.1. Sidebar + Topbar + área de scroll.
// O título da topbar é derivado da rota atual (mapa simples por enquanto).
const TITULOS: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Carteira Operacional', subtitle: 'Portfólio de contratos' },
  '/regua': { title: 'Régua de Cobrança', subtitle: 'Gestão de inadimplência' },
  '/acordos': { title: 'Renegociações', subtitle: 'Acordos e novações' },
};

export function Shell() {
  const { pathname } = useLocation();
  const meta = pathname.startsWith('/contratos/')
    ? { title: 'Detalhe do contrato', subtitle: 'Cronograma e posição' }
    : TITULOS[pathname] ?? { title: 'Azit Move', subtitle: '' };

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={meta.title} subtitle={meta.subtitle} />
        <main
          className="flex-1 overflow-auto"
          style={{ background: 'var(--bg)', padding: '24px 26px 40px' }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
