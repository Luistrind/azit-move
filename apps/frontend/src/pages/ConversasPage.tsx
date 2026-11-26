import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EtiquetaContato,
  NOME_ETIQUETA_CONTATO,
  NOME_SITUACAO_MENSAGEM_WHATSAPP,
  nomeMomentoLembrete,
  nomeSituacaoLembrete,
  TipoMidiaSaidaWhatsapp,
} from '@azit/types';
import { AUDIO_MAX_SEGUNDOS_WHATSAPP, formatarWhatsapp, validarMidiaSaidaWhatsapp } from '@azit/utils';
import { conversasService as svc, lerComoBase64, type Conversa, type ItemConversa, type ResultadoSaida, type ResumoConversa } from '../services/conversas.service';
import { ETIQUETA_CONTATO_COLORS, LEMBRETE_SITUACAO_COLORS, MENSAGEM_WHATSAPP_COLORS } from '../config/statusColors';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { instanteCurtoBR } from '../lib/datas';
import { AREAS_ROTA_CONTRATO, AREAS_ROTA_FICHA_TITULAR, mensagemErro } from '../lib/permissoes';
import { Botao } from '../components/Botao';
import { Chips } from '../components/Chips';
import { LinkArea } from '../components/LinkArea';
import { StatusBadge } from '../components/StatusBadge';
import { toast } from '../components/Toast';
import { PainelAtendimento } from './conversas/PainelAtendimento';

// Conversas do WhatsApp (doc 02 §24 e §34): o atendimento do número oficial.
// Lista pela última atividade (o lembrete conta), etiqueta automática de quem é
// o número, conversa no meio com texto, imagem, documento e áudio, e o painel
// de atendimento à direita (lead e simulação de compra; posição, acordo,
// novação e quitação do cliente).

const muted = { color: 'var(--text-muted)' } as const;
const borda = '1px solid var(--border)';
const campo = { background: 'var(--surface-input)', border: borda, color: 'var(--text-primary)' } as const;

function nomeDe(i: { titular: { nome: string } | null; lead?: { nome: string } | null; nomePerfil: string | null; numero: string }) {
  return i.titular?.nome ?? i.lead?.nome ?? i.nomePerfil ?? formatarWhatsapp(i.numero);
}

function avisarResultado(r: ResultadoSaida, ok: string) {
  if (r.resultado === 'falhou') toast.erro(`Não enviada: ${r.motivo}`);
  else if (r.resultado === 'enviada') toast.sucesso(ok);
  else toast.info(`Registrada como ${r.resultado} — ${r.motivo}`);
}

// Áudio dentro da bolha: baixa só quando o operador pede para ouvir.
function Audio({ item }: { item: ItemConversa }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!item.midiaDisponivel) return <div className="mt-[4px] text-[11.5px] italic" style={muted}>Áudio ainda não baixado</div>;
  return url ? (
    <audio controls autoPlay src={url} className="mt-[4px] h-[36px] max-w-full" />
  ) : (
    <button type="button" className="mt-[4px] text-[12px] font-semibold underline" onClick={() => void svc.urlMidia(item.id).then(setUrl).catch((e) => toast.erro(mensagemErro(e)))}>
      Ouvir áudio
    </button>
  );
}

