import { useEffect } from 'react';

// Modal genérico (Doc 3 §5.8). Overlay + card; fecha no backdrop e no Esc.
// O corpo ROLA quando o conteúdo passa de ~88% da tela — o card nunca estoura
// a viewport (correção 14/09: a memória de cálculo da novação, com centenas de
// linhas, empurrava a página inteira). `largura` opcional para modais densos.
type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  largura?: number; // px — default 460
};

export function Modal({ open, onClose, title, children, largura }: ModalProps) {
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
        className="flex w-full flex-col overflow-hidden rounded-[18px]"
        style={{ maxWidth: largura ?? 460, maxHeight: '88vh', background: 'var(--surface)', boxShadow: '0 30px 80px rgba(0,16,41,.4)' }}
      >
        <div className="flex shrink-0 items-center justify-between px-[18px] py-[14px]" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="font-display text-[14px] font-bold">{title}</span>
          <button onClick={onClose} className="text-[18px] leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
        <div className="overflow-y-auto p-[18px]">{children}</div>
      </div>
    </div>
  );
}
