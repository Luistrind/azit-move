import { useEffect, useRef, useState } from 'react';

// Gráfico de tempo GENÉRICO (SVG, sem biblioteca; doc 02 §27.11): barras finas
// empilhadas por ponto, UMA linha suave pelo topo das barras (que se desenha
// quando `animarChave` muda), linhas extras opcionais no mesmo eixo e uma linha
// de meta. Não tem caixa flutuante: a página recebe o ponto em foco (`onFoco`)
// e mostra os valores onde quiser. Um eixo só, sempre na mesma unidade.
export interface SegmentoTempo {
  chave: string;
  valor: number;
  cor: string;
  opacidade?: number;
}
export interface PontoTempo {
  chave: string;
  rotulo: string; // eixo
  rotuloLinha2?: string; // ex.: ano na virada
  rotuloAcessivel: string; // "Março de 2027: R$ 311.411"
  segmentos: SegmentoTempo[]; // empilhados de baixo para cima
  adicional?: number; // parte "e se" por cima das barras (simulação), em cor de acento
  destaque?: boolean; // ex.: período selecionado na página
}
export interface LinhaTempo {
  chave: string;
  cor: string;
  tracejada?: boolean;
  valores: (number | null)[]; // um por ponto; null interrompe a linha
}

const topoBonito = (v: number) => {
  const p = Number(`1e${Math.floor(Math.log10(v))}`); // ordem de grandeza do eixo (não é conta de negócio)
  return ([1.2, 1.5, 3, 4.5, 6, 9, 12].find((t) => v / p <= t) ?? 12) * p; // sempre divisível em 3 passos redondos
};
const barraTopo = (x: number, y: number, w: number, h: number, r: number) => {
  const q = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + q}Q${x},${y} ${x + q},${y}H${x + w - q}Q${x + w},${y} ${x + w},${y + q}V${y + h}Z`;
};
// Curva suave que não ultrapassa os pontos (cúbica monótona).
function curva(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return '';
  const dx: number[] = [];
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    d[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  let s = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    s += `C${(pts[i][0] + dx[i] / 3).toFixed(1)},${(pts[i][1] + (m[i] * dx[i]) / 3).toFixed(1)} ${(pts[i + 1][0] - dx[i] / 3).toFixed(1)},${(pts[i + 1][1] - (m[i + 1] * dx[i]) / 3).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return s;
}

