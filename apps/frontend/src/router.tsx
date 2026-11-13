import { createBrowserRouter, RouteObject } from 'react-router-dom';
import { AreaSistema } from '@azit/types';
import { Shell } from './components/layout/Shell';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { RotaPorArea } from './components/auth/RotaPorArea';
import { AREAS_ROTA_CONTRATO, AREAS_ROTA_FICHA_TITULAR, AreaRota } from './lib/permissoes';
import { LoginPage } from './pages/auth/LoginPage';
import { CarteiraPage } from './pages/CarteiraPage';
import { CarteiraClientesPage } from './pages/CarteiraClientesPage';
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
import { ListaEsperaPage } from './pages/ListaEsperaPage';
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
import { DocumentosEmpresaPage } from './pages/DocumentosEmpresaPage';
import { TitularPage } from './pages/TitularPage';
import { TitularDetalhePage } from './pages/TitularDetalhePage';
import { AprovacoesPage } from './pages/AprovacoesPage';
import { AprovacaoDossiePage } from './pages/AprovacaoDossiePage';
import { AlcadasPage } from './pages/AlcadasPage';
import { SimuladorConfigPage } from './pages/SimuladorConfigPage';
import { UsuariosPage } from './pages/UsuariosPage';
import { CentroCustoPage } from './pages/CentroCustoPage';
import { IntegracoesPage } from './pages/IntegracoesPage';
import { OcorrenciasPage } from './pages/OcorrenciasPage';
import { MigracaoLegadoPage } from './pages/MigracaoLegadoPage';
import { MigracaoLegadoCasoPage } from './pages/MigracaoLegadoCasoPage';
import { MinhaContaPage } from './pages/MinhaContaPage';

// Rotas client-side — Doc 4 §5.1. /login é pública; o restante é protegido pela sessão.
//
// Área por rota (doc 06 §5.4 item 3, §13 — v1.1): cada tela declara em `handle.area`
// a(s) área(s) de trabalho a que pertence, no MESMO mapa dos controllers da API.
// `RotaPorArea` lê isso e mostra "Sem acesso a esta área" para quem não a tem.
// Início, login e páginas de apoio não declaram área.
const { COMERCIAL, ANALISE_CADASTRO, CARTEIRA_COBRANCA, FINANCEIRO_ADMINISTRATIVO, PESSOAS, ATIVOS_FROTA, CAPITAL_INVESTIMENTO, PRODUTOS, APROVACOES, CONFIGURACOES } = AreaSistema;

function rota(path: string, element: JSX.Element, area?: AreaRota): RouteObject {
  return area ? { path, element, handle: { area } } : { path, element };
}

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
        element: <RotaPorArea />,
        children: [
          { index: true, element: <InicioPage /> },
          // Minha conta (doc 06 v1.1 §2.5): sem área — apoio a qualquer usuário autenticado.
          rota('minha-conta', <MinhaContaPage />),

          // Comercial (funil: atendimento → simulação → proposta → formalização)
          rota('atendimento', <AtendimentoPage />, COMERCIAL),
          rota('simulacoes', <SimulacoesPage />, COMERCIAL),
          rota('propostas', <PropostasPage />, COMERCIAL),
          rota('propostas/:id', <PropostaDetalhePage />, COMERCIAL),
          rota('lista-espera', <ListaEsperaPage />, COMERCIAL),

          // Análise de cadastro
          rota('analises', <AnalisesPage />, ANALISE_CADASTRO),
          rota('analises/:id', <AnalisePage />, ANALISE_CADASTRO),

          // Carteira e cobrança
          rota('carteira', <CarteiraPage />, CARTEIRA_COBRANCA),
          rota('carteira/clientes', <CarteiraClientesPage />, CARTEIRA_COBRANCA),
          rota('regua', <ReguaPage />, CARTEIRA_COBRANCA),
          rota('acordos', <AcordosPage />, CARTEIRA_COBRANCA),
          rota('migracao-legado', <MigracaoLegadoPage />, CARTEIRA_COBRANCA),
          rota('migracao-legado/:id', <MigracaoLegadoCasoPage />, CARTEIRA_COBRANCA),

          // Detalhe do contrato: tela compartilhada (sem item de menu "Contratos") —
          // aberta a partir da carteira, do funil (formalização) e da ficha.
          rota('contratos/:id', <ContratoDetalhePage />, AREAS_ROTA_CONTRATO),

          // Pessoas (ficha do titular é compartilhada com o atendimento)
          rota('titulares', <TitularPage />, PESSOAS),
          rota('titulares/:id', <TitularDetalhePage />, AREAS_ROTA_FICHA_TITULAR),
          rota('pessoas', <PessoasPage />, PESSOAS),

          // Financeiro administrativo
          rota('contas-a-pagar', <ContasPagarPage />, FINANCEIRO_ADMINISTRATIVO),
          rota('fornecedores-financeiro', <FornecedoresPage />, FINANCEIRO_ADMINISTRATIVO),
          rota('financeiro-configuracao', <FinanceiroConfigPage />, FINANCEIRO_ADMINISTRATIVO),

          // Ativos e frota (custo por ativo também é lido pelo financeiro — mesma API)
          rota('ativos', <AtivoPage />, ATIVOS_FROTA),
          rota('frota/ocorrencias', <OcorrenciasPage />, ATIVOS_FROTA),
          rota('centros-custo', <CentroCustoPage />, [ATIVOS_FROTA, FINANCEIRO_ADMINISTRATIVO]),

          // Capital e investimento
          rota('estruturas', <EstruturasPage />, CAPITAL_INVESTIMENTO),

          // Produtos
          rota('produtos', <ProdutosPage />, PRODUTOS),
          rota('catalogo', <CatalogoPage />, PRODUTOS),
          rota('protecao', <ProtecaoPage />, PRODUTOS),

          // Aprovações
          rota('aprovacoes', <AprovacoesPage />, APROVACOES),
          rota('aprovacoes/:id', <AprovacaoDossiePage />, APROVACOES),

          // Configurações
          rota('configuracoes/alcadas', <AlcadasPage />, CONFIGURACOES),
          rota('configuracoes/assinatura', <AssinaturaConfigPage />, CONFIGURACOES),
          rota('configuracoes/documentos-empresa', <DocumentosEmpresaPage />, CONFIGURACOES),
          rota('configuracoes/simulador', <SimuladorConfigPage />, CONFIGURACOES),
          rota('configuracoes/usuarios', <UsuariosPage />, CONFIGURACOES),
          rota('configuracoes/integracoes', <IntegracoesPage />, CONFIGURACOES),

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
    ],
  },
]);
