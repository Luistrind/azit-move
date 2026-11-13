// Interruptor liga/desliga GENÉRICO (doc 03 §11): rótulo + descrição + chave.
// Configurado por props; nada de caso de uso dentro. Acessível (role="switch").
export function Interruptor({
  ligado,
  onChange,
  rotulo,
  descricao,
  desabilitado = false,
  carregando = false,
}: {
  ligado: boolean;
  onChange: (ligado: boolean) => void;
  rotulo: string;
  descricao?: string;
  desabilitado?: boolean;
  carregando?: boolean;
}) {
  const inativo = desabilitado || carregando;
  return (
    <label className={`flex items-start gap-[12px] ${inativo ? 'opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={rotulo}
        disabled={inativo}
        onClick={() => onChange(!ligado)}
        className="relative mt-[2px] h-[22px] w-[40px] shrink-0 rounded-full transition-colors"
        style={{ background: ligado ? 'var(--ok-fg)' : 'var(--border)' }}
      >
        <span
          className="absolute top-[3px] h-[16px] w-[16px] rounded-full transition-all"
          style={{ left: ligado ? 21 : 3, background: 'var(--surface)' }}
        />
      </button>
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{rotulo}</span>
        {descricao ? <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{descricao}</span> : null}
      </span>
    </label>
  );
}