export function GraficoTempo({
  pontos,
  linhas = [],
  meta,
  marcaApos,
  rotuloMarca,
  formatarEixo,
  foco,
  onFoco,
  onSelecionar,
  rotuloAcessivel,
  animarChave,
}: {
  pontos: PontoTempo[];
  linhas?: LinhaTempo[];
  meta?: { valor: number; rotulo: string };
  marcaApos?: number; // índice do ponto depois do qual vai a divisória (ex.: "hoje")
  rotuloMarca?: string;
  formatarEixo: (v: number) => string;
  foco: number | null;
  onFoco: (i: number | null) => void;
  onSelecionar?: (p: PontoTempo, i: number) => void;
  rotuloAcessivel: string;
  animarChave: string; // mudou → as barras sobem e a linha se desenha de novo
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setW(Math.max(320, Math.round(el.clientWidth)));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = W < 560 ? 250 : 310;
  const mg = { l: 46, r: 10, t: 14, b: 38 };
  const pw = W - mg.l - mg.r;
  const ph = H - mg.t - mg.b;
  const total = (p: PontoTempo) => p.segmentos.reduce((s, g) => s + g.valor, 0) + (p.adicional ?? 0);
  const maximo = Math.max(1, ...pontos.map(total), ...linhas.flatMap((l) => l.valores.map((v) => v ?? 0)), meta?.valor ?? 0);
  const topo = topoBonito(maximo * 1.06);
  const y = (v: number) => mg.t + ph - (v / topo) * ph;
  const banda = pw / Math.max(1, pontos.length);
  const cx = (i: number) => mg.l + banda * i + banda / 2;
  const lb = Math.max(3, Math.min(banda * 0.46, 20));
  const passo = Math.ceil(pontos.length / (W < 560 ? 6 : 13));
  const pts = pontos.map((p, i): [number, number] => [cx(i), y(total(p))]);
  const dTopo = curva(pts);
  const base = mg.t + ph;

  return (
    <div ref={caixa} className="relative">
      {/* key = animarChave: o SVG nasce de novo e as animações rodam; o foco só redesenha. */}
      <svg key={animarChave} viewBox={`0 0 ${W} ${H}`} className="grafico-tempo block h-auto w-full overflow-visible" role="img" aria-label={rotuloAcessivel} style={{ cursor: 'crosshair' }} onPointerLeave={() => onFoco(null)}>
        <defs>
          <linearGradient id="gt-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--text-primary)" stopOpacity="0.06" />
            <stop offset="1" stopColor="var(--text-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[1, 2, 3].map((t) => (
          <g key={t}>
            <line x1={mg.l} x2={mg.l + pw} y1={y((topo / 3) * t)} y2={y((topo / 3) * t)} stroke="var(--border-light)" />
            <text x={mg.l - 10} y={y((topo / 3) * t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">{formatarEixo((topo / 3) * t)}</text>
          </g>
        ))}
        <line x1={mg.l} x2={mg.l + pw} y1={base} y2={base} stroke="var(--border)" />
        {pontos.map((p, i) => (
          <g key={p.chave}>
            {(i % passo === 0 || p.destaque) && (
              <text x={cx(i)} y={base + 17} textAnchor="middle" fontSize="11" fontWeight={p.destaque ? 600 : 400} fill={p.destaque ? 'var(--text-primary)' : 'var(--text-muted)'}>{p.rotulo}</text>
            )}
            {p.rotuloLinha2 && <text x={cx(i)} y={base + 32} textAnchor="middle" fontSize="11" fontWeight={600} fill="var(--text-body)">{p.rotuloLinha2}</text>}
            {p.destaque && <rect x={cx(i) - 9} y={base + 1} width={18} height={2} rx={1} fill="var(--accent)" />}
          </g>
        ))}
        {marcaApos != null && marcaApos >= 0 && marcaApos < pontos.length - 1 && (
          <g>
            <line x1={mg.l + banda * (marcaApos + 1)} x2={mg.l + banda * (marcaApos + 1)} y1={mg.t} y2={base} stroke="var(--border)" strokeDasharray="2 4" />
            {rotuloMarca && <text x={mg.l + banda * (marcaApos + 1) + 6} y={mg.t + 9} fontSize="11" fill="var(--text-muted)">{rotuloMarca}</text>}
          </g>
        )}

        {pontos.map((p, i) => {
          const x0 = cx(i) - lb / 2;
          const partes = p.segmentos.filter((g) => g.valor > 0);
          let acumulado = 0;
          return (
            <g key={p.chave} className="gt-col" style={{ animationDelay: `${Math.min(i * 16, 400)}ms` }}>
              {partes.map((g, j) => {
                const y1 = y(acumulado + g.valor);
                const h = Math.max(0, y(acumulado) - y1 - (j > 0 ? 1.5 : 0));
                acumulado += g.valor;
                return j === partes.length - 1 ? (
                  <path key={g.chave} d={barraTopo(x0, y1, lb, h, 3)} fill={g.cor} fillOpacity={g.opacidade ?? 1} />
                ) : (
                  <rect key={g.chave} x={x0} y={y1} width={lb} height={h} fill={g.cor} fillOpacity={g.opacidade ?? 1} />
                );
              })}
              {(p.adicional ?? 0) > 0 && (
                <rect x={x0} y={y(acumulado + (p.adicional ?? 0))} width={lb} height={Math.max(0, y(acumulado) - y(acumulado + (p.adicional ?? 0)) - 2)} rx={3} fill="var(--accent)" fillOpacity={0.3} />
              )}
            </g>
          );
        })}

        {/* A linha pelo topo das barras, com uma sombra leve por baixo. */}
        {pts.length > 1 && (
          <>
            <path className="gt-surge" d={`${dTopo}L${pts[pts.length - 1][0]},${base}L${pts[0][0]},${base}Z`} fill="url(#gt-area)" />
            <path className="gt-traco" pathLength={1} d={dTopo} fill="none" stroke="var(--text-primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
        {linhas.map((l) => {
          const q = l.valores.map((v, i): [number, number] | null => (v == null ? null : [cx(i), y(v)])).filter((x): x is [number, number] => x !== null);
          if (q.length < 2) return null;
          const d = curva(q);
          return l.tracejada ? (
            <path key={l.chave} className="gt-surge" d={d} fill="none" stroke={l.cor} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="2 5" strokeLinecap="round" />
          ) : (
            <g key={l.chave}>
              <path className="gt-surge" d={d} fill="none" stroke="var(--surface)" strokeWidth={4.5} />
              <path className="gt-traco" pathLength={1} d={d} fill="none" stroke={l.cor} strokeWidth={1.75} strokeLinecap="round" />
            </g>
          );
        })}
        {meta && meta.valor > 0 && (
          <g className="gt-surge">
            <line x1={mg.l} x2={mg.l + pw} y1={y(meta.valor)} y2={y(meta.valor)} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="5 5" />
            <text x={mg.l + pw} y={y(meta.valor) - 6} textAnchor="end" fontSize="11" fontWeight={600} fill="var(--text-body)">{meta.rotulo}</text>
          </g>
        )}

        {/* Foco: fio vertical e ponto na linha — os valores aparecem na página, não numa caixa flutuante. */}
        {foco != null && pts[foco] && (
          <>
            <line x1={pts[foco][0]} x2={pts[foco][0]} y1={mg.t} y2={base} stroke="var(--text-primary)" strokeOpacity={0.28} />
            <circle cx={pts[foco][0]} cy={pts[foco][1]} r={5} fill="var(--text-primary)" stroke="var(--surface)" strokeWidth={2.5} />
          </>
        )}
        {pontos.map((p, i) => (
          <rect
            key={p.chave}
            x={mg.l + banda * i}
            y={mg.t}
            width={banda}
            height={ph + mg.b}
            fill="transparent"
            tabIndex={0}
            role={onSelecionar ? 'button' : undefined}
            aria-label={p.rotuloAcessivel}
            style={{ outline: 'none', cursor: onSelecionar ? 'pointer' : 'crosshair' }}
            onPointerMove={() => foco !== i && onFoco(i)}
            onFocus={() => onFoco(i)}
            onBlur={() => onFoco(null)}
            onClick={() => onSelecionar?.(p, i)}
            onKeyDown={(e) => { if (onSelecionar && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelecionar(p, i); } }}
          />
        ))}
      </svg>
    </div>
  );
}
