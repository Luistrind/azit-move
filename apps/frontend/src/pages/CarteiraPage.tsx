import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  diasCalendarioEntre,
  formatCurrency,
  mesAnterior,
  mesSeguinte,
  periodoAnteriorMesmoTrecho,
  periodoDoMes,
  somarDiasISO,
  variacaoPct,
  type VisaoCarteira,
  type VisaoMensal,
} from '@azit/utils';
import { carteiraVisaoService, type EstadoVisao } from '../services/carteira-visao.service';
import { Bloco } from '../components/Bloco';
import { CartaoIndicador } from '../components/CartaoIndicador';
import { SeletorPeriodo, intervaloDoPeriodo, rotuloDoPeriodo, type PeriodoSelecionado } from '../components/SeletorPeriodo';
import { GraficoBarrasEmpilhadas, type CategoriaEmpilhada } from '../components/GraficoBarrasEmpilhadas';
import { PRODUTO_SLOT_COLORS, VISAO_ESTADO_COLORS, VIZ_NEUTRAL } from '../config/statusColors';
import { hojeBrasilISO } from '../lib/datas';

// Carteira (doc 02 §27, 30/10/2026): visão por período de vencimento — teto,
// recebidas, vencidas, a vencer — com cartões que abrem a lista de clientes,
// comparação com o mesmo trecho do mês anterior, por produto, o que vem aí e
// mês a mês. A grade de clientes é tela própria: /carteira/clientes.
// Nenhum número é calculado aqui: tudo vem de `agregarVisaoCarteira` via API.

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESC = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = (anoMes: string) => `${MESC[Number(anoMes.slice(5, 7)) - 1]}/${anoMes.slice(0, 4)}`;
const mesNome = (anoMes: string) => MESES[Number(anoMes.slice(5, 7)) - 1];
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const semCentavos = (c: number) => formatCurrency(c).replace(/,\d{2}$/, '');
// "165,9 mil" — só para a Leitura do Hub ler bonito; números dos cartões são formatCurrency.
const compacto = (c: number) => {
  const v = c / 100;
  return Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;


export function CarteiraPage() {
  const navigate = useNavigate();
  const hoje = hojeBrasilISO();
  const mesHoje = hoje.slice(0, 7);
  const [sel, setSel] = useState<PeriodoSelecionado>({ modo: 'mes', anoMes: mesHoje });
  const [lista, setLista] = useState<EstadoVisao | null>(null);
  const [listaToda, setListaToda] = useState(false);

  const periodo = intervaloDoPeriodo(sel, hoje);
  const rotulo = rotuloDoPeriodo(sel, hoje);
  const aberto = periodo.ate >= hoje && periodo.de <= hoje;
  const futuro = periodo.de > hoje;

  // Janela do mês a mês: 15 meses para trás, 2 para a frente do mês de hoje.
  const janela = useMemo(() => {
    let m = mesHoje;
    for (let i = 0; i < 15; i++) m = mesAnterior(m);
    const out: string[] = [];
    for (let i = 0; i < 18; i++) { out.push(m); m = mesSeguinte(m); }
    return out;
  }, [mesHoje]);

  const visao = useQuery({ queryKey: ['carteira-visao', periodo.de, periodo.ate], queryFn: () => carteiraVisaoService.periodo(periodo.de, periodo.ate) });
  const trecho = useMemo(() => periodoAnteriorMesmoTrecho(periodo, hoje, sel.modo === 'mes' ? sel.anoMes : undefined), [periodo.de, periodo.ate, hoje, sel.modo, sel.anoMes]);
  const atual = useQuery({ queryKey: ['carteira-visao', trecho?.atual.de, trecho?.atual.ate], queryFn: () => carteiraVisaoService.periodo(trecho!.atual.de, trecho!.atual.ate), enabled: !!trecho });
  const anterior = useQuery({ queryKey: ['carteira-visao', trecho?.anterior.de, trecho?.anterior.ate], queryFn: () => carteiraVisaoService.periodo(trecho!.anterior.de, trecho!.anterior.ate), enabled: !!trecho });
  const mensal = useQuery({ queryKey: ['carteira-visao-mensal', janela[0], janela[janela.length - 1]], queryFn: () => carteiraVisaoService.mensal(janela[0], janela[janela.length - 1]) });
  const sete = useQuery({ queryKey: ['carteira-visao', somarDiasISO(hoje, 1), somarDiasISO(hoje, 7)], queryFn: () => carteiraVisaoService.periodo(somarDiasISO(hoje, 1), somarDiasISO(hoje, 7)) });
  const proxMes = useMemo(() => periodoDoMes(mesSeguinte(sel.anoMes)), [sel.anoMes]);
  const seguinte = useQuery({ queryKey: ['carteira-visao', proxMes.de, proxMes.ate], queryFn: () => carteiraVisaoService.periodo(proxMes.de, proxMes.ate) });
  const clientes = useQuery({ queryKey: ['carteira-visao-clientes', periodo.de, periodo.ate, lista], queryFn: () => carteiraVisaoService.clientes(periodo.de, periodo.ate, lista!), enabled: !!lista });

  const v = visao.data;
  const mesesAnteriores = useMemo(() => {
    const porMes = new Map((mensal.data ?? []).map((m) => [m.mes, m]));
    return porMes;
  }, [mensal.data]);
  const anteriorMes: VisaoMensal | undefined = sel.modo === 'mes' ? mesesAnteriores.get(mesAnterior(sel.anoMes)) : undefined;

  const abrirLista = (estado: EstadoVisao) => { setLista((l) => (l === estado ? null : estado)); setListaToda(false); };
  // 'Abrir na Carteira': a grade de clientes é tela própria do módulo (doc 02 §27.8).
  const abrirNaCarteira = (situacao: string) => navigate(situacao ? `/carteira/clientes?situacao=${situacao}` : '/carteira/clientes');

  // ---------- Leituras do Hub ----------
  const leituraA = (x: VisaoCarteira) => {
    const t = x.teto.valor;
    if (!t) return 'Nenhuma fatura vence neste período.';
    if (futuro) return <><b>{compacto(t)} já contratados</b> com {plural(x.teto.clientes, 'cliente', 'clientes')}.</>;
    if (!aberto) return <><b>{pct(x.recebidas.valor, t)}% do teto entrou</b>; {compacto(x.vencidas.valor)} ficaram vencidos com {plural(x.vencidas.clientes, 'cliente', 'clientes')}.</>;
    const proj = x.recebidas.valor + x.aVencer.valor;
    return <><b>{pct(x.recebidas.valor, t)}% do teto já entrou.</b> Se tudo que falta vencer entrar, fecha em {compacto(proj)} ({pct(proj, t)}%). O que falta para o teto são os {compacto(x.vencidas.valor)} vencidos de {plural(x.vencidas.clientes, 'cliente', 'clientes')}.</>;
  };


  return (
    <div className="flex flex-col gap-[14px]">
      <SeletorPeriodo valor={sel} onChange={(s) => { setSel(s); setLista(null); }} hoje={hoje} mesMin={janela[0]} mesMax={mesSeguinte(mesSeguinte(mesHoje))} />

      <div className="grid grid-cols-12 gap-[12px]">
        {/* A — Cobranças do período */}
        <Bloco titulo="Cobranças" tag={rotulo} className="col-span-12 lg:col-span-8" leitura={v ? leituraA(v) : 'Carregando…'}>
          {v ? (
            <>
              <div className="font-display text-[30px] font-bold leading-[1.1] tracking-[-0.02em] tabular-nums sm:text-[34px]" style={{ color: 'var(--text-primary)' }}>
                {formatCurrency(v.teto.valor)}
                <span className="ml-[6px] text-[14px] font-semibold" style={{ color: 'var(--text-muted)' }}>teto</span>
              </div>
              <div className="-mt-[4px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
                {plural(v.teto.faturas, 'fatura', 'faturas')} · {plural(v.teto.clientes, 'cliente', 'clientes')}
              </div>
              <div className="flex h-[12px] gap-[2px] overflow-hidden rounded-[6px]" style={{ background: 'var(--surface-muted)' }} aria-hidden>
                {(['recebidas', 'vencidas', 'a_vencer'] as const).map((e) => {
                  const val = e === 'a_vencer' ? v.aVencer.valor : v[e].valor;
                  return val > 0 && v.teto.valor > 0 ? <span key={e} style={{ width: `${(100 * val) / v.teto.valor}%`, background: VISAO_ESTADO_COLORS[e].fg }} /> : null;
                })}
              </div>
              <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-3">
                {(['recebidas', 'vencidas', 'a_vencer'] as const).map((e) => {
                  const r = e === 'a_vencer' ? v.aVencer : v[e];
                  const tom = e === 'recebidas' ? 'good' : e === 'vencidas' ? 'bad' : 'warn';
                  return (
                    <CartaoIndicador
                      key={e}
                      rotulo={VISAO_ESTADO_COLORS[e].rotulo}
                      valor={formatCurrency(r.valor)}
                      detalhe={`${pct(r.valor, v.teto.valor)}% · ${plural(r.clientes, 'cliente', 'clientes')} · ${plural(r.faturas, 'fatura', 'faturas')}`}
                      tom={tom}
                      ativo={lista === e}
                      onClick={() => abrirLista(e)}
                    />
                  );
                })}
              </div>
              {lista ? (
                <div className="flex flex-col pt-[8px]" style={{ borderTop: '1px solid var(--border-light)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-[8px] pb-[6px] text-[12px]" style={{ color: 'var(--text-body)' }}>
                    <span>
                      <b style={{ color: 'var(--text-primary)' }}>{VISAO_ESTADO_COLORS[lista].rotulo}</b> · {clientes.data ? plural(clientes.data.length, 'cliente', 'clientes') : '…'} · {rotulo}
                    </span>
                    <button type="button" onClick={() => abrirNaCarteira(lista === 'vencidas' ? 'em_atraso' : lista === 'recebidas' ? 'em_dia' : '')} className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
                      Abrir na Carteira →
                    </button>
                  </div>
                  {(listaToda ? clientes.data ?? [] : (clientes.data ?? []).slice(0, 8)).map((c) => {
                    const dias = Math.max(0, diasCalendarioEntre(c.maisAntiga, hoje));
                    const tomDias = dias >= 30 ? 'bad' : dias >= 3 ? 'warn' : 'neutro';
                    return (
                      <div key={c.contaId} className="grid grid-cols-[1fr_auto] items-center gap-x-[12px] py-[8px] text-[12.5px]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <div className="min-w-0">
                          <Link to={`/titulares/${c.titularId}`} className="block truncate font-semibold" style={{ color: 'var(--text-primary)' }}>{c.titular}</Link>
                          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {c.faturas} fatura{c.faturas > 1 ? 's' : ''} · {lista === 'vencidas' ? 'mais antiga' : 'vencimento'} {ddmm(c.maisAntiga)}
                            {lista === 'vencidas' ? (
                              <span className="ml-[6px] rounded-full px-[7px] py-[1px] text-[10.5px] font-semibold" style={{ background: tomDias === 'neutro' ? 'var(--surface-muted)' : VISAO_ESTADO_COLORS[tomDias === 'bad' ? 'vencidas' : 'a_vencer'].soft, color: tomDias === 'neutro' ? 'var(--text-body)' : VISAO_ESTADO_COLORS[tomDias === 'bad' ? 'vencidas' : 'a_vencer'].fg }}>
                                {dias}d
                              </span>
                            ) : null}
                            {c.bloqueada ? <span className="ml-[6px] rounded-full px-[7px] py-[1px] text-[10.5px] font-semibold" style={{ background: VISAO_ESTADO_COLORS.vencidas.soft, color: VISAO_ESTADO_COLORS.vencidas.fg }}>bloqueada</span> : null}
                          </div>
                        </div>
                        <div className="whitespace-nowrap text-right font-display text-[13px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(c.valor)}</div>
                      </div>
                    );
                  })}
                  {(clientes.data?.length ?? 0) > 8 ? (
                    <button type="button" onClick={() => setListaToda((t) => !t)} className="self-start pt-[8px] text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                      {listaToda ? 'ver menos' : `ver todos (${clientes.data?.length})`}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{visao.isError ? 'Não foi possível carregar a visão.' : 'Carregando…'}</div>
          )}
        </Bloco>

        {/* B — Comparação, mesmo trecho */}
        <Bloco
          titulo={sel.modo === 'mes' ? `Versus ${mesNome(mesAnterior(sel.anoMes))}` : 'Versus trecho anterior'}
          tag={trecho ? `${ddmm(trecho.atual.de)}–${ddmm(trecho.atual.ate)} × ${ddmm(trecho.anterior.de)}–${ddmm(trecho.anterior.ate)}` : undefined}
          className="col-span-12 lg:col-span-4"
          leitura={(() => {
            if (!trecho) return 'Quando o período começar, a comparação usa o mesmo trecho do mês anterior.';
            const a = atual.data, b = anterior.data;
            if (!a || !b) return 'Carregando…';
            const dr = variacaoPct(a.recebidas.valor, b.recebidas.valor), dt = variacaoPct(a.teto.valor, b.teto.valor), dv = variacaoPct(a.vencidas.valor, b.vencidas.valor);
            const sinal = (d: number | null) => (d === null ? '—' : `${d >= 0 ? '+' : ''}${d}%`);
            return <>Recebido <b>{sinal(dr)}</b> com teto {sinal(dt)}. {aberto ? 'Vencido não compara: o período anterior teve mais tempo de cobrança.' : `Vencido ${sinal(dv)}.`}</>;
          })()}
        >
          {!trecho ? (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>nada venceu ainda</div>
          ) : atual.data && anterior.data ? (
            <div className="flex flex-col">
              {([
                ['Teto', atual.data.teto.valor, anterior.data.teto.valor, false, false],
                ['Recebido', atual.data.recebidas.valor, anterior.data.recebidas.valor, false, false],
                ['Vencido', atual.data.vencidas.valor, anterior.data.vencidas.valor, true, aberto],
              ] as [string, number, number, boolean, boolean][]).map(([k, a, b, inverso, nc]) => {
                const d = nc ? null : variacaoPct(a, b);
                const tom = d === null || d === 0 ? 'flat' : (d > 0) !== inverso ? 'up' : 'down';
                const cor = tom === 'up' ? VISAO_ESTADO_COLORS.recebidas : tom === 'down' ? VISAO_ESTADO_COLORS.vencidas : null;
                return (
                  <div key={k} className="grid grid-cols-[1fr_1fr_auto] items-center gap-x-[10px] gap-y-[2px] py-[8px] text-[13px] sm:grid-cols-[1.1fr_1fr_1fr_auto]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <span className="col-span-3 sm:col-span-1" style={{ color: 'var(--text-body)' }}>{k}</span>
                    <span className="font-display font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{semCentavos(a)}<small className="block text-[10.5px] font-normal uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>agora</small></span>
                    <span className="font-display font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{semCentavos(b)}<small className="block text-[10.5px] font-normal uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>antes</small></span>
                    <span
                      className="justify-self-end whitespace-nowrap rounded-full px-[8px] py-[2px] text-[12px] font-semibold"
                      title={nc ? 'não comparável: o período anterior teve mais tempo de cobrança' : undefined}
                      style={cor ? { background: cor.soft, color: cor.fg } : { background: 'var(--surface-muted)', color: 'var(--text-body)' }}
                    >
                      {d === null ? (nc ? 'n/c' : '—') : `${d > 0 ? '↑' : d < 0 ? '↓' : '='} ${Math.abs(d)}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
          )}
        </Bloco>

        {/* D — Por produto */}
        <Bloco
          titulo="Por produto"
          tag={rotulo}
          className="col-span-12 lg:col-span-6"
          explorar={{ rotulo: 'Catálogo', to: '/catalogo' }}
          leitura={(() => {
            if (!v) return 'Carregando…';
            const tot = v.porProduto.reduce((s, p) => s + p.recebido, 0);
            if (!tot) return 'Nada recebido no período.';
            const principal = v.porProduto[0];
            const outros = v.porProduto.slice(1);
            const maior = [...outros].sort((a, b) => b.recebido - a.recebido)[0];
            return <><b>{pct(principal.recebido, tot)}% é {principal.rotulo}.</b> Demais produtos: {compacto(outros.reduce((s, p) => s + p.recebido, 0))}{maior ? `, maior ${maior.rotulo.toLowerCase()} (${compacto(maior.recebido)})` : ''}. Encargos: {compacto(v.encargosRecebidos)}.</>;
          })()}
        >
          {v ? (
            <div className="flex flex-col">
              <div className="hidden grid-cols-[minmax(120px,1.4fr)_1fr_1fr_90px] gap-[10px] pb-[4px] text-[10.5px] uppercase tracking-[0.1em] sm:grid" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>
                <span>Produto</span><span className="text-right">Recebido</span><span className="text-right">Teto</span><span />
              </div>
              {v.porProduto.map((p, i) => {
                const ant = anteriorMes?.porProduto.find((q) => q.chave === p.chave);
                return (
                  <div key={p.chave} className="grid grid-cols-[1fr_auto] items-center gap-x-[10px] gap-y-[2px] py-[7px] text-[12.5px] sm:grid-cols-[minmax(120px,1.4fr)_1fr_1fr_90px]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <span className="flex items-center gap-[8px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      <i className="inline-block h-[8px] w-[8px] flex-none rounded-[2px]" style={{ background: PRODUTO_SLOT_COLORS[i % PRODUTO_SLOT_COLORS.length] }} />
                      {p.rotulo}
                    </span>
                    <span className="text-right font-display font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {semCentavos(p.recebido)}
                      {ant ? <small className="block text-[10.5px] font-normal" style={{ color: 'var(--text-muted)' }}>{MESC[Number(mesAnterior(sel.anoMes).slice(5, 7)) - 1]} {semCentavos(ant.recebido)}</small> : null}
                    </span>
                    <span className="hidden text-right font-display font-semibold tabular-nums sm:block" style={{ color: 'var(--text-primary)' }}>{semCentavos(p.teto)}</span>
                    <span className="col-span-2 flex items-center gap-[6px] text-[11.5px] sm:col-span-1" style={{ color: 'var(--text-body)' }}>
                      <i className="block h-[6px] flex-1 overflow-hidden rounded-[3px]" style={{ background: 'var(--surface-muted)' }}>
                        <b className="block h-full" style={{ width: `${pct(p.recebido, p.teto)}%`, background: VISAO_ESTADO_COLORS.recebidas.fg }} />
                      </i>
                      {pct(p.recebido, p.teto)}%<span className="sm:hidden"> de {semCentavos(p.teto)}</span>
                    </span>
                  </div>
                );
              })}
              <div className="grid grid-cols-[1fr_auto] items-center gap-x-[10px] py-[7px] text-[12.5px] sm:grid-cols-[minmax(120px,1.4fr)_1fr_1fr_90px]">
                <span className="flex items-center gap-[8px]" style={{ color: 'var(--text-body)' }}>
                  <i className="inline-block h-[8px] w-[8px] flex-none rounded-[2px]" style={{ background: VIZ_NEUTRAL }} />
                  Encargos de atraso
                </span>
                <span className="text-right font-display font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{semCentavos(v.encargosRecebidos)}</span>
                <span className="hidden text-right sm:block" style={{ color: 'var(--text-muted)' }}>—</span>
                <span className="col-span-2 text-[11px] sm:col-span-1" style={{ color: 'var(--text-muted)' }}>fora do teto</span>
              </div>
            </div>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
          )}
        </Bloco>

        {/* G — O que vem aí */}
        <Bloco
          titulo="O que vem aí"
          className="col-span-12 lg:col-span-6"
          explorar={{ rotulo: 'Régua de cobrança', to: '/regua' }}
          leitura={(() => {
            if (!v) return 'Carregando…';
            if (aberto) {
              const otim = v.recebidas.valor + v.aVencer.valor;
              return <>Fecha entre <b>{compacto(v.recebidas.valor)} e {compacto(otim)}</b>. O teto só volta com os {compacto(v.vencidas.valor)} vencidos.</>;
            }
            const s = seguinte.data;
            return s ? <>{mesNome(proxMes.de.slice(0, 7)).replace(/^./, (c) => c.toUpperCase())}: <b>{compacto(s.teto.valor)} já contratados</b> para {plural(s.teto.clientes, 'cliente', 'clientes')}.</> : '—';
          })()}
        >
          <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
            <CartaoIndicador
              rotulo="Próximos 7 dias"
              tom="warn"
              valor={sete.data ? semCentavos(sete.data.aVencer.valor) : '—'}
              detalhe={sete.data ? `${plural(sete.data.aVencer.faturas, 'fatura', 'faturas')} · ${plural(sete.data.aVencer.clientes, 'cliente', 'clientes')} · ${ddmm(somarDiasISO(hoje, 1))}–${ddmm(somarDiasISO(hoje, 7))}` : undefined}
            />
            <CartaoIndicador
              rotulo={`${mesCurto(proxMes.de.slice(0, 7))} contratado`}
              tom="neutro"
              valor={seguinte.data ? semCentavos(seguinte.data.teto.valor) : '—'}
              detalhe={seguinte.data ? `${plural(seguinte.data.teto.faturas, 'fatura', 'faturas')} · ${plural(seguinte.data.teto.clientes, 'cliente', 'clientes')}` : undefined}
            />
          </div>
          {v && aberto ? (
            <div className="flex flex-col">
              {[
                ['Se tudo que falta vencer entrar', v.recebidas.valor + v.aVencer.valor],
                ['Se nada mais entrar', v.recebidas.valor],
              ].map(([k, val]) => (
                <div key={String(k)} className="grid grid-cols-[1fr_auto] items-center gap-x-[10px] py-[8px] text-[13px]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <span style={{ color: 'var(--text-body)' }}>{k}</span>
                  <span className="text-right font-display font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {semCentavos(Number(val))}
                    <small className="block text-[10.5px] font-normal uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>{pct(Number(val), v.teto.valor)}% do teto</small>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </Bloco>

        {/* E — Mês a mês */}
        <Bloco titulo="Mês a mês" className="col-span-12">
          {mensal.data ? (
            <MesAMes janela={janela} dados={mesesAnteriores} mesHoje={mesHoje} selecionado={sel.modo === 'mes' ? sel.anoMes : null} onSelecionar={(m) => { setSel({ modo: 'mes', anoMes: m }); setLista(null); }} />
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
          )}
        </Bloco>
      </div>

    </div>
  );
}

// Mês a mês: o gráfico genérico com os dados da visão mensal. Meses sem fatura
// entram zerados; futuros ficam hachurados (contratado).
function MesAMes({ janela, dados, mesHoje, selecionado, onSelecionar }: {
  janela: string[];
  dados: Map<string, VisaoMensal>;
  mesHoje: string;
  selecionado: string | null;
  onSelecionar: (anoMes: string) => void;
}) {
  const series = [
    { chave: 'recebidas', rotulo: 'Recebido', cor: VISAO_ESTADO_COLORS.recebidas.fg },
    { chave: 'vencidas', rotulo: 'Vencido', cor: VISAO_ESTADO_COLORS.vencidas.fg },
    { chave: 'a_vencer', rotulo: 'A vencer', cor: VISAO_ESTADO_COLORS.a_vencer.fg },
  ];
  const categorias: CategoriaEmpilhada[] = janela.map((m, i) => {
    const d = dados.get(m);
    const mm = Number(m.slice(5, 7));
    return {
      chave: m,
      rotulo: MESC[mm - 1],
      rotuloLinha2: mm === 1 || i === 0 ? m.slice(0, 4) : undefined,
      valores: { recebidas: d?.recebidas.valor ?? 0, vencidas: d?.vencidas.valor ?? 0, a_vencer: d?.aVencer.valor ?? 0 },
      tracejado: m > mesHoje,
      destaque: m === selecionado,
    };
  });
  const tabela = (
    <table className="w-full border-collapse text-[12px]">
      <thead>
        <tr style={{ color: 'var(--text-muted)' }}>
          {['Mês', 'Teto', 'Recebido', '%', 'Vencido', 'A vencer', 'Clientes', 'Faturas'].map((h) => (
            <th key={h} className="whitespace-nowrap px-[6px] py-[6px] text-right text-[10.5px] font-medium uppercase tracking-[0.08em] first:text-left" style={{ borderBottom: '1px solid var(--border-light)' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {janela.map((m) => {
          const d = dados.get(m);
          if (!d) return null;
          return (
            <tr key={m}>
              {[mesCurto(m), semCentavos(d.teto.valor), semCentavos(d.recebidas.valor), `${pct(d.recebidas.valor, d.teto.valor)}%`, semCentavos(d.vencidas.valor), semCentavos(d.aVencer.valor), d.teto.clientes, d.teto.faturas].map((cel, i) => (
                <td key={i} className="whitespace-nowrap px-[6px] py-[6px] text-right tabular-nums first:text-left" style={{ borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>{cel}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
  return (
    <GraficoBarrasEmpilhadas
      categorias={categorias}
      series={series}
      formatarEixo={(v) => `${Math.round(v / 100000).toLocaleString('pt-BR')} mil`}
      rotuloAcessivel="Faturamento mês a mês: teto, recebido, vencido e a vencer"
      onSelecionar={(c) => onSelecionar(c.chave)}
      tabela={tabela}
      tooltip={(c) => {
        const d = dados.get(c.chave);
        if (!d) return <b className="font-display">{mesNome(c.chave)} {c.chave.slice(0, 4)}</b>;
        const linha = (k: string, val: string) => (
          <div className="flex justify-between gap-[12px]" style={{ color: 'var(--text-body)' }}><span>{k}</span><em className="font-display font-semibold not-italic" style={{ color: 'var(--text-primary)' }}>{val}</em></div>
        );
        return (
          <div className="flex flex-col gap-[2px]">
            <b className="font-display" style={{ color: 'var(--text-primary)' }}>{mesNome(c.chave)} {c.chave.slice(0, 4)}{c.tracejado ? ' · contratado' : ''}</b>
            {linha('Teto', semCentavos(d.teto.valor))}
            {linha('Recebido', `${semCentavos(d.recebidas.valor)} · ${pct(d.recebidas.valor, d.teto.valor)}%`)}
            {linha('Vencido', semCentavos(d.vencidas.valor))}
            {linha('A vencer', semCentavos(d.aVencer.valor))}
            {linha('Clientes · faturas', `${d.teto.clientes} · ${d.teto.faturas}`)}
            {d.porProduto.some((p) => p.recebido > 0) ? <div className="my-[4px]" style={{ borderTop: '1px solid var(--border-light)' }} /> : null}
            {d.porProduto.filter((p) => p.recebido > 0).map((p, i) => (
              <div key={p.chave} className="flex items-center justify-between gap-[12px]" style={{ color: 'var(--text-body)' }}>
                <span className="inline-flex items-center gap-[6px]"><i className="inline-block h-[8px] w-[8px] rounded-[2px]" style={{ background: PRODUTO_SLOT_COLORS[i % PRODUTO_SLOT_COLORS.length] }} />{p.rotulo}</span>
                <em className="font-display font-semibold not-italic" style={{ color: 'var(--text-primary)' }}>{semCentavos(p.recebido)}</em>
              </div>
            ))}
            {d.encargosRecebidos ? (
              <div className="flex items-center justify-between gap-[12px]" style={{ color: 'var(--text-body)' }}>
                <span className="inline-flex items-center gap-[6px]"><i className="inline-block h-[8px] w-[8px] rounded-[2px]" style={{ background: VIZ_NEUTRAL }} />Encargos</span>
                <em className="font-display font-semibold not-italic" style={{ color: 'var(--text-primary)' }}>{semCentavos(d.encargosRecebidos)}</em>
              </div>
            ) : null}
          </div>
        );
      }}
    />
  );
}
