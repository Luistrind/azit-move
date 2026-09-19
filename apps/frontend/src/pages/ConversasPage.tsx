import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { conversasService as svc, type ItemConversa } from '../services/conversas.service';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { NOTIFICACAO_COBRANCA_STATUS_COLORS, FASE_POP_COLORS } from '../config/statusColors';

// Conversas do WhatsApp (doc 02 §24, opção C): o número dedicado fica só na
// API — o cliente que responde a uma notificação é atendido aqui. A conversa
// junta as mensagens trocadas e as notificações formais enviadas ao número.

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const formatarNumero = (n: string) => (n.length === 13 ? `(${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}` : `+${n}`);

// Status das mensagens enviadas → mesma paleta das notificações (Regra 9).
const COR_STATUS: Record<string, { bg: string; fg: string }> = {
  enviando: NOTIFICACAO_COBRANCA_STATUS_COLORS.PREPARADA,
  enviada: NOTIFICACAO_COBRANCA_STATUS_COLORS.ENVIADA,
  entregue: NOTIFICACAO_COBRANCA_STATUS_COLORS.ENTREGUE,
  lida: NOTIFICACAO_COBRANCA_STATUS_COLORS.LIDA,
  falhou: NOTIFICACAO_COBRANCA_STATUS_COLORS.FALHOU,
  simulada: NOTIFICACAO_COBRANCA_STATUS_COLORS.SIMULADA,
};

