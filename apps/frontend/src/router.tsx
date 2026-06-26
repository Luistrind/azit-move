import { createBrowserRouter } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { PlaceholderPage } from './pages/PlaceholderPage';

// Rotas client-side — Doc 4 §5.1. Shell envolve as páginas autenticadas.
// O guard de rota e a tela de login entram no Bloco 1 (autenticação).
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      {
        index: true,
        element: (
          <PlaceholderPage
            titulo="Carteira Operacional"
            descricao="KPIs e portfólio de contratos sobre dados semeados (Bloco 3)."
          />
        ),
      },
      {
        path: 'regua',
        element: (
          <PlaceholderPage
            titulo="Régua de Cobrança"
            descricao="Kanban de 5 estágios D+1 a D+12 (Bloco 5)."
          />
        ),
      },
      {
        path: 'acordos',
        element: (
          <PlaceholderPage
            titulo="Renegociações"
            descricao="Lista de acordos e modal de novação (Bloco 6)."
          />
        ),
      },
    ],
  },
]);
