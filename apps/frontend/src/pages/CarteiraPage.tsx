import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  diasCalendarioEntre,
  formatCurrency,
  mesAnterior,
  mesSeguinte,
  periodoAnteriorMesmoTrecho,
  periodoDoMes,
  somarDiasISO,
  variacaoPct,
  type MotivoVariacaoTeto,
  type VisaoCarteira,
  type VisaoMensal,
} from '@azit/utils';
import { carteiraVisaoService, type ClienteSemFatura, type ComparacaoFoto, type EstadoVisao, type VariacaoTetoNomeada } from '../services/carteira-visao.service';
import { Bloco } from '../components/Bloco';
import { CartaoIndicador } from '../components/CartaoIndicador';
import { SeletorPeriodo, intervaloDoPeriodo, rotuloDoPeriodo, type PeriodoSelecionado } from '../components/SeletorPeriodo';
import { CarteiraNoTempo } from './carteira/CarteiraNoTempo';
import { PRODUTO_SLOT_COLORS, VISAO_ESTADO_COLORS, VIZ_NEUTRAL } from '../config/statusColors';
import { hojeBrasilISO, instanteCurtoBR } from '../lib/datas';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { ConferenciaAsaasModal } from './CarteiraConferenciaAsaas';
import { LinkArea } from '../components/LinkArea';
import { AREAS_ROTA_FICHA_TITULAR } from '../lib/permissoes';

