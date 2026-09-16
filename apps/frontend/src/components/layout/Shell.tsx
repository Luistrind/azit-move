import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Toaster } from '../Toast';

// Shell da aplicação — Doc 3 §7.1. Sidebar + Topbar + área de scroll.
// O título da topbar é derivado da rota atual (mapa simples por enquanto).
const TITULOS: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Início', subtitle: 'Sua fila de trabalho' },
  '/atendimento': { title: 'Novo atendimento', subtitle: 'Simulação na frente do cliente' },
  '/catalogo': { title: 'Catálogo de produtos', subtitle: 'Produto, variantes e versões de parâmetros' },
  '/protecao': { title: 'Proteção veicular', subtitle: 'Simulação da contribuição — valores em homologação' },
  '/contas-a-pagar': { title: 'Contas a pagar', subtitle: 'Financeiro administrativo — do pedido ao extrato' },
  '/fornecedores-financeiro': { title: 'Fornecedores', subtitle: 'Cadastro mestre com dados bancários versionados' },
  '/financeiro-configuracao': { title: 'Configuração do financeiro', subtitle: 'Entidades, contas, naturezas e centros de custo' },
  '/carteira': { title: 'Carteira Operacional', subtitle: 'Posição consolidada por titular' },
  '/analises': { title: 'Análises de cadastro', subtitle: 'Fila de análises em andamento' },
  '/pessoas': { title: 'Pessoas', subtitle: 'Investidores, fornecedores e parceiros' },
  '/estruturas': { title: 'Estruturas jurídicas', subtitle: 'Capital por rodada de captação' },
  '/configuracoes/usuarios': { title: 'Usuários e permissões', subtitle: 'Acesso por papel e por área' },
  '/regua': { title: 'Régua de Cobrança', subtitle: 'Gestão de inadimplência' },
  '/acordos': { title: 'Renegociações', subtitle: 'Acompanhamento de acordos e novações' },
  '/aprovacoes': { title: 'Central de Aprovações', subtitle: 'Solicitações pendentes de alçada' },
  '/configuracoes/alcadas': { title: 'Alçadas', subtitle: 'Matriz de aprovação por papel' },
  '/configuracoes/simulador': { title: 'Simulador', subtitle: 'Parâmetros versionados e ofertas fixas' },
  '/centros-custo': { title: 'Custo por ativo', subtitle: 'Quanto gastamos × quanto recebemos, por veículo' },
  // Auditoria 15/09 (Bloco D): 5 telas ficavam com topbar genérico "Azit Move".
  '/simulacoes': { title: 'Simulações', subtitle: 'Atendimentos simulados e retomada' },
  '/propostas': { title: 'Propostas', subtitle: 'Funil comercial — da proposta à formalização' },
  '/titulares': { title: 'Titulares', subtitle: 'Cadastro único de clientes' },
  '/ativos': { title: 'Estoque de ativos', subtitle: 'Veículos e disponibilidade' },
  '/produtos': { title: 'Itens avulsos de contrato', subtitle: 'Itens contratáveis avulsos (legado §9)' },
  '/configuracoes/assinatura': { title: 'Assinatura digital', subtitle: 'Signatários padrão e validade do contrato' },
  '/configuracoes/integracoes': { title: 'Integrações', subtitle: 'Credenciais do Asaas e da ZapSign — sem redeploy' },
};

export function Shell() {
  const { pathname } = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);
  const meta = pathname.startsWith('/contratos/')
    ? { title: 'Detalhe do contrato', subtitle: 'Cronograma e posição' }
    : pathname.startsWith('/titulares/')
      ? { title: 'Ficha do titular', subtitle: 'Hub de operações da conta' }
      : pathname.startsWith('/propostas/')
        ? { title: 'Proposta', subtitle: 'Detalhe e formalização' }
        : pathname.startsWith('/analises/')
          ? { title: 'Análise de cadastro', subtitle: 'Dossiê e decisão' }
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
