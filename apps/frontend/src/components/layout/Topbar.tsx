// Topbar 60px — Doc 3 §7.3. Título da página + sub à esquerda; busca/notif à direita.
type TopbarProps = {
  title: string;
  subtitle?: string;
};

export function Topbar({ title, subtitle }: TopbarProps) {
  return (
    <header
      className="flex h-[60px] flex-none items-center gap-[18px] px-[26px]"
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
    >
      <div className="leading-tight">
        <div className="font-display text-[16px] font-bold tracking-[-0.01em]">
          {title}
        </div>
        {subtitle && (
          <div className="mt-px text-[11.5px]" style={{ color: 'var(--text-body)' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex-1" />
      <button
        className="relative h-[38px] w-[38px] rounded-[10px]"
        style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
        aria-label="Notificações"
      >
        <span
          className="absolute right-[8px] top-[7px] h-[7px] w-[7px] rounded-full"
          style={{ background: '#e0413c', border: '1.5px solid #fff' }}
        />
      </button>
    </header>
  );
}
