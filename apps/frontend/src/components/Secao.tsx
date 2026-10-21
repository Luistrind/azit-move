// Seção rotulada GENÉRICA (título em caixa-alta discreta + conteúdo) — usada nos
// detalhes de acordo/novação (Renegociações) e no dossiê da Central de Aprovações.
export function Secao({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-[6px] flex flex-wrap items-center gap-[8px]">
        <div className="text-[11px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-label)' }}>{titulo}</div>
        {acao ? <div className="ml-auto">{acao}</div> : null}
      </div>
      {children}
    </div>
  );
}
