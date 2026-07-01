import { useEffect } from 'react';

// Modal genérico (Doc 3 §5.8). Overlay + card; fecha no backdrop e no Esc.
type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

export function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-[20px]"
      style={{ background: 'rgba(0,16,41,.45)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] max-w-full overflow-hidden rounded-[18px]"
        style={{ background: 'var(--surface)', boxShadow: '0 30px 80px rgba(0,16,41,.4)' }}
      >
        <div className="flex items-center justify-between px-[18px] py-[14px]" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="font-display text-[14px] font-bold">{title}</span>
          <button onClick={onClose} className="text-[18px] leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
        <div className="p-[18px]">{children}</div>
      </div>
    </div>
  );
}
