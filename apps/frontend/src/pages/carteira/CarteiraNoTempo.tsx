import { useMemo, useState } from 'react';
import {
  escoamentoDaCarteira,
  formatCurrency,
  mesAnterior,
  mesSeguinte,
  pontosDaCarteira,
  simularVendasNovas,
  ticketMedioMensal,
  PRAZO_SIMULACAO_MESES,
  type PontoCarteira,
  type VisaoMensal,
} from '@azit/utils';
import { GraficoTempo, type LinhaTempo, type PontoTempo } from '../../components/GraficoTempo';
import { PRODUTO_SLOT_COLORS, VISAO_ESTADO_COLORS, VIZ_FUTURO } from '../../config/statusColors';

// "Mês a mês" da Carteira (doc 02 §27.11): o que já aconteceu em barras, o
// que está contratado até a última fatura em cinza-claro e UMA linha pelo topo.
// O número grande acompanha o mês sob o ponteiro. Nenhuma conta é feita aqui:
// pontos, escoamento e simulação vêm de `@azit/utils` (Regra 16).
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MESC = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = (m: string) => `${MESC[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const semCentavos = (c: number) => formatCurrency(c).replace(/,\d{2}$/, '');
const curto = (c: number) => {
  const v = c / 100;
  return v >= 1e6 ? `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : `${Math.round(v / 1000).toLocaleString('pt-BR')} mil`;
};
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const mesesEntre = (de: string, ate: string) => {
  const out: string[] = [];
  for (let m = de; m <= ate && out.length < 240; m = mesSeguinte(m)) out.push(m);
  return out;
};
const somarMeses = (m: string, n: number) => {
  let x = m;
  for (let i = 0; i < Math.abs(n); i++) x = n < 0 ? mesAnterior(x) : mesSeguinte(x);
  return x;
};

type Horizonte = '1a' | '2a' | 'tudo';
const HORIZONTES: { chave: Horizonte; rotulo: string; meses: number }[] = [
  { chave: '1a', rotulo: '1 ano', meses: 12 },
  { chave: '2a', rotulo: '2 anos', meses: 24 },
  { chave: 'tudo', rotulo: 'Tudo', meses: 0 },
];
const ATRAS = 6; // meses de história à esquerda de hoje nos horizontes de 1 e 2 anos
// Metas da simulação: só na tela (provisório, Regra 12) — viram parâmetro quando o Luís definir.
const METAS = [0, 30_000_000, 50_000_000, 100_000_000];

const seg = 'rounded-[7px] px-[11px] py-[5px] text-[12px] font-semibold transition-colors';
function Segmentado<T extends string>({ itens, valor, onChange }: { itens: { chave: T; rotulo: string }[]; valor: T | null; onChange: (v: T) => void }) {
  return (
    <span className="inline-flex rounded-[9px] p-[2px]" style={{ background: 'var(--surface-input)' }}>
      {itens.map((it) => (
        <button
          key={it.chave}
          type="button"
          aria-pressed={valor === it.chave}
          onClick={() => onChange(it.chave)}
          className={seg}
          style={valor === it.chave ? { background: 'var(--surface)', color: 'var(--text-primary)', boxShadow: '0 1px 2px rgba(0,16,41,.1)' } : { color: 'var(--text-muted)' }}
        >
          {it.rotulo}
        </button>
      ))}
    </span>
  );
}