function Bolha({ item }: { item: ItemConversa }) {
  const minha = item.direcao === 'SAIDA';
  const lembrete = item.origem === 'lembrete';
  const situacao = !item.situacao
    ? null
    : lembrete
      ? { rotulo: nomeSituacaoLembrete(item.situacao), cores: LEMBRETE_SITUACAO_COLORS }
      : { rotulo: NOME_SITUACAO_MENSAGEM_WHATSAPP[item.situacao] ?? item.situacao, cores: MENSAGEM_WHATSAPP_COLORS };
  return (
    <div className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[82%] rounded-[12px] px-[12px] py-[8px] text-[13px] md:max-w-[70%]"
        style={{
          background: lembrete ? 'var(--surface-muted)' : minha ? 'var(--info-bg)' : 'var(--surface)',
          color: 'var(--text-primary)',
          border: lembrete ? '1px dashed var(--border)' : borda,
        }}
      >
        {lembrete && (
          <div className="mb-[2px] text-[10.5px] font-bold uppercase tracking-[.04em]" style={muted}>
            Lembrete de pagamento · {nomeMomentoLembrete(item.tipo).toLowerCase()}
          </div>
        )}
        {item.temMidia && item.tipo === 'audio' && <Audio item={item} />}
        {item.temMidia && item.tipo !== 'audio' &&
          (item.midiaDisponivel ? (
            <button type="button" className="mb-[4px] text-[12px] font-semibold underline" onClick={() => void svc.abrirMidia(item).catch((e) => toast.erro(mensagemErro(e)))}>
              {item.tipo === 'image' ? 'Ver imagem' : 'Abrir anexo'}{item.midiaNome ? ` (${item.midiaNome})` : ''}
            </button>
          ) : (
            <div className="mb-[4px] text-[11.5px] italic" style={muted}>Anexo ({item.tipo}) ainda não baixado</div>
          ))}
        {item.texto && <div className="whitespace-pre-wrap break-words">{item.texto}</div>}
        <div className="mt-[4px] flex flex-wrap items-center justify-end gap-[6px] text-[10.5px]" style={muted}>
          {item.autor && <span>{item.autor}</span>}
          <span className="tabular-nums">{instanteCurtoBR(item.momento)}</span>
          {minha && situacao && <StatusBadge label={situacao.rotulo} colors={situacao.cores} />}
        </div>
        {item.motivo && <div className="mt-[3px] text-[11px]" style={muted}>{item.motivo}</div>}
      </div>
    </div>
  );
}

// Por que o operador não consegue (ou não vai conseguir de verdade) responder.
function avisoDeEnvio(c: Conversa): string | null {
  if (c.envio.enviaDeVerdade) return null;
  return c.envio.producao
    ? `As respostas ficam retidas: ${c.envio.motivo ?? 'WhatsApp sem credencial'}.`
    : `Ambiente de teste — a resposta fica registrada como simulada: ${c.envio.motivo ?? 'nada é enviado'}.`;
}

type Anexo = { tipo: TipoMidiaSaidaWhatsapp; arquivo: File };

