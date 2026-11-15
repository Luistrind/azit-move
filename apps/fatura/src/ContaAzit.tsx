import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContaFaturaPublica, FaturaContaPublica, FaturaPublica, PixSobDemandaPublico } from '@azit/types';
import { formatCurrency, isoParaBR, minimoParcialFatura, projetarConta, regraParcial, type ContaProjetada, type FaturaProjetada, type RegraParcial } from '@azit/utils';
import { ErroFatura, faturaApi } from './api';
import { diaSemana, linkWhatsapp, Marca, QrPix } from './comum';

// Fatura Azit — conta do modelo AZIT (doc 02 §32.2, §32.4-A, §32.6, §32.6-A;
// protótipo v3 aprovado em 14/11). Ordem: cabeçalho → PAGAR ("Copiar código
// Pix" como ação principal, QR recolhido) → valores já recebidos → itens.
// Com mais de uma fatura em aberto o link abre na lista "Suas faturas".
//
// A página REFAZ a conta com o motor de @azit/utils sobre o que o servidor
// mandou (itens + pagamentos registrados) — a mesma função que o servidor usa
// para validar o Pix.
//
// PIX PRONTO ANTES DO TOQUE (ajuste Luís 15/11): a página pede o Pix da opção
// selecionada assim que carrega, e de novo quando o cliente troca a opção ou
// confirma outro valor — o toque em "Copiar código Pix" só copia. Pedir de novo
// o mesmo valor no dia devolve o mesmo Pix (reuso no servidor), então reabrir a
// página não cria cobrança nova. Gerar outro valor NÃO cancela os anteriores
// (regra Luís 15/11): a página guarda um código por valor e, se o cliente volta
// a uma opção que já tinha gerado, o código aparece na hora, sem pedir de novo. A cópia acontece DENTRO do toque: depois de
// esperar a rede o Safari do iPhone recusa, então se o código ainda não chegou
// a página mostra o código com "Toque para copiar" em vez de copiar atrasado.

const brl = formatCurrency;
const dataBr = isoParaBR;
const dataCurta = (iso: string) => isoParaBR(iso).slice(0, 5);
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);
const pct = (n: number) => String(n).replace('.', ',');
const STATUS_TXT: Record<FaturaProjetada['situacao'], string> = { aberta: 'Em aberto', hoje: 'Vence hoje', vencida: 'Vencida', parcial: 'Paga parcialmente', paga: 'Paga' };

type Vista = { tipo: 'lista' } | { tipo: 'fatura'; id: string };

function vistaInicial(k: ContaProjetada, conta: ContaFaturaPublica): Vista {
  if (k.abertas.length > 1) return { tipo: 'lista' };
  if (k.abertas.length === 1) return { tipo: 'fatura', id: k.abertas[0].id };
  return k.faturas.some((x) => x.id === conta.faturaDoLink) ? { tipo: 'fatura', id: conta.faturaDoLink } : { tipo: 'lista' };
}

// Espera (ms) entre o cliente trocar de opção e a página pedir o Pix novo: quem
// passa pelas opções sem parar não gera um Pix por toque.
const ESPERA_TROCA_MS = 450;

