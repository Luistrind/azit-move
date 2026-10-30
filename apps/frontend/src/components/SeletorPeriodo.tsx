import { diaSemanaISO, mesAnterior, mesSeguinte, periodoDoMes, somarDiasISO, type Periodo } from '@azit/utils';

// Seletor de período GENÉRICO (doc 02 §27.4): navegador de mês ‹ › + modos
// (mês, semana, 7 dias, de–até). Controlado: o pai guarda `PeriodoSelecionado`
// e lê o intervalo com `intervaloDoPeriodo`. Mobile first: tudo quebra linha.
export type ModoPeriodo = 'mes' | 'semana' | '7d' | 'custom';
export interface PeriodoSelecionado {
  modo: ModoPeriodo;
  anoMes: string; // YYYY-MM — mês de referência (modo 'mes') ou do início do período
  de?: string; // custom
  ate?: string; // custom
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MODOS: { modo: ModoPeriodo; rotulo: string }[] = [
  { modo: 'mes', rotulo: 'Mês' },
  { modo: 'semana', rotulo: 'Semana' },
  { modo: '7d', rotulo: '7 dias' },
  { modo: 'custom', rotulo: 'De – até' },
];

// Semana de segunda a domingo que contém `hoje`.
function semanaDe(hoje: string): Periodo {
  const dow = (diaSemanaISO(hoje) + 6) % 7;
  const de = somarDiasISO(hoje, -dow);
  return { de, ate: somarDiasISO(de, 6) };
}

export function intervaloDoPeriodo(sel: PeriodoSelecionado, hoje: string): Periodo {
  if (sel.modo === 'mes') return periodoDoMes(sel.anoMes);
  if (sel.modo === 'semana') return semanaDe(hoje);
  if (sel.modo === '7d') return { de: somarDiasISO(hoje, -6), ate: hoje };
  const de = sel.de ?? somarDiasISO(hoje, -13);
  const ate = sel.ate ?? hoje;
  return de <= ate ? { de, ate } : { de: ate, ate: de };
}

export function rotuloDoPeriodo(sel: PeriodoSelecionado, hoje: string): string {
  if (sel.modo === 'mes') {
    const [a, m] = sel.anoMes.split('-').map(Number);
    return `${MESES[m - 1]} ${a}`;
  }
  const { de, ate } = intervaloDoPeriodo(sel, hoje);
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return `${br(de)} a ${br(ate)}`;
}

export function SeletorPeriodo({
  valor,
  onChange,
  hoje,
  mesMin,
  mesMax,
}: {
  valor: PeriodoSelecionado;
  onChange: (v: PeriodoSelecionado) => void;
  hoje: string;
  mesMin?: string; // YYYY-MM
  mesMax?: string;
}) {
  const chip = 'min-h-[32px] rounded-full border px-[12px] text-[12.5px] transition-colors';
  const navegar = (dir: -1 | 1) => {
    const alvo = dir < 0 ? mesAnterior(valor.anoMes) : mesSeguinte(valor.anoMes);
    if (mesMin && alvo < mesMin) return;
    if (mesMax && alvo > mesMax) return;
    onChange({ modo: 'mes', anoMes: alvo });
  };
  const mudarModo = (modo: ModoPeriodo) => {
    if (modo === 'mes') return onChange({ modo, anoMes: valor.anoMes });
    const base = intervaloDoPeriodo({ ...valor, modo }, hoje);
    onChange({ modo, anoMes: base.de.slice(0, 7), de: valor.de ?? base.de, ate: valor.ate ?? base.ate });
  };
  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      <div className="inline-flex items-center gap-[2px] rounded-full border px-[4px] py-[2px]" style={{ borderColor: 'var(--border)' }}>
        <button type="button" onClick={() => navegar(-1)} aria-label="Mês anterior" className="grid h-[30px] w-[30px] place-items-center rounded-full text-[17px]" style={{ color: 'var(--text-body)' }}>
          ‹
        </button>
        <span className="min-w-[132px] text-center font-display text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-primary)' }}>
          {rotuloDoPeriodo(valor, hoje)}
        </span>
        <button type="button" onClick={() => navegar(1)} aria-label="Mês seguinte" className="grid h-[30px] w-[30px] place-items-center rounded-full text-[17px]" style={{ color: 'var(--text-body)' }}>
          ›
        </button>
      </div>
      <div className="flex flex-wrap gap-[6px]">
        {MODOS.map((m) => {
          const on = valor.modo === m.modo;
          return (
            <button
              key={m.modo}
              type="button"
              onClick={() => mudarModo(m.modo)}
              className={chip}
              style={on
                ? { background: 'var(--text-primary)', color: 'var(--surface)', borderColor: 'var(--text-primary)', fontWeight: 600 }
                : { background: 'transparent', color: 'var(--text-body)', borderColor: 'var(--border)' }}
            >
              {m.rotulo}
            </button>
          );
        })}
      </div>
      {valor.modo === 'custom' && (
        <div className="flex flex-wrap items-center gap-[6px] text-[12px]" style={{ color: 'var(--text-body)' }}>
          <input
            type="date"
            aria-label="de"
            value={valor.de ?? ''}
            onChange={(e) => onChange({ ...valor, de: e.target.value || valor.de })}
            className="rounded-[8px] border px-[8px] py-[5px] text-[12.5px]"
            style={{ background: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
          />
          <span>até</span>
          <input
            type="date"
            aria-label="até"
            value={valor.ate ?? ''}
            onChange={(e) => onChange({ ...valor, ate: e.target.value || valor.ate })}
            className="rounded-[8px] border px-[8px] py-[5px] text-[12.5px]"
            style={{ background: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
          />
        </div>
      )}
    </div>
  );
}
