// Trilha de eventos GENÉRICA (21/10): lista cronológica "● título · por X em
// dd/mm hh:mm — detalhe", no padrão da trilha de decisões da Central de
// Aprovações. Configurada por props (eventos + formatação); quem chama decide a
// cor por evento, se quiser. Usada no detalhe de acordos e novações.
export interface EventoTrilhaProps {
  em: string | null;
  titulo: string;
  por?: string | null;
  detalhe?: string | null;
  cor?: string; // cor do marcador/título (default: navy)
}

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function Trilha({ eventos, vazio }: { eventos: EventoTrilhaProps[]; vazio?: string }) {
  if (eventos.length === 0) {
    return <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{vazio ?? 'Sem eventos registrados.'}</div>;
  }
  return (
    <div className="flex flex-col gap-[6px]">
      {eventos.map((e, i) => (
        <div key={i} className="text-[12px]" style={{ color: 'var(--text-body)' }}>
          <span className="font-semibold" style={{ color: e.cor ?? 'var(--navy)' }}>● {e.titulo}</span>
          {e.por ? <span> · {e.por}</span> : null}
          {e.em ? <span style={{ color: 'var(--text-muted)' }}> · {fmtDataHora(e.em)}</span> : null}
          {e.detalhe ? <div className="ml-[14px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{e.detalhe}</div> : null}
        </div>
      ))}
    </div>
  );
}
