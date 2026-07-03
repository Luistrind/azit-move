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
  sucesso: { bg: '#e8f7ef', fg: '#1f9d5b', icone: '✓' },
  erro: { bg: '#fdeceb', fg: '#c0392b', icone: '✕' },
  info: { bg: '#eaf1fb', fg: 'var(--navy)', icone: 'ℹ' },
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-[20px] right-[20px] z-[100] flex w-[340px] flex-col gap-[8px]">
      {toasts.map((t) => {
        const c = CORES[t.tipo];
        return (
          <div
            key={t.id}
            onClick={() => remove(t.id)}
            className="flex cursor-pointer items-start gap-[10px] rounded-[12px] px-[14px] py-[12px] text-[13px] font-semibold"
            style={{ background: c.bg, color: c.fg, boxShadow: '0 10px 30px rgba(0,16,41,.18)' }}
          >
            <span className="mt-[1px] text-[14px] leading-none">{c.icone}</span>
            <span className="flex-1">{t.mensagem}</span>
          </div>
        );
      })}
    </div>
  );
}
