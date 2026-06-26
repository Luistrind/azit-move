import type { StatusColor } from '../config/statusColors';

// Badge de status genérico (Regra 9: cor nunca hardcoded — vem de statusColors).
// Configurado por props: o mapa de cores é passado pelo chamador.
type StatusBadgeProps = {
  label: string;
  colors: Record<string, StatusColor>;
};

export function StatusBadge({ label, colors }: StatusBadgeProps) {
  const c = colors[label] ?? { bg: 'var(--surface-input)', fg: 'var(--text-muted)' };
  return (
    <span
      className="inline-flex items-center rounded-[6px] px-[8px] py-[3px] text-[11px] font-semibold"
      style={{ background: c.bg, color: c.fg }}
    >
      {label}
    </span>
  );
}
