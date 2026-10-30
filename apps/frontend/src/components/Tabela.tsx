import type { ReactNode } from 'react';

// Tabela GENÉRICA e responsiva (layout v2, doc 03 §11 / doc 02 §27.6): no
// desktop é a grade de sempre; no celular (< md) cada linha vira um cartão —
// título, subtítulo, destaque à direita e os demais campos em duas colunas.
// A página só descreve as colunas; nunca escreve <table> nem cartão à mão.
export type AlinharColuna = 'left' | 'center' | 'right';
export type PapelCelular = 'titulo' | 'subtitulo' | 'destaque' | 'campo' | 'omitir';

export interface Coluna<T> {
  chave: string;
  titulo: string;
  render: (linha: T) => ReactNode;
  alinhar?: AlinharColuna;
  // Papel no cartão de celular. Padrão: a 1ª coluna é título, as demais campos.
  celular?: PapelCelular;
  // Classe extra da célula (ex.: 'tabular-nums', 'font-semibold').
  classe?: string;
}

export function Tabela<T>({
  colunas,
  linhas,
  chave,
  onClick,
  vazio = 'Nada por aqui.',
  carregando = false,
  larguraMinima = 620,
  acoes,
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  chave: (linha: T) => string;
  onClick?: (linha: T) => void;
  vazio?: ReactNode;
  carregando?: boolean;
  larguraMinima?: number;
  acoes?: (linha: T) => ReactNode; // botões da linha (desktop: última coluna; celular: rodapé)
}) {
  const alinhamento = (a?: AlinharColuna) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  const papel = (c: Coluna<T>, i: number): PapelCelular => c.celular ?? (i === 0 ? 'titulo' : 'campo');
  const titulo = colunas.find((c, i) => papel(c, i) === 'titulo');
  const subtitulo = colunas.find((c, i) => papel(c, i) === 'subtitulo');
  const destaque = colunas.find((c, i) => papel(c, i) === 'destaque');
  const campos = colunas.filter((c, i) => papel(c, i) === 'campo');
  const clicavel = !!onClick;

  const mensagem = (texto: ReactNode) => (
    <div className="px-[18px] py-[24px] text-center text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
      {texto}
    </div>
  );

  return (
    <>
      {/* Celular: cartões */}
      <div className="flex flex-col gap-[8px] md:hidden">
        {carregando ? mensagem('Carregando…') : null}
        {!carregando && linhas.length === 0 ? <div className="rounded-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>{mensagem(vazio)}</div> : null}
        {linhas.map((l) => {
          // Cartão clicável é <button> só quando não há botões de ação dentro
          // (botão dentro de botão é DOM inválido); com ações, vira <div role=button>.
          const comoBotao = clicavel && !acoes;
          const Tag = comoBotao ? 'button' : 'div';
          return (
            <Tag
              key={chave(l)}
              type={comoBotao ? 'button' : undefined}
              role={clicavel && !comoBotao ? 'button' : undefined}
              tabIndex={clicavel && !comoBotao ? 0 : undefined}
              onKeyDown={clicavel && !comoBotao ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!(l); } } : undefined}
              onClick={clicavel ? () => onClick!(l) : undefined}
              className={`w-full rounded-card p-[14px] text-left ${clicavel ? 'cursor-pointer' : ''}`}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start justify-between gap-[8px]">
                <div className="min-w-0">
                  {titulo ? <div className="break-words text-[13.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{titulo.render(l)}</div> : null}
                  {subtitulo ? <div className="text-[11.5px]" style={{ color: 'var(--text-body)' }}>{subtitulo.render(l)}</div> : null}
                </div>
                {destaque ? <div className="flex-none text-right font-display text-[13px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{destaque.render(l)}</div> : null}
              </div>
              {campos.length ? (
                <div className="mt-[8px] grid grid-cols-2 gap-x-[10px] gap-y-[6px] text-[12px]">
                  {campos.map((c) => (
                    <div key={c.chave} className="min-w-0">
                      <div className="text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--text-label)' }}>{c.titulo}</div>
                      <div className={`truncate ${c.classe ?? ''}`} style={{ color: 'var(--text-primary)' }}>{c.render(l)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {acoes ? <div className="mt-[10px] flex flex-wrap justify-end gap-[6px]" onClick={(e) => e.stopPropagation()}>{acoes(l)}</div> : null}
            </Tag>
          );
        })}
      </div>

      {/* Desktop: a grade */}
      <div className="hidden overflow-x-auto rounded-card md:block" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: larguraMinima }}>
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              {colunas.map((c) => (
                <th key={c.chave} className={`px-[18px] py-[12px] text-[10.5px] font-semibold uppercase tracking-[0.1em] ${alinhamento(c.alinhar)}`}>
                  {c.titulo}
                </th>
              ))}
              {acoes ? <th className="px-[18px] py-[12px]" /> : null}
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <tr><td colSpan={colunas.length + (acoes ? 1 : 0)}>{mensagem('Carregando…')}</td></tr>
            ) : null}
            {!carregando && linhas.length === 0 ? (
              <tr><td colSpan={colunas.length + (acoes ? 1 : 0)}>{mensagem(vazio)}</td></tr>
            ) : null}
            {linhas.map((l) => (
              <tr
                key={chave(l)}
                onClick={clicavel ? () => onClick!(l) : undefined}
                className={`${clicavel ? 'cursor-pointer hover:bg-[var(--surface-muted)]' : ''} transition-colors`}
                style={{ borderBottom: '1px solid var(--border-light)' }}
              >
                {colunas.map((c, i) => (
                  <td
                    key={c.chave}
                    className={`px-[18px] py-[13px] ${alinhamento(c.alinhar)} ${i === 0 ? 'font-semibold' : ''} ${c.classe ?? ''}`}
                    style={{ color: i === 0 ? 'var(--text-primary)' : 'var(--text-body)' }}
                  >
                    {c.render(l)}
                  </td>
                ))}
                {acoes ? <td className="px-[18px] py-[13px] text-right" onClick={(e) => e.stopPropagation()}>{acoes(l)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
