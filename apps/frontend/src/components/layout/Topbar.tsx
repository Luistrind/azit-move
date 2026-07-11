// Topbar 60px — Doc 3 §7.3. Título da página + sub à esquerda; busca/notif à direita.
// Mobile: botão hambúrguer abre a sidebar em gaveta.
type TopbarProps = {
  title: string;
  subtitle?: string;
  onMenu?: () => void;
};

export function Topbar({ title, subtitle, onMenu }: TopbarProps) {
  return (
    <header
      className="flex h-[60px] flex-none items-center gap-[12px] px-[14px] lg:gap-[18px] lg:px-[26px]"
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
    >
      <button
        onClick={onMenu}
        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] lg:hidden"
        style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
        aria-label="Abrir menu"
      >
        <span className="flex flex-col gap-[4px]">
          <span className="h-[2px] w-[16px] rounded" style={{ background: 'var(--navy)' }} />
          <span className="h-[2px] w-[16px] rounded" style={{ background: 'var(--navy)' }} />
          <span className="h-[2px] w-[16px] rounded" style={{ background: 'var(--navy)' }} />
        </span>
      </button>
      <div className="min-w-0 leading-tight">
        <div className="truncate font-display text-[15px] font-bold tracking-[-0.01em] lg:text-[16px]">
          {title}
        </div>
        {subtitle && (
          <div className="mt-px hidden truncate text-[11.5px] sm:block" style={{ color: 'var(--text-body)' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex-1" />
      <button
        className="relative h-[38px] w-[38px] flex-none rounded-[10px]"
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
