import { useEffect } from 'react';

// Modal genérico (Doc 3 §5.8). Overlay + card; fecha SÓ no × e no Esc — clique
// fora NÃO fecha (reclamação dos usuários 14/10: perdiam o que estavam preenchendo).
// O corpo ROLA quando o conteúdo passa de ~88% da tela — o card nunca estoura
// a viewport (correção 14/09: a memória de cálculo da novação, com centenas de
// linhas, empurrava a página inteira). `largura` opcional para modais densos.
// Layout v2 (doc 03 §11): no celular o card ocupa a tela menos 12 px de cada
// lado (calc(100vw - 24px)) e o conteúdo rola dentro dele; só tokens.
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
      className="fixed inset-0 z-50 flex items-center justify-center p-[12px] sm:p-[20px]"
      style={{ background: 'rgba(0,16,41,.45)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-full max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[16px]"
        style={{ width: largura ?? 460, maxHeight: '88vh', background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 30px 80px rgba(0,16,41,.4)' }}
      >
        <div className="flex shrink-0 items-center justify-between gap-[10px] px-[18px] py-[12px]" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="min-w-0 truncate font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-[18px] leading-none hover:bg-[var(--surface-input)]"
            style={{ color: 'var(--text-muted)' }}
          >
            ×
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-[14px] sm:p-[18px]">{children}</div>
      </div>
    </div>
  );
}
