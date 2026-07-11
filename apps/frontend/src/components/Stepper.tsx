// Stepper genérico (Doc 3 §5 / §8-A.5). Configurado por props — não é específico
// de um caso de uso. Passos numerados, clicáveis até o máximo alcançável.
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
    <div className="flex items-center gap-[6px] overflow-x-auto">
      {steps.map((s, i) => {
        const ativo = i === current;
        const concluido = i < current;
        const navegavel = i <= max;
        const bg = ativo ? 'var(--accent)' : concluido ? 'var(--navy)' : 'var(--surface-input)';
        const fg = ativo || concluido ? '#fff' : 'var(--text-muted)';
        return (
          <div key={s.key} className="flex flex-none items-center gap-[6px]">
            <button
              onClick={() => navegavel && onSelect(i)}
              disabled={!navegavel}
              className="flex items-center gap-[8px] rounded-[8px] px-[10px] py-[6px] text-[12px] font-semibold"
              style={{ background: ativo ? 'var(--surface-input)' : 'transparent', cursor: navegavel ? 'pointer' : 'default', opacity: navegavel ? 1 : 0.5 }}
            >
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full text-[11px]" style={{ background: bg, color: fg }}>
                {concluido ? '✓' : i + 1}
              </span>
              <span style={{ color: ativo ? 'var(--text-primary)' : 'var(--text-label)' }}>{s.label}</span>
            </button>
            {i < steps.length - 1 && <span style={{ color: 'var(--border)' }}>—</span>}
          </div>
        );
      })}
    </div>
  );
}
