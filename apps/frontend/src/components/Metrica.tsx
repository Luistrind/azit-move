import type { ReactNode } from 'react';
import { CartaoIndicador, type TomIndicador } from './CartaoIndicador';

// Métrica GENÉRICA (padronização E2, 07/09; layout v2 em 30/10 — doc 03 §11).
// Mesmo componente em todo o sistema, configurado por props:
//  'kpi'    — cartão de indicador do layout v2 (CartaoIndicador): fio de estado à
//             esquerda, rótulo em caixa-alta, valor em destaque; clicável se
//             receber onClick ("todo dado é link").
//  'claro'  — bloco compacto sobre superfície clara (fichas, modais).
//  'escuro' — texto sobre o entity header navy (detalhe do contrato).
type Tom = 'kpi' | 'claro' | 'escuro';

export function Metrica({
  label,
  valor,
  detalhe,
  tom = 'claro',
  destaque = false,
  alerta = false,
  onClick,
  ativo,
}: {
  label: string;
  valor: ReactNode;
  detalhe?: ReactNode; // linha pequena sob o valor (só tons kpi/claro)
  tom?: Tom;
  destaque?: boolean; // valor na cor de acento (só faz sentido no escuro)
  alerta?: boolean; // valor em vermelho (atraso/atenção)
  onClick?: () => void; // kpi clicável abre o conjunto que o número representa
  ativo?: boolean;
}) {
  if (tom === 'escuro') {
    return (
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--navy-text-meta)' }}>
          {label}
        </div>
        <div className="mt-[4px] font-display text-[16px] font-bold tabular-nums" style={{ color: destaque ? 'var(--accent)' : '#fff' }}>
          {valor}
        </div>
        {detalhe ? <div className="text-[11px]" style={{ color: 'var(--navy-text-muted)' }}>{detalhe}</div> : null}
      </div>
    );
  }
  if (tom === 'kpi') {
    const tomCartao: TomIndicador = alerta ? 'bad' : 'neutro';
    return (
      <div className="rounded-[12px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <CartaoIndicador rotulo={label} valor={valor} detalhe={detalhe} tom={tomCartao} onClick={onClick} ativo={ativo} />
      </div>
    );
  }
  return (
    <div className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-label)' }}>{label}</div>
      <div className="mt-[4px] font-display text-[17px] font-bold tabular-nums" style={{ color: alerta ? 'var(--danger-fg)' : 'var(--text-primary)' }}>
        {valor}
      </div>
      {detalhe ? <div className="mt-[2px] text-[11.5px]" style={{ color: 'var(--text-body)' }}>{detalhe}</div> : null}
    </div>
  );
}

// Par rótulo/valor de leitura (3 cópias por página viraram esta) — aceita valor
// pronto ou children para conteúdo composto.
export function Campo({ label, valor, children }: { label: string; valor?: string | null; children?: ReactNode }) {
  return (
    <div>
      <div className="text-[11px]" style={{ color: 'var(--text-label)' }}>{label}</div>
      <div className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{children ?? valor ?? '—'}</div>
    </div>
  );
}
