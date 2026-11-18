import type { ReactNode } from 'react';

// Abas GENÉRICAS (doc 03 §11): troca o conteúdo de um mesmo cartão. Uma ativa,
// sublinhada pela cor de acento; `contagem` opcional ao lado do rótulo. Rola
// na horizontal no celular em vez de quebrar linha.
export interface AbaItem {
  chave: string;
  rotulo: ReactNode;
  contagem?: number;
}

export function Abas({ itens, valor, onChange }: { itens: AbaItem[]; valor: string; onChange: (chave: string) => void }) {
  return (
    <div role="tablist" className="flex gap-[2px] overflow-x-auto px-[10px]" style={{ borderBottom: '1px solid var(--border)' }}>
      {itens.map((it) => {
        const on = it.chave === valor;
        return (
          <button
            key={it.chave}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.chave)}
            className="-mb-px inline-flex flex-none items-center gap-[6px] whitespace-nowrap px-[12px] pb-[11px] pt-[13px] text-[12.5px] font-semibold transition-colors"
            style={{ color: on ? 'var(--text-primary)' : 'var(--text-muted)', borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}` }}
          >
            {it.rotulo}
            {it.contagem !== undefined ? (
              <span className="text-[11.5px] font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {it.contagem}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
