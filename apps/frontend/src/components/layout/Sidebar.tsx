import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/authStore';
import { authService } from '../../services/auth.service';
import { aprovacaoService } from '../../services/aprovacao.service';
import { usuarioService } from '../../services/usuario.service';
import { queryClient } from '../../lib/queryClient';

// Sidebar 236px navy — Doc 3 §7.2. Logo (fallback bloco âmbar "a" até o SVG oficial),
// nav e footer de usuário. Os itens reais entram conforme as telas dos blocos seguintes.
type NavItemDef = { to: string; label: string };

// Iniciais do nome para o avatar (ex: "Administrador Azit" -> "AA").
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || 'A';
}

// Menu por áreas de trabalho (proposta UX §3): cada grupo é uma área do sistema
// e só aparece se o usuário tem a área (matriz papel×área ± exceções — GET /me/areas).
type GrupoNav = { area: string | null; titulo: string; itens: NavItemDef[] };

const GRUPOS_NAV: GrupoNav[] = [
  { area: null, titulo: '', itens: [{ to: '/', label: 'Início' }] },
  {
    area: 'COMERCIAL',
    titulo: 'Comercial',
    itens: [
      { to: '/atendimento', label: 'Novo atendimento' },
      { to: '/simulacoes', label: 'Simulações' },
      { to: '/propostas', label: 'Propostas' },
    ],
  },
  {
    area: 'ANALISE_CADASTRO',
    titulo: 'Análise de cadastro',
    itens: [{ to: '/analises', label: 'Análises' }],
  },
  {
    area: 'CARTEIRA_COBRANCA',
    titulo: 'Carteira e cobrança',
    itens: [
      { to: '/carteira', label: 'Carteira' },
      { to: '/regua', label: 'Régua de cobrança' },
      { to: '/acordos', label: 'Renegociações' },
    ],
  },
  {
    area: 'FINANCEIRO_ADMINISTRATIVO',
    titulo: 'Financeiro administrativo',
    itens: [
      { to: '/contas-a-pagar', label: 'Contas a pagar' },
      { to: '/fornecedores-financeiro', label: 'Fornecedores' },
      { to: '/financeiro-configuracao', label: 'Configuração do financeiro' },
    ],
  },
  {
    area: 'PESSOAS',
    titulo: 'Pessoas',
    itens: [
      { to: '/titulares', label: 'Titulares' },
      { to: '/pessoas', label: 'Investidores, fornecedores e parceiros' },
    ],
  },
  {
    area: 'ATIVOS_FROTA',
    titulo: 'Ativos e frota',
    itens: [
      { to: '/ativos', label: 'Frota e estoque' },
      { to: '/frota/ocorrencias', label: 'Multas e pendências' },
      { to: '/centros-custo', label: 'Custo por ativo' },
    ],
  },
  {
    area: 'CAPITAL_INVESTIMENTO',
    titulo: 'Capital e investimento',
    itens: [{ to: '/estruturas', label: 'Estruturas jurídicas' }],
  },
  {
    area: 'PRODUTOS',
    titulo: 'Produtos',
    itens: [
      { to: '/catalogo', label: 'Catálogo de produtos' },
      { to: '/protecao', label: 'Proteção veicular (simulação)' },
      { to: '/produtos', label: 'Itens avulsos de contrato' },
    ],
  },
  {
    area: 'APROVACOES',
    titulo: 'Aprovações',
    itens: [{ to: '/aprovacoes', label: 'Aprovações' }],
  },
  {
    area: 'CONFIGURACOES',
    titulo: 'Configuração',
    itens: [
      { to: '/configuracoes/alcadas', label: 'Alçadas' },
      { to: '/configuracoes/assinatura', label: 'Assinatura digital' },
      { to: '/configuracoes/integracoes', label: 'Integrações' },
      { to: '/configuracoes/simulador', label: 'Simulador' },
      { to: '/configuracoes/usuarios', label: 'Usuários e permissões' },
    ],
  },
];

// Grupos recolhíveis (16/09): o estado fica no navegador do usuário — é uma
// conveniência de tela, não um dado do sistema.
const CHAVE_RECOLHIDOS = 'azit.menu.recolhidos';
function lerRecolhidos(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CHAVE_RECOLHIDOS) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function gravarRecolhidos(v: string[]) {
  try {
    localStorage.setItem(CHAVE_RECOLHIDOS, JSON.stringify(v));
  } catch {
    /* armazenamento indisponível — o menu segue funcionando sem lembrar */
  }
}