export function ContaAzit({ f, token, avisar }: { f: FaturaPublica; token: string; avisar: (m: string) => void }) {
  const conta = f.conta!;
  const { parametros } = conta.motor;
  const k = useMemo(() => projetarConta(conta.motor.faturas, conta.hoje, [], parametros.cascata), [conta, parametros]);
  // Conta mista (§32.4-A, provisório): só a fatura AZIT mais antiga, sozinha.
  const regra: RegraParcial | null = conta.mista ? null : regraParcial(k, parametros);
  const podeOutroValor = !!regra && regra.tipo !== 'sem-parcial';
  const n = k.abertas.length;

  const [vista, setVista] = useState<Vista>(() => vistaInicial(k, conta));
  const [selecao, setSelecao] = useState<number | null>(null);
  const [valorEscolhido, setValorEscolhido] = useState<number | null>(null);
  // Pix ativos de hoje, UM POR VALOR: os que o servidor já tinha + os gerados nesta visita.
  const [pixPorValor, setPixPorValor] = useState<Record<number, PixSobDemandaPublico>>(() => Object.fromEntries(conta.pixAtivos.map((p) => [p.valor, p])));
  const [pixFalhou, setPixFalhou] = useState(false);
  const [gerando, setGerando] = useState(false);
  // O cliente tocou em "Copiar" antes de o código chegar: o botão vira
  // "Gerando…" e, quando chega, o código aparece com "Toque para copiar".
  const [pediuCopia, setPediuCopia] = useState(false);
  const pediuCopiaRef = useRef(false);
  const marcarPediuCopia = (v: boolean) => {
    pediuCopiaRef.current = v;
    setPediuCopia(v);
  };
  // Último valor para o qual a página JÁ pediu o Pix sozinha (uma vez por valor:
  // se o servidor recusar, não fica insistindo) e se já houve a 1ª pré-geração.
  const autoPara = useRef<number | null>(null);
  const jaPreGerou = useRef(false);
  const [modal, setModal] = useState(false);
  const [qrAberto, setQrAberto] = useState(false);
  const meta = (id: string): FaturaContaPublica => conta.faturas.find((x) => x.id === id)!;

  // Pagamento entrou (a página recarregou sozinha): diz o que aconteceu em
  // linguagem do cliente e leva para onde faz sentido (§32.6-A).
  const anterior = useRef(k);
  useEffect(() => {
    const antes = anterior.current;
    anterior.current = k;
    if (antes === k) return;
    // A página recarregou (pagamento ou virada do dia): valem os Pix que o
    // servidor diz estarem ativos — depois de um pagamento, os outros são cancelados.
    setPixPorValor(Object.fromEntries(conta.pixAtivos.map((p) => [p.valor, p])));
    const pago = (p: ContaProjetada) => p.faturas.reduce((s, x) => s + x.pagoTotal, 0);
    const recebido = pago(k) - pago(antes);
    if (recebido <= 0) return;
    const quitadas = antes.abertas.filter((a) => k.faturas.find((x) => x.id === a.id)?.situacao === 'paga');
    const proxima = k.abertas[0];
    let msg = `Recebemos ${brl(recebido)}.`;
    if (quitadas.length) msg += quitadas.length === 1 ? ` Fatura de ${dataCurta(quitadas[0].vencimento)} quitada.` : ` ${quitadas.length} faturas quitadas.`;
    if (proxima && proxima.pagamentos.length) msg += ` Faltam ${brl(proxima.totalHoje)} da fatura de ${dataCurta(proxima.vencimento)}.`;
    if (!proxima) msg += ' Tudo em dia!';
    setSelecao(null);
    setValorEscolhido(null);
    setPixFalhou(false);
    setQrAberto(false);
    marcarPediuCopia(false);
    autoPara.current = null;
    setVista(vistaInicial(k, conta));
    avisar(msg);
  }, [k, conta, avisar]);

  // Fatura que a vista aponta pode ter saído da conta (paga há mais de alguns dias).
  const faturaDaVista = vista.tipo === 'fatura' ? k.faturas.find((x) => x.id === vista.id) : undefined;
  const vistaEfetiva: Vista = vista.tipo === 'fatura' && !faturaDaVista ? vistaInicial(k, conta) : vista;
  const fat = vistaEfetiva.tipo === 'fatura' ? k.faturas.find((x) => x.id === vistaEfetiva.id) : undefined;
  const idx = fat ? k.abertas.findIndex((x) => x.id === fat.id) : -1;

  // Quantas faturas (da mais antiga até…) o Pix cobre e de quanto é.
  const maxSel = Math.max(1, n);
  const kSel = conta.mista ? 1 : Math.min(Math.max(1, selecao ?? (fat ? (idx <= 0 ? 1 : idx + 1) : k.selecaoPadrao)), maxSel);
  const valor = n === 0 || (fat && fat.situacao === 'paga') ? null : (valorEscolhido ?? k.acumulado[kSel - 1]);
  const pixDoValor = valor !== null ? (pixPorValor[valor] ?? null) : null;
  // Mudou o valor a pagar: o QR recolhe e o pedido de cópia pendente deixa de valer.
  useEffect(() => {
    setQrAberto(false);
    marcarPediuCopia(false);
  }, [valor]);

  // `silencioso` = pré-geração: a página pediu sozinha, o cliente não tocou em nada.
  async function gerarPix(v: number, silencioso = false): Promise<PixSobDemandaPublico | null> {
    setGerando(true);
    setPixFalhou(false);
    try {
      const p = await faturaApi.criarIntencao(token, v);
      setPixPorValor((m) => ({ ...m, [p.valor]: p }));
      // O cliente tocou em Copiar enquanto o código vinha: NÃO copia agora (fora
      // do toque o iPhone recusa) — o código aparece com "Toque para copiar".
      if (pediuCopiaRef.current) avisar(`Pix de ${brl(p.valor)} pronto. Toque no código para copiar.`);
      return p;
    } catch (e) {
      const err = e instanceof ErroFatura ? e : new ErroFatura(0, 'Sem conexão.');
      const explicado = err.codigo === 'valor_invalido' || err.codigo === 'limite_pix_dia' || err.status === 429;
      // Valor recusado ou teto do dia: a API explica (na pré-geração, só se o
      // cliente já tocou em Copiar); o resto é falha ao gerar — tela de erro.
      if (explicado) {
        if (!silencioso || pediuCopiaRef.current) avisar(err.message);
      } else setPixFalhou(true);
      marcarPediuCopia(false);
      return null;
    } finally {
      setGerando(false);
    }
  }

  // PRÉ-GERAÇÃO: assim que a página carrega (e a cada troca de opção ou de
  // valor), pede o Pix do valor selecionado — sem esperar o toque em Copiar.
  // Um pedido por vez (o seguinte só sai quando o anterior volta, senão o Pix
  // de um valor antigo poderia substituir o do valor atual no servidor).
  useEffect(() => {
    if (valor === null || pixDoValor || gerando || pixFalhou || autoPara.current === valor) return;
    const espera = jaPreGerou.current ? ESPERA_TROCA_MS : 0;
    const t = window.setTimeout(() => {
      jaPreGerou.current = true;
      autoPara.current = valor;
      void gerarPix(valor, true);
    }, espera);
    return () => window.clearTimeout(t);
    // (gerarPix fica fora das dependências de propósito: muda a cada render; o
    // que dispara a pré-geração é o valor e o estado do Pix.)
  }, [valor, pixDoValor, gerando, pixFalhou]);

  // Copia DENTRO do toque: `writeText` é chamado na hora, sem nada assíncrono antes.
  function copiarAgora(p: PixSobDemandaPublico) {
    let copia: Promise<void>;
    try {
      copia = navigator.clipboard.writeText(p.copiaECola);
    } catch {
      copia = Promise.reject(new Error('sem área de transferência'));
    }
    copia.then(
      () => {
        marcarPediuCopia(false);
        avisar('Código Pix copiado. Cole no app do seu banco.');
      },
      () => {
        // Navegador sem cópia automática: o código fica à vista, selecionável.
        setQrAberto(true);
        avisar('Código à vista: segure o dedo sobre ele para copiar, ou leia o QR.');
      },
    );
  }

  function copiar() {
    if (valor === null) return;
    if (pixDoValor) {
      copiarAgora(pixDoValor);
      return;
    }
    // O código ainda não chegou: marca o pedido e espera (sem copiar depois da espera).
    marcarPediuCopia(true);
    if (!gerando) {
      autoPara.current = valor;
      void gerarPix(valor);
    }
  }

  function abrirQr(aberto: boolean) {
    setQrAberto(aberto);
    if (aberto && !pixDoValor && valor !== null && !gerando) {
      autoPara.current = valor;
      void gerarPix(valor);
    }
  }

  function escolher(q: number) {
    setSelecao(q);
    setValorEscolhido(null);
    setPixFalhou(false);
  }
  function irParaLista(sel?: number) {
    setVista({ tipo: 'lista' });
    setValorEscolhido(null);
    setPixFalhou(false);
    setSelecao(sel ?? null);
    if (sel) avisar(`Pix de ${brl(k.acumulado[sel - 1])}: ${sel === 1 ? 'só a fatura mais antiga' : `as ${sel} faturas`}.`);
  }
  function verFatura(id: string) {
    setVista({ tipo: 'fatura', id });
    setSelecao(null);
    setValorEscolhido(null);
    setPixFalhou(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function voltarTotal() {
    setValorEscolhido(null);
    setPixFalhou(false);
  }
  function confirmarOutroValor(v: number) {
    const exato = k.acumulado.findIndex((a) => a === v);
    if (exato >= 0) {
      setValorEscolhido(null);
      setSelecao(exato + 1);
    } else {
      setValorEscolhido(v);
      setSelecao(null);
    }
    if (vistaEfetiva.tipo !== 'fatura') setVista({ tipo: 'lista' });
    setModal(false);
    autoPara.current = v;
    void gerarPix(v).then((p) => p && avisar(`Pix de ${brl(p.valor)} pronto. Copie o código ou leia o QR.`));
  }

  const vencTxt = (x: FaturaProjetada) =>
    x.situacao === 'paga'
      ? `Vencimento ${dataCurta(x.vencimento)}`
      : x.diasAtraso > 0
        ? `Venceu em ${dataCurta(x.vencimento)} · ${x.diasAtraso} ${plural(x.diasAtraso, 'dia', 'dias')} de atraso`
        : x.vencimento === conta.hoje
          ? `Vence hoje, ${diaSemana(x.vencimento)}`
          : `Vence ${diaSemana(x.vencimento)}, ${dataCurta(x.vencimento)}`;
  const quandoPagou = (x: FaturaProjetada) => {
    const r = meta(x.id).recebidos.at(-1);
    return r ? `${dataBr(r.data)}${r.hora ? ` às ${r.hora}` : ''}` : '';
  };

  // ---------- pedaços ----------
  // (Auxiliares de render: chamadas como FUNÇÃO, não como componente — assim o
  // <details> aberto e o QR não são remontados a cada atualização da página.)
  function Topo({ titulo, valorTxt, sobrescreve }: { titulo?: string; valorTxt?: string; sobrescreve?: boolean }) {
    let ola: React.ReactNode;
    let pill: React.ReactNode;
    let kTxt: string;
    let vTxt: string;
    let venc: React.ReactNode;
    let sub: React.ReactNode = null;
    if (fat) {
      const paga = fat.situacao === 'paga';
      ola = paga ? 'Esta fatura está quitada.' : 'Aqui está a sua fatura.';
      pill = <span className={`status st-${fat.situacao}`}>{STATUS_TXT[fat.situacao]}</span>;
      kTxt = sobrescreve && titulo ? titulo : paga ? 'Total pago' : 'Total a pagar';
      vTxt = sobrescreve && valorTxt ? valorTxt : brl(paga ? fat.pagoTotal : fat.totalHoje);
      venc = paga ? (
        <>Vencimento era {dataBr(fat.vencimento)}</>
      ) : fat.diasAtraso > 0 ? (
        <>Venceu em <em>{dataBr(fat.vencimento)}</em> · {fat.diasAtraso} {plural(fat.diasAtraso, 'dia', 'dias')} de atraso</>
      ) : fat.vencimento === conta.hoje ? (
        <>Vence <em>hoje</em>, {diaSemana(fat.vencimento)} {dataCurta(fat.vencimento)}</>
      ) : (
        <>Vence {diaSemana(fat.vencimento)}, <em>{dataBr(fat.vencimento)}</em></>
      );
      if (fat.situacao === 'parcial') sub = <div className="sub"><span>Você já pagou <b>{brl(fat.pagoTotal)}</b> desta fatura</span></div>;
    } else {
      const nv = k.vencidas.filter((x) => x.diasAtraso > 0).length;
      const nh = k.abertas.filter((x) => x.vencimento === conta.hoje).length;
      const na = k.abertas.filter((x) => x.aVencer).length;
      ola = n ? <>Você tem <strong>{n} {plural(n, 'fatura', 'faturas')} em aberto</strong>.</> : 'Suas faturas estão em dia.';
      const partes: string[] = [];
      if (nv) partes.push(`${nv} ${plural(nv, 'vencida', 'vencidas')}`);
      if (nh) partes.push(`${nh} vence hoje`);
      if (na) partes.push(`${na} a vencer`);
      pill = n ? <span className={`status st-${nv ? 'vencida' : nh ? 'hoje' : 'aberta'}`}>{partes.join(' · ')}</span> : <span className="status st-paga">Tudo pago</span>;
      if (n) {
        kTxt = 'Total em aberto';
        vTxt = brl(k.totalAberto);
        if (na && k.vencidas.length) sub = <div className="sub"><span>Vencido <b>{brl(k.totalVencido)}</b></span><span>A vencer <b>{brl(k.totalAberto - k.totalVencido)}</b></span></div>;
        const m = k.abertas[0];
        venc = m.diasAtraso > 0 ? (
          <>A mais antiga venceu em <em>{dataBr(m.vencimento)}</em> · {m.diasAtraso} {plural(m.diasAtraso, 'dia', 'dias')} de atraso</>
        ) : (
          <>A mais antiga vence <em>{m.vencimento === conta.hoje ? 'hoje' : dataBr(m.vencimento)}</em></>
        );
      } else {
        const ultimas = k.pagas.map((x) => ({ x, r: meta(x.id).recebidos.at(-1) })).filter((y) => y.r);
        const ult = ultimas.sort((a, b) => (a.r!.data < b.r!.data ? 1 : -1))[0];
        kTxt = 'Último pagamento';
        vTxt = brl(ult?.r?.valor ?? 0);
        venc = ult?.r ? <>Recebido em <em>{dataBr(ult.r.data)}</em>{ult.r.hora ? ` às ${ult.r.hora}` : ''}</> : 'Nenhuma fatura em aberto.';
      }
    }
    return (
      <header className="topo">
        <Marca />
        <div className="meta">
          <span>{fat ? `Fatura nº ${meta(fat.id).numero}` : 'Suas faturas'}</span>
          <span>{f.veiculo?.placa ?? f.titular.documentoMascarado}</span>
        </div>
        <div className="ola">Olá, <strong>{f.titular.primeiroNome}</strong>. {ola}</div>
        {pill}
        <div className="total">
          <div className="k">{kTxt}</div>
          <div className="v num">{vTxt}</div>
          <div className="venc">{venc}</div>
          {sub}
        </div>
      </header>
    );
  }

  // Bloco PAGAR: o código Pix é a ação principal; o QR fica recolhido para quem
  // abre no computador. O código só existe depois que o cliente pede.
  function BlocoPagar({ legenda, extra, rotulo }: { legenda: string; extra?: React.ReactNode; rotulo?: string }) {
    if (valor === null) return null;
    if (pixFalhou) {
      return (
        <section className="erro-box">
          <h3>Não conseguimos gerar o Pix agora</h3>
          <p>O valor a pagar é <b className="num">{brl(valor)}</b>. Tente de novo em alguns segundos. Se continuar, fale com a gente pelo WhatsApp: o saldo não muda por causa desta falha.</p>
          <div className="acoes"><button className="btn btn-p" disabled={gerando} onClick={() => void gerarPix(valor).then((p) => p && avisar(`Pix de ${brl(p.valor)} pronto. Copie o código ou leia o QR.`))}>{gerando ? 'Gerando…' : 'Tentar de novo'}</button></div>
        </section>
      );
    }
    return (
      <section className="pagar" id="pagar">
        <div className="cab">
          <div>
            <div className="k">{rotulo ?? 'Pagar agora'}</div>
            <div className="v num">{brl(valor)}</div>
            <div className="leg">{legenda}</div>
          </div>
        </div>
        {/* O botão só vira "Gerando…" se o cliente tocou antes de o código chegar. */}
        <button className="btn btn-p" disabled={pediuCopia && !pixDoValor} onClick={copiar}>{pediuCopia && !pixDoValor ? 'Gerando o código Pix…' : 'Copiar código Pix'}</button>
        {pediuCopia && pixDoValor && (
          <button className="toque-copiar" onClick={() => copiarAgora(pixDoValor)} aria-label="Toque para copiar o código Pix">
            <code>{pixDoValor.copiaECola}</code>
            <b>Toque para copiar</b>
          </button>
        )}
        <details className="qr" open={qrAberto} onToggle={(e) => { const aberto = (e.currentTarget as HTMLDetailsElement).open; if (aberto !== qrAberto) abrirQr(aberto); }}>
          <summary><span className="rot">Mostrar QR Code<small>para pagar por outro aparelho</small></span></summary>
          <div className="box">
            {pixDoValor ? (
              <>
                <QrPix payload={pixDoValor.copiaECola} tamanho={168} />
                <code id="pixcode">{pixDoValor.copiaECola}</code>
                {pixDoValor.simulado && <span className="aviso-teste">Ambiente de teste: Pix simulado, não pague.</span>}
              </>
            ) : (
              <span className="gerando">Gerando o código Pix…</span>
            )}
          </div>
        </details>
        <div className="receb">
          <span>Recebedor: <b>{conta.recebedor.nome}</b>{conta.recebedor.cnpj ? ` · CNPJ ${conta.recebedor.cnpj}` : ''}</span>
          <span>O código vale até as 23h59 de hoje; ao reabrir a página, ele é gerado de novo com o saldo do dia.</span>
        </div>
        {extra}
      </section>
    );
  }

  function Acoes({ numeroPdf }: { numeroPdf: number }) {
    return (
      <div className="acoes">
        <div className={podeOutroValor ? 'dupla' : ''}>
          {/* "Pagar outro valor" só aparece quando a regra permite (não mostrar o que não pode). */}
          {podeOutroValor && <button className="btn btn-s" onClick={() => setModal(true)}>Pagar outro valor</button>}
          <a className="btn btn-s" href={faturaApi.urlPdf(token, numeroPdf)} target="_blank" rel="noreferrer">Ver fatura em PDF</a>
        </div>
      </div>
    );
  }

  function Itens({ x }: { x: FaturaProjetada }) {
    const m = meta(x.id);
    const motor = conta.motor.faturas.find((y) => y.id === x.id)!;
    const taxa = motor.itens[0];
    const paga = x.situacao === 'paga';
    const desde = x.pagamentos.length && x.encargo.desde > x.vencimento ? `desde o pagamento de ${dataCurta(x.encargo.desde)}` : 'desde o vencimento';
    return (
      <>
        {motor.itens.map((it) => {
          const nome = m.itens.find((y) => y.id === it.id);
          const saldo = x.saldos.get(it.id) ?? 0;
          const pago = it.valor - saldo;
          const subtitulo = [nome?.subtitulo, pago > 0 && saldo > 0 ? `já recebido ${brl(pago)}` : null].filter(Boolean).join(' · ');
          return (
            <div className="item" key={it.id}>
              <div className="n"><div className="t">{nome?.titulo ?? 'Item da fatura'}</div>{subtitulo && <div className="s">{subtitulo}</div>}</div>
              <div className={`v num ${saldo === 0 ? 'zero' : ''}`}>{saldo === 0 ? 'Quitado' : brl(saldo)}</div>
            </div>
          );
        })}
        {paga && x.encargosPagos.multa > 0 && (
          <div className="item encargo"><div className="n"><div className="t">Multa por atraso</div><div className="s">{taxa ? `${pct(taxa.multaPct)}% sobre o saldo em atraso, ` : ''}uma única vez · paga</div></div><div className="v num">{brl(x.encargosPagos.multa)}</div></div>
        )}
        {paga && x.encargosPagos.atualizacao > 0 && (
          <div className="item encargo"><div className="n"><div className="t">Atualização por dias de atraso</div><div className="s">{taxa ? `${pct(taxa.atualizacaoMesPct)}% ao mês, ` : ''}proporcional aos dias · paga</div></div><div className="v num">{brl(x.encargosPagos.atualizacao)}</div></div>
        )}
        {!paga && x.diasAtraso > 0 && (
          <>
            <div className="item encargo">
              <div className="n"><div className="t">Multa por atraso</div><div className="s">{x.encargo.multaJaPaga ? 'Cobrada uma única vez, já paga' : `${taxa ? `${pct(taxa.multaPct)}% sobre o saldo em atraso, ` : ''}cobrada uma única vez`}</div></div>
              <div className={`v num ${x.encargo.multa ? '' : 'zero'}`}>{x.encargo.multa ? brl(x.encargo.multa) : 'R$ 0,00 (paga)'}</div>
            </div>
            <div className="item encargo">
              <div className="n"><div className="t">Atualização por dias de atraso</div><div className="s">{taxa ? `${pct(taxa.atualizacaoMesPct)}% ao mês, proporcional: ` : ''}{x.encargo.dias} {plural(x.encargo.dias, 'dia', 'dias')} {desde}, só sobre {brl(x.saldoNominal)} · muda a cada dia</div></div>
              <div className="v num">{brl(x.encargo.atualizacao)}</div>
            </div>
          </>
        )}
      </>
    );
  }

  function Recebidos({ x }: { x: FaturaProjetada }) {
    const m = meta(x.id);
    if (!m.recebidos.length) return null;
    const nomeDe = (itemId: string | null) => m.itens.find((y) => y.id === itemId)?.titulo ?? 'Item da fatura';
    return (
      <section className="bloco">
        <h2>Valores já recebidos</h2>
        {m.recebidos.map((r, i) => (
          <details className="rec" key={i}>
            <summary>
              <div className="d">Pix em {dataBr(r.data)}{r.hora ? ` às ${r.hora}` : ''}<span>toque para ver o que este valor quitou</span></div>
              <div className="v num">{brl(r.valor)}</div>
            </summary>
            <div className="quitou">
              {(x.pagamentos[i]?.alocacoes ?? []).map((a, j) => (
                <div className="q" key={j}>
                  <span>{a.alvo === 'MULTA' ? 'Multa por atraso' : a.alvo === 'ATUALIZACAO' ? 'Atualização por dias de atraso' : nomeDe(a.itemId)}{a.quitou ? '' : ' (parte)'}</span>
                  <b className="num">{brl(a.valor)}</b>
                </div>
              ))}
              {r.identificador && <div className="q meta"><span>Identificador do Pix</span><span className="num">{r.identificador}</span></div>}
            </div>
          </details>
        ))}
      </section>
    );
  }

  function Rodape() {
    return (
      <footer className="rodape">
        <span><b>Azit Move</b>{f.contratos.length > 0 && <> · Contrato {f.contratos.join(', ')}</>} · {f.titular.documentoMascarado}</span>
        {conta.atendimentoWhatsappLink && (
          <a className="btn btn-wa" href={linkWhatsapp(conta.atendimentoWhatsappLink, `Olá! Tenho uma dúvida sobre a minha fatura${f.contratos.length ? ` do contrato ${f.contratos[0]}` : ''}.`)} target="_blank" rel="noopener noreferrer">
            Falar com a Azit no WhatsApp{f.atendimentoWhatsapp ? ` · ${f.atendimentoWhatsapp}` : ''}
          </a>
        )}
        <span>Pagamento processado com segurança. Esta página mostra o saldo atualizado a cada abertura.</span>
      </footer>
    );
  }

  // Conta mista (§32.4-A, provisório): a fatura do modelo antigo tem o link e o Pix dela.
  const AvisoMista = () => {
    if (!conta.mista) return null;
    const antigas = conta.antigasEmAberto;
    return (
      <div className="ajuda">
        {antigas.length === 1 ? (
          <>Você também tem a <b>fatura nº {antigas[0].numero}</b> (vencimento {dataCurta(antigas[0].vencimento)}) em aberto. Ela é paga pelo link que você recebeu para ela.</>
        ) : (
          <>Você também tem <b>outras {antigas.length} faturas</b> em aberto. Elas são pagas pelo link que você recebeu para cada uma.</>
        )}{' '}
        Aqui o Pix paga uma fatura por vez{n > 1 ? ', começando pela mais antiga desta página' : ''}.
      </div>
    );
  };

  // ---------- telas ----------
  function Lista() {
    let pagamento: React.ReactNode;
    if (n === 0) {
      pagamento = (
        <div className="pago-box">
          <div className="g">Tudo em dia, {f.titular.primeiroNome}!</div>
          <div className="s">Nenhuma fatura em aberto.{conta.proximoVencimento ? <> A próxima vence {diaSemana(conta.proximoVencimento)}, <b>{dataBr(conta.proximoVencimento)}</b>.</> : null}</div>
        </div>
      );
    } else {
      const seg =
        n > 1 && valorEscolhido === null && !conta.mista ? (
          <div className="seg" role="radiogroup" aria-label="Quanto pagar agora">
            {k.abertas.map((x, i) => {
              const q = i + 1;
              const titulo = q === 1 ? 'Só a mais antiga' : q === n ? 'Todas as faturas' : `As ${q} mais antigas`;
              const aVencer = x.aVencer ? ' (ainda vai vencer)' : '';
              const sub = q === 1 ? `Fatura de ${dataCurta(x.vencimento)}${aVencer}` : `Da fatura de ${dataCurta(k.abertas[0].vencimento)} até a de ${dataCurta(x.vencimento)}${aVencer}`;
              return (
                <button key={x.id} role="radio" aria-checked={q === kSel} aria-pressed={q === kSel} onClick={() => escolher(q)}>
                  <div className="l"><b>{titulo}</b><span>{sub}</span></div>
                  <div className="r num">{brl(k.acumulado[i])}</div>
                </button>
              );
            })}
          </div>
        ) : null;
      const legenda =
        valorEscolhido !== null ? 'valor escolhido por você' : n === 1 ? 'esta fatura' : kSel === n ? `as ${n} faturas de uma vez` : kSel === 1 ? `só a fatura de ${dataCurta(k.abertas[0].vencimento)}` : `as ${kSel} faturas mais antigas`;
      pagamento = (
        <>
          {BlocoPagar({ legenda, extra: valorEscolhido !== null ? <button className="btn btn-l" onClick={voltarTotal}>Voltar às opções</button> : null })}
          {seg}
          {AvisoMista()}
          {Acoes({ numeroPdf: meta(k.abertas[0].id).numero })}
        </>
      );
    }
    return (
      <>
        {Topo({})}
        <div className="corpo">
          {pagamento}
          {n > 0 && (
            <section className="bloco">
              <h2>Faturas em aberto<small>O pagamento quita sempre a mais antiga primeiro: é assim que a dívida mais velha para de gerar atualização.</small></h2>
              <div className="cards">
                {k.abertas.map((x, i) => {
                  const ant = k.abertas[i - 1];
                  const numero = meta(x.id).numero;
                  return (
                    <button key={x.id} className={`card ${i === 0 ? 'primeira' : 'travada'}`} onClick={() => verFatura(x.id)} aria-label={`Ver fatura nº ${numero}`}>
                      <div className="ord">{numero}</div>
                      <div className="info">
                        <div className="t">Fatura nº {numero}</div>
                        <div className="s">{vencTxt(x)}{x.situacao === 'parcial' ? ` · Paga parcialmente · já pagou ${brl(x.pagoTotal)}` : ''}</div>
                        {i === 0 ? <div className="tag primeira">Pague esta primeiro</div> : i === 1 ? <div className="tag">Paga junto com a de {dataCurta(ant.vencimento)}</div> : <div className="tag">Paga junto com as anteriores</div>}
                      </div>
                      <div className="val"><b className="num">{brl(x.totalHoje)}</b><span>Detalhes ›</span></div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {k.pagas.length > 0 && (
            <section className="bloco">
              <h2>Faturas pagas</h2>
              <div className="cards">
                {k.pagas.map((x) => {
                  const numero = meta(x.id).numero;
                  return (
                    <button key={x.id} className="card" onClick={() => verFatura(x.id)}>
                      <div className="ord ok">{numero}</div>
                      <div className="info"><div className="t">Fatura nº {numero}</div><div className="s">Paga em {quandoPagou(x)}</div></div>
                      <div className="val"><b className="num">{brl(x.pagoTotal)}</b><span>Comprovante ›</span></div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
        {Rodape()}
      </>
    );
  }

  function TelaFatura({ x }: { x: FaturaProjetada }) {
    const numero = meta(x.id).numero;
    let cobertas: FaturaProjetada[] = [x];
    let total = x.totalHoje;
    let topo: { titulo: string; valorTxt: string } | null = null;
    let pagamento: React.ReactNode;
    const coberturaDe = (v: number) => Math.max(1, k.acumulado.findIndex((a) => a >= v) + 1);

    if (x.situacao === 'paga') {
      const ult = meta(x.id).recebidos.at(-1);
      pagamento = (
        <>
          <div className="pago-box">
            <div className="g">Fatura paga. Obrigado, {f.titular.primeiroNome}!</div>
            {ult && <div className="s">Pago em <b>{dataBr(ult.data)}{ult.hora ? ` às ${ult.hora}` : ''}</b>{ult.identificador ? <> · Pix {ult.identificador}</> : null}</div>}
          </div>
          <div className="acoes">
            <a className="btn btn-s" href={faturaApi.urlPdf(token, numero)} target="_blank" rel="noreferrer">Baixar comprovante em PDF</a>
            {n > 0 && <button className="btn btn-l" onClick={() => irParaLista()}>Você ainda tem {n} {plural(n, 'fatura', 'faturas')} em aberto · ver</button>}
          </div>
        </>
      );
    } else if (idx === 0) {
      let legenda = n > 1 ? 'só esta fatura, a mais antiga' : 'esta fatura';
      if (valorEscolhido !== null) {
        const m = coberturaDe(valorEscolhido);
        cobertas = k.abertas.slice(0, m);
        total = valorEscolhido;
        legenda = m === 1 ? `pagamento parcial · ficam em aberto ${brl(x.totalHoje - valorEscolhido)}` : `quita ${m - 1 === 1 ? `a fatura nº ${meta(cobertas[0].id).numero}` : `${m - 1} faturas`} e abate parte da nº ${meta(cobertas.at(-1)!.id).numero}`;
        if (m > 1) topo = { titulo: `Valor escolhido · ${m} faturas`, valorTxt: brl(valorEscolhido) };
      } else if (selecao !== null && selecao > 1) {
        cobertas = k.abertas.slice(0, kSel);
        total = k.acumulado[kSel - 1];
        legenda = `as ${kSel} faturas mais antigas`;
        topo = { titulo: `Total a pagar · ${kSel} faturas`, valorTxt: brl(total) };
      }
      const extra =
        valorEscolhido !== null || (selecao !== null && selecao > 1) ? (
          <button className="btn btn-l" onClick={() => { voltarTotal(); setSelecao(null); }}>Voltar ao valor total</button>
        ) : n > 1 && !conta.mista ? (
          <button className="btn btn-s" onClick={() => irParaLista(n)}>Pagar todas as {n} · {brl(k.totalAberto)}</button>
        ) : null;
      pagamento = (
        <>
          {BlocoPagar({ legenda, extra })}
          {AvisoMista()}
          {Acoes({ numeroPdf: numero })}
        </>
      );
    } else {
      // Fatura que NÃO é a mais antiga: o Pix já vem com as anteriores.
      const ant = k.abertas[0];
      const opcoes = conta.mista ? [1] : [...new Set([idx + 1, 1, n])].sort((a, b) => a - b);
      const seg =
        valorEscolhido !== null || conta.mista ? null : (
          <div className="seg" role="radiogroup" aria-label="Quanto pagar agora">
            {opcoes.map((q) => {
              const titulo = q === idx + 1 ? (idx === 1 ? 'As duas juntas' : `Até esta fatura (${q})`) : q === 1 ? `Só a fatura de ${dataCurta(ant.vencimento)}` : `Todas as ${n}`;
              const sub = q === idx + 1 ? `Da fatura de ${dataCurta(ant.vencimento)} até esta` : q === 1 ? 'A mais antiga, que venceu antes desta' : 'Inclui as que vencem depois desta';
              return (
                <button key={q} role="radio" aria-checked={q === kSel} aria-pressed={q === kSel} onClick={() => escolher(q)}>
                  <div className="l"><b>{titulo}</b><span>{sub}</span></div>
                  <div className="r num">{brl(k.acumulado[q - 1])}</div>
                </button>
              );
            })}
          </div>
        );
      let legenda = kSel === 1 ? `só a fatura de ${dataCurta(ant.vencimento)}; esta continua em aberto` : kSel === idx + 1 ? `esta e ${idx === 1 ? `a de ${dataCurta(ant.vencimento)}` : `as ${idx} anteriores`} de uma vez` : `as ${n} faturas em aberto`;
      if (valorEscolhido !== null) {
        const m = coberturaDe(valorEscolhido);
        cobertas = k.abertas.slice(0, m);
        total = valorEscolhido;
        legenda = 'valor escolhido por você';
        topo = { titulo: `Valor escolhido · ${m === 1 ? `fatura nº ${meta(ant.id).numero}` : `${m} faturas`}`, valorTxt: brl(valorEscolhido) };
      } else {
        cobertas = k.abertas.slice(0, kSel);
        total = k.acumulado[kSel - 1];
        topo = { titulo: kSel === 1 ? `Total a pagar · só a fatura nº ${meta(ant.id).numero}` : `Total a pagar · ${kSel} faturas, inclui a vencida de ${dataCurta(ant.vencimento)}`, valorTxt: brl(total) };
      }
      pagamento = (
        <>
          <div className="ajuda">
            Esta fatura é paga <b>junto com a de {dataCurta(ant.vencimento)}</b>, que venceu antes dela{idx > 1 ? ` (e mais ${idx - 1} ${plural(idx - 1, 'anterior', 'anteriores')})` : ''}. O pagamento sempre quita a fatura mais antiga primeiro, por isso não dá para pagar só esta.{conta.mista ? '' : ' Se preferir, pague primeiro só a mais antiga.'}
          </div>
          {BlocoPagar({ legenda, extra: valorEscolhido !== null ? <button className="btn btn-l" onClick={voltarTotal}>Voltar às opções</button> : null })}
          {seg}
          {AvisoMista()}
          {Acoes({ numeroPdf: numero })}
        </>
      );
    }

    const soEsta = cobertas.length === 1 && cobertas[0].id === x.id;
    const ultima = cobertas.at(-1)!;
    const faltaDaUltima = k.acumulado[cobertas.length - 1] - total;
    return (
      <>
        {k.faturas.length > 1 && <button className="volta" onClick={() => irParaLista()}>‹ Suas faturas</button>}
        {Topo({ titulo: topo?.titulo, valorTxt: topo?.valorTxt, sobrescreve: !!topo })}
        <div className="corpo">
          {pagamento}
          {Recebidos({ x })}
          {soEsta ? (
            <section className="bloco">
              <h2>Itens da fatura</h2>
              <div className="lista">{Itens({ x })}</div>
              <div className="soma"><span>{x.situacao === 'paga' ? 'Total pago' : 'Total a pagar'}</span><span className="v num">{brl(x.situacao === 'paga' ? x.pagoTotal : x.totalHoje)}</span></div>
              {x.situacao === 'parcial' && <div className="ajuda">Multa e atualização só incidem sobre o que ainda falta pagar. O que você já pagou não gera encargo novo.</div>}
            </section>
          ) : (
            <section className="bloco">
              <h2>
                Itens a pagar
                <small>{cobertas.length === 1 ? `Só a fatura nº ${meta(cobertas[0].id).numero}, que venceu antes desta.` : `${cobertas.length} faturas, da mais antiga até ${ultima.id === x.id ? 'esta' : `a nº ${meta(ultima.id).numero}`}.`}</small>
              </h2>
              {cobertas.map((c) => (
                <div className={`grupo ${c.id === x.id ? 'esta' : ''}`} key={c.id}>
                  <div className="gt"><span>Fatura nº {meta(c.id).numero}{c.id === x.id ? ' · esta' : ''}</span><span>{vencTxt(c)}</span></div>
                  <div className="lista">{Itens({ x: c })}</div>
                  <div className="subt"><span>Subtotal da fatura nº {meta(c.id).numero}</span><b className="num">{brl(c.totalHoje)}</b></div>
                </div>
              ))}
              <div className="soma"><span>Total a pagar</span><span className="v num">{brl(total)}</span></div>
              {valorEscolhido !== null && faltaDaUltima > 0 && <div className="ajuda">Pagamento parcial: ficam em aberto <b>{brl(faltaDaUltima)}</b> da fatura nº {meta(ultima.id).numero}.</div>}
            </section>
          )}
        </div>
        {Rodape()}
      </>
    );
  }

  return (
    <>
      {fat ? TelaFatura({ x: fat }) : Lista()}
      {modal && regra && podeOutroValor && (
        <ModalOutroValor conta={conta} k={k} regra={regra} fechar={() => setModal(false)} confirmar={confirmarOutroValor} />
      )}
    </>
  );
}

// "Pagar outro valor" (§32.6 + §32.6-A): o campo formata em reais enquanto o
// cliente digita, o botão só ativa com valor válido e a prévia diz o que o
// valor quita — pela MESMA conta do motor.
function ModalOutroValor({ conta, k, regra, fechar, confirmar }: { conta: ContaFaturaPublica; k: ContaProjetada; regra: RegraParcial; fechar: () => void; confirmar: (v: number) => void }) {
  const [texto, setTexto] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const { parametros } = conta.motor;
  const n = k.abertas.length;
  const m = k.abertas[0];
  const { minimo, maximo } = regra;
  const digitos = texto.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const v = digitos ? Number(digitos) : null; // centavos
  const mostrado = v === null ? '' : (v / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const consequencia = m.aVencer
    ? 'Se o restante não for pago até o vencimento, ele passa a ter multa e atualização.'
    : 'O que ficar em aberto continua com atualização por dia de atraso, só sobre o saldo que faltar.';
  const minimoPeloPiso = minimoParcialFatura(m.face, parametros) === parametros.minimoParcialPiso && parametros.minimoParcialPiso > Math.round((m.face * parametros.minimoParcialPct) / 100);

  function previa(valor: number): string {
    const depois = projetarConta(conta.motor.faturas, conta.hoje, [{ data: conta.hoje, valor }], parametros.cascata);
    const quitadas = k.abertas.filter((a) => depois.faturas.find((x) => x.id === a.id)?.situacao === 'paga');
    const proxima = depois.abertas[0];
    const partes: string[] = [];
    if (quitadas.length) partes.push(`quita ${quitadas.length === 1 ? `a fatura de ${dataCurta(quitadas[0].vencimento)}` : `${quitadas.length} faturas (até a de ${dataCurta(quitadas.at(-1)!.vencimento)})`}`);
    if (proxima) {
      const antes = k.abertas.find((a) => a.id === proxima.id);
      const abatido = antes ? antes.totalHoje - proxima.totalHoje : 0;
      if (abatido > 0) partes.push(`abate ${brl(abatido)} da fatura de ${dataCurta(proxima.vencimento)} (ficam ${brl(proxima.totalHoje)})`);
    }
    const frase = partes.join(' e ');
    return frase ? `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.` : 'Quita tudo.';
  }

  let dica = `Entre ${brl(minimo)} e ${brl(maximo)}`;
  let classe = 'dica';
  let valido = false;
  if (v !== null) {
    if (v < minimo) {
      classe = 'dica erro';
      dica = regra.tipo === 'antiga' ? `Abaixo do mínimo: a fatura de ${dataCurta(m.vencimento)} precisa ser paga inteira (${brl(minimo)}).` : `Abaixo do mínimo de ${brl(minimo)}.`;
    } else if (v > maximo) {
      classe = 'dica erro';
      dica = `Acima do que você deve. Para pagar tudo, use ${brl(maximo)}.`;
    } else {
      classe = 'dica ok';
      dica = v === maximo ? (n > 1 ? 'Quita todas as faturas.' : 'Quita a fatura.') : previa(v);
      valido = true;
    }
  }

  const atalhos: { rotulo: string; valor: number }[] =
    regra.tipo === 'antiga'
      ? k.acumulado.map((a, i) => ({ rotulo: `${i === 0 ? 'Só a mais antiga' : i + 1 === n ? 'Tudo' : `As ${i + 1} mais antigas`} · ${brl(a)}`, valor: a }))
      : [
          ...[...new Set([minimo, Math.max(minimo, Math.round(m.totalHoje * 0.75)), m.totalHoje])].map((a) => ({ rotulo: `${a === m.totalHoje ? 'Total ' : a === minimo ? 'Mínimo ' : ''}${brl(a)}`, valor: a })),
          ...(n > 1 ? [{ rotulo: `Tudo · ${brl(maximo)}`, valor: maximo }] : []),
        ];

  return (
    <div className="veu" role="dialog" aria-modal="true" aria-label="Pagar outro valor" onClick={(e) => { if (e.target === e.currentTarget) fechar(); }}>
      <div className="modal">
        <h3>Pagar outro valor</h3>
        {regra.tipo === 'antiga' ? (
          <p>Como há mais de uma fatura vencida, o mínimo é o valor da mais antiga, a <b>fatura de {dataCurta(m.vencimento)}: {brl(minimo)}</b>. O que passar disso abate a fatura seguinte, na ordem. {consequencia}</p>
        ) : (
          <p>Você pode pagar parte agora e o restante depois. O mínimo é <b>{brl(minimo)}</b> ({pct(parametros.minimoParcialPct)}% do valor da fatura{minimoPeloPiso ? `, e nunca menos que ${brl(parametros.minimoParcialPiso)}` : ''}). {consequencia}</p>
        )}
        <div className="campo">
          <label htmlFor="vparcial">Quanto quer pagar agora?</label>
          <div className="in"><span>R$</span><input id="vparcial" ref={inputRef} inputMode="numeric" placeholder="0,00" autoComplete="off" value={mostrado} onChange={(e) => setTexto(e.target.value)} /></div>
          <div className={classe}>{dica}</div>
        </div>
        <div className="atalhos">
          {atalhos.map((a) => <button key={a.valor} className="chip" onClick={() => setTexto(String(a.valor))}>{a.rotulo}</button>)}
        </div>
        <div className="acoes">
          <button className="btn btn-p" disabled={!valido} onClick={() => valido && v !== null && confirmar(v)}>Gerar Pix deste valor</button>
          <button className="btn btn-l" onClick={fechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
