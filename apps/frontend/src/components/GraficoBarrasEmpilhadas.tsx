import { useId, useRef, useState, type ReactNode } from 'react';

// Gráfico de barras empilhadas GENÉRICO (SVG, sem biblioteca). Uma barra por
// categoria, segmentos por série na ordem dada; hover abre tooltip (render
// prop), clique seleciona; alterna para tabela (acessibilidade e conferência).
// Marcas: 2px de respiro entre segmentos, topo arredondado, eixo discreto.
export interface SerieEmpilhada {
  chave: string;
  rotulo: string;
  cor: string;
}
export interface CategoriaEmpilhada {
  chave: string;
  rotulo: string; // eixo
  rotuloLinha2?: string; // ex.: ano na virada
  valores: Record<string, number>; // por chave de série
  tracejado?: boolean; // ex.: futuro/contratado — último segmento hachurado
  destaque?: boolean; // ex.: mês selecionado
}

export function GraficoBarrasEmpilhadas({
  categorias,
  series,
  formatarEixo,
  tooltip,
  onSelecionar,
  tabela,
  rotuloAcessivel,
}: {
  categorias: CategoriaEmpilhada[];
  series: SerieEmpilhada[];
  formatarEixo: (v: number) => string;
  tooltip?: (c: CategoriaEmpilhada) => ReactNode;
  onSelecionar?: (c: CategoriaEmpilhada) => void;
  tabela?: ReactNode; // alternativa em tabela (já pronta)
  rotuloAcessivel: string;
}) {
  const [modo, setModo] = useState<'grafico' | 'tabela'>('grafico');
  const [hover, setHover] = useState<{ c: CategoriaEmpilhada; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const hatchId = useId().replace(/:/g, '');

  const W = 1000, H = 300, L = 56, R = 10, T = 18, B = 34;
  const iw = W - L - R, ih = H - T - B;
  const n = Math.max(1, categorias.length), gap = 8, bw = (iw - gap * (n - 1)) / n;
  const total = (c: CategoriaEmpilhada) => series.reduce((s, se) => s + (c.valores[se.chave] ?? 0), 0);
  const max = Math.max(1, ...categorias.map(total)) * 1.06;
  const y = (v: number) => T + ih - (ih * v) / max;

  const mover = (c: CategoriaEmpilhada, e: React.MouseEvent | React.TouchEvent) => {
    const bx = wrap.current?.getBoundingClientRect();
    if (!bx) return;
    const p = 'touches' in e ? e.touches[0] : e;
    let x = p.clientX - bx.left + 14;
    const yy = p.clientY - bx.top + 14;
    if (x + 240 > bx.width) x = Math.max(0, p.clientX - bx.left - 250);
    setHover({ c, x, y: yy });
  };

  return (
    <div className="flex flex-col gap-[8px]">
      {tabela ? (
        <div className="flex justify-end">
          <span className="inline-flex overflow-hidden rounded-full border" style={{ borderColor: 'var(--border)' }}>
            {(['grafico', 'tabela'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModo(m)}
                className="px-[10px] py-[4px] text-[11.5px]"
                style={modo === m ? { background: 'var(--text-primary)', color: 'var(--surface)' } : { color: 'var(--text-body)' }}
              >
                {m === 'grafico' ? 'gráfico' : 'tabela'}
              </button>
            ))}
          </span>
        </div>
      ) : null}
      {modo === 'tabela' ? (
        <div className="overflow-auto">{tabela}</div>
      ) : (
        <div ref={wrap} className="relative w-full">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rotuloAcessivel} className="block h-auto w-full overflow-visible">
            <defs>
              <pattern id={hatchId} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--surface)" />
                <rect width="2.5" height="6" fill={series[series.length - 1]?.cor ?? 'currentColor'} />
              </pattern>
            </defs>
            {[0, 1, 2, 3, 4].map((i) => {
              const v = (max * i) / 4;
              return (
                <g key={i}>
                  <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border-light)" />
                  <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--text-muted)">
                    {v ? formatarEixo(v) : '0'}
                  </text>
                </g>
              );
            })}
            {categorias.map((c, i) => {
              const x = L + i * (bw + gap);
              let cum = 0;
              const tot = total(c);
              return (
                <g key={c.chave}>
                  {series.map((se, j) => {
                    const v = c.valores[se.chave] ?? 0;
                    if (v <= 0) return null;
                    const y1 = y(cum + v), y0 = y(cum);
                    const h = Math.max(0, y0 - y1 - (j < series.length - 1 ? 2 : 0));
                    const topo = cum + v >= tot - 1;
                    const fill = c.tracejado && j === series.length - 1 ? `url(#${hatchId})` : se.cor;
                    cum += v;
                    return <rect key={se.chave} x={x} y={y1} width={bw} height={h} fill={fill} rx={topo ? 4 : 0} ry={topo ? 4 : 0} />;
                  })}
                  {c.destaque ? (
                    <rect x={x - 3} y={T - 6} width={bw + 6} height={ih + 10} fill="none" stroke="var(--text-primary)" strokeDasharray="3 3" rx={6} />
                  ) : null}
                  <text x={x + bw / 2} y={H - 12} textAnchor="middle" fontSize="10.5" fill="var(--text-muted)">
                    {c.rotulo}
                    {c.rotuloLinha2 ? (
                      <tspan x={x + bw / 2} dy="11">{c.rotuloLinha2}</tspan>
                    ) : null}
                  </text>
                  <rect
                    x={x - gap / 2}
                    y={T}
                    width={bw + gap}
                    height={ih}
                    fill="transparent"
                    style={{ cursor: onSelecionar ? 'pointer' : 'default' }}
                    onMouseMove={(e) => mover(c, e)}
                    onTouchStart={(e) => mover(c, e)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onSelecionar?.(c)}
                  />
                </g>
              );
            })}
          </svg>
          {hover && tooltip ? (
            <div
              className="pointer-events-none absolute z-10 min-w-[200px] rounded-[10px] px-[10px] py-[8px] text-[12px] shadow-lg"
              style={{ left: hover.x, top: hover.y, background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            >
              {tooltip(hover.c)}
            </div>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap gap-[12px] text-[11.5px]" style={{ color: 'var(--text-body)' }}>
        {series.map((se) => (
          <span key={se.chave} className="inline-flex items-center gap-[6px]">
            <i className="inline-block h-[8px] w-[8px] rounded-[2px]" style={{ background: se.cor }} />
            {se.rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}
