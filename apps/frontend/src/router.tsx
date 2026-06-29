import { createBrowserRouter } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { LoginPage } from './pages/auth/LoginPage';
import { CarteiraPage } from './pages/CarteiraPage';
import { ContratoDetalhePage } from './pages/ContratoDetalhePage';
import { ReguaPage } from './pages/ReguaPage';
import { AcordosPage } from './pages/AcordosPage';
import { OriginacaoPage } from './pages/OriginacaoPage';
import { PropostaDetalhePage } from './pages/PropostaDetalhePage';

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
        element: <ReguaPage />,
      },
      {
        path: 'acordos',
        element: <AcordosPage />,
      },
      {
        path: 'originacao',
        element: <OriginacaoPage />,
      },
      {
        path: 'originacao/propostas/:id',
        element: <PropostaDetalhePage />,
      },
    ],
  },
]);
