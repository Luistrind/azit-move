import { createBrowserRouter } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { LoginPage } from './pages/auth/LoginPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { CarteiraPage } from './pages/CarteiraPage';
import { ContratoDetalhePage } from './pages/ContratoDetalhePage';

// Rotas client-side — Doc 4 §5.1. /login é pública; o restante é protegido pela sessão.
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <Shell />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <CarteiraPage />,
      },
      {
        path: 'contratos/:id',
        element: <ContratoDetalhePage />,
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
