import { NavLink } from 'react-router-dom';

// Sidebar 236px navy — Doc 3 §7.2. Logo (fallback bloco âmbar "a" até o SVG oficial),
// nav e footer de usuário. Os itens reais entram conforme as telas dos blocos seguintes.
type NavItemDef = { to: string; label: string };

const NAV_ITEMS: NavItemDef[] = [
  { to: '/', label: 'Carteira' },
  { to: '/regua', label: 'Régua' },
  { to: '/acordos', label: 'Renegociações' },
];

export function Sidebar() {
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
          A
        </div>
        <div className="leading-tight">
          <div className="text-[12.5px] font-semibold">Operador Azit</div>
          <div className="text-[11px]" style={{ color: 'var(--navy-text-meta)' }}>
            Console operacional
          </div>
        </div>
      </div>
    </aside>
  );
}
