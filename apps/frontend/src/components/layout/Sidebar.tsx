import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { authService } from '../../services/auth.service';

// Sidebar 236px navy — Doc 3 §7.2. Logo (fallback bloco âmbar "a" até o SVG oficial),
// nav e footer de usuário. Os itens reais entram conforme as telas dos blocos seguintes.
type NavItemDef = { to: string; label: string };

// Iniciais do nome para o avatar (ex: "Administrador Azit" -> "AA").
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || 'A';
}

const NAV_ITEMS: NavItemDef[] = [
  { to: '/', label: 'Carteira' },
  { to: '/regua', label: 'Régua' },
  { to: '/acordos', label: 'Renegociações' },
];

export function Sidebar() {
  const navigate = useNavigate();
  const usuario = useAuthStore((s) => s.usuario);
  const limpar = useAuthStore((s) => s.limpar);

  async function onLogout() {
    await authService.logout();
    limpar();
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

      <nav className="flex flex-col gap-[2px] px-[12px]">
        <div
          className="mx-[8px] mb-[8px] mt-[10px] text-[10px] uppercase tracking-[0.14em]"
          style={{ color: 'var(--navy-text-muted)' }}
        >
          Operação
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className="flex items-center gap-[11px] rounded-[9px] px-[11px] py-[10px] text-[13px] transition-colors"
            style={({ isActive }) =>
              isActive
                ? { background: 'rgba(255,255,255,.08)', color: '#fff', fontWeight: 700 }
                : { color: 'var(--navy-text)', fontWeight: 500 }
            }
          >
            {item.label}
          </NavLink>
        ))}
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
          <div className="truncate text-[11px]" style={{ color: 'var(--navy-text-meta)' }}>
            {usuario?.email ?? 'Console operacional'}
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
