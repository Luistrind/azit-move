import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Bloco GENÉRICO do layout novo (doc 02 §27.6, 30/10): rótulo em caixa-alta +
// etiqueta opcional + conteúdo + "Leitura do Hub" (uma frase em linguagem
// natural sobre os números) + link "Explorar". Mesmo bloco em todo o sistema —
// configurado por props, nunca um por caso de uso.
export function Bloco({
  titulo,
  tag,
  acao,
  leitura,
  explorar,
  children,
  className = '',
  id,
}: {
  titulo: string;
  tag?: ReactNode;
  acao?: ReactNode; // controle à direita do rótulo (ex.: alternar gráfico/tabela)
  leitura?: ReactNode; // texto da Leitura do Hub (aceita <b>)
  explorar?: { rotulo: string; to?: string; href?: string };
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`flex min-w-0 flex-col gap-[10px] rounded-card p-[16px] pb-[12px] ${className}`}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between gap-[10px]">
        <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-label)' }}>
          {titulo}
        </div>
        {acao ?? (tag ? <div className="text-[11px]" style={{ color: 'var(--text-label)' }}>{tag}</div> : null)}
      </div>
      {children}
      {leitura ? <Leitura>{leitura}</Leitura> : null}
      {explorar ? (
        explorar.to ? (
          <Link to={explorar.to} className="inline-flex items-center gap-[6px] text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
            {explorar.rotulo} →
          </Link>
        ) : (
          <a href={explorar.href} target="_blank" rel="noopener" className="inline-flex items-center gap-[6px] text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
            {explorar.rotulo} →
          </a>
        )
      ) : null}
    </section>
  );
}

// Leitura do Hub: o sistema explica o número em uma frase. Vive no rodapé do
// bloco, separada por um fio; o avatar "H" identifica a voz do sistema.
export function Leitura({ children }: { children: ReactNode }) {
  return (
    <div className="mt-auto flex items-start gap-[10px] pt-[10px]" style={{ borderTop: '1px solid var(--border-light)' }}>
      <div
        className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full font-display text-[11px] font-bold"
        style={{ background: 'var(--accent)', color: 'var(--navy)' }}
        aria-label="Leitura do Hub"
      >
        H
      </div>
      <p className="m-0 text-[13px] leading-[1.45]" style={{ color: 'var(--text-primary)' }}>
        {children}
      </p>
    </div>
  );
}