export function CarteiraNoTempo({
  serie,
  primeiroMes,
  ultimoMes,
  mesHoje,
  selecionado,
  onSelecionar,
}: {
  serie: Map<string, VisaoMensal>; // a carteira inteira, por mês
  primeiroMes: string;
  ultimoMes: string;
  mesHoje: string;
  selecionado: string | null;
  onSelecionar: (anoMes: string) => void;
}) {
  const [horizonte, setHorizonte] = useState<Horizonte | null>('1a');
  const [inicio, setInicio] = useState(() => somarMeses(mesHoje, -ATRAS));
  const [tamanho, setTamanho] = useState(ATRAS + 12 + 1);
  const [ver, setVer] = useState<'situacao' | 'produto'>('situacao');
  const [comRecebido, setComRecebido] = useState(false);
  const [vista, setVista] = useState<'grafico' | 'tabela'>('grafico');
  const [simAberta, setSimAberta] = useState(false);
  const [novos, setNovos] = useState(0);
  const [esperado, setEsperado] = useState(100);
  const [meta, setMeta] = useState(0);
  const [foco, setFoco] = useState<number | null>(null);

  const todos = useMemo(() => mesesEntre(primeiroMes, ultimoMes), [primeiroMes, ultimoMes]);
  // Janela: nunca sai dos limites da carteira.
  const janela = useMemo(() => {
    const n = Math.min(tamanho, todos.length);
    const i = Math.max(0, Math.min(todos.length - n, todos.indexOf(inicio) < 0 ? (inicio < primeiroMes ? 0 : todos.length - n) : todos.indexOf(inicio)));
    return todos.slice(i, i + n);
  }, [todos, inicio, tamanho, primeiroMes]);
  const escolherHorizonte = (h: Horizonte) => {
    setHorizonte(h);
    setFoco(null);
    if (h === 'tudo') { setInicio(primeiroMes); setTamanho(todos.length); }
    else { setInicio(somarMeses(mesHoje, -ATRAS)); setTamanho(ATRAS + (h === '1a' ? 12 : 24) + 1); }
  };
  const andar = (sentido: -1 | 1) => { setInicio(somarMeses(janela[0], sentido * 3)); setHorizonte(null); setFoco(null); };

  const grupo = janela.length > 32 ? 'trimestre' : 'mes';
  const pontos = useMemo(() => pontosDaCarteira(janela, serie, grupo), [janela, serie, grupo]);
  // Simulação e escoamento olham a carteira inteira, não só a janela.
  const serieTeto = useMemo(() => todos.map((m) => ({ mes: m, teto: serie.get(m)?.teto.valor ?? 0, clientes: serie.get(m)?.teto.clientes ?? 0 })), [todos, serie]);
  const ticket = useMemo(() => ticketMedioMensal(serieTeto, mesHoje), [serieTeto, mesHoje]);
  const simPorMes = useMemo(() => new Map(todos.map((m, i) => [m, simularVendasNovas(todos, mesHoje, novos, ticket)[i]])), [todos, mesHoje, novos, ticket]);
  const simDe = (p: PontoCarteira) => p.meses.reduce((s, m) => s + (simPorMes.get(m) ?? 0), 0);
  const futuro = (p: PontoCarteira) => p.meses[0] > mesHoje;
  const comHoje = (p: PontoCarteira) => p.meses.includes(mesHoje);
  const titulo = (p: PontoCarteira) => (grupo === 'mes' ? `${MESES[Number(p.chave.slice(5, 7)) - 1]} de ${p.chave.slice(0, 4)}` : `${p.chave.slice(6)}º trimestre de ${p.chave.slice(0, 4)}`);
  const produtos = pontos[0]?.porProduto.map((x, i) => ({ chave: x.chave, rotulo: x.rotulo, cor: PRODUTO_SLOT_COLORS[i % PRODUTO_SLOT_COLORS.length] })) ?? [];

  const E = VISAO_ESTADO_COLORS;
  const pontosGrafico: PontoTempo[] = pontos.map((p, i) => {
    const mm = Number(p.meses[0].slice(5, 7));
    const segmentos =
      ver === 'produto'
        ? p.porProduto.map((x, j) => ({ chave: x.chave, valor: x.teto, cor: produtos[j]?.cor ?? 'var(--viz-neutral)', opacidade: futuro(p) ? 0.42 : 1 }))
        : futuro(p)
          ? [{ chave: 'contratado', valor: p.teto, cor: VIZ_FUTURO }]
          : [
              { chave: 'pago', valor: p.pago, cor: E.recebidas.fg },
              { chave: 'vencido', valor: p.vencido, cor: E.vencidas.fg },
              { chave: 'aVencer', valor: p.aVencer, cor: E.a_vencer.fg },
            ];
    return {
      chave: p.chave,
      rotulo: grupo === 'mes' ? MESC[mm - 1] : `T${p.chave.slice(6)}`,
      rotuloLinha2: i === 0 || (grupo === 'mes' ? mm === 1 : mm <= 3) ? p.chave.slice(0, 4) : undefined,
      rotuloAcessivel: `${titulo(p)}: ${semCentavos(p.teto + simDe(p))}`,
      segmentos,
      adicional: simDe(p),
      destaque: grupo === 'mes' && p.chave === selecionado,
    };
  });
  const linhas: LinhaTempo[] = [];
  // Recebido no mês é caixa: só existe em mês fechado.
  if (comRecebido) linhas.push({ chave: 'recebido', cor: E.recebidas.fg, valores: pontos.map((p) => (p.meses[p.meses.length - 1] < mesHoje ? p.recebido : null)) });
  if (esperado < 100) linhas.push({ chave: 'esperado', cor: 'var(--text-primary)', tracejada: true, valores: pontos.map((p) => (futuro(p) ? Math.round(((p.teto + simDe(p)) * esperado) / 100) : null)) });

  // O número grande: o ponto sob o ponteiro; sem ponteiro, o mês selecionado na página ou o de hoje.
  const idxPadrao = Math.max(0, pontos.findIndex((p) => (selecionado && p.meses.includes(selecionado)) || false));
  const idxHoje = pontos.findIndex(comHoje);
  const p = pontos[foco ?? (selecionado && pontos.some((x) => x.meses.includes(selecionado)) ? idxPadrao : Math.max(0, idxHoje))];

  const esc = useMemo(() => escoamentoDaCarteira(serieTeto), [serieTeto]);
  const frase = (() => {
    if (novos > 0) {
      const comSim = serieTeto.filter((x) => x.mes > mesHoje).map((x) => ({ mes: x.mes, total: x.teto + (simPorMes.get(x.mes) ?? 0) }));
      const maximo = comSim.reduce((a, b) => (b.total > a.total ? b : a), { mes: mesHoje, total: 0 });
      const quem = <b>{plural(novos, 'contrato novo', 'contratos novos')} por mês</b>;
      if (meta > 0) {
        const bate = comSim.find((x) => x.total >= meta);
        return bate ? <>Com {quem}, a carteira chega a {curto(meta)} por mês em <b>{mesCurto(bate.mes)}</b>.</> : <>Com {quem}, a carteira não chega a {curto(meta)} por mês: o máximo é <b>{semCentavos(maximo.total)}</b>, em {mesCurto(maximo.mes)}.</>;
      }
      return <>Com {quem}, a carteira chega a <b>{semCentavos(maximo.total)}</b> por mês no ponto mais alto, em {mesCurto(maximo.mes)}.</>;
    }
    if (!esc) return <>Nenhuma fatura na carteira ainda.</>;
    return (
      <>
        O que já está contratado tem o pico em <b>{mesCurto(esc.pico.mes)}</b> ({semCentavos(esc.pico.teto)}).{' '}
        {esc.abaixo ? <>Sem vender mais nada, cai abaixo de {curto(esc.limite)} em <b>{mesCurto(esc.abaixo)}</b> e termina em <b>{mesCurto(esc.ultimo)}</b>.</> : <>A última fatura vence em <b>{mesCurto(esc.ultimo)}</b>.</>}
      </>
    );
  })();

  if (!p) return <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhuma fatura na carteira ainda.</div>;
  const partes: { cor: string; nome: string; valor: number; linha?: boolean; tracejada?: boolean }[] =
    ver === 'produto'
      ? p.porProduto.filter((x) => x.teto > 0).map((x) => ({ cor: produtos.find((q) => q.chave === x.chave)?.cor ?? 'var(--viz-neutral)', nome: x.rotulo, valor: x.teto }))
      : futuro(p)
        ? []
        : [
            { cor: E.recebidas.fg, nome: 'Pago', valor: p.pago },
            { cor: E.vencidas.fg, nome: 'Vencido', valor: p.vencido },
            { cor: E.a_vencer.fg, nome: 'A vencer', valor: p.aVencer },
          ].filter((x) => x.valor > 0);
  if (simDe(p) > 0) partes.push({ cor: 'var(--accent)', nome: 'Vendas novas (simulação)', valor: simDe(p) });
  if (comRecebido && p.meses[p.meses.length - 1] < mesHoje) partes.push({ cor: E.recebidas.fg, nome: 'Recebido no mês', valor: p.recebido, linha: true });
  if (esperado < 100 && futuro(p)) partes.push({ cor: 'var(--text-primary)', nome: 'Esperado', valor: Math.round(((p.teto + simDe(p)) * esperado) / 100), linha: true, tracejada: true });

  const chaveItem = 'inline-flex items-center gap-[6px] whitespace-nowrap';
  const ponto = (cor: string) => <i className="block h-[7px] w-[7px] flex-none rounded-full" style={{ background: cor }} />;
  const traco = (cor: string, tracejada?: boolean) => <i className="block h-0 w-[12px] flex-none" style={{ borderTop: `2px ${tracejada ? 'dashed' : 'solid'} ${cor}` }} />;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-start gap-x-[20px] gap-y-[12px]">
        <div className="min-w-0 flex-[1_1_280px]">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: 'var(--text-muted)' }}>{titulo(p)}</div>
          <div className="mt-[6px] font-display text-[28px] font-bold leading-[1.15] tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {semCentavos(p.teto + simDe(p))}
            <small className="ml-[6px] font-body text-[12.5px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {futuro(p) ? `já contratado${simDe(p) ? ' + simulação' : ''}` : comHoje(p) ? 'teto do período em curso' : 'teto'}
            </small>
          </div>
          <div className="mt-[6px] flex min-h-[19px] flex-wrap gap-x-[16px] gap-y-[3px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
            {partes.map((x) => (
              <span key={x.nome} className={chaveItem}>
                {x.linha ? traco(x.cor, x.tracejada) : ponto(x.cor)}
                {x.nome} <b className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{semCentavos(x.valor)}</b>
              </span>
            ))}
            <span className={chaveItem}>{plural(p.faturas, 'fatura', 'faturas')}{p.clientes != null ? ` · ${plural(p.clientes, 'cliente', 'clientes')}` : ''}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
          <span className="inline-flex items-center gap-[2px] text-[12.5px] tabular-nums" style={{ color: 'var(--text-body)' }}>
            <button type="button" aria-label="Meses anteriores" disabled={janela[0] <= primeiroMes} onClick={() => andar(-1)} className="h-[26px] w-[26px] rounded-[7px] text-[15px] disabled:opacity-30" style={{ color: 'var(--text-muted)' }}>‹</button>
            {mesCurto(janela[0])} – {mesCurto(janela[janela.length - 1])}
            <button type="button" aria-label="Meses seguintes" disabled={janela[janela.length - 1] >= ultimoMes} onClick={() => andar(1)} className="h-[26px] w-[26px] rounded-[7px] text-[15px] disabled:opacity-30" style={{ color: 'var(--text-muted)' }}>›</button>
          </span>
          <Segmentado itens={HORIZONTES} valor={horizonte} onChange={escolherHorizonte} />
          <select
            aria-label="O que as barras mostram"
            value={ver}
            onChange={(e) => setVer(e.target.value as 'situacao' | 'produto')}
            className="rounded-[8px] px-[8px] py-[5px] text-[12px] font-semibold"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            <option value="situacao">Por situação</option>
            <option value="produto">Por produto</option>
          </select>
          <Segmentado itens={[{ chave: 'grafico', rotulo: 'gráfico' }, { chave: 'tabela', rotulo: 'tabela' }]} valor={vista} onChange={setVista} />
        </div>
      </div>

      {vista === 'grafico' ? (
        <div className="mt-[14px]">
          <GraficoTempo
            pontos={pontosGrafico}
            linhas={linhas}
            meta={meta > 0 ? { valor: meta * (grupo === 'trimestre' ? 3 : 1), rotulo: 'meta' } : undefined}
            marcaApos={idxHoje}
            rotuloMarca="a vencer →"
            formatarEixo={curto}
            foco={foco}
            onFoco={setFoco}
            onSelecionar={grupo === 'mes' ? (pt) => onSelecionar(pt.chave) : undefined}
            rotuloAcessivel={`Carteira por ${grupo === 'mes' ? 'mês' : 'trimestre'}: o que já aconteceu em barras e o teto contratado em linha, de ${mesCurto(janela[0])} a ${mesCurto(janela[janela.length - 1])}`}
            animarChave={`${janela[0]}|${janela.length}|${ver}|${comRecebido}|${meta}`}
          />
        </div>
      ) : (
        <div className="mt-[14px] overflow-x-auto">
          <table className="w-full border-collapse text-[12px]" style={{ minWidth: 640 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                {[grupo === 'mes' ? 'Mês' : 'Trimestre', 'Teto', 'Pago', '%', 'Vencido', 'A vencer', 'Recebido (caixa)', ...(novos ? ['Vendas novas (sim.)'] : []), 'Faturas', 'Clientes'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-[6px] py-[6px] text-right text-[10.5px] font-medium uppercase tracking-[0.08em] first:text-left" style={{ borderBottom: '1px solid var(--border-light)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pontos.map((x) => (
                <tr key={x.chave}>
                  {[titulo(x), semCentavos(x.teto), semCentavos(x.pago), x.teto ? `${Math.round((100 * x.pago) / x.teto)}%` : '—', semCentavos(x.vencido), semCentavos(x.aVencer), semCentavos(x.recebido), ...(novos ? [semCentavos(simDe(x))] : []), x.faturas, x.clientes ?? '—'].map((cel, i) => (
                    <td key={i} className="whitespace-nowrap px-[6px] py-[6px] text-right tabular-nums first:text-left" style={{ borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>{cel}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-[12px] flex flex-wrap items-center gap-x-[16px] gap-y-[6px] text-[12px]" style={{ color: 'var(--text-body)' }}>
        {ver === 'produto' ? (
          produtos.map((x) => <span key={x.chave} className={chaveItem}>{ponto(x.cor)}{x.rotulo}</span>)
        ) : (
          <>
            <span className={chaveItem}>{ponto(E.recebidas.fg)}Pago</span>
            <span className={chaveItem}>{ponto(E.vencidas.fg)}Vencido</span>
            <span className={chaveItem}>{ponto(E.a_vencer.fg)}A vencer</span>
            <span className={chaveItem}>{ponto(VIZ_FUTURO)}Contratado, ainda não venceu</span>
          </>
        )}
        <span className={chaveItem}>{traco('var(--text-primary)')}Teto</span>
        <button type="button" aria-pressed={comRecebido} onClick={() => setComRecebido((v) => !v)} className={chaveItem} style={comRecebido ? undefined : { color: 'var(--text-muted)', opacity: 0.7 }} title="Ligar ou desligar: o que entrou em cada mês, de qualquer vencimento">
          {traco(E.recebidas.fg)}Recebido no mês
        </button>
        <span className="flex-1" />
        <button type="button" aria-expanded={simAberta} onClick={() => setSimAberta((v) => !v)} className="font-semibold underline underline-offset-[3px]" style={{ color: 'var(--text-primary)', textDecorationColor: 'var(--border)' }}>
          {simAberta ? 'Fechar simulação' : 'Simular vendas novas'}
        </button>
      </div>

      {simAberta && (
        <div className="mt-[12px] grid grid-cols-1 items-end gap-x-[24px] gap-y-[10px] pt-[14px] md:grid-cols-[1fr_1fr_auto]" style={{ borderTop: '1px solid var(--border-light)' }}>
          <label className="flex flex-col gap-[6px] text-[12px]" style={{ color: 'var(--text-body)' }}>
            <span className="flex justify-between">Contratos novos por mês <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{novos === 0 ? 'nenhum' : `${novos} por mês`}</b></span>
            <input type="range" min={0} max={15} step={1} value={novos} onChange={(e) => setNovos(Number(e.target.value))} style={{ accentColor: 'var(--text-primary)' }} />
          </label>
          <label className="flex flex-col gap-[6px] text-[12px]" style={{ color: 'var(--text-body)' }}>
            <span className="flex justify-between">Recebimento esperado <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{esperado}% do teto</b></span>
            <input type="range" min={80} max={100} step={1} value={esperado} onChange={(e) => setEsperado(Number(e.target.value))} style={{ accentColor: 'var(--text-primary)' }} />
          </label>
          <select aria-label="Meta por mês" value={meta} onChange={(e) => setMeta(Number(e.target.value))} className="rounded-[8px] px-[8px] py-[5px] text-[12px] font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            {METAS.map((m) => <option key={m} value={m}>{m === 0 ? 'Sem meta' : `Meta ${curto(m)}`}</option>)}
          </select>
          <div className="text-[11.5px] md:col-span-3" style={{ color: 'var(--text-muted)' }}>
            Só desenha por cima do que está contratado; não muda nenhum dado. Cada contrato novo vale {semCentavos(ticket)} por mês (a média de um cliente de hoje) por {PRAZO_SIMULACAO_MESES} meses.
          </div>
        </div>
      )}

      <div className="mt-[14px] flex items-start gap-[9px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
        <span className="grid h-[20px] w-[20px] flex-none place-items-center rounded-full text-[10.5px] font-bold" style={{ background: 'var(--accent)', color: '#2b1700' }}>H</span>
        <span className="[&_b]:text-[var(--text-primary)]">{frase}</span>
      </div>
    </div>
  );
}