function Bolha({ item }: { item: ItemConversa }) {
  const minha = item.direcao === 'SAIDA';
  const formal = item.origem === 'notificacao';
  const cor = item.status ? COR_STATUS[item.status] : null;
  return (
    <div className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[78%] rounded-[12px] px-[12px] py-[8px] text-[13px]"
        style={{
          background: formal ? 'var(--surface-muted)' : minha ? 'var(--navy)' : 'var(--surface)',
          color: minha && !formal ? '#fff' : 'var(--text-primary)',
          border: formal ? '1px dashed var(--border)' : minha ? 'none' : '1px solid var(--border)',
        }}>
        {formal && <div className="mb-[2px] text-[10.5px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-muted)' }}>Notificação formal</div>}
        {item.texto && <div className="whitespace-pre-wrap break-words">{item.texto}</div>}
        {item.temMidia && (
          item.midiaDisponivel ? (
            <button className="mt-[4px] text-[12px] font-semibold underline" onClick={() => void svc.abrirMidia(item).catch((e) => toast.erro(mensagemErro(e)))}>
              {formal ? 'Abrir PDF enviado' : `Abrir anexo${item.midiaNome ? ` (${item.midiaNome})` : ` (${item.tipo})`}`}
            </button>
          ) : (
            <div className="mt-[4px] text-[11.5px] italic opacity-80">Anexo ({item.tipo}) ainda não baixado</div>
          )
        )}
        <div className="mt-[4px] flex flex-wrap items-center justify-end gap-[6px] text-[10.5px] opacity-80">
          {item.autor && <span>{item.autor}</span>}
          <span className="tabular-nums">{hora(item.momento)}</span>
          {minha && cor && item.status && (
            <span className="rounded-full px-[7px] py-[1px] font-bold" style={{ background: cor.bg, color: cor.fg }}>{item.status}</span>
          )}
        </div>
        {item.falhaMotivo && <div className="mt-[3px] text-[11px]" style={{ color: minha && !formal ? '#ffd9d6' : NOTIFICACAO_COBRANCA_STATUS_COLORS.FALHOU.fg }}>{item.falhaMotivo}</div>}
      </div>
    </div>
  );
}

function Thread({ numero, onVoltar }: { numero: string; onVoltar: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['conversa', numero], queryFn: () => svc.conversa(numero), refetchInterval: 20_000 });
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const c = q.data;

  // Abrir a conversa = ler: marca no sistema e manda o visto azul.
  const naoLidas = c?.itens.filter((i) => i.direcao === 'ENTRADA' && !i.lida).length ?? 0;
  useEffect(() => {
    if (naoLidas > 0) {
      void svc.marcarLida(numero).then(() => {
        void qc.invalidateQueries({ queryKey: ['conversas'] });
        void qc.invalidateQueries({ queryKey: ['regua'] });
      });
    }
  }, [numero, naoLidas, qc]);
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [c?.itens.length]);

  async function enviar() {
    setOcupado(true);
    try {
      const r = await svc.responder(numero, texto);
      if (r.resultado === 'falhou') toast.erro(`Não enviada: ${r.motivo}`);
      else if (r.resultado === 'simulada') toast.sucesso(`Registrada como SIMULADA — ${r.motivo}`);
      else toast.sucesso('Resposta enviada.');
      setTexto('');
      await qc.invalidateQueries({ queryKey: ['conversa', numero] });
      await qc.invalidateQueries({ queryKey: ['conversas'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  if (!c) return <div className="p-[16px] text-[13px]" style={{ color: 'var(--text-muted)' }}>{q.isLoading ? 'Carregando…' : mensagemErro(q.error)}</div>;

  const avisoEnvio = !c.envio.provedorConfigurado
    ? 'WhatsApp sem credencial neste ambiente: as respostas ficam registradas como SIMULADAS.'
    : !c.envio.producao && !c.envio.numeroAutorizadoTeste
      ? 'Ambiente de teste: este número não está autorizado — a resposta fica registrada como SIMULADA.'
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-[10px] px-[14px] py-[10px]" style={{ borderBottom: '1px solid var(--border)' }}>
        <button className="text-[13px] font-semibold md:hidden" onClick={onVoltar}>←</button>
        <div className="min-w-[180px] flex-1">
          <div className="truncate text-[14px] font-bold">
            {c.titular ? <Link to={`/titulares/${c.titular.id}`} className="hover:underline">{c.titular.nome}</Link> : c.nomePerfil ?? 'Número não identificado'}
          </div>
          <div className="text-[11.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {formatarNumero(c.numero)}{c.nomePerfil && c.titular ? ` · perfil "${c.nomePerfil}"` : ''}
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-[6px] md:w-auto">
          {c.contratos.map((k) => (
            <Link key={k.id} to={`/contratos/${k.id}`} className="rounded-full px-[10px] py-[2px] text-[11px] font-semibold"
              style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
              {k.numero}{k.ativo?.placa ? ` · ${k.ativo.placa}` : ''}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto p-[14px]" style={{ background: 'var(--surface-muted)' }}>
        {c.itens.length === 0 && <div className="text-center text-[12px]" style={{ color: 'var(--text-muted)' }}>Sem mensagens.</div>}
        {c.itens.map((i) => <Bolha key={`${i.origem}-${i.id}`} item={i} />)}
        <div ref={fim} />
      </div>

      <div className="flex flex-col gap-[6px] p-[12px]" style={{ borderTop: '1px solid var(--border)' }}>
        {c.janela.aberta ? (
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Pode responder até {hora(c.janela.ate as string)} (24h após a última mensagem do cliente).
          </div>
        ) : (
          <div className="rounded-[8px] px-[10px] py-[6px] text-[11.5px]" style={{ background: FASE_POP_COLORS.juridico.bg, color: FASE_POP_COLORS.juridico.fg }}>
            Janela de 24h fechada: a Meta só permite texto livre até 24h depois da última mensagem do cliente. Fora dela, só as
            notificações (modelos aprovados) podem ser enviadas.
          </div>
        )}
        {avisoEnvio && <div className="text-[11px]" style={{ color: NOTIFICACAO_COBRANCA_STATUS_COLORS.SIMULADA.fg }}>{avisoEnvio}</div>}
        <div className="flex gap-[8px]">
          <textarea rows={2} value={texto} disabled={!c.janela.aberta || ocupado} onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && texto.trim()) void enviar(); }}
            placeholder={c.janela.aberta ? 'Escreva a resposta (Ctrl+Enter envia)' : 'Aguardando nova mensagem do cliente'}
            className="min-w-0 flex-1 resize-none rounded-[8px] px-[10px] py-[7px] text-[13px] disabled:opacity-60"
            style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
          <button className="self-end rounded-[8px] px-[14px] py-[8px] text-[12.5px] font-bold text-white disabled:opacity-40"
            style={{ background: 'var(--navy)' }} disabled={!c.janela.aberta || ocupado || !texto.trim()} onClick={() => void enviar()}>
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConversasPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selecionado = params.get('numero');
  const lista = useQuery({ queryKey: ['conversas'], queryFn: () => svc.listar(), refetchInterval: 30_000 });
  const [teste, setTeste] = useState({ numero: '', texto: '' });
  const itens = lista.data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-[10px]">
      <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
        Respostas dos clientes às notificações de cobrança, recebidas no WhatsApp dedicado. Tudo o que chega fica
        registrado e entra no dossiê do contrato.
      </p>
      <div className="grid min-h-[520px] flex-1 grid-cols-1 overflow-hidden rounded-card md:grid-cols-[320px_1fr]"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className={`${selecionado ? 'hidden md:flex' : 'flex'} min-h-0 flex-col overflow-y-auto`} style={{ borderRight: '1px solid var(--border)' }}>
          {itens.length === 0 && (
            <div className="p-[16px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
              {lista.isLoading ? 'Carregando…' : 'Nenhuma conversa ainda. Quando um cliente responder a uma notificação, a conversa aparece aqui.'}
            </div>
          )}
          {itens.map((i) => (
            <button key={i.numero} onClick={() => setParams({ numero: i.numero })}
              className="flex flex-col gap-[2px] px-[14px] py-[10px] text-left"
              style={{ borderBottom: '1px solid var(--border)', background: selecionado === i.numero ? 'var(--surface-input)' : undefined }}>
              <div className="flex items-center justify-between gap-[8px]">
                <span className="truncate text-[13px] font-bold">{i.titular?.nome ?? i.nomePerfil ?? formatarNumero(i.numero)}</span>
                {i.naoLidas > 0 && (
                  <span className="rounded-full px-[7px] py-[1px] text-[10.5px] font-bold" style={{ background: NOTIFICACAO_COBRANCA_STATUS_COLORS.ENVIADA.bg, color: NOTIFICACAO_COBRANCA_STATUS_COLORS.ENVIADA.fg }}>
                    {i.naoLidas}
                  </span>
                )}
              </div>
              <div className="truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                {i.ultimaDirecao === 'SAIDA' ? 'Você: ' : ''}{i.ultimaPrevia}
              </div>
              <div className="text-[10.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {i.ultimaEm ? hora(i.ultimaEm) : ''}{i.titular ? '' : ' · número não identificado'}
              </div>
            </button>
          ))}
          {FERRAMENTAS_TESTE && (
            <div className="mt-auto flex flex-col gap-[6px] p-[12px] text-[11.5px]" style={{ borderTop: '1px solid var(--border)' }}>
              <b>Teste: simular resposta de cliente</b>
              <input value={teste.numero} onChange={(e) => setTeste({ ...teste, numero: e.target.value })} placeholder="WhatsApp (DDD + número)"
                className="rounded-[7px] px-[8px] py-[5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
              <input value={teste.texto} onChange={(e) => setTeste({ ...teste, texto: e.target.value })} placeholder="Texto (ex.: pago amanhã)"
                className="rounded-[7px] px-[8px] py-[5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
              <button className="rounded-[7px] px-[10px] py-[6px] font-semibold" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
                onClick={() => void svc.simularEntrada(teste.numero, teste.texto)
                  .then(() => { toast.sucesso('Mensagem simulada recebida.'); setTeste({ numero: '', texto: '' }); return qc.invalidateQueries({ queryKey: ['conversas'] }); })
                  .catch((e) => toast.erro(mensagemErro(e)))}>
                Simular recebimento
              </button>
            </div>
          )}
        </div>
        <div className={`${selecionado ? 'flex' : 'hidden md:flex'} min-h-0 flex-col`}>
          {selecionado ? (
            <Thread key={selecionado} numero={selecionado} onVoltar={() => setParams({})} />
          ) : (
            <div className="m-auto p-[16px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Selecione uma conversa.</div>
          )}
        </div>
      </div>
    </div>
  );
}
