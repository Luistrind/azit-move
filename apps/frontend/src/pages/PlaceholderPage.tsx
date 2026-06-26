// Placeholder de tela — Bloco 0.9. As telas reais entram após os endpoints que
// as alimentam (Doc 7: "frontend acompanha o backend, não o precede").
type PlaceholderPageProps = {
  titulo: string;
  descricao: string;
};

export function PlaceholderPage({ titulo, descricao }: PlaceholderPageProps) {
  return (
    <div
      className="rounded-card p-[40px]"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <h2 className="font-display text-[15px] font-bold">{titulo}</h2>
      <p className="mt-[8px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
        {descricao}
      </p>
      <p className="mt-[16px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
        Tela a ser construída no bloco correspondente do backlog.
      </p>
    </div>
  );
}
