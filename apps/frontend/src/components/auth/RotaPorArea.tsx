import { Outlet, useMatches } from 'react-router-dom';
import { AreaRota, temAlgumaArea, useMinhasAreas } from '../../lib/permissoes';
import { SemAcessoArea } from './SemAcessoArea';

// Guarda de rota por ÁREA de trabalho (doc 06 §5.4 item 3). Cada rota declara
// `handle: { area }` no router; esta camada (rota de layout, dentro do Shell) lê a
// área da rota mais específica e:
//  - sem área declarada → renderiza normal (Início, Minha conta, apoio);
//  - áreas ainda carregando → estado de carregamento, sem piscar a tela;
//  - sem acesso → página "Sem acesso a esta área" com a área dona (a primeira).
// Mesma query do menu lateral (GET /me/areas) — nada é duplicado.
type HandleArea = { area?: AreaRota };

export function RotaPorArea() {
  const matches = useMatches();
  const { areas, carregando, erro } = useMinhasAreas();
  const area = [...matches].reverse().find((m) => (m.handle as HandleArea | undefined)?.area)?.handle as HandleArea | undefined;

  if (!area?.area) return <Outlet />;
  if (carregando) {
    return (
      <div className="p-[24px] text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
    );
  }
  // Falha ao carregar as áreas (rede, 401 em renovação): não bloqueia a tela — a
  // API nega o que não pode e o interceptor mostra a mensagem.
  if (erro || temAlgumaArea(areas, area.area)) return <Outlet />;
  return <SemAcessoArea area={Array.isArray(area.area) ? area.area[0] : area.area} />;
}
