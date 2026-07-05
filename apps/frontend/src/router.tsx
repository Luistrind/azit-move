import { createBrowserRouter } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { LoginPage } from './pages/auth/LoginPage';
import { CarteiraPage } from './pages/CarteiraPage';
import { ContratoDetalhePage } from './pages/ContratoDetalhePage';
import { ReguaPage } from './pages/ReguaPage';
import { AcordosPage } from './pages/AcordosPage';
import { OriginacaoPage } from './pages/OriginacaoPage';
import { SimulacoesPage } from './pages/SimulacoesPage';
import { PropostasPage } from './pages/PropostasPage';
import { PropostaDetalhePage } from './pages/PropostaDetalhePage';
import { AtivoPage } from './pages/AtivoPage';
import { ProdutosPage } from './pages/ProdutosPage';
import { TitularPage } from './pages/TitularPage';
import { TitularDetalhePage } from './pages/TitularDetalhePage';
import { AprovacoesPage } from './pages/AprovacoesPage';
import { AlcadasPage } from './pages/AlcadasPage';
import { SimuladorConfigPage } from './pages/SimuladorConfigPage';

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
        path: 'simulacoes',
        element: <SimulacoesPage />,
      },
      {
        path: 'propostas',
        element: <PropostasPage />,
      },
      {
        path: 'propostas/:id',
        element: <PropostaDetalhePage />,
      },
      {
        path: 'ativos',
        element: <AtivoPage />,
      },
      {
        path: 'produtos',
        element: <ProdutosPage />,
      },
      {
        path: 'titulares',
        element: <TitularPage />,
      },
      {
        path: 'titulares/:id',
        element: <TitularDetalhePage />,
      },
      {
        path: 'aprovacoes',
        element: <AprovacoesPage />,
      },
      {
        path: 'configuracoes/alcadas',
        element: <AlcadasPage />,
      },
      {
        path: 'configuracoes/simulador',
        element: <SimuladorConfigPage />,
      },
    ],
  },
]);
