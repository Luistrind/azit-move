import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AreaSistema, EtiquetaContato, NOME_ETIQUETA_CONTATO } from '@azit/types';
import { formatCurrency, formatarWhatsapp, isoParaBR, reaisParaCentavos } from '@azit/utils';
import { conversasService as svc, type Conversa } from '../../services/conversas.service';
import { originacaoService, type SimulacaoResultado } from '../../services/originacao.service';
import { operacoesService, type PreviaAcordo, type SimulacaoNovacao, type SimulacaoQuitacao } from '../../services/operacoes.service';
import { faturaService } from '../../services/fatura.service';
import { ETIQUETA_CONTATO_COLORS } from '../../config/statusColors';
import { AREAS_ROTA_CONTRATO, AREAS_ROTA_FICHA_TITULAR, mensagemErro, useTemArea } from '../../lib/permissoes';
import { dataBR, hojeBrasilISO } from '../../lib/datas';
import { Abas } from '../../components/Abas';
import { Botao } from '../../components/Botao';
import { LinkArea } from '../../components/LinkArea';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { toast } from '../../components/Toast';
import { porFrequencia, textoAcordo, textoCompra, textoNovacao, textoQuitacao, type Mensagem } from './textos';

// Painel de atendimento ao lado da conversa (doc 02 §34.4). Muda conforme quem
// é o número. NÃO tem conta própria (Regra 16): chama os mesmos serviços do
// funil (simulação), da ficha (posição, acordo, novação) e do contrato
// (quitação). Regra "não mostrar o que não pode": as abas de lead e compra só
// aparecem para quem tem a área Comercial, dona do funil.

const muted = { color: 'var(--text-muted)' } as const;
const borda = '1px solid var(--border)';
const campo = { background: 'var(--surface-input)', border: borda, color: 'var(--text-primary)' } as const;
const inputCls = 'h-[32px] w-full rounded-[8px] px-[9px] text-[12.5px]';
const rotulo = 'text-[10.5px] font-semibold uppercase tracking-[0.08em]';
const PRAZOS = [6, 12, 24, 36, 48];

// "1.234,56" ou "1234" → centavos (entrada de valor pelo operador).
function lerReais(v: string): number | null {
  const limpo = v.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.');
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n >= 0 ? reaisParaCentavos(n) : null;
}

function Linha({ r, v, forte }: { r: ReactNode; v: ReactNode; forte?: boolean }) {
  return (
    <div className={`flex justify-between gap-[12px] py-[3px] text-[12.5px] ${forte ? 'mt-[3px] border-t pt-[6px] font-bold' : ''}`} style={{ color: forte ? 'var(--text-primary)' : 'var(--text-body)', borderColor: 'var(--border)' }}>
      <span>{r}</span>
      <span className="tabular-nums" style={{ color: 'var(--text-primary)', fontWeight: forte ? 700 : 600 }}>{v}</span>
    </div>
  );
}
function Rotulo({ children }: { children: ReactNode }) {
  return <div className={rotulo} style={{ color: 'var(--text-label)' }}>{children}</div>;
}
function Aviso({ tom = 'info', children }: { tom?: 'info' | 'warn' | 'danger'; children: ReactNode }) {
  return <div className="rounded-[8px] px-[10px] py-[7px] text-[11.5px]" style={{ background: `var(--${tom}-bg)`, color: `var(--${tom}-fg)` }}>{children}</div>;
}
function Caixa({ children }: { children: ReactNode }) {
  return <div className="flex flex-col rounded-[12px] p-[12px]" style={{ border: borda }}>{children}</div>;
}

// ---------------- Mandar ao cliente (§34.7) ----------------

