// Stepper genérico (Doc 3 §5 / §8-A.5). Configurado por props — não é específico
// de um caso de uso. Passos numerados, clicáveis até o máximo alcançável.
// Layout v2 (doc 03 §11): os passos QUEBRAM linha no celular (nada rola na
// horizontal); só tokens — '#fff' só como texto sobre navy/acento.
type Step = { key: string; label: string };

type StepperProps = {
  steps: Step[];
  current: number;
  maxReachable?: number; // índice máximo navegável (gate); default = todos
  onSelect: (index: number) => void;
};

export function Stepper({ steps, current, maxReachable, onSelect }: StepperProps) {
  const max = maxReachable ?? steps.length - 1;
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {steps.map((s, i) => {
        const ativo = i === current;
        const concluido = i < current;
        const navegavel = i <= max;
        const bg = ativo ? 'var(--accent)' : concluido ? 'var(--navy)' : 'var(--surface-input)';
        const fg = ativo || concluido ? '#fff' : 'var(--text-muted)';
        return (
          <div key={s.key} className="flex flex-none items-center gap-[6px]">
            <button
              type="button"
              onClick={() => navegavel && onSelect(i)}
              disabled={!navegavel}
              aria-current={ativo ? 'step' : undefined}
              className="flex min-h-[30px] items-center gap-[8px] rounded-[10px] px-[10px] py-[5px] text-[12px] font-semibold"
              style={{ background: ativo ? 'var(--surface-input)' : 'transparent', cursor: navegavel ? 'pointer' : 'default', opacity: navegavel ? 1 : 0.5 }}
            >
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full text-[11px]" style={{ background: bg, color: fg }}>
                {concluido ? '✓' : i + 1}
              </span>
              <span style={{ color: ativo ? 'var(--text-primary)' : 'var(--text-label)' }}>{s.label}</span>
            </button>
            {i < steps.length - 1 && <span aria-hidden style={{ color: 'var(--border)' }}>—</span>}
          </div>
        );
      })}
    </div>
  );
}