// Carteira (doc 02 §27, 30/10/2026): teto, vencidas e a vencer por VENCIMENTO;
// Recebido é CAIXA — tudo que entrou no período pela data do pagamento (faturas
// de qualquer vencimento + entradas). Cartões abrem a lista de clientes;
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
  // Conferência Asaas × sistema (doc 02 §27.9): aberta pela lista de vencidas,
  // sobre o mesmo recorte dela — vencimento no período e já vencido (até ontem).
  const [conferindo, setConferindo] = useState(false);
  // O aviso da conferência automática (doc 02 §27.9.1) abre a Carteira com a
  // conferência aberta: /carteira?conferencia=asaas. O parâmetro sai ao fechar.
  const [params, setParams] = useSearchParams();
  const pediuConferencia = params.get('conferencia') === 'asaas';
  useEffect(() => {
    if (!pediuConferencia) return;
    setLista('vencidas');
    setConferindo(true);
  }, [pediuConferencia]);
  const fecharConferencia = () => {
    setConferindo(false);
    if (pediuConferencia) {
      const p = new URLSearchParams(params);
      p.delete('conferencia');
      setParams(p, { replace: true });
    }
  };

  const periodo = intervaloDoPeriodo(sel, hoje);
  const rotulo = rotuloDoPeriodo(sel, hoje);
  const aberto = periodo.ate >= hoje && periodo.de <= hoje;
  const futuro = periodo.de > hoje;

  // A carteira no tempo (doc 02 §27.11): da primeira à última fatura. Alimenta o
  // gráfico, o limite das setas do período e a comparação com o mês anterior.
  const limites = useQuery({ queryKey: ['carteira-visao-limites'], queryFn: () => carteiraVisaoService.limites(), staleTime: 5 * 60_000 });
  const primeiroMes = limites.data?.primeiroMes ?? mesHoje;
  const ultimoMes = limites.data?.ultimoMes ?? mesHoje;

  const visao = useQuery({ queryKey: ['carteira-visao', periodo.de, periodo.ate], queryFn: () => carteiraVisaoService.periodo(periodo.de, periodo.ate) });
  const trecho = useMemo(() => periodoAnteriorMesmoTrecho(periodo, hoje, sel.modo === 'mes' ? sel.anoMes : undefined), [periodo.de, periodo.ate, hoje, sel.modo, sel.anoMes]);
  const atual = useQuery({ queryKey: ['carteira-visao', trecho?.atual.de, trecho?.atual.ate], queryFn: () => carteiraVisaoService.periodo(trecho!.atual.de, trecho!.atual.ate), enabled: !!trecho });
  const anterior = useQuery({ queryKey: ['carteira-visao', trecho?.anterior.de, trecho?.anterior.ate], queryFn: () => carteiraVisaoService.periodo(trecho!.anterior.de, trecho!.anterior.ate), enabled: !!trecho });
  const mensal = useQuery({ queryKey: ['carteira-visao-mensal', primeiroMes, ultimoMes], queryFn: () => carteiraVisaoService.mensal(primeiroMes, ultimoMes), enabled: !!limites.data, staleTime: 60_000 });
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
    const r = x.recebido;
    const origem = [
      r.faturasDoPeriodo ? `${compacto(r.faturasDoPeriodo)} das faturas do período (${pct(x.pagas.valor, t)}% do teto)` : null,
      r.faturasDeOutrosPeriodos ? `${compacto(r.faturasDeOutrosPeriodos)} de outros vencimentos` : null,
      r.entradas ? `${compacto(r.entradas)} de entradas` : null,
      r.saldosRescisao ? `${compacto(r.saldosRescisao)} de saldos de rescisão` : null,
    ].filter(Boolean).join(', ');
    if (!aberto) return <><b>{compacto(r.valor)} entraram</b>{origem ? `: ${origem}` : ''}. {compacto(x.vencidas.valor)} ficaram vencidos com {plural(x.vencidas.clientes, 'cliente', 'clientes')}.</>;
    const proj = x.pagas.valor + x.aVencer.valor;
    return <><b>{compacto(r.valor)} entraram</b>{origem ? `: ${origem}` : ''}. Se tudo que falta vencer entrar, as faturas do período fecham em {compacto(proj)} ({pct(proj, t)}% do teto). Faltam os {compacto(x.vencidas.valor)} vencidos de {plural(x.vencidas.clientes, 'cliente', 'clientes')}.</>;
  };


  return (
    <div className="flex flex-col gap-[14px]">
      <SeletorPeriodo valor={sel} onChange={(s) => { setSel(s); setLista(null); }} hoje={hoje} mesMin={limites.data?.primeiroMes ?? undefined} mesMax={limites.data?.ultimoMes ?? undefined} />

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
                {plural(v.teto.faturas, 'fatura', 'faturas')} · {plural(v.teto.clientes, 'cliente', 'clientes')} com fatura no período · {plural(v.ativos.clientes, 'cliente ativo', 'clientes ativos')}
              </div>
              <AtivosSemFatura lista={v.ativos.semFatura} />
              <div className="flex h-[12px] gap-[2px] overflow-hidden rounded-[6px]" style={{ background: 'var(--surface-muted)' }} aria-hidden>
                {/* A barra é o progresso do TETO (por vencimento): faturas do período pagas / vencidas / a vencer. */}
                {(['recebidas', 'vencidas', 'a_vencer'] as const).map((e) => {
                  const val = e === 'a_vencer' ? v.aVencer.valor : e === 'recebidas' ? v.pagas.valor : v.vencidas.valor;
                  return val > 0 && v.teto.valor > 0 ? <span key={e} style={{ width: `${(100 * val) / v.teto.valor}%`, background: VISAO_ESTADO_COLORS[e].fg }} /> : null;
                })}
              </div>
              <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-3">
                {/* Recebido = CAIXA do período (qualquer vencimento + entradas); vencidas e a vencer = por vencimento. */}
                <CartaoIndicador
                  rotulo={VISAO_ESTADO_COLORS.recebidas.rotulo}
                  valor={formatCurrency(v.recebido.valor)}
                  detalhe={`${plural(v.recebido.clientes, 'cliente', 'clientes')} · ${plural(v.recebido.recebimentos, 'recebimento', 'recebimentos')} · faturas do período ${pct(v.pagas.valor, v.teto.valor)}%`}
                  tom="good"
                  ativo={lista === 'recebidas'}
                  onClick={() => abrirLista('recebidas')}
                />
                {(['vencidas', 'a_vencer'] as const).map((e) => {
                  const r = e === 'a_vencer' ? v.aVencer : v.vencidas;
                  return (
                    <CartaoIndicador
                      key={e}
                      rotulo={VISAO_ESTADO_COLORS[e].rotulo}
                      valor={formatCurrency(r.valor)}
                      detalhe={`${pct(r.valor, v.teto.valor)}% do teto · ${plural(r.clientes, 'cliente', 'clientes')} · ${plural(r.faturas, 'fatura', 'faturas')}`}
                      tom={e === 'vencidas' ? 'bad' : 'warn'}
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
                    <span className="flex flex-wrap items-center gap-[14px]">
                      {lista === 'vencidas' ? (
                        <button type="button" onClick={() => setConferindo(true)} className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
                          Conferir com o Asaas
                        </button>
                      ) : null}
                      <button type="button" onClick={() => abrirNaCarteira(lista === 'vencidas' ? 'em_atraso' : lista === 'recebidas' ? 'em_dia' : '')} className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
                        Abrir na Carteira →
                      </button>
                    </span>
                  </div>
                  {lista === 'vencidas' ? (
                    <ConferenciaAsaasModal
                      open={conferindo}
                      onClose={fecharConferencia}
                      de={periodo.de}
                      ate={periodo.ate < hoje ? periodo.ate : somarDiasISO(hoje, -1)}
                      rotulo={rotulo}
                    />
                  ) : null}
                  {(listaToda ? clientes.data ?? [] : (clientes.data ?? []).slice(0, 8)).map((c) => {
                    const dias = Math.max(0, diasCalendarioEntre(c.maisAntiga, hoje));
                    const tomDias = dias >= 30 ? 'bad' : dias >= 3 ? 'warn' : 'neutro';
                    return (
                      <div key={c.contaId} className="grid grid-cols-[1fr_auto] items-center gap-x-[12px] py-[8px] text-[12.5px]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <div className="min-w-0">
                          <LinkArea area={AREAS_ROTA_FICHA_TITULAR} to={`/titulares/${c.titularId}`} className="block truncate font-semibold" style={{ color: 'var(--text-primary)' }}>{c.titular}</LinkArea>
                          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {lista === 'recebidas'
                              ? `${plural(c.faturas, 'recebimento', 'recebimentos')} · último pagamento ${ddmm(c.ultimoPagamento ?? c.maisAntiga)}`
                              : `${plural(c.faturas, 'fatura', 'faturas')} · ${lista === 'vencidas' ? 'mais antiga' : 'vencimento'} ${ddmm(c.maisAntiga)}`}
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
            const dr = variacaoPct(a.recebido.valor, b.recebido.valor), dt = variacaoPct(a.teto.valor, b.teto.valor);
            const sinal = (d: number | null) => (d === null ? '—' : `${d >= 0 ? '+' : ''}${d}%`);
            return <>Recebido <b>{sinal(dr)}</b> com teto {sinal(dt)}.</>;
          })()}
        >
          {!trecho ? (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>nada venceu ainda</div>
          ) : atual.data && anterior.data ? (
            <div className="flex flex-col">
              {([
                // Só teto e recebido (Luís, 12/11): vencido saiu da comparação — o trecho
                // anterior sempre teve mais tempo de cobrança, a leitura não compara.
                ['Teto', atual.data.teto.valor, anterior.data.teto.valor],
                ['Recebido', atual.data.recebido.valor, anterior.data.recebido.valor],
              ] as [string, number, number][]).map(([k, a, b]) => {
                const d = variacaoPct(a, b);
                const tom = d === null || d === 0 ? 'flat' : d > 0 ? 'up' : 'down';
                const cor = tom === 'up' ? VISAO_ESTADO_COLORS.recebidas : tom === 'down' ? VISAO_ESTADO_COLORS.vencidas : null;
                return (
                  <div key={k} className="grid grid-cols-[1fr_1fr_auto] items-center gap-x-[10px] gap-y-[2px] py-[8px] text-[13px] sm:grid-cols-[1.1fr_1fr_1fr_auto]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <span className="col-span-3 sm:col-span-1" style={{ color: 'var(--text-body)' }}>{k}</span>
                    <span className="font-display font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{semCentavos(a)}<small className="block text-[10.5px] font-normal uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>agora</small></span>
                    <span className="font-display font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{semCentavos(b)}<small className="block text-[10.5px] font-normal uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>antes</small></span>
                    <span
                      className="justify-self-end whitespace-nowrap rounded-full px-[8px] py-[2px] text-[12px] font-semibold"
                      style={cor ? { background: cor.soft, color: cor.fg } : { background: 'var(--surface-muted)', color: 'var(--text-body)' }}
                    >
                      {d === null ? '—' : `${d > 0 ? '↑' : d < 0 ? '↓' : '='} ${Math.abs(d)}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
          )}
          {/* Foto do início do mês (doc 02 §27.12): só no período "Mês". */}
          {sel.modo === 'mes' ? <FotoDoMes mes={sel.anoMes} agora={v} /> : null}
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
                    <span className="hidden text-right font-display font-semibold tabular-nums sm:block" style={{ color: p.teto ? 'var(--text-primary)' : 'var(--text-muted)' }}>{p.teto ? semCentavos(p.teto) : '—'}</span>
                    {/* Barra = faturas do período pagas / teto (progresso do mês); o Recebido ao lado é caixa. */}
                    {p.teto ? (
                      <span className="col-span-2 flex items-center gap-[6px] text-[11.5px] sm:col-span-1" style={{ color: 'var(--text-body)' }}>
                        <i className="block h-[6px] flex-1 overflow-hidden rounded-[3px]" style={{ background: 'var(--surface-muted)' }}>
                          <b className="block h-full" style={{ width: `${Math.min(100, pct(p.pagoDoPeriodo, p.teto))}%`, background: VISAO_ESTADO_COLORS.recebidas.fg }} />
                        </i>
                        {pct(p.pagoDoPeriodo, p.teto)}%<span className="sm:hidden"> de {semCentavos(p.teto)}</span>
                      </span>
                    ) : (
                      <span className="col-span-2 text-[11px] sm:col-span-1" style={{ color: 'var(--text-muted)' }}>sem teto</span>
                    )}
                    {/* Composição (decisão Luís 31/10): acordo, entradas, intermediárias e
                        avulsos NÃO são produto — o valor já está na linha; aqui só a visão. */}
                    {p.composicao.length > 1 && (
                      <div className="col-span-2 flex flex-wrap gap-x-[10px] gap-y-[2px] text-[11px] sm:col-span-4" style={{ color: 'var(--text-muted)' }}>
                        <span>{p.recebido ? 'inclui' : 'teto inclui'}</span>
                        {p.composicao.map((c) => (
                          <span key={c.parte}>{c.rotulo.toLowerCase()} <b className="font-display font-semibold tabular-nums" style={{ color: 'var(--text-body)' }}>{semCentavos(p.recebido ? c.recebido : c.teto)}</b></span>
                        ))}
                      </div>
                    )}
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
              const otim = v.pagas.valor + v.aVencer.valor;
              return <>As faturas do período fecham entre <b>{compacto(v.pagas.valor)} e {compacto(otim)}</b>. O teto só volta com os {compacto(v.vencidas.valor)} vencidos.</>;
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
                ['Se tudo que falta vencer entrar', v.pagas.valor + v.aVencer.valor],
                ['Se nada mais entrar', v.pagas.valor],
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
            <>
              <CarteiraNoTempo serie={mesesAnteriores} primeiroMes={primeiroMes} ultimoMes={ultimoMes} mesHoje={mesHoje} selecionado={sel.modo === 'mes' ? sel.anoMes : null} onSelecionar={(m) => { setSel({ modo: 'mes', anoMes: m }); setLista(null); }} />
              {/* Por que o teto muda de um mês para o outro (doc 02 §27.10): os dois meses depois do selecionado. */}
              <div className="text-[10.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>Por que o teto muda de um mês para o outro</div>
              <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-2">
                <VariacaoEntreMeses de={sel.anoMes} para={mesSeguinte(sel.anoMes)} />
                <VariacaoEntreMeses de={mesSeguinte(sel.anoMes)} para={mesSeguinte(mesSeguinte(sel.anoMes))} />
              </div>
            </>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
          )}
        </Bloco>
      </div>

    </div>
  );
}

// Clientes ATIVOS sem fatura no período (doc 02 §27.10): o número de clientes do
// teto é "quem tem fatura vencendo aqui", não "quem está ativo" — a tela diz quem
// falta e quando vem a próxima fatura, para a diferença nunca parecer um furo.
function AtivosSemFatura({ lista }: { lista: ClienteSemFatura[] }) {
  const [todos, setTodos] = useState(false);
  if (lista.length === 0) return null;
  const mostrados = todos ? lista : lista.slice(0, 3);
  return (
    <div className="text-[12px] leading-[1.5]" style={{ color: 'var(--text-body)' }}>
      {plural(lista.length, 'cliente ativo não tem', 'clientes ativos não têm')} fatura neste período:{' '}
      {mostrados.map((c, i) => (
        <span key={c.contaId}>
          {i > 0 ? '; ' : ''}
          <LinkArea area={AREAS_ROTA_FICHA_TITULAR} to={`/titulares/${c.titularId}`} className="font-semibold" style={{ color: 'var(--text-primary)' }}>{c.titular}</LinkArea>
          {c.proximaFatura ? ` (próxima fatura em ${ddmm(c.proximaFatura)})` : ' (sem fatura à frente)'}
        </span>
      ))}
      {lista.length > 3 ? (
        <button type="button" onClick={() => setTodos((t) => !t)} className="ml-[6px] font-semibold" style={{ color: 'var(--accent)' }}>
          {todos ? 'ver menos' : `ver todos (${lista.length})`}
        </button>
      ) : null}
    </div>
  );
}

// Por que o teto muda de um mês para o outro (doc 02 §27.10). Os números vêm de
// `explicarVariacaoTeto` pela API — aqui só o texto de cada motivo. Quem sobe e
// quem desce ficam em linhas separadas; a soma das linhas é a diferença do teto.
// Com centavos: as linhas precisam somar exatamente a diferença que o título mostra.
const sinal = (c: number) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatCurrency(Math.abs(c))}`;
function rotuloVariacao(g: VariacaoTetoNomeada['grupos'][number], de: string, para: string): { titulo: string; nota: string } {
  const quem = plural(g.clientes, 'cliente', 'clientes');
  const mais = g.sentido === 'mais';
  const porMotivo: Record<MotivoVariacaoTeto, { titulo: string; nota: string }> = {
    calendario: {
      titulo: `${quem} com ${mais ? 'mais' : 'menos'} vencimentos no mês`,
      nota: `calendário: o dia de vencimento cai ${mais ? 'mais' : 'menos'} vezes em ${mesNome(para)} · ${plural(Math.abs(g.faturas), 'fatura', 'faturas')}`,
    },
    entrou: { titulo: `${quem} sem fatura em ${mesNome(de)}`, nota: `passa${g.clientes === 1 ? '' : 'm'} a ter fatura em ${mesNome(para)}` },
    saiu: { titulo: `${quem} sem fatura em ${mesNome(para)}`, nota: `tinha${g.clientes === 1 ? '' : 'm'} fatura em ${mesNome(de)}` },
    faturas: {
      titulo: `${quem} com fatura ${mais ? 'a mais' : 'a menos'}, fora do calendário`,
      nota: mais ? 'algo com fatura própria começa (ex.: reembolso parcelado)' : 'algo com fatura própria termina (ex.: reembolso parcelado)',
    },
    valor: {
      titulo: `${quem} com fatura de valor ${mais ? 'maior' : 'menor'}`,
      nota: mais ? 'item que começa a ser cobrado na fatura' : 'item que deixa de ser cobrado na fatura',
    },
  };
  return porMotivo[g.motivo];
}

function VariacaoEntreMeses({ de, para }: { de: string; para: string }) {
  const q = useQuery({ queryKey: ['carteira-variacao', de, para], queryFn: () => carteiraVisaoService.variacao(de, para) });
  const [aberto, setAberto] = useState<string | null>(null);
  const r = q.data;
  return (
    <div className="flex flex-col gap-[4px] rounded-[12px] p-[14px]" style={{ background: 'var(--surface-muted)' }}>
      <div className="text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        {mesCurto(para)} × {mesCurto(de)}
      </div>
      {!r ? (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{q.isError ? 'Não foi possível carregar.' : 'Carregando…'}</div>
      ) : (
        <>
          <div className="text-[12.5px]" style={{ color: 'var(--text-body)' }}>
            Teto de {formatCurrency(r.tetoPara)}, contra {formatCurrency(r.tetoDe)} em {mesNome(de)}:{' '}
            <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{r.diferenca === 0 ? 'igual' : sinal(r.diferenca)}</b>.
            {r.grupos.length === 0 ? ' Mesmos clientes, mesmas faturas.' : ''}
          </div>
          {r.grupos.map((g) => {
            const chave = `${g.motivo}:${g.sentido}`;
            const t = rotuloVariacao(g, de, para);
            return (
              <div key={chave} className="py-[7px]" style={{ borderTop: '1px solid var(--border-light)' }}>
                <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-[10px] text-[12.5px]">
                  <div className="min-w-0">
                    <span style={{ color: 'var(--text-primary)' }}>{t.titulo}</span>
                    <button type="button" onClick={() => setAberto((a) => (a === chave ? null : chave))} className="ml-[8px] text-[11.5px] font-semibold" style={{ color: 'var(--accent)' }} aria-expanded={aberto === chave}>
                      {aberto === chave ? 'ocultar' : 'ver quem'}
                    </button>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t.nota}</div>
                  </div>
                  <span className="whitespace-nowrap font-display font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{sinal(g.valor)}</span>
                </div>
                {aberto === chave ? (
                  <div className="mt-[4px] flex flex-col">
                    {g.contas.map((c) => (
                      <div key={c.contaId} className="grid grid-cols-[1fr_auto] gap-x-[10px] py-[3px] text-[12px]">
                        <LinkArea area={AREAS_ROTA_FICHA_TITULAR} to={`/titulares/${c.titularId}`} className="truncate" style={{ color: 'var(--text-body)' }}>{c.titular}</LinkArea>
                        <span className="whitespace-nowrap tabular-nums" style={{ color: 'var(--text-body)' }}>{sinal(c.valor)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ---------- Foto do início do mês (doc 02 §27.12, decisão Luís 27/11) ----------
// Teto no início × agora, por produto, e a ponte do que mudou — a conta é a
// função única `explicarMudancaDesdeFoto` (backend); aqui só exibe.
type GrupoFoto = NonNullable<ComparacaoFoto['foto']>['ponte']['grupos'][number];

function rotuloFoto(g: GrupoFoto): { titulo: string; nota: string } {
  const mais = g.sentido === 'mais';
  const quem = `${g.clientes} cliente${g.clientes === 1 ? '' : 's'}`;
  const fat = g.faturas ? ` · ${Math.abs(g.faturas)} fatura${Math.abs(g.faturas) === 1 ? '' : 's'}` : '';
  const porMotivo: Record<GrupoFoto['motivo'], { titulo: string; nota: string }> = {
    contrato_novo: { titulo: 'Contratos novos', nota: 'faturas de contrato que começou depois da foto' },
    novacao: mais
      ? { titulo: 'Entrou pela novação', nota: 'faturas do contrato nascido da novação' }
      : { titulo: 'Saiu na novação', nota: 'faturas da foto trocadas pela novação' },
    acordo: mais
      ? { titulo: 'Parcelas de acordo', nota: 'parcelas de acordo que passaram a vencer no mês' }
      : { titulo: 'Saiu para acordo', nota: 'faturas da foto cobertas por acordo' },
    rescisao: { titulo: 'Saiu na rescisão', nota: 'faturas extintas pela rescisão' },
    data: mais
      ? { titulo: 'Mudou de data: entrou no mês', nota: 'fatura que vencia em outro mês' }
      : { titulo: 'Mudou de data: saiu do mês', nota: 'o vencimento foi para outro mês' },
    removida: { titulo: 'Fatura removida', nota: 'fatura da foto que não existe mais' },
    valor: mais
      ? { titulo: 'Valor maior na mesma fatura', nota: 'item que começou a ser cobrado' }
      : { titulo: 'Valor menor na mesma fatura', nota: 'item que deixou de ser cobrado' },
  };
  const r = porMotivo[g.motivo];
  return { titulo: r.titulo, nota: `${quem}${fat} · ${r.nota}` };
}

function FotoDoMes({ mes, agora }: { mes: string; agora: VisaoCarteira | undefined }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['carteira-foto', mes], queryFn: () => carteiraVisaoService.foto(mes) });
  const [aberto, setAberto] = useState<string | null>(null);
  const [tirando, setTirando] = useState(false);
  const foto = q.data?.foto ?? null;
  const mesHoje = hojeBrasilISO().slice(0, 7);

  async function tirarTeste() {
    setTirando(true);
    try {
      await carteiraVisaoService.tirarFotoTeste();
      await qc.invalidateQueries({ queryKey: ['carteira-foto'] });
    } finally {
      setTirando(false);
    }
  }

  const produtosAgora = new Map((agora?.porProduto ?? []).map((p) => [p.chave, p]));
  const produtos = foto
    ? [...new Set([...foto.inicio.porProduto.map((p) => p.chave), ...(agora?.porProduto ?? []).filter((p) => p.teto).map((p) => p.chave)])].map((chave) => {
        const ini = foto.inicio.porProduto.find((p) => p.chave === chave);
        const ag = produtosAgora.get(chave);
        return { chave, rotulo: ini?.rotulo ?? ag?.rotulo ?? chave, inicio: ini?.teto ?? 0, agora: ag?.teto ?? 0 };
      })
    : [];

  return (
    <div className="mt-[12px] flex flex-col gap-[4px] pt-[12px]" style={{ borderTop: '1px solid var(--border-light)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-[8px]">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>No início do mês</span>
        {foto ? <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>foto de {instanteCurtoBR(foto.tiradaEm)}</span> : null}
      </div>
      {q.isLoading ? (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
      ) : q.isError ? (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Não foi possível carregar a foto.</div>
      ) : !foto ? (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {mes > mesHoje
            ? `A foto de ${mesNome(mes)} é tirada em 01/${mes.slice(5, 7)} à 0h.`
            : `Sem foto do início de ${mesNome(mes)}. A foto é tirada no dia 1 de cada mês à 0h; a primeira é a de dezembro/2026.`}
        </div>
      ) : (
        <>
          <div className="text-[12.5px]" style={{ color: 'var(--text-body)' }}>
            Teto de <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(foto.ponte.tetoFoto)}</b> no início ({foto.inicio.teto.faturas} faturas · {foto.inicio.teto.clientes} clientes); agora {formatCurrency(foto.ponte.tetoAgora)}:{' '}
            <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{foto.ponte.diferenca === 0 ? 'igual' : sinal(foto.ponte.diferenca)}</b>.
            {foto.ponte.grupos.length === 0 ? ' Nada mudou desde a foto.' : ''}
          </div>
          {foto.ponte.grupos.map((g) => {
            const chave = `${g.motivo}:${g.sentido}`;
            const t = rotuloFoto(g);
            return (
              <div key={chave} className="py-[7px]" style={{ borderTop: '1px solid var(--border-light)' }}>
                <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-[10px] text-[12.5px]">
                  <div className="min-w-0">
                    <span style={{ color: 'var(--text-primary)' }}>{t.titulo}</span>
                    <button type="button" onClick={() => setAberto((a) => (a === chave ? null : chave))} className="ml-[8px] text-[11.5px] font-semibold" style={{ color: 'var(--accent)' }} aria-expanded={aberto === chave}>
                      {aberto === chave ? 'ocultar' : 'ver quem'}
                    </button>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t.nota}</div>
                  </div>
                  <span className="whitespace-nowrap font-display font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{sinal(g.valor)}</span>
                </div>
                {aberto === chave ? (
                  <div className="mt-[4px] flex flex-col">
                    {g.contas.map((c) => (
                      <div key={c.contaId} className="grid grid-cols-[1fr_auto] gap-x-[10px] py-[3px] text-[12px]">
                        {c.titularId ? (
                          <LinkArea area={AREAS_ROTA_FICHA_TITULAR} to={`/titulares/${c.titularId}`} className="truncate" style={{ color: 'var(--text-body)' }}>{c.titular}</LinkArea>
                        ) : (
                          <span className="truncate" style={{ color: 'var(--text-body)' }}>{c.titular}</span>
                        )}
                        <span className="whitespace-nowrap tabular-nums" style={{ color: 'var(--text-body)' }}>{sinal(c.valor)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
          {produtos.length ? (
            <div className="mt-[6px] flex flex-col">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-[12px] pb-[3px] text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>
                <span>Por produto</span><span className="text-right">início</span><span className="text-right">agora</span>
              </div>
              {produtos.map((p) => (
                <div key={p.chave} className="grid grid-cols-[1fr_auto_auto] gap-x-[12px] py-[3px] text-[12px]" style={{ borderTop: '1px solid var(--border-light)' }}>
                  <span className="truncate" style={{ color: 'var(--text-body)' }}>{p.rotulo}</span>
                  <span className="text-right tabular-nums" style={{ color: 'var(--text-body)' }}>{semCentavos(p.inicio)}</span>
                  <span className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{semCentavos(p.agora)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
      {FERRAMENTAS_TESTE && mes === mesHoje ? (
        <button type="button" disabled={tirando} onClick={() => void tirarTeste()} className="mt-[6px] self-start rounded-full border px-[10px] py-[3px] text-[11.5px] font-semibold" style={{ color: 'var(--text-body)', borderColor: 'var(--border)' }}>
          {tirando ? 'Tirando a foto…' : foto ? 'Refazer a foto agora (teste)' : 'Tirar foto agora (teste)'}
        </button>
      ) : null}
    </div>
  );
}