// Campo de resposta: texto, anexo (imagem/documento) e áudio gravado (§34.6).
function Compositor({ c }: { c: Conversa }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [menu, setMenu] = useState(false);
  const [anexo, setAnexo] = useState<Anexo | null>(null);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const inputImagem = useRef<HTMLInputElement>(null);
  const inputDoc = useRef<HTMLInputElement>(null);
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const descartar = useRef(false);
  const relogio = useRef<number | null>(null);
  const podeGravar = typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia;

  const atualizar = async () => {
    await qc.invalidateQueries({ queryKey: ['conversa', c.numero] });
    await qc.invalidateQueries({ queryKey: ['conversas'] });
  };
  useEffect(() => () => pararGravacao(true), []);

  function escolher(tipo: TipoMidiaSaidaWhatsapp, f: File | undefined) {
    setMenu(false);
    if (!f) return;
    const invalido = validarMidiaSaidaWhatsapp(tipo, f.type, f.size);
    if (invalido) return toast.erro(invalido);
    setAnexo({ tipo, arquivo: f });
  }

  async function enviar() {
    if (!texto.trim() && !anexo) return;
    setOcupado(true);
    try {
      if (anexo) {
        const r = await svc.enviarAnexo(c.numero, { tipo: anexo.tipo, nome: anexo.arquivo.name, mime: anexo.arquivo.type, conteudoBase64: await lerComoBase64(anexo.arquivo), legenda: texto.trim() || undefined });
        avisarResultado(r, 'Anexo enviado.');
        setAnexo(null);
      } else {
        avisarResultado(await svc.responder(c.numero, texto), 'Resposta enviada.');
      }
      setTexto('');
      await atualizar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function iniciarGravacao() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      pedacos.current = [];
      descartar.current = false;
      rec.ondataavailable = (ev) => { if (ev.data.size) pedacos.current.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!descartar.current) void mandarAudio(new Blob(pedacos.current, { type: rec.mimeType || 'audio/webm' }));
      };
      gravador.current = rec;
      rec.start(1000);
      setSegundos(0);
      setGravando(true);
      relogio.current = window.setInterval(() => {
        setSegundos((s) => {
          if (s + 1 >= AUDIO_MAX_SEGUNDOS_WHATSAPP) pararGravacao(false); // limite de 5 minutos (§34.6)
          return s + 1;
        });
      }, 1000);
    } catch {
      toast.erro('Não foi possível usar o microfone. Libere o acesso ao microfone no navegador.');
    }
  }
  function pararGravacao(descarta: boolean) {
    if (relogio.current) window.clearInterval(relogio.current);
    relogio.current = null;
    descartar.current = descarta;
    if (gravador.current && gravador.current.state !== 'inactive') gravador.current.stop();
    gravador.current = null;
    setGravando(false);
  }
  async function mandarAudio(blob: Blob) {
    setOcupado(true);
    try {
      const r = await svc.enviarAnexo(c.numero, { tipo: TipoMidiaSaidaWhatsapp.AUDIO, nome: 'gravacao.webm', mime: blob.type, conteudoBase64: await lerComoBase64(blob) });
      avisarResultado(r, 'Áudio enviado como mensagem de voz.');
      await atualizar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const aviso = avisoDeEnvio(c);
  if (!c.janela.aberta) {
    return (
      <div className="p-[12px]" style={{ borderTop: borda }}>
        <div className="rounded-[8px] px-[10px] py-[6px] text-[11.5px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
          {c.respondeu
            ? `Não é possível responder agora: a Meta só permite texto, áudio ou anexo até ${c.janela.horas} horas depois da última mensagem do cliente. Quando ele escrever de novo, a resposta volta a ficar disponível.`
            : `Este contato ainda não escreveu: só recebeu lembrete automático. A Meta só permite mensagem livre depois que o cliente escreve. Para falar antes disso, use "Enviar pelo WhatsApp" na ficha (sai do seu aparelho).`}
        </div>
      </div>
    );
  }
  const mm = Math.floor(segundos / 60);
  const ss = String(segundos % 60).padStart(2, '0');
  return (
    <div className="relative flex flex-col gap-[6px] p-[12px]" style={{ borderTop: borda }}>
      <div className="text-[11px]" style={muted}>
        Pode responder até {c.janela.ate ? instanteCurtoBR(c.janela.ate) : ''} ({c.janela.horas} horas depois da última mensagem do cliente).
      </div>
      {aviso && <div className="text-[11px]" style={{ color: c.envio.producao ? 'var(--danger-fg)' : 'var(--info-fg)' }}>{aviso}</div>}
      {anexo && (
        <div className="flex items-center gap-[10px] rounded-[10px] px-[10px] py-[7px] text-[12px]" style={{ background: 'var(--surface-input)' }}>
          <span className="min-w-0 flex-1 truncate">
            <b>{anexo.tipo === TipoMidiaSaidaWhatsapp.IMAGEM ? 'Imagem' : 'Documento'}</b> · {anexo.arquivo.name}
            <span className="block text-[11px]" style={muted}>o texto abaixo vai como legenda</span>
          </span>
          <Botao tamanho="sm" variante="fantasma" onClick={() => setAnexo(null)}>remover</Botao>
        </div>
      )}
      {gravando ? (
        <div className="flex items-center gap-[8px]">
          <Botao tamanho="sm" variante="fantasma" onClick={() => pararGravacao(true)} aria-label="Descartar áudio">Descartar</Botao>
          <div className="flex h-[40px] flex-1 items-center gap-[10px] rounded-[10px] px-[12px] text-[13px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
            <span className="tabular-nums">{mm}:{ss}</span>
            <span className="font-medium">gravando… (até 5 minutos)</span>
          </div>
          <Botao variante="primaria" onClick={() => pararGravacao(false)}>Enviar áudio</Botao>
        </div>
      ) : (
        <div className="flex items-end gap-[8px]">
          <Botao variante="secundaria" className="h-[40px]" aria-label="Anexar imagem ou documento" aria-expanded={menu} disabled={ocupado} onClick={() => setMenu((m) => !m)}>
            Anexar
          </Botao>
          <textarea
            rows={2}
            value={texto}
            disabled={ocupado}
            maxLength={anexo ? 1024 : 4096}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void enviar(); }}
            placeholder={anexo ? 'Legenda (opcional)' : 'Escreva a resposta (Ctrl+Enter envia)'}
            aria-label="Resposta ao cliente"
            className="min-w-0 flex-1 resize-none rounded-[10px] px-[10px] py-[7px] text-[13px] disabled:opacity-60"
            style={campo}
          />
          {podeGravar && !anexo && !texto.trim() ? (
            <Botao variante="secundaria" className="h-[40px]" disabled={ocupado} carregando={ocupado} onClick={() => void iniciarGravacao()} aria-label="Gravar áudio">
              Gravar áudio
            </Botao>
          ) : (
            <Botao variante="primaria" className="h-[40px]" carregando={ocupado} disabled={!texto.trim() && !anexo} onClick={() => void enviar()}>Enviar</Botao>
          )}
        </div>
      )}
      {menu && (
        <div role="menu" className="absolute bottom-[58px] left-[12px] z-10 flex min-w-[230px] flex-col rounded-[12px] p-[6px]" style={{ background: 'var(--surface)', border: borda, boxShadow: '0 12px 30px rgba(0,16,41,.18)' }}>
          <button type="button" role="menuitem" className="rounded-[8px] px-[10px] py-[8px] text-left text-[12.5px] hover:bg-[var(--surface-input)]" onClick={() => inputImagem.current?.click()}>
            Imagem<span className="block text-[11px]" style={muted}>JPG ou PNG, até 5 MB</span>
          </button>
          <button type="button" role="menuitem" className="rounded-[8px] px-[10px] py-[8px] text-left text-[12.5px] hover:bg-[var(--surface-input)]" onClick={() => inputDoc.current?.click()}>
            PDF ou documento<span className="block text-[11px]" style={muted}>PDF, Word, Excel ou texto, até 20 MB</span>
          </button>
        </div>
      )}
      <input ref={inputImagem} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { escolher(TipoMidiaSaidaWhatsapp.IMAGEM, e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={inputDoc} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt" hidden onChange={(e) => { escolher(TipoMidiaSaidaWhatsapp.DOCUMENTO, e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

function Conversa_({ numero, onVoltar }: { numero: string; onVoltar: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['conversa', numero], queryFn: () => svc.conversa(numero), refetchInterval: 20_000 });
  const [painel, setPainel] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const c = q.data;

  // Abrir a conversa = ler: marca no sistema e manda o visto azul ao cliente.
  const naoLidas = c?.itens.filter((i) => i.direcao === 'ENTRADA' && !i.lida).length ?? 0;
  useEffect(() => {
    if (naoLidas > 0) {
      void svc.marcarLida(numero).then(() => {
        void qc.invalidateQueries({ queryKey: ['conversas'] });
        void qc.invalidateQueries({ queryKey: ['conversas-nao-lidas'] }); // contador do menu
        void qc.invalidateQueries({ queryKey: ['conversa', numero] });
      });
    }
  }, [numero, naoLidas, qc]);
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [c?.itens.length]);

  // "Marcar como não lida" (§34.2): volta a última recebida e FECHA a conversa,
  // para o efeito acima não ler de novo na hora. Só no sistema — o visto do cliente fica.
  const [marcando, setMarcando] = useState(false);
  const temRecebida = !!c?.itens.some((i) => i.origem === 'mensagem' && i.direcao === 'ENTRADA');
  async function marcarNaoLida() {
    setMarcando(true);
    try {
      await svc.marcarNaoLida(numero);
      qc.removeQueries({ queryKey: ['conversa', numero] });
      void qc.invalidateQueries({ queryKey: ['conversas'] });
      void qc.invalidateQueries({ queryKey: ['conversas-nao-lidas'] });
      toast.sucesso('Conversa marcada como não lida');
      onVoltar();
    } catch (e) {
      toast.erro(mensagemErro(e));
      setMarcando(false);
    }
  }

  if (!c) return <div className="p-[16px] text-[13px]" style={muted}>{q.isLoading ? 'Carregando…' : mensagemErro(q.error)}</div>;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-[10px] px-[14px] py-[10px]" style={{ borderBottom: borda }}>
          <button type="button" className="text-[13px] font-semibold md:hidden" aria-label="Voltar para a lista de conversas" onClick={onVoltar}>←</button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-[8px] truncate text-[14px] font-bold">
              {c.titular ? (
                <LinkArea to={`/titulares/${c.titular.id}`} area={AREAS_ROTA_FICHA_TITULAR} className="truncate hover:underline">{c.titular.nome}</LinkArea>
              ) : (
                <span className="truncate">{c.lead?.nome ?? c.nomePerfil ?? 'Número não identificado'}</span>
              )}
              <StatusBadge label={NOME_ETIQUETA_CONTATO[c.etiqueta]} colors={ETIQUETA_CONTATO_COLORS} />
            </div>
            <div className="text-[11.5px] tabular-nums" style={muted}>
              {formatarWhatsapp(c.numero)}
              {c.nomePerfil && (c.titular || c.lead) ? ` · perfil "${c.nomePerfil}"` : ''}
            </div>
          </div>
          <div className="flex flex-wrap gap-[6px]">
            {c.contratos.map((k) => (
              <LinkArea key={k.id} to={`/contratos/${k.id}`} area={AREAS_ROTA_CONTRATO} className="rounded-full px-[10px] py-[2px] text-[11px] font-semibold" style={{ background: 'var(--surface-input)', border: borda }}>
                {k.numero}{k.ativo?.placa ? ` · ${k.ativo.placa}` : ''}
              </LinkArea>
            ))}
            {temRecebida && (
              <Botao tamanho="sm" carregando={marcando} onClick={() => void marcarNaoLida()} title="Volta a contar como não lida só no sistema; o visto do cliente continua">
                Marcar como não lida
              </Botao>
            )}
            <Botao tamanho="sm" className="xl:hidden" onClick={() => setPainel(true)}>Atendimento</Botao>
          </div>
        </div>

        <div className="flex min-h-[320px] flex-1 flex-col gap-[8px] overflow-y-auto p-[14px]" style={{ background: 'var(--surface-muted)' }}>
          {c.itens.length === 0 && <div className="text-center text-[12px]" style={muted}>Sem mensagens.</div>}
          {c.itens.map((i) => <Bolha key={`${i.origem}-${i.id}`} item={i} />)}
          <div ref={fim} />
        </div>
        <Compositor c={c} />
      </div>

      {/* Painel: coluna fixa em tela larga; por cima, pelo botão "Atendimento", nas menores (§34.1). */}
      <aside className="hidden min-h-0 xl:flex xl:flex-col" style={{ borderLeft: borda }}>
        <PainelAtendimento c={c} />
      </aside>
      {painel && (
        <div className="fixed inset-0 z-40 flex justify-end xl:hidden" style={{ background: 'rgba(0,16,41,.35)' }} onClick={() => setPainel(false)}>
          <aside className="flex h-full w-full max-w-[400px] flex-col" style={{ background: 'var(--surface)' }} onClick={(e) => e.stopPropagation()}>
            <PainelAtendimento c={c} onFechar={() => setPainel(false)} />
          </aside>
        </div>
      )}
    </div>
  );
}

