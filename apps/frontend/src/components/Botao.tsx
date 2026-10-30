import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Botão GENÉRICO (layout v2, doc 03 §11). Quatro variantes, dois tamanhos, só
// tokens — funciona nos dois temas. Substitui os <button> com estilo inline
// repetido por página.
export type VarianteBotao = 'primaria' | 'secundaria' | 'perigo' | 'fantasma';

const ESTILO: Record<VarianteBotao, React.CSSProperties> = {
  primaria: { background: 'var(--accent)', color: 'var(--navy)', border: '1px solid transparent' },
  secundaria: { background: 'var(--surface-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' },
  perigo: { background: 'var(--danger-bg)', color: 'var(--danger-fg)', border: '1px solid transparent' },
  fantasma: { background: 'transparent', color: 'var(--accent)', border: '1px solid transparent' },
};

export function Botao({
  variante = 'secundaria',
  tamanho = 'md',
  carregando = false,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBotao;
  tamanho?: 'sm' | 'md';
  carregando?: boolean;
  children: ReactNode;
}) {
  const dim = tamanho === 'sm' ? 'h-[30px] px-[11px] text-[12px]' : 'h-[36px] px-[14px] text-[12.5px]';
  return (
    <button
      type="button"
      disabled={disabled || carregando}
      className={`inline-flex items-center justify-center gap-[6px] whitespace-nowrap rounded-[10px] font-semibold transition-[filter,opacity] hover:brightness-[1.05] disabled:cursor-not-allowed disabled:opacity-50 ${dim} ${className}`}
      style={ESTILO[variante]}
      {...rest}
    >
      {carregando ? '…' : children}
    </button>
  );
}
