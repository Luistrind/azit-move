import { createBrowserRouter } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { LoginPage } from './pages/auth/LoginPage';
import { CarteiraPage } from './pages/CarteiraPage';
import { InicioPage } from './pages/InicioPage';
import { AnalisesPage } from './pages/AnalisesPage';
import { PessoasPage } from './pages/PessoasPage';
import { EstruturasPage } from './pages/EstruturasPage';
import { ContratoDetalhePage } from './pages/ContratoDetalhePage';
import { ReguaPage } from './pages/ReguaPage';
import { AcordosPage } from './pages/AcordosPage';
import { AtendimentoPage } from './pages/AtendimentoPage';
import { SimulacoesPage } from './pages/SimulacoesPage';
import { PropostasPage } from './pages/PropostasPage';
import { PropostaDetalhePage } from './pages/PropostaDetalhePage';
import { AnalisePage } from './pages/AnalisePage';
import { AtivoPage } from './pages/AtivoPage';
import { ProdutosPage } from './pages/ProdutosPage';
import { CatalogoPage } from './pages/CatalogoPage';
import { ProtecaoPage } from './pages/ProtecaoPage';
import { ContasPagarPage } from './pages/ContasPagarPage';
import { FornecedoresPage } from './pages/FornecedoresPage';
import { FinanceiroConfigPage } from './pages/FinanceiroConfigPage';
import { AssinaturaConfigPage } from './pages/AssinaturaConfigPage';
import { TitularPage } from './pages/TitularPage';
import { TitularDetalhePage } from './pages/TitularDetalhePage';
import { AprovacoesPage } from './pages/AprovacoesPage';
import { AlcadasPage } from './pages/AlcadasPage';
import { SimuladorConfigPage } from './pages/SimuladorConfigPage';
import { UsuariosPage } from './pages/UsuariosPage';
import { CentroCustoPage } from './pages/CentroCustoPage';
import { IntegracoesPage } from './pages/IntegracoesPage';

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
        element: <InicioPage />,
      },
      {
        path: 'carteira',
        element: <CarteiraPage />,
      },
      {
        path: 'analises',
        element: <AnalisesPage />,
      },
      {
        path: 'pessoas',
        element: <PessoasPage />,
      },
      {
        path: 'estruturas',
        element: <EstruturasPage />,
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
        path: 'atendimento',
        element: <AtendimentoPage />,
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
        path: 'analises/:id',
        element: <AnalisePage />,
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
        path: 'catalogo',
        element: <CatalogoPage />,
      },
      {
        path: 'protecao',
        element: <ProtecaoPage />,
      },
      {
        path: 'contas-a-pagar',
        element: <ContasPagarPage />,
      },
      {
        path: 'fornecedores-financeiro',
        element: <FornecedoresPage />,
      },
      {
        path: 'financeiro-configuracao',
        element: <FinanceiroConfigPage />,
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
        path: 'configuracoes/assinatura',
        element: <AssinaturaConfigPage />,
      },
      {
        path: 'centros-custo',
        element: <CentroCustoPage />,
      },
      {
        path: 'configuracoes/simulador',
        element: <SimuladorConfigPage />,
      },
      {
        path: 'configuracoes/usuarios',
        element: <UsuariosPage />,
      },
      {
        path: 'configuracoes/integracoes',
        element: <IntegracoesPage />,
      },
      // Catch-all (auditoria 15/09, Bloco D): URL desconhecida não pode cair
      // no erro cru do React Router (já aconteceu com /originacao) — mostra
      // uma página simples com caminho de volta.
      {
        path: '*',
        element: (
          <div className="flex flex-col items-start gap-[10px] p-[24px]">
            <h1 className="font-display text-[20px] font-bold">Página não encontrada</h1>
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              O endereço não existe (ou mudou). Use o menu ao lado ou volte ao início.
            </p>
            <a href="/" className="rounded-[8px] px-[14px] py-[8px] text-[12.5px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>
              Ir para o Início
            </a>
          </div>
        ),
      },
    ],
  },
]);