type FiltroLidas = 'todas' | 'nao_lidas' | 'responderam';

export function ConversasPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selecionado = params.get('numero');
  const lista = useQuery({ queryKey: ['conversas'], queryFn: () => svc.listar(), refetchInterval: 30_000 });
  const [teste, setTeste] = useState({ numero: '', texto: '' });
  const [lidas, setLidas] = useState<FiltroLidas>('todas');
  const [etiqueta, setEtiqueta] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const todos = useMemo(() => lista.data ?? [], [lista.data]);

  const itens = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = termo.replace(/\D/g, '');
    return todos
      .filter((i) => lidas === 'todas' || (lidas === 'nao_lidas' ? i.naoLidas > 0 : i.respondeu))
      .filter((i) => !etiqueta || i.etiqueta === etiqueta)
      .filter((i) => !termo || nomeDe(i).toLowerCase().includes(termo) || (i.nomePerfil ?? '').toLowerCase().includes(termo) || (digitos.length >= 3 && i.numero.includes(digitos)));
  }, [todos, lidas, etiqueta, busca]);
  const contagemEtiqueta = (e: EtiquetaContato) => todos.filter((i) => i.etiqueta === e).length;

  async function simular() {
    try {
      await svc.simularEntrada(teste.numero, teste.texto);
      toast.sucesso('Mensagem simulada enviada pela fila do webhook.');
      setTeste({ numero: '', texto: '' });
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['conversas'] }), 1500);
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }

  const botaoLidas = (k: FiltroLidas, rotulo: string, n?: number) => (
    <button
      type="button"
      onClick={() => setLidas(k)}
      aria-pressed={lidas === k}
      className="rounded-[8px] px-[9px] py-[4px] text-[11.5px] font-semibold"
      style={lidas === k ? { background: 'var(--surface)', color: 'var(--text-primary)', boxShadow: '0 1px 2px rgba(0,16,41,.12)' } : { color: 'var(--text-body)' }}
    >
      {rotulo}{n !== undefined ? <span className="ml-[3px] font-medium" style={muted}>{n}</span> : null}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-[10px]">
      <p className="text-[12.5px]" style={muted}>
        Clientes e leads que escrevem para o WhatsApp da Azit. O número fica só no sistema: responda por aqui, em até 24 horas depois da
        última mensagem da pessoa. Ao lado de cada conversa ficam os dados dela e as simulações.
      </p>
      <div className="grid min-h-[560px] flex-1 grid-cols-1 overflow-hidden rounded-card md:grid-cols-[300px_1fr]" style={{ background: 'var(--surface)', border: borda }}>
        <div className={`${selecionado ? 'hidden md:flex' : 'flex'} min-h-0 flex-col`} style={{ borderRight: borda }}>
          <div className="flex flex-col gap-[8px] p-[12px]" style={{ borderBottom: borda }}>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou número" aria-label="Buscar conversa" className="h-[32px] rounded-[9px] px-[10px] text-[12.5px]" style={campo} />
            <div className="inline-flex self-start rounded-[10px] p-[3px]" style={{ background: 'var(--surface-input)' }}>
              {botaoLidas('todas', 'Todas')}
              {botaoLidas('nao_lidas', 'Não lidas', todos.filter((i) => i.naoLidas > 0).length)}
              {botaoLidas('responderam', 'Só quem respondeu')}
            </div>
            <Chips
              tamanho="sm"
              todos="Todos"
              valor={etiqueta}
              onChange={setEtiqueta}
              itens={Object.values(EtiquetaContato).map((e) => ({ chave: e, rotulo: NOME_ETIQUETA_CONTATO[e], contagem: contagemEtiqueta(e) }))}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {itens.length === 0 && (
              <div className="p-[16px] text-[12.5px]" style={muted}>
                {lista.isLoading ? 'Carregando…' : lista.error ? mensagemErro(lista.error) : todos.length ? 'Nenhuma conversa com esse filtro.' : 'Nenhuma conversa ainda. Quando alguém escrever ou receber um lembrete, a conversa aparece aqui.'}
              </div>
            )}
            {itens.map((i: ResumoConversa) => (
              <button
                key={i.numero}
                type="button"
                onClick={() => setParams({ numero: i.numero })}
                className="flex w-full flex-col gap-[3px] px-[12px] py-[10px] text-left"
                style={{ borderBottom: '1px solid var(--border-light)', background: selecionado === i.numero ? 'var(--surface-input)' : undefined }}
              >
                <div className="flex items-center justify-between gap-[8px]">
                  <span className="truncate text-[13px] font-bold">{nomeDe(i)}</span>
                  <span className="shrink-0 text-[10.5px] tabular-nums" style={i.naoLidas ? { color: 'var(--ok-fg)', fontWeight: 700 } : muted}>{i.ultimaEm ? instanteCurtoBR(i.ultimaEm) : ''}</span>
                </div>
                <div className="flex items-center gap-[6px]">
                  <span className="min-w-0 flex-1 truncate text-[11.5px]" style={i.naoLidas ? { color: 'var(--text-primary)', fontWeight: 600 } : { color: 'var(--text-body)' }}>
                    {i.ultimaOrigem === 'mensagem' && i.ultimaDirecao === 'SAIDA' ? 'Azit: ' : ''}{i.ultimaPrevia}
                  </span>
                  {i.naoLidas > 0 && (
                    <span className="rounded-full px-[7px] py-[1px] text-[10.5px] font-bold" style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)' }} aria-label={`${i.naoLidas} mensagem(ns) não lida(s)`}>
                      {i.naoLidas}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-[6px]">
                  <StatusBadge label={NOME_ETIQUETA_CONTATO[i.etiqueta]} colors={ETIQUETA_CONTATO_COLORS} />
                  {!i.respondeu && <span className="text-[10.5px]" style={muted}>só lembrete, nunca respondeu</span>}
                </div>
              </button>
            ))}
          </div>
          {FERRAMENTAS_TESTE && (
            <div className="flex flex-col gap-[6px] p-[12px] text-[11.5px]" style={{ borderTop: borda }}>
              <b>Teste: simular mensagem de um cliente</b>
              <input value={teste.numero} onChange={(e) => setTeste({ ...teste, numero: e.target.value })} placeholder="WhatsApp (DDD + número)" inputMode="tel"
                aria-label="WhatsApp do cliente simulado" className="h-[30px] rounded-[8px] px-[8px]" style={campo} />
              <input value={teste.texto} onChange={(e) => setTeste({ ...teste, texto: e.target.value })} placeholder="Texto (ex.: pago amanhã)"
                aria-label="Texto da mensagem simulada" className="h-[30px] rounded-[8px] px-[8px]" style={campo} />
              <Botao tamanho="sm" variante="secundaria" disabled={!teste.numero.trim()} onClick={() => void simular()}>Simular recebimento</Botao>
            </div>
          )}
        </div>
        <div className={`${selecionado ? 'flex' : 'hidden md:flex'} min-h-0 flex-col`}>
          {selecionado ? (
            <Conversa_ key={selecionado} numero={selecionado} onVoltar={() => setParams({})} />
          ) : (
            <div className="m-auto p-[16px] text-[12.5px]" style={muted}>Selecione uma conversa.</div>
          )}
        </div>
      </div>
    </div>
  );
}
