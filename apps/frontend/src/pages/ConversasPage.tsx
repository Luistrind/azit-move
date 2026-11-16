import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { nomeMomentoLembrete, nomeSituacaoLembrete, NOME_SITUACAO_MENSAGEM_WHATSAPP } from '@azit/types';
import { formatarWhatsapp } from '@azit/utils';
import { conversasService as svc, type Conversa, type ItemConversa } from '../services/conversas.service';
import { LEMBRETE_SITUACAO_COLORS, MENSAGEM_WHATSAPP_COLORS } from '../config/statusColors';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { instanteCurtoBR } from '../lib/datas';
import { AREAS_ROTA_CONTRATO, AREAS_ROTA_FICHA_TITULAR, mensagemErro } from '../lib/permissoes';
import { Botao } from '../components/Botao';
import { LinkArea } from '../components/LinkArea';
import { StatusBadge } from '../components/StatusBadge';
import { toast } from '../components/Toast';

// Conversas do WhatsApp (doc 02 §24): o número dedicado fica só na API — o
// cliente que responde a um lembrete é atendido aqui. A conversa é do número,
// ligada ao titular quando bate com o cadastro, e junta as mensagens trocadas
// aos lembretes enviados àquele número.

const muted = { color: 'var(--text-muted)' } as const;
const borda = '1px solid var(--border)';
const campo = { background: 'var(--surface-input)', border: borda, color: 'var(--text-primary)' } as const;

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
        {item.texto && <div className="whitespace-pre-wrap break-words">{item.texto}</div>}
        {item.temMidia &&
          (item.midiaDisponivel ? (
            <button type="button" className="mt-[4px] text-[12px] font-semibold underline" onClick={() => void svc.abrirMidia(item).catch((e) => toast.erro(mensagemErro(e)))}>
              Abrir anexo{item.midiaNome ? ` (${item.midiaNome})` : ` (${item.tipo})`}
            </button>
          ) : (
            <div className="mt-[4px] text-[11.5px] italic" style={muted}>Anexo ({item.tipo}) ainda não baixado</div>
          ))}
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

