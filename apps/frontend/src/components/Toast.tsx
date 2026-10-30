import { create } from 'zustand';

// Feedback não-bloqueante (substitui window.alert) — Doc 3: componentes genéricos.
type TipoToast = 'sucesso' | 'erro' | 'info';
type ToastItem = { id: number; tipo: TipoToast; mensagem: string };

let seq = 0;

const useToastStore = create<{
  toasts: ToastItem[];
  push: (tipo: TipoToast, mensagem: string) => void;
  remove: (id: number) => void;
}>((set) => ({
  toasts: [],
  push: (tipo, mensagem) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, tipo, mensagem }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  sucesso: (m: string) => useToastStore.getState().push('sucesso', m),
  erro: (m: string) => useToastStore.getState().push('erro', m),
  info: (m: string) => useToastStore.getState().push('info', m),
};

const CORES: Record<TipoToast, { bg: string; fg: string; icone: string }> = {
  sucesso: { bg: 'var(--ok-bg)', fg: 'var(--ok-fg)', icone: '✓' },
  erro: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)', icone: '✕' },
  // Layout v2 (doc 03 §11): texto do "info" no token do estado (navy sumia no tema escuro).
  info: { bg: 'var(--info-bg)', fg: 'var(--info-fg)', icone: 'ℹ' },
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-[12px] right-[12px] z-[100] flex w-[340px] max-w-[calc(100vw-24px)] flex-col gap-[8px] sm:bottom-[20px] sm:right-[20px]">
      {toasts.map((t) => {
        const c = CORES[t.tipo];
        return (
          <div
            key={t.id}
            onClick={() => remove(t.id)}
            className="flex cursor-pointer items-start gap-[10px] rounded-[12px] px-[14px] py-[12px] text-[13px] font-semibold"
            role="status"
            style={{ background: c.bg, color: c.fg, border: '1px solid var(--border)', boxShadow: '0 10px 30px rgba(0,16,41,.18)' }}
          >
            <span className="mt-[1px] text-[14px] leading-none">{c.icone}</span>
            <span className="flex-1 whitespace-pre-line">{t.mensagem}</span>
          </div>
        );
      })}
    </div>
  );
}
