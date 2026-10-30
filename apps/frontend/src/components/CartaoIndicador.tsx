import type { ReactNode } from 'react';

// Cartão de indicador GENÉRICO (doc 02 §27.5/27.6): rótulo, valor, detalhe e um
// tom de estado. Com `onClick` vira botão — "todo dado é link": o número que
// representa um conjunto abre o conjunto. `ativo` marca o cartão cuja lista
// está aberta.
export type TomIndicador = 'good' | 'bad' | 'warn' | 'neutro';

const FIO: Record<TomIndicador, string> = {
  good: 'var(--viz-good)',
  bad: 'var(--viz-bad)',
  warn: 'var(--viz-warn)',
  neutro: 'var(--text-muted)',
};

export function CartaoIndicador({
  rotulo,
  valor,
  detalhe,
  tom = 'neutro',
  onClick,
  ativo = false,
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  tom?: TomIndicador;
  onClick?: () => void;
  ativo?: boolean;
}) {
  const estilo = {
    background: 'var(--surface-muted)',
    boxShadow: `inset 3px 0 0 ${FIO[tom]}`,
    outline: ativo ? '1.5px solid var(--text-primary)' : 'none',
  } as const;
  const conteudo = (
    <>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-label)' }}>
        {rotulo}
      </div>
      <div className="mt-[2px] font-display text-[19px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {valor}
      </div>
      {detalhe ? <div className="mt-[2px] text-[11.5px]" style={{ color: 'var(--text-body)' }}>{detalhe}</div> : null}
    </>
  );
  if (!onClick) {
    return <div className="min-h-[70px] rounded-[12px] px-[14px] py-[12px] text-left" style={estilo}>{conteudo}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className="relative block min-h-[70px] w-full rounded-[12px] px-[14px] py-[12px] text-left transition-shadow hover:brightness-[1.04]"
      style={estilo}
    >
      {conteudo}
      <span className="absolute right-[12px] top-[10px] text-[13px]" style={{ color: 'var(--text-muted)' }} aria-hidden>
        →
      </span>
    </button>
  );
}