export function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [recolhidos, setRecolhidos] = useState<string[]>(lerRecolhidos);
  function alternar(area: string) {
    const novo = recolhidos.includes(area) ? recolhidos.filter((a) => a !== area) : [...recolhidos, area];
    setRecolhidos(novo);
    gravarRecolhidos(novo);
  }
  function definirTodos(recolher: boolean) {
    const novo = recolher ? GRUPOS_NAV.flatMap((g) => (g.area ? [g.area] : [])) : [];
    setRecolhidos(novo);
    gravarRecolhidos(novo);
  }
  // O grupo da tela aberta fica sempre visível — o operador nunca perde onde está.
  const ativa = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));
  const usuario = useAuthStore((s) => s.usuario);
  const limpar = useAuthStore((s) => s.limpar);
  // Badge de aprovações pendentes (atualiza a cada 60s).
  const contagem = useQuery({
    queryKey: ['aprovacoes-contagem'],
    queryFn: () => aprovacaoService.contagem(),
    refetchInterval: 60_000,
  });
  const pendentes = contagem.data ?? 0;
  // Áreas efetivas do usuário (matriz papel×área ± exceções). Enquanto carrega,
  // mostra só o Início — evita piscar itens que serão removidos.
  const areasQuery = useQuery({
    queryKey: ['me-areas'],
    queryFn: () => usuarioService.minhasAreas(),
    staleTime: 5 * 60_000,
  });
  const areas = areasQuery.data;
  const grupos = GRUPOS_NAV.filter(
    (g) => g.area === null || (areas ? areas.includes(g.area) : false),
  );

  async function onLogout() {
    await authService.logout();
    limpar();
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  return (
    <aside
      className="flex h-full w-[236px] flex-none flex-col"
      style={{ background: 'var(--navy)', color: '#fff' }}
    >
      <div className="flex items-center gap-[10px] px-[22px] pb-[18px] pt-[22px]">
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] font-display text-[17px] font-extrabold"
          style={{ background: 'var(--accent)', color: 'var(--navy)' }}
        >
          a
        </div>
        <span className="font-display text-[18px] font-bold tracking-[-0.01em]">
          azit<span style={{ color: 'var(--accent)' }}>move</span>
        </span>
      </div>

      <div
        className="mx-[16px] mb-[12px] mt-[6px] h-px"
        style={{ background: 'rgba(255,255,255,.08)' }}
      />

      <div className="mx-[20px] -mt-[4px] mb-[2px] flex justify-end gap-[10px] text-[10.5px]" style={{ color: 'var(--navy-text-muted)' }}>
        <button className="hover:underline" onClick={() => definirTodos(false)}>Expandir tudo</button>
        <button className="hover:underline" onClick={() => definirTodos(true)}>Recolher tudo</button>
      </div>

      <nav className="flex flex-col gap-[2px] overflow-y-auto px-[12px]">
        {grupos.map((grupo) => {
          const temAtiva = grupo.itens.some((i) => ativa(i.to));
          const aberto = !grupo.area || !recolhidos.includes(grupo.area) || temAtiva;
          return (
          <div key={grupo.area ?? 'inicio'} className="flex flex-col gap-[2px]">
            {grupo.titulo && grupo.area && (
              <button
                onClick={() => alternar(grupo.area as string)}
                aria-expanded={aberto}
                title={temAtiva ? 'Grupo da tela aberta' : aberto ? 'Recolher' : 'Expandir'}
                className="mx-[4px] mb-[4px] mt-[12px] flex items-center justify-between rounded-[6px] px-[4px] py-[3px] text-left text-[10px] uppercase tracking-[0.14em] hover:bg-[rgba(255,255,255,.05)]"
                style={{ color: 'var(--navy-text-muted)' }}
              >
                <span>{grupo.titulo}</span>
                <span className="text-[8px] transition-transform" style={{ transform: aberto ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
              </button>
            )}
            {aberto && grupo.itens.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className="flex items-center gap-[11px] rounded-[9px] px-[11px] py-[9px] text-[13px] transition-colors"
                style={({ isActive }) =>
                  isActive
                    ? { background: 'rgba(255,255,255,.08)', color: '#fff', fontWeight: 700 }
                    : { color: 'var(--navy-text)', fontWeight: 500 }
                }
              >
                <span className="flex-1">{item.label}</span>
                {item.to === '/aprovacoes' && pendentes > 0 && (
                  <span
                    className="rounded-full px-[7px] py-[1px] text-[10.5px] font-bold"
                    style={{ background: 'var(--accent)', color: 'var(--navy)' }}
                  >
                    {pendentes}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div
        className="flex items-center gap-[10px] px-[18px] py-[14px]"
        style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}
      >
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[12px] font-bold"
          style={{
            background: 'linear-gradient(135deg, #FA8E0D, #d97206)',
            color: 'var(--navy)',
          }}
        >
          {iniciais(usuario?.nome ?? 'Azit')}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[12.5px] font-semibold">
            {usuario?.nome ?? 'Operador Azit'}
          </div>
          <div className="truncate text-[11px]" style={{ color: 'var(--accent)' }}>
            {usuario?.roles?.join(' · ') ?? 'Console operacional'}
          </div>
        </div>
        <button
          onClick={onLogout}
          title="Sair"
          className="rounded-[8px] px-[8px] py-[6px] text-[11px] font-semibold transition-colors"
          style={{ color: 'var(--navy-text)', background: 'rgba(255,255,255,.06)' }}
        >
          Sair
        </button>
      </div>
    </aside>
  );
}