function Conversa_({ numero, onVoltar }: { numero: string; onVoltar: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['conversa', numero], queryFn: () => svc.conversa(numero), refetchInterval: 20_000 });
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const c = q.data;

  // Abrir a conversa = ler: marca no sistema e manda o visto azul ao cliente.
  const naoLidas = c?.itens.filter((i) => i.direcao === 'ENTRADA' && !i.lida).length ?? 0;
  useEffect(() => {
    if (naoLidas > 0) {
      void svc.marcarLida(numero).then(() => {
        void qc.invalidateQueries({ queryKey: ['conversas'] });
        void qc.invalidateQueries({ queryKey: ['conversa', numero] });
      });
    }
  }, [numero, naoLidas, qc]);
  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [c?.itens.length]);

  async function enviar() {
    if (!texto.trim()) return;
    setOcupado(true);
    try {
      const r = await svc.responder(numero, texto);
      if (r.resultado === 'falhou') toast.erro(`Não enviada: ${r.motivo}`);
      else if (r.resultado === 'enviada') toast.sucesso('Resposta enviada.');
      else toast.info(`Registrada como ${r.resultado} — ${r.motivo}`);
      setTexto('');
      await qc.invalidateQueries({ queryKey: ['conversa', numero] });
      await qc.invalidateQueries({ queryKey: ['conversas'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  if (!c) return <div className="p-[16px] text-[13px]" style={muted}>{q.isLoading ? 'Carregando…' : mensagemErro(q.error)}</div>;
  const aviso = avisoDeEnvio(c);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-[10px] px-[14px] py-[10px]" style={{ borderBottom: borda }}>
        <button type="button" className="text-[13px] font-semibold md:hidden" aria-label="Voltar para a lista de conversas" onClick={onVoltar}>←</button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold">
            {c.titular ? (
              <LinkArea to={`/titulares/${c.titular.id}`} area={AREAS_ROTA_FICHA_TITULAR} className="hover:underline">{c.titular.nome}</LinkArea>
            ) : (
              c.nomePerfil ?? 'Número não identificado'
            )}
          </div>
          <div className="text-[11.5px] tabular-nums" style={muted}>
            {formatarWhatsapp(c.numero)}
            {c.nomePerfil && c.titular ? ` · perfil "${c.nomePerfil}"` : ''}
            {!c.titular ? ' · não bate com o WhatsApp de nenhum titular' : ''}
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-[6px] md:w-auto">
          {c.contratos.map((k) => (
            <LinkArea key={k.id} to={`/contratos/${k.id}`} area={AREAS_ROTA_CONTRATO} className="rounded-full px-[10px] py-[2px] text-[11px] font-semibold" style={{ background: 'var(--surface-input)', border: borda }}>
              {k.numero}{k.ativo?.placa ? ` · ${k.ativo.placa}` : ''}
            </LinkArea>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto p-[14px]" style={{ background: 'var(--surface-muted)' }}>
        {c.itens.length === 0 && <div className="text-center text-[12px]" style={muted}>Sem mensagens.</div>}
        {c.itens.map((i) => <Bolha key={`${i.origem}-${i.id}`} item={i} />)}
        <div ref={fim} />
      </div>

      <div className="flex flex-col gap-[6px] p-[12px]" style={{ borderTop: borda }}>
        {c.janela.aberta ? (
          <div className="text-[11px]" style={muted}>
            Pode responder até {c.janela.ate ? instanteCurtoBR(c.janela.ate) : ''} ({c.janela.horas} horas depois da última mensagem do cliente).
          </div>
        ) : (
          <div className="rounded-[8px] px-[10px] py-[6px] text-[11.5px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }}>
            Não é possível responder agora: a Meta só permite texto livre até {c.janela.horas} horas depois da última mensagem do cliente.
            Quando ele escrever de novo, a resposta volta a ficar disponível.
          </div>
        )}
        {c.janela.aberta && aviso && <div className="text-[11px]" style={{ color: c.envio.producao ? 'var(--danger-fg)' : 'var(--info-fg)' }}>{aviso}</div>}
        {/* Regra "não mostrar o que não pode": fora da janela o campo nem aparece. */}
        {c.janela.aberta && (
          <div className="flex gap-[8px]">
            <textarea
              rows={2}
              value={texto}
              disabled={ocupado}
              maxLength={4096}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void enviar(); }}
              placeholder="Escreva a resposta (Ctrl+Enter envia)"
              aria-label="Resposta ao cliente"
              className="min-w-0 flex-1 resize-none rounded-[10px] px-[10px] py-[7px] text-[13px] disabled:opacity-60"
              style={campo}
            />
            <Botao variante="primaria" className="self-end" carregando={ocupado} disabled={!texto.trim()} onClick={() => void enviar()}>Enviar</Botao>
          </div>
        )}
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-[10px]">
      <p className="text-[12.5px]" style={muted}>
        O que os clientes respondem no WhatsApp da Azit. O número fica só no sistema: responda por aqui, em até 24 horas depois da
        última mensagem do cliente.
      </p>
      <div className="grid min-h-[520px] flex-1 grid-cols-1 overflow-hidden rounded-card md:grid-cols-[320px_1fr]" style={{ background: 'var(--surface)', border: borda }}>
        <div className={`${selecionado ? 'hidden md:flex' : 'flex'} min-h-0 flex-col overflow-y-auto`} style={{ borderRight: borda }}>
          {itens.length === 0 && (
            <div className="p-[16px] text-[12.5px]" style={muted}>
              {lista.isLoading ? 'Carregando…' : lista.error ? mensagemErro(lista.error) : 'Nenhuma conversa ainda. Quando um cliente responder a um lembrete, a conversa aparece aqui.'}
            </div>
          )}
          {itens.map((i) => (
            <button
              key={i.numero}
              type="button"
              onClick={() => setParams({ numero: i.numero })}
              className="flex flex-col gap-[2px] px-[14px] py-[10px] text-left"
              style={{ borderBottom: borda, background: selecionado === i.numero ? 'var(--surface-input)' : undefined }}
            >
              <div className="flex items-center justify-between gap-[8px]">
                <span className="truncate text-[13px] font-bold">{i.titular?.nome ?? i.nomePerfil ?? formatarWhatsapp(i.numero)}</span>
                {i.naoLidas > 0 && (
                  <span className="rounded-full px-[7px] py-[1px] text-[10.5px] font-bold" style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }} aria-label={`${i.naoLidas} mensagem(ns) não lida(s)`}>
                    {i.naoLidas}
                  </span>
                )}
              </div>
              <div className="truncate text-[11.5px]" style={muted}>
                {i.ultimaDirecao === 'SAIDA' ? 'Azit: ' : ''}{i.ultimaPrevia}
              </div>
              <div className="text-[10.5px] tabular-nums" style={muted}>
                {i.ultimaEm ? instanteCurtoBR(i.ultimaEm) : ''}{i.titular ? '' : ' · número não identificado'}
              </div>
            </button>
          ))}
          {FERRAMENTAS_TESTE && (
            <div className="mt-auto flex flex-col gap-[6px] p-[12px] text-[11.5px]" style={{ borderTop: borda }}>
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
