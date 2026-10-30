import type { ReactNode } from 'react';

// Seção rotulada GENÉRICA (layout v2, doc 03 §11): rótulo em caixa-alta com o
// mesmo desenho do eyebrow do Bloco + ação opcional à direita + conteúdo.
// Usada dentro de fichas, dossiês e modais; para um cartão completo com
// leitura e link, use <Bloco>.
export function Secao({ titulo, acao, children, tag }: { titulo: string; acao?: ReactNode; tag?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-[8px] flex flex-wrap items-center gap-[8px]">
        <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>{titulo}</div>
        {tag ? <span className="text-[11px]" style={{ color: 'var(--text-label)' }}>{tag}</span> : null}
        {acao ? <div className="ml-auto">{acao}</div> : null}
      </div>
      {children}
    </div>
  );
}
