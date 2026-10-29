// Card de métrica GENÉRICO (padronização E2, 07/09 — regra do projeto: componente
// por props, não por caso de uso). Substitui as 5 variantes locais (Metrica ×3 e
// Kpi ×2 espalhadas por página).
//
// tom:
//  'kpi'      — cartão branco grande (painéis: Carteira, Centro de custo)
//  'claro'    — bloco compacto sobre superfície clara (fichas, modais)
//  'escuro'   — texto sobre o entity header navy (detalhe do contrato)
type Tom = 'kpi' | 'claro' | 'escuro';

export function Metrica({
  label,
  valor,
  tom = 'claro',
  destaque = false,
  alerta = false,
  detalhe,
}: {
  label: string;
  valor: React.ReactNode;
  tom?: Tom;
  destaque?: boolean; // valor na cor de acento (só faz sentido no escuro)
  alerta?: boolean; // valor em vermelho (atraso/atenção)
  // Linha(s) secundária(s) abaixo do valor — abertura do número ("+ 4 reembolsos",
  // "veículo · acordos · reembolsos"). Genérico: quem usa decide o conteúdo.
  detalhe?: React.ReactNode;
}) {
  const linhaDetalhe = detalhe ? (
    <div className="mt-[6px] text-[11.5px] leading-[1.45] tabular-nums" style={{ color: 'var(--text-muted)' }}>
      {detalhe}
    </div>
  ) : null;
  if (tom === 'escuro') {
    return (
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--navy-text-meta)' }}>
          {label}
        </div>
        <div className="mt-[4px] font-display text-[16px] font-bold" style={{ color: destaque ? 'var(--accent)' : '#fff' }}>
          {valor}
        </div>
        {detalhe ? (
          <div className="mt-[4px] text-[11px] leading-[1.45] tabular-nums" style={{ color: 'var(--navy-text-meta)' }}>
            {detalhe}
          </div>
        ) : null}
      </div>
    );
  }
  if (tom === 'kpi') {
    return (
      <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-label)' }}>
          {label}
        </div>
        <div className="mt-[6px] font-display text-[22px] font-bold tabular-nums" style={{ color: alerta ? '#e0413c' : 'var(--text-primary)' }}>
          {valor}
        </div>
        {linhaDetalhe}
      </div>
    );
  }
  return (
    <div className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-label)' }}>{label}</div>
      <div className="mt-[4px] font-display text-[17px] font-bold tabular-nums" style={{ color: alerta ? '#e0413c' : 'var(--text-primary)' }}>
        {valor}
      </div>
      {linhaDetalhe}
    </div>
  );
}

// Par rótulo/valor de leitura (3 cópias por página viraram esta) — aceita valor
// pronto ou children para conteúdo composto.
export function Campo({ label, valor, children }: { label: string; valor?: string | null; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px]" style={{ color: 'var(--text-label)' }}>{label}</div>
      <div className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{children ?? valor ?? '—'}</div>
    </div>
  );
}
