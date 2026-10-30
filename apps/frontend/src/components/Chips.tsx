import type { ReactNode } from 'react';

// Chips de filtro GENÉRICOS (layout v2, doc 03 §11): pílulas, uma ativa (ou
// nenhuma = "Todas"). Substituem <select> de status e botões de aba soltos nas
// listas. `contagem` opcional mostra quantos itens cada filtro tem.
export interface ChipItem {
  chave: string;
  rotulo: ReactNode;
  contagem?: number;
}

export function Chips({
  itens,
  valor,
  onChange,
  todos = 'Todas',
  tamanho = 'md',
}: {
  itens: ChipItem[];
  valor: string | null;
  onChange: (chave: string | null) => void;
  todos?: ReactNode | null; // rótulo do chip "sem filtro"; null para não mostrar
  tamanho?: 'sm' | 'md';
}) {
  const base = tamanho === 'sm' ? 'min-h-[28px] px-[10px] text-[11.5px]' : 'min-h-[30px] px-[11px] text-[12px]';
  const chip = (on: boolean) =>
    on
      ? { background: 'var(--text-primary)', color: 'var(--surface)', borderColor: 'var(--text-primary)', fontWeight: 600 }
      : { color: 'var(--text-body)', borderColor: 'var(--border)' };
  const lista: { chave: string | null; rotulo: ReactNode; contagem?: number }[] = [
    ...(todos !== null ? [{ chave: null, rotulo: todos }] : []),
    ...itens,
  ];
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {lista.map((it) => {
        const on = (valor ?? null) === it.chave;
        return (
          <button
            key={it.chave ?? '__todos'}
            type="button"
            onClick={() => onChange(it.chave)}
            aria-pressed={on}
            className={`inline-flex items-center gap-[6px] rounded-full border transition-colors ${base}`}
            style={chip(on)}
          >
            {it.rotulo}
            {it.contagem !== undefined ? (
              <span className="rounded-full px-[6px] text-[10.5px] font-semibold" style={on ? { background: 'rgba(255,255,255,.18)' } : { background: 'var(--surface-muted)', color: 'var(--text-body)' }}>
                {it.contagem}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