function JanelaEnvio({ numero, msg, janelaAberta, onClose }: { numero: string; msg: Mensagem | null; janelaAberta: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [comPdf, setComPdf] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (msg) {
      setTexto(msg.texto);
      setComPdf(false);
    }
  }, [msg]);
  if (!msg) return null;
  async function mandar() {
    if (!msg) return;
    setOcupado(true);
    try {
      const r = await svc.enviarSimulacao(numero, { texto, pdf: comPdf ? msg.pdf : null });
      const partes = [r.pdf, r.texto].filter((x): x is NonNullable<typeof x> => !!x);
      const falhou = partes.find((p) => p.resultado === 'falhou');
      if (falhou) toast.erro(`Não enviada: ${falhou.motivo ?? ''}`);
      else if (partes.every((p) => p.resultado === 'enviada')) toast.sucesso('Mandada na conversa.');
      else toast.info(`Registrada como ${partes[partes.length - 1].resultado} — ${partes[partes.length - 1].motivo ?? ''}`);
      await qc.invalidateQueries({ queryKey: ['conversa', numero] });
      await qc.invalidateQueries({ queryKey: ['conversas'] });
      onClose();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Mandar ao cliente · ${msg.titulo}`} largura={560}>
      <div className="flex flex-col gap-[10px]">
        <label className="flex flex-col gap-[4px] text-[11.5px] font-semibold" style={{ color: 'var(--text-body)' }}>
          Texto (pode editar antes de mandar; *assim* sai em negrito)
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={9} maxLength={4096} className="rounded-[10px] px-[10px] py-[8px] text-[13px] font-normal" style={campo} />
        </label>
        <label className="flex items-center gap-[8px] text-[12.5px]">
          <input type="checkbox" checked={comPdf} onChange={(e) => setComPdf(e.target.checked)} />
          Mandar também o PDF com os mesmos valores
        </label>
        {comPdf && (
          <div className="rounded-[10px] p-[10px] text-[11.5px]" style={{ background: 'var(--surface-muted)', border: borda }}>
            <b>{msg.pdf.titulo}</b>
            {msg.pdf.destaque && <div className="mt-[4px]">{msg.pdf.destaque.rotulo}: <b>{msg.pdf.destaque.valor}</b></div>}
            {msg.pdf.linhas.map((l) => <div key={l.rotulo}>{l.rotulo}: {l.valor}</div>)}
          </div>
        )}
        <div className="flex justify-end gap-[8px]">
          <Botao onClick={onClose}>Cancelar</Botao>
          <Botao variante="primaria" carregando={ocupado} disabled={!texto.trim() || !janelaAberta} onClick={() => void mandar()}>Mandar na conversa</Botao>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Lead (§34.5) ----------------

function AbaQuemE({ c }: { c: Conversa }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(c.nomePerfil ?? '');
  const [cpf, setCpf] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function criar() {
    setOcupado(true);
    try {
      const r = await originacaoService.criarLead({ nome: nome.trim(), cpf: cpf.replace(/\D/g, '') || undefined, telefone: c.numero, canalOrigem: 'whatsapp' });
      toast.sucesso(r.tipo === 'titular' ? `O CPF já é de ${r.titular?.nome}: a conversa passa a ser dele quando o WhatsApp do cadastro for este número.` : 'Lead criado no funil. As simulações deste número passaram para ele.');
      await qc.invalidateQueries({ queryKey: ['conversa', c.numero] });
      await qc.invalidateQueries({ queryKey: ['conversas'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="flex flex-col gap-[10px]">
      <Aviso>O número não bate com nenhum titular nem com nenhum lead do funil.</Aviso>
      <label className="flex flex-col gap-[3px] text-[11px] font-semibold" style={{ color: 'var(--text-body)' }}>
        Nome
        <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} style={campo} />
      </label>
      <div className="grid grid-cols-2 gap-[8px]">
        <label className="flex flex-col gap-[3px] text-[11px] font-semibold" style={{ color: 'var(--text-body)' }}>
          WhatsApp
          <input value={formatarWhatsapp(c.numero)} disabled className={inputCls} style={{ ...campo, opacity: 0.6 }} />
        </label>
        <label className="flex flex-col gap-[3px] text-[11px] font-semibold" style={{ color: 'var(--text-body)' }}>
          CPF (opcional agora)
          <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" className={inputCls} style={campo} />
        </label>
      </div>
      <Botao variante="primaria" className="self-start" carregando={ocupado} disabled={nome.trim().length < 2} onClick={() => void criar()}>Criar lead no funil</Botao>
      <div className="text-[11px]" style={muted}>O lead nasce com o canal WhatsApp. O CPF é pedido no "Enviar proposta", como no atendimento.</div>
    </div>
  );
}

function ListaSimulacoes({ c }: { c: Conversa }) {
  if (!c.simulacoes.length) return null;
  return (
    <div className="flex flex-col gap-[4px]">
      <Rotulo>Simulações · {c.simulacoes.length}</Rotulo>
      {c.simulacoes.map((s) => (
        <div key={s.id} className="flex items-center gap-[8px] py-[4px] text-[11.5px]" style={{ borderBottom: '1px solid var(--border-light)', color: 'var(--text-body)' }}>
          <span className="min-w-0 flex-1">
            <b style={{ color: 'var(--text-primary)' }}>{dataBR(s.criadaEm)}</b> {s.veiculo}
            {s.oferta && <> · entrada {formatCurrency(s.oferta.valorEntrada)} · {formatCurrency(s.oferta.valorParcela)} {porFrequencia(s.oferta.frequencia)}</>}
          </span>
          <LinkArea to={`/atendimento?simulacao=${s.id}`} area={AreaSistema.COMERCIAL} className="shrink-0 font-semibold underline">abrir</LinkArea>
        </div>
      ))}
    </div>
  );
}

function AbaLead({ c }: { c: Conversa }) {
  const l = c.lead!;
  return (
    <div className="flex flex-col gap-[12px]">
      <div>
        <Linha r="Nome" v={l.nome} />
        <Linha r="WhatsApp" v={formatarWhatsapp(c.numero)} />
        <Linha r="CPF" v={l.cpf ? `***.${l.cpf.slice(3, 6)}.${l.cpf.slice(6, 9)}-**` : 'ainda não informado'} />
        <Linha r="Canal" v={l.canalOrigem === 'whatsapp' ? 'WhatsApp' : l.canalOrigem.replace(/_/g, ' ')} />
        <Linha r="No funil desde" v={dataBR(l.criadoEm)} />
      </div>
      <ListaSimulacoes c={c} />
      {!c.simulacoes.length && <div className="text-[11.5px]" style={muted}>Nenhuma simulação ainda. Use a aba "Simular compra".</div>}
    </div>
  );
}

// ---------------- Simular compra (funil, §34.4) ----------------

function AbaCompra({ c, onMandar }: { c: Conversa; onMandar: (m: Mensagem) => void }) {
  const qc = useQueryClient();
  const ativos = useQuery({ queryKey: ['atendimento-ativos'], queryFn: () => originacaoService.ativosDisponiveis(), staleTime: 60_000 });
  const [ativoId, setAtivoId] = useState<string | null>(null);
  const [valorManual, setValorManual] = useState('');
  const [sim, setSim] = useState<SimulacaoResultado | null>(null);
  const [ofertaId, setOfertaId] = useState<string | null>(null);
  const [entrada, setEntrada] = useState('');
  const [prazo, setPrazo] = useState(48);
  const [freq, setFreq] = useState<'semanal' | 'quinzenal' | 'mensal'>('semanal');
  const [ocupado, setOcupado] = useState(false);
  const nome = c.titular?.nome ?? c.lead?.nome ?? c.nomePerfil;

  async function simular() {
    setOcupado(true);
    try {
      const valorAvista = ativoId ? undefined : lerReais(valorManual) ?? undefined;
      const r = await originacaoService.simular({
        ativoId: ativoId ?? undefined,
        valorAvista,
        leadId: c.lead?.id,
        titularId: c.titular?.id,
        numeroWhatsapp: !c.lead && !c.titular ? c.numero : undefined,
      });
      setSim(r);
      setOfertaId(r.ofertas[0]?.id ?? null);
      await qc.invalidateQueries({ queryKey: ['conversa', c.numero] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }
  async function outraCondicao() {
    if (!sim) return;
    const v = lerReais(entrada);
    if (v === null) return toast.erro('Informe a entrada.');
    setOcupado(true);
    try {
      const r = await originacaoService.simularOpcao(sim.id, { valorEntrada: v, prazoMeses: prazo, frequencia: freq });
      setSim(r);
      setOfertaId(r.ofertas[r.ofertas.length - 1]?.id ?? null);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }
  const oferta = sim?.ofertas.find((o) => o.id === ofertaId) ?? null;
  const veiculo = sim ? (sim.ativo ? sim.ativo.descricao : sim.referencia ? `${sim.referencia.marca} ${sim.referencia.modelo} ${sim.referencia.anoModelo}` : 'Veículo de sua escolha') : '';
  const nomeTipo: Record<string, string> = { oferta_fixa: 'Oferta fixa', padrao: 'Oferta padrão', personalizada: 'Condição informada' };

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-col gap-[6px]">
        <Rotulo>Carros disponíveis</Rotulo>
        {ativos.isLoading && <div className="text-[11.5px]" style={muted}>Carregando…</div>}
        {ativos.data?.length === 0 && <div className="text-[11.5px]" style={muted}>Nenhum carro disponível no estoque. Simule pelo valor à vista.</div>}
        <div className="flex max-h-[220px] flex-col gap-[5px] overflow-y-auto">
          {ativos.data?.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { setAtivoId(a.id); setSim(null); }}
              className="grid grid-cols-[1fr_auto] gap-x-[10px] rounded-[10px] px-[10px] py-[8px] text-left"
              style={{ border: ativoId === a.id ? '1px solid var(--accent)' : borda, boxShadow: ativoId === a.id ? 'inset 0 0 0 1px var(--accent)' : undefined, background: 'var(--surface)' }}
              aria-pressed={ativoId === a.id}
            >
              <b className="text-[12.5px]">{a.descricao}</b>
              <span className="text-right text-[12.5px] font-bold tabular-nums">{a.valorVenda ? formatCurrency(a.valorVenda) : '—'}</span>
              <span className="text-[11px]" style={muted}>{a.placa ?? 'sem placa'}{a.pacoteOfertaId ? ' · tem oferta fixa' : ''}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-[8px] text-[12px]">
          <input type="radio" checked={ativoId === null} onChange={() => { setAtivoId(null); setSim(null); }} />
          Sem carro definido: valor à vista
          <input value={valorManual} onChange={(e) => setValorManual(e.target.value)} disabled={ativoId !== null} inputMode="decimal" placeholder="R$" aria-label="Valor à vista" className="h-[30px] w-[110px] rounded-[8px] px-[8px] text-[12.5px] disabled:opacity-50" style={campo} />
        </label>
        <Botao variante="secundaria" className="self-start" carregando={ocupado && !sim} disabled={!ativoId && !lerReais(valorManual)} onClick={() => void simular()}>Simular</Botao>
      </div>

      {sim && (
        <div className="flex flex-col gap-[8px]">
          {sim.avisoDivergencia && <Aviso tom="warn">{sim.avisoDivergencia}</Aviso>}
          <Rotulo>Ofertas · {veiculo} · {formatCurrency(sim.valorAvista)}</Rotulo>
          {sim.ofertas.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setOfertaId(o.id)}
              aria-pressed={ofertaId === o.id}
              className="flex items-center gap-[10px] rounded-[10px] px-[10px] py-[9px] text-left"
              style={{ border: ofertaId === o.id ? '1px solid var(--accent)' : borda, boxShadow: ofertaId === o.id ? 'inset 0 0 0 1px var(--accent)' : undefined, background: 'var(--surface)' }}
            >
              <span className="min-w-0 flex-1">
                <b className="text-[12.5px]">{nomeTipo[o.tipo] ?? o.tipo}</b>
                <span className="block text-[11px]" style={muted}>entrada {formatCurrency(o.valorEntrada)}{o.prazoMeses ? ` · ${o.prazoMeses} meses` : ''}{o.foraParametro ? ' · fora dos parâmetros' : ''}</span>
              </span>
              <span className="text-right font-display text-[17px] font-bold leading-[1.1] tabular-nums">
                {formatCurrency(o.valorParcela)}
                <span className="block text-[10.5px] font-semibold" style={muted}>{porFrequencia(o.frequencia)}</span>
              </span>
            </button>
          ))}
          <div className="grid grid-cols-3 gap-[6px]">
            <input value={entrada} onChange={(e) => setEntrada(e.target.value)} inputMode="decimal" placeholder="Entrada R$" aria-label="Entrada" className={inputCls} style={campo} />
            <select value={prazo} onChange={(e) => setPrazo(Number(e.target.value))} aria-label="Prazo" className={inputCls} style={campo}>
              {PRAZOS.map((p) => <option key={p} value={p}>{p} meses</option>)}
            </select>
            <select value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)} aria-label="Frequência" className={inputCls} style={campo}>
              <option value="semanal">semanal</option>
              <option value="quinzenal">quinzenal</option>
              <option value="mensal">mensal</option>
            </select>
          </div>
          <Botao tamanho="sm" className="self-start" carregando={ocupado} disabled={!entrada.trim()} onClick={() => void outraCondicao()}>Simular esta condição</Botao>
          <div className="text-[11px]" style={muted}>Motor da simulação do funil. Válida até {sim.validaAte ? dataBR(sim.validaAte) : '—'}. Fica gravada {c.lead ? 'no lead' : c.titular ? 'no titular' : 'neste número e passa para o lead quando ele for criado'}.</div>
          <div className="flex flex-wrap gap-[6px]">
            {c.janela.aberta && <Botao
              variante="primaria"
              disabled={!oferta}
              onClick={() => oferta && onMandar(textoCompra({ nome, veiculo, valorAvista: sim.valorAvista, valorEntrada: oferta.valorEntrada, valorParcela: oferta.valorParcela, frequencia: oferta.frequencia, prazoMeses: oferta.prazoMeses, validaAte: sim.validaAte }))}
            >
              Mandar ao cliente
            </Botao>}
            <LinkArea to={`/atendimento?simulacao=${sim.id}`} area={AreaSistema.COMERCIAL} className="inline-flex items-center rounded-[10px] px-[12px] text-[12.5px] font-semibold" style={{ border: borda }}>Seguir no atendimento</LinkArea>
          </div>
        </div>
      )}
      <ListaSimulacoes c={c} />
    </div>
  );
}

// ---------------- Cliente: posição, acordo, novação, quitação ----------------

function AbaPosicao({ c, onMandou }: { c: Conversa; onMandou: () => void }) {
  const contaId = c.contaId!;
  const posicao = useQuery({ queryKey: ['posicao', contaId], queryFn: () => faturaService.posicao(contaId) });
  const agora = useQuery({ queryKey: ['faturas-conta', contaId, 'agora'], queryFn: () => faturaService.daConta(contaId, 'agora') });
  const [enviando, setEnviando] = useState<string | null>(null);
  const p = posicao.data;
  async function mandarLink(f: { id: string; numero: number; linkPublico: string | null }) {
    if (!f.linkPublico) return;
    setEnviando(f.id);
    try {
      const r = await svc.responder(c.numero, `Segue o link da sua fatura nº ${f.numero}, para ver os itens e pagar com Pix: ${f.linkPublico}`);
      if (r.resultado === 'falhou') toast.erro(`Não enviada: ${r.motivo}`);
      else {
        await faturaService.registrarEnvioLink(f.id, 'whatsapp').catch(() => undefined);
        toast.sucesso(r.resultado === 'enviada' ? 'Link da fatura mandado na conversa.' : `Registrado como ${r.resultado}.`);
      }
      onMandou();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEnviando(null);
    }
  }
  if (!p) return <div className="text-[12px]" style={muted}>{posicao.isLoading ? 'Carregando…' : mensagemErro(posicao.error)}</div>;
  const atraso = p.atraso.faturas > 0;
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="grid grid-cols-2 gap-[10px] rounded-[12px] p-[12px]" style={{ background: atraso ? 'var(--danger-bg)' : undefined, border: atraso ? undefined : borda }}>
        <div className="col-span-2">
          <Rotulo>{atraso ? 'Falta pagar hoje' : 'Posição de hoje'}</Rotulo>
          <div className="font-display text-[24px] font-bold leading-[1.1] tabular-nums" style={{ color: atraso ? 'var(--danger-fg)' : 'var(--ok-fg)' }}>{atraso ? formatCurrency(p.atraso.valorHoje) : 'Em dia'}</div>
          <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>
            {atraso
              ? <><b>{p.atraso.faturas} {p.atraso.faturas === 1 ? 'fatura vencida' : 'faturas vencidas'}</b>, a mais antiga há {p.atraso.diasMaisAntiga} dias{p.atraso.encargos > 0 ? ` · inclui ${formatCurrency(p.atraso.encargos)} de multa e atualização` : ''}</>
              : `Nada vencido · ${p.trilho.pagas} faturas pagas`}
          </div>
        </div>
        <div>
          <Rotulo>Próxima fatura</Rotulo>
          {p.proxima ? <><div className="font-bold tabular-nums">{formatCurrency(p.proxima.valor)}</div><div className="text-[11px]" style={muted}>nº {p.proxima.numero} · {dataBR(p.proxima.dataVencimento)}{p.proxima.disponivel ? ' · disponível' : ''}</div></> : <div className="text-[11.5px]" style={muted}>nenhuma</div>}
        </div>
        <div>
          <Rotulo>Último pagamento</Rotulo>
          {p.ultimoPagamento ? <><div className="font-bold tabular-nums">{formatCurrency(p.ultimoPagamento.valor)}</div><div className="text-[11px]" style={muted}>{isoParaBR(p.ultimoPagamento.dia)}</div></> : <div className="text-[11.5px]" style={muted}>nenhum</div>}
        </div>
      </div>
      <div className="flex flex-col">
        <Rotulo>Faturas para pagar agora</Rotulo>
        {agora.data?.data.length === 0 && <div className="py-[4px] text-[11.5px]" style={muted}>Nenhuma fatura disponível ou vencida.</div>}
        {agora.data?.data.map((f) => (
          <div key={f.id} className="flex items-center gap-[8px] py-[7px]" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <span className="min-w-0 flex-1 text-[12px]">
              <b>nº {f.numero}</b> <span style={muted}>vence {dataBR(f.dataVencimento)}</span>
            </span>
            <b className="tabular-nums text-[12.5px]">{formatCurrency(f.faltaHoje ?? f.valorTotal)}</b>
            {/* Só dentro da janela de 24 h e com link (regra "não mostrar o que não pode"). */}
            {c.janela.aberta && f.linkPublico && (
              <Botao tamanho="sm" carregando={enviando === f.id} onClick={() => void mandarLink(f)}>Mandar link</Botao>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-[4px]">
        <Rotulo>Contratos ativos</Rotulo>
        {c.contratos.map((k) => (
          <LinkArea key={k.id} to={`/contratos/${k.id}`} area={AREAS_ROTA_CONTRATO} className="text-[12px] hover:underline">
            <b>{k.numero}</b>{k.ativo?.modelo ? ` · ${k.ativo.modelo}` : ''}{k.ativo?.placa ? ` · ${k.ativo.placa}` : ''}
          </LinkArea>
        ))}
        {c.titular && <LinkArea to={`/titulares/${c.titular.id}`} area={AREAS_ROTA_FICHA_TITULAR} className="mt-[4px] self-start text-[12px] font-semibold underline">Abrir a ficha completa</LinkArea>}
      </div>
    </div>
  );
}

function AbaAcordo({ c, onMandar }: { c: Conversa; onMandar: (m: Mensagem) => void }) {
  const contaId = c.contaId!;
  const elegivel = useQuery({ queryKey: ['renegociacao-elegivel', contaId], queryFn: () => operacoesService.elegivelConta(contaId) });
  const [entrada, setEntrada] = useState('');
  const [parcelas, setParcelas] = useState(4);
  const [previa, setPrevia] = useState<PreviaAcordo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const e = elegivel.data;
  async function simular() {
    const v = lerReais(entrada);
    if (v === null) return toast.erro('Informe a entrada.');
    setOcupado(true);
    try {
      setPrevia(await operacoesService.simularRenegociacaoConta(contaId, { valorEntrada: v, numeroParcelasNovas: parcelas }));
    } catch (err) {
      toast.erro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }
  if (!e) return <div className="text-[12px]" style={muted}>{elegivel.isLoading ? 'Carregando…' : mensagemErro(elegivel.error)}</div>;
  if (e.faturasVencidas === 0) return <Aviso>Esta conta não tem fatura em atraso. O acordo é só para quem está em atraso.</Aviso>;
  return (
    <div className="flex flex-col gap-[10px]">
      <div>
        <Rotulo>O que entra no acordo</Rotulo>
        <Linha r={`${e.faturasVencidas} ${e.faturasVencidas === 1 ? 'fatura vencida' : 'faturas vencidas'}, com multa e atualização de hoje`} v={formatCurrency(e.valorTotal)} />
        <div className="text-[11px]" style={muted}>As faturas não somem: ficam ligadas ao acordo. Todas as faturas em atraso da conta entram juntas.</div>
      </div>
      <div className="grid grid-cols-2 gap-[8px]">
        <input value={entrada} onChange={(ev) => setEntrada(ev.target.value)} inputMode="decimal" placeholder="Entrada R$" aria-label="Entrada do acordo" className={inputCls} style={campo} />
        <select value={parcelas} onChange={(ev) => setParcelas(Number(ev.target.value))} aria-label="Parcelas do acordo" className={inputCls} style={campo}>
          {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n} parcelas</option>)}
        </select>
      </div>
      <Botao className="self-start" carregando={ocupado} disabled={!entrada.trim()} onClick={() => void simular()}>Simular acordo</Botao>
      {previa && (
        <Caixa>
          {previa.entradaMinima > 0 && <Linha r="Entrada mínima" v={formatCurrency(previa.entradaMinima)} />}
          <Linha r="Saldo negociado" v={formatCurrency(previa.saldoNegociado)} />
          <Linha r={`${parcelas} parcelas do acordo`} v={formatCurrency(previa.valorParcela)} />
          {previa.parcelaDuranteAcordo && <Linha r="Fatura durante o acordo" v={formatCurrency(previa.parcelaDuranteAcordo.valorTotal)} forte />}
          {previa.excecoes.map((x) => <div key={x} className="mt-[4px]"><Aviso tom="warn">{x}</Aviso></div>)}
          <div className="mt-[6px] text-[11px]" style={muted}>Pelo motor do acordo, o mesmo da ficha. Registrar o acordo continua na ficha, com a aprovação de sempre.</div>
        </Caixa>
      )}
      <div className="flex flex-wrap gap-[6px]">
        {previa && c.janela.aberta && (
          <Botao
            variante="primaria"
            onClick={() => onMandar(textoAcordo({
              nome: c.titular?.nome ?? null,
              saldo: previa.saldoNegociado,
              faturas: e.faturasVencidas,
              valorEntrada: lerReais(entrada) ?? 0,
              dataLimiteEntrada: null,
              numeroParcelas: parcelas,
              valorParcela: previa.valorParcela,
              frequencia: previa.periodicidade,
              faturaDurante: previa.parcelaDuranteAcordo?.valorTotal ?? null,
            }))}
          >
            Mandar ao cliente
          </Botao>
        )}
        {c.titular && <LinkArea to={`/titulares/${c.titular.id}`} area={AREAS_ROTA_FICHA_TITULAR} className="inline-flex min-h-[34px] items-center rounded-[10px] px-[12px] text-[12.5px] font-semibold" style={{ border: borda }}>Seguir para o acordo na ficha</LinkArea>}
      </div>
    </div>
  );
}

function AbaNovacao({ c, onMandar }: { c: Conversa; onMandar: (m: Mensagem) => void }) {
  const contaId = c.contaId!;
  const [prazo, setPrazo] = useState(48);
  const [sim, setSim] = useState<SimulacaoNovacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function simular() {
    setOcupado(true);
    setErro(null);
    try {
      setSim(await operacoesService.simularNovacao(contaId, { prazoMeses: prazo, frequencia: 'semanal' }));
    } catch (e) {
      setSim(null);
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-end gap-[8px]">
        <label className="flex flex-1 flex-col gap-[3px] text-[11px] font-semibold" style={{ color: 'var(--text-body)' }}>
          Prazo do contrato novo
          <select value={prazo} onChange={(e) => setPrazo(Number(e.target.value))} className={inputCls} style={campo}>
            {[12, 24, 36, 48].map((p) => <option key={p} value={p}>{p} meses</option>)}
          </select>
        </label>
        <Botao carregando={ocupado} onClick={() => void simular()}>Simular novação</Botao>
      </div>
      {erro && <Aviso tom="warn">{erro}</Aviso>}
      {sim && (
        <Caixa>
          <Rotulo>Saldo que vira o contrato novo</Rotulo>
          <Linha r="Parte do veículo" v={formatCurrency(sim.decomposicao.parteVeiculo.total)} />
          {sim.decomposicao.demaisProdutos.total > 0 && <Linha r="Demais produtos" v={formatCurrency(sim.decomposicao.demaisProdutos.total)} />}
          <Linha r="Base da novação" v={formatCurrency(sim.saldoNovado)} forte />
          <div className="mt-[8px]" />
          <Linha r={`Parcela nova (${sim.numeroParcelasVeiculo} parcelas)`} v={`${formatCurrency(sim.valorParcelaTotal)} ${porFrequencia(sim.frequencia)}`} forte />
          <Linha r="Primeira parcela" v={isoParaBR(sim.dataPrimeiraParcela.slice(0, 10))} />
          {sim.excecoes.map((x) => <div key={x} className="mt-[4px]"><Aviso tom="warn">{x}</Aviso></div>)}
          <div className="mt-[6px] text-[11px]" style={muted}>Prévia pela mesma conta da novação na ficha. O contrato atual é encerrado e nasce outro, com aprovação.</div>
        </Caixa>
      )}
      <div className="flex flex-wrap gap-[6px]">
        {sim && c.janela.aberta && (
          <Botao variante="primaria" onClick={() => onMandar(textoNovacao({ nome: c.titular?.nome ?? null, prazoMeses: sim.prazoMeses, numeroParcelas: sim.numeroParcelasVeiculo, valorParcela: sim.valorParcelaTotal, frequencia: sim.frequencia, primeiraEm: sim.dataPrimeiraParcela }))}>
            Mandar ao cliente
          </Botao>
        )}
        {c.titular && <LinkArea to={`/titulares/${c.titular.id}`} area={AREAS_ROTA_FICHA_TITULAR} className="inline-flex min-h-[34px] items-center rounded-[10px] px-[12px] text-[12.5px] font-semibold" style={{ border: borda }}>Seguir para a novação na ficha</LinkArea>}
      </div>
    </div>
  );
}

function AbaQuitacao({ c, onMandar }: { c: Conversa; onMandar: (m: Mensagem) => void }) {
  const [contratoId, setContratoId] = useState(c.contratos[0]?.id ?? '');
  const [sim, setSim] = useState<SimulacaoQuitacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const contrato = c.contratos.find((k) => k.id === contratoId);
  async function simular() {
    setOcupado(true);
    try {
      setSim(await operacoesService.simularQuitacao(contratoId));
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="flex flex-col gap-[10px]">
      {c.contratos.length > 1 && (
        <select value={contratoId} onChange={(e) => { setContratoId(e.target.value); setSim(null); }} aria-label="Contrato" className={inputCls} style={campo}>
          {c.contratos.map((k) => <option key={k.id} value={k.id}>{k.numero}{k.ativo?.modelo ? ` · ${k.ativo.modelo}` : ''}</option>)}
        </select>
      )}
      <Botao className="self-start" carregando={ocupado} disabled={!contratoId} onClick={() => void simular()}>Simular quitação de hoje</Botao>
      {sim && (
        <Caixa>
          <Linha r={`${sim.parcelas.length} parcelas em aberto, valor de face`} v={formatCurrency(sim.valorNominalTotal)} />
          <Linha r="Desconto por antecipar" v={`− ${formatCurrency(sim.desconto)}`} />
          <Linha r="Para quitar hoje" v={formatCurrency(sim.valorQuitacao)} forte />
          <div className="mt-[6px] text-[11px]" style={muted}>Pela conta da quitação antecipada, a mesma do contrato. Executar a quitação continua na tela do contrato.</div>
        </Caixa>
      )}
      <div className="flex flex-wrap gap-[6px]">
        {sim && contrato && c.janela.aberta && (
          <Botao variante="primaria" onClick={() => onMandar(textoQuitacao({ nome: c.titular?.nome ?? null, contrato: contrato.numero, valorFace: sim.valorNominalTotal, desconto: sim.desconto, valorQuitacao: sim.valorQuitacao, hoje: hojeBrasilISO() }))}>
            Mandar ao cliente
          </Botao>
        )}
        {contrato && <LinkArea to={`/contratos/${contrato.id}`} area={AREAS_ROTA_CONTRATO} className="inline-flex min-h-[34px] items-center rounded-[10px] px-[12px] text-[12.5px] font-semibold" style={{ border: borda }}>Abrir no contrato</LinkArea>}
      </div>
    </div>
  );
}

const MOTIVO: Record<string, string> = { quitacao: 'Quitado', novacao: 'Novado', rescisao: 'Rescindido', cancelamento: 'Cancelado' };

function AbaHistorico({ c }: { c: Conversa }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <Rotulo>Contratos</Rotulo>
      {c.historico.map((k) => (
        <div key={k.id} className="flex items-center gap-[8px] py-[6px] text-[12px]" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <span className="min-w-0 flex-1">
            <b>{k.numero}</b>
            <span className="block text-[11px]" style={muted}>{k.ativo ?? '—'}{k.dataEncerramento ? ` · encerrado em ${dataBR(k.dataEncerramento)}` : ''}</span>
          </span>
          <span className="text-[11px] font-semibold" style={muted}>{k.motivoEncerramento ? MOTIVO[k.motivoEncerramento] ?? k.motivoEncerramento : k.status.toLowerCase()}</span>
        </div>
      ))}
      {c.titular && <LinkArea to={`/titulares/${c.titular.id}`} area={AREAS_ROTA_FICHA_TITULAR} className="mt-[4px] self-start text-[12px] font-semibold underline">Abrir a ficha</LinkArea>}
      <ListaSimulacoes c={c} />
    </div>
  );
}

// ---------------- O painel ----------------

export function PainelAtendimento({ c, onFechar }: { c: Conversa; onFechar?: () => void }) {
  const qc = useQueryClient();
  const comercial = useTemArea(AreaSistema.COMERCIAL);
  const [aba, setAba] = useState<string>('');
  const [msg, setMsg] = useState<Mensagem | null>(null);
  const posicao = useQuery({ queryKey: ['posicao', c.contaId], queryFn: () => faturaService.posicao(c.contaId!), enabled: c.etiqueta === EtiquetaContato.CLIENTE && !!c.contaId });

  const abas = useMemo(() => {
    const e = c.etiqueta;
    if (e === EtiquetaContato.CLIENTE && c.contaId) {
      const emAtraso = (posicao.data?.atraso.faturas ?? 0) > 0;
      return [
        { chave: 'posicao', rotulo: 'Posição de hoje' },
        ...(emAtraso ? [{ chave: 'acordo', rotulo: 'Acordo' }] : []),
        { chave: 'novacao', rotulo: 'Novação' },
        ...(c.contratos.length ? [{ chave: 'quitacao', rotulo: 'Quitação' }] : []),
      ];
    }
    if (e === EtiquetaContato.EX_CLIENTE) return [{ chave: 'historico', rotulo: 'Histórico' }, ...(comercial ? [{ chave: 'compra', rotulo: 'Simular compra' }] : [])];
    if (!comercial) return [];
    if (e === EtiquetaContato.LEAD && c.lead) return [{ chave: 'lead', rotulo: 'Lead' }, { chave: 'compra', rotulo: 'Simular compra' }];
    if (e === EtiquetaContato.LEAD) return [{ chave: 'compra', rotulo: 'Simular compra' }]; // titular sem contrato ativo
    return [{ chave: 'quem', rotulo: 'Quem é' }, { chave: 'compra', rotulo: 'Simular compra' }];
  }, [c.etiqueta, c.contaId, c.lead, c.contratos.length, comercial, posicao.data]);
  const atual = abas.find((a) => a.chave === aba)?.chave ?? abas[0]?.chave ?? '';

  const rotuloEtiqueta = NOME_ETIQUETA_CONTATO[c.etiqueta];
  const subtitulo = {
    [EtiquetaContato.CLIENTE]: 'Conta com contrato ativo',
    [EtiquetaContato.EX_CLIENTE]: 'Só contratos encerrados',
    [EtiquetaContato.LEAD]: c.lead ? 'Lead no funil, sem contrato' : 'Cadastrado, sem contrato ativo',
    [EtiquetaContato.NAO_CADASTRADO]: 'Número fora do sistema',
  }[c.etiqueta];
  const recarregar = () => void qc.invalidateQueries({ queryKey: ['conversa', c.numero] });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-[3px] px-[14px] py-[11px]" style={{ borderBottom: borda }}>
        <div className="flex items-center gap-[8px]">
          <span className="flex-1 font-display text-[15px] font-bold">Atendimento</span>
          <StatusBadge label={rotuloEtiqueta} colors={ETIQUETA_CONTATO_COLORS} />
          {onFechar && <Botao tamanho="sm" variante="fantasma" className="xl:hidden" onClick={onFechar}>Fechar</Botao>}
        </div>
        <div className="text-[11.5px]" style={muted}>{subtitulo}</div>
      </div>
      {abas.length > 0 ? (
        <>
          <Abas itens={abas} valor={atual} onChange={setAba} />
          <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto p-[14px]">
            {atual === 'quem' && <AbaQuemE c={c} />}
            {atual === 'lead' && <AbaLead c={c} />}
            {atual === 'compra' && <AbaCompra c={c} onMandar={setMsg} />}
            {atual === 'posicao' && <AbaPosicao c={c} onMandou={recarregar} />}
            {atual === 'acordo' && <AbaAcordo c={c} onMandar={setMsg} />}
            {atual === 'novacao' && <AbaNovacao c={c} onMandar={setMsg} />}
            {atual === 'quitacao' && <AbaQuitacao c={c} onMandar={setMsg} />}
            {atual === 'historico' && <AbaHistorico c={c} />}
          </div>
        </>
      ) : (
        <div className="p-[14px] text-[12px]" style={muted}>Sem ações para o seu acesso. Lead e simulação de compra são da área Comercial.</div>
      )}
      <JanelaEnvio numero={c.numero} msg={msg} janelaAberta={c.janela.aberta} onClose={() => setMsg(null)} />
    </div>
  );
}
