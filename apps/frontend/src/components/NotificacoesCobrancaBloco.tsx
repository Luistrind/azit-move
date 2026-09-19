import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { Modal } from './Modal';
import { toast } from './Toast';
import {
  notificacaoCobrancaService as svc,
  type NotificacaoCobranca,
  type PainelNotificacoes,
} from '../services/notificacaoCobranca.service';
import { FASE_POP_COLORS, FASE_POP_LABEL, NOTIFICACAO_COBRANCA_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_JURIDICO, ROLE_RETOMADA, mensagemErro } from '../lib/permissoes';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';

// Notificações formais de cobrança — POP-COB-001 (doc 02 §23). Mostra onde o
// caso está no procedimento, a trilha das 6 notificações com a PROVA de cada
// uma (carimbos do provedor + hash) e as ações humanas do POP: registrar a
// retomada (dispara a 5ª), encaminhar ao jurídico e enviar a rescisão (6ª).

const ETAPAS = [
  { n: 1, titulo: '1ª', resumo: 'Parcela em aberto' },
  { n: 2, titulo: '2ª', resumo: 'Reiteração' },
  { n: 3, titulo: '3ª', resumo: 'Duas parcelas' },
  { n: 4, titulo: '4ª', resumo: 'Pré-bloqueio' },
  { n: 5, titulo: '5ª', resumo: 'Após a retomada' },
  { n: 6, titulo: '6ª', resumo: 'Rescisão' },
];

const dh = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const card = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const btn = 'h-[32px] rounded-[8px] px-[12px] text-[12px] font-semibold disabled:opacity-50';
const btnSec = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-body)' } as const;
const inputCls = 'w-full rounded-[8px] px-[10px] py-[7px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;

function Chip({ texto, cor }: { texto: string; cor: { bg: string; fg: string } }) {
  return (
    <span className="whitespace-nowrap rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={{ background: cor.bg, color: cor.fg }}>
      {texto}
    </span>
  );
}

function LinhaNotificacao({ n, onAcao, ocupado, podeReenviar }: { n: NotificacaoCobranca; onAcao: (fn: () => Promise<unknown>, ok?: string) => void; ocupado: boolean; podeReenviar: boolean }) {
  const [aberta, setAberta] = useState(false);
  const cor = NOTIFICACAO_COBRANCA_STATUS_COLORS[n.status];
  return (
    <div className="rounded-[10px] px-[12px] py-[9px]" style={{ background: 'var(--surface-input)' }}>
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>
            {n.titulo} <span className="font-normal" style={{ color: 'var(--text-muted)' }}>· {n.assunto}</span>
          </div>
          <div className="text-[11.5px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {n.enviadaEm && <>Enviada {dh(n.enviadaEm)}</>}
            {n.entregueEm && <> · entregue {dh(n.entregueEm)}</>}
            {n.lidaEm && <> · lida {dh(n.lidaEm)}</>}
            {n.falhaMotivo && <span style={{ color: NOTIFICACAO_COBRANCA_STATUS_COLORS.FALHOU.fg }}> · {n.falhaMotivo}</span>}
            {n.disparo === 'manual' && <> · disparo manual</>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-[6px]">
          <Chip texto={n.statusRotulo} cor={cor} />
          {n.temPdf && (
            <button className={btn} style={btnSec} onClick={() => onAcao(() => svc.abrirPdf(n.id))}>
              PDF
            </button>
          )}
          <button className={btn} style={btnSec} onClick={() => setAberta((v) => !v)}>
            {aberta ? 'Ocultar prova' : 'Prova'}
          </button>
          {n.status === 'FALHOU' && podeReenviar && (
            <button className={btn} style={{ background: 'var(--accent)', color: '#fff' }} disabled={ocupado} onClick={() => onAcao(() => svc.reenviar(n.id), 'Reenvio processado.')}>
              Reenviar
            </button>
          )}
          {FERRAMENTAS_TESTE && n.status === 'SIMULADA' && !n.lidaEm && (
            <button className={btn} style={btnSec} disabled={ocupado} title="Teste: simula o carimbo de entrega/leitura do WhatsApp"
              onClick={() => onAcao(() => svc.simularStatus(n.id, n.entregueEm ? 'read' : 'delivered'))}>
              {n.entregueEm ? 'Simular leitura' : 'Simular entrega'}
            </button>
          )}
        </div>
      </div>
      {aberta && (
        <div className="mt-[8px] flex flex-col gap-[3px] border-t pt-[8px] text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-body)' }}>
          <div>Destino: {n.destino ? `WhatsApp +${n.destino}` : '—'} · provedor: {n.provedor ?? '—'} · tentativas: {n.tentativas}</div>
          {n.mensagemId && <div className="break-all">Id da mensagem (Meta): {n.mensagemId}</div>}
          <div className="break-all font-mono">SHA-256 do texto: {n.textoSha256}</div>
          {n.pdfSha256 && <div className="break-all font-mono">SHA-256 do PDF: {n.pdfSha256}</div>}
          <div className="mt-[4px] font-semibold">Linha do tempo</div>
          {n.eventos.map((e, i) => (
            <div key={i} className="tabular-nums">
              {dh(e.em)} — {e.tipo}{e.detalhe ? `: ${e.detalhe}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NotificacoesCobrancaBloco({ contratoId, numero }: { contratoId: string; numero: string }) {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const q = useQuery({ queryKey: ['notificacoes-cobranca', contratoId], queryFn: () => svc.painel(contratoId) });
  const [ocupado, setOcupado] = useState(false);
  const [modal, setModal] = useState<null | 'retomada' | 'devolver' | 'juridico' | 'rescisao'>(null);
  const [form, setForm] = useState({ dataHora: '', local: '', responsavel: '', condicoes: '', observacoes: '', motivo: '' });

  async function acao(fn: () => Promise<unknown>, ok?: string) {
    setOcupado(true);
    try {
      const r = (await fn()) as { resultado?: string; motivo?: string } | undefined;
      if (r?.resultado === 'falhou') toast.erro(`Não enviada: ${r.motivo ?? 'falha no provedor'}`);
      else if (ok) toast.sucesso(ok);
      setModal(null);
      await qc.invalidateQueries({ queryKey: ['notificacoes-cobranca', contratoId] });
      await qc.invalidateQueries({ queryKey: ['contrato', contratoId] });
      await qc.invalidateQueries({ queryKey: ['regua'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const p: PainelNotificacoes | undefined = q.data;
  if (!p || (!p.elegivel && p.casos.length === 0)) return null;

  const e = p.estado;
  const casoAtual = p.casos.find((c) => !c.encerradoEm) ?? null;
  const anteriores = p.casos.filter((c) => c.encerradoEm);
  const porEtapa = new Map((casoAtual?.notificacoes ?? []).map((n) => [n.etapa, n]));
  const ret = p.intervencoes.retomada;

  return (
    <div className="rounded-card flex flex-col gap-[12px] p-[16px]" style={card}>
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div>
          <div className="text-[13.5px] font-bold" style={{ color: 'var(--text-primary)' }}>Notificações de cobrança</div>
          <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Procedimento POP-COB-001 · enviadas pelo WhatsApp dedicado, com PDF e comprovantes
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-[6px]">
          {e?.casoAberto && <Chip texto={FASE_POP_LABEL[e.fase] ?? e.fase} cor={FASE_POP_COLORS[e.fase] ?? FASE_POP_COLORS.ordinaria} />}
          {!p.disparoAutomatico && <Chip texto="Disparo automático desligado" cor={FASE_POP_COLORS.juridico} />}
          {p.provedor.simulado && <Chip texto={p.provedor.disponivel ? 'Modo simulado (sem WhatsApp)' : 'Retidas: WhatsApp sem credencial'} cor={NOTIFICACAO_COBRANCA_STATUS_COLORS.SIMULADA} />}
          <button className={btn} style={btnSec} disabled={p.casos.length === 0} onClick={() => void acao(() => svc.baixarDossie(contratoId, numero))}>
            Dossiê (PDF)
          </button>
        </div>
      </div>

      {e && e.casoAberto ? (
        <>
          <div className="flex flex-wrap gap-x-[22px] gap-y-[4px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
            <span><b className="tabular-nums">{e.parcelasVencidas}</b> parcela(s) vencida(s)</span>
            <span><b className="tabular-nums">{e.diasAtraso}</b> dia(s) de atraso</span>
            <span>Débito atualizado <b className="tabular-nums">{formatCurrency(e.valorAtualizado)}</b> <span style={{ color: 'var(--text-muted)' }}>(multa + juros pro rata)</span></span>
          </div>

          {/* Trilha das 6 notificações do POP */}
          <div className="grid grid-cols-3 gap-[6px] sm:grid-cols-6">
            {ETAPAS.map((et) => {
              const n = porEtapa.get(et.n);
              const proxima = e.proxima?.etapa === et.n;
              const cor = n ? NOTIFICACAO_COBRANCA_STATUS_COLORS[n.status] : null;
              return (
                <div key={et.n} className="rounded-[9px] px-[9px] py-[7px]"
                  style={{
                    background: cor ? cor.bg : 'var(--surface-input)',
                    border: proxima ? '1.5px dashed var(--accent)' : '1px solid transparent',
                    opacity: n || proxima ? 1 : 0.55,
                  }}>
                  <div className="text-[12px] font-bold" style={{ color: cor ? cor.fg : 'var(--text-primary)' }}>{et.titulo}</div>
                  <div className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>{et.resumo}</div>
                  <div className="mt-[2px] text-[10.5px] font-semibold tabular-nums" style={{ color: cor ? cor.fg : 'var(--text-muted)' }}>
                    {n ? (n.status === 'FALHOU' ? 'falhou' : dh(n.enviadaEm).slice(0, 10)) : proxima ? 'próxima' : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          {e.proxima && (
            <div className="rounded-[10px] px-[12px] py-[8px] text-[12.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>
              <b>Próxima: {e.proxima.etapa}ª notificação</b> —{' '}
              {e.proxima.prevista ? <>prevista para <b className="tabular-nums">{dh(e.proxima.prevista)}</b> ({e.proxima.condicao})</> : <>aguarda: {e.proxima.condicao}</>}
              {e.proxima.etapa === 6 && ' — envio manual pela direção'}
            </div>
          )}

          <div className="flex flex-wrap gap-[6px]">
            {e.monitorarVeiculo && <Chip texto="Monitorar veículo (POP §11)" cor={FASE_POP_COLORS.escalonamento} />}
            {e.bloqueioLiberado && <Chip texto={`Bloqueio liberado desde ${dh(e.bloqueioLiberadoEm)}`} cor={FASE_POP_COLORS.bloqueio_liberado} />}
            {!e.bloqueioLiberado && e.bloqueioLiberadoEm && <Chip texto={`Bloqueio libera em ${dh(e.bloqueioLiberadoEm)}`} cor={FASE_POP_COLORS.pre_bloqueio} />}
            {e.rescisaoSinalizada && <Chip texto="Rescisão: +30 dias ou 4 parcelas — encaminhar" cor={FASE_POP_COLORS.juridico} />}
          </div>
        </>
      ) : (
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          {p.elegivel ? 'Sem caso de cobrança aberto — o contrato está sem parcelas vencidas.' : 'Contrato fora do fluxo (não está ativo ou não é de veículo).'}
        </div>
      )}

      {casoAtual && casoAtual.notificacoes.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          {casoAtual.notificacoes.map((n) => (
            <LinhaNotificacao key={n.id} n={n} ocupado={ocupado} podeReenviar={pode(ROLE_RETOMADA)} onAcao={(fn, ok) => void acao(fn, ok)} />
          ))}
        </div>
      )}

      {(p.intervencoes.retomadoEm || p.intervencoes.juridicoEm || ret?.devolvidoEm) && (
        <div className="flex flex-col gap-[3px] rounded-[10px] px-[12px] py-[8px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>
          {p.intervencoes.retomadoEm && (
            <div><b>Retomado em {dh(p.intervencoes.retomadoEm)}</b> · {ret?.local} · responsável {ret?.responsavel} · condições: {ret?.condicoes}{ret?.observacoes ? ` · ${ret.observacoes}` : ''}</div>
          )}
          {!p.intervencoes.retomadoEm && ret?.devolvidoEm && <div>Veículo devolvido ao cliente em {dh(ret.devolvidoEm)} — {ret.motivoDevolucao}</div>}
          {p.intervencoes.juridicoEm && <div><b>No jurídico</b> desde {dh(p.intervencoes.juridicoEm)} — o envio automático está pausado.</div>}
        </div>
      )}

      {/* Ações humanas do POP */}
      {p.elegivel && (
        <div className="flex flex-wrap gap-[8px]">
          {pode(ROLE_RETOMADA) && e?.casoAberto && !p.intervencoes.retomadoEm && (
            <button className={btn} style={{ background: FASE_POP_COLORS.pos_retomada.fg, color: '#fff' }} disabled={ocupado} onClick={() => setModal('retomada')}>
              Registrar retomada
            </button>
          )}
          {pode(ROLE_RETOMADA) && p.intervencoes.retomadoEm && (
            <button className={btn} style={btnSec} disabled={ocupado} onClick={() => setModal('devolver')}>
              Devolver veículo ao cliente
            </button>
          )}
          {pode(ROLE_JURIDICO) && (
            <button className={btn} style={btnSec} disabled={ocupado} onClick={() => setModal('juridico')}>
              {p.intervencoes.juridicoEm ? 'Retirar do jurídico' : 'Encaminhar ao jurídico'}
            </button>
          )}
          {pode(ROLE_JURIDICO) && e?.podeEnviarRescisao && (
            <button className={btn} style={{ background: FASE_POP_COLORS.juridico.fg, color: '#fff' }} disabled={ocupado} onClick={() => setModal('rescisao')}>
              Enviar notificação de rescisão (6ª)
            </button>
          )}
          {FERRAMENTAS_TESTE && e?.casoAberto && (
            <span className="ml-auto flex flex-wrap items-center gap-[6px] text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Teste:
              {[24, 72].map((h) => (
                <button key={h} className={btn} style={btnSec} disabled={ocupado} title="Recua os carimbos do caso — simula a passagem do tempo"
                  onClick={() => void acao(() => svc.avancarRelogio(contratoId, h), `Relógio do caso avançado ${h}h.`)}>
                  +{h}h
                </button>
              ))}
              <button className={btn} style={btnSec} disabled={ocupado} title="Roda a varredura agora, ignorando a janela de dias úteis"
                onClick={() => void acao(async () => { const r = await svc.varrerTeste(); await new Promise((ok) => setTimeout(ok, 1500)); return r; }, 'Varredura executada.')}>
                Rodar notificações
              </button>
            </span>
          )}
        </div>
      )}

      {anteriores.length > 0 && (
        <details className="text-[12px]" style={{ color: 'var(--text-body)' }}>
          <summary className="cursor-pointer font-semibold">Casos anteriores ({anteriores.length})</summary>
          <div className="mt-[6px] flex flex-col gap-[6px]">
            {anteriores.map((cs) => (
              <div key={cs.id} className="rounded-[10px] px-[12px] py-[8px]" style={{ background: 'var(--surface-input)' }}>
                <div className="font-semibold tabular-nums">
                  {dh(cs.abertoEm)} → {dh(cs.encerradoEm)} · {cs.motivoEncerramento === 'regularizado' ? 'regularizado' : cs.motivoEncerramento === 'contrato_encerrado' ? 'contrato encerrado' : cs.motivoEncerramento}
                </div>
                <div className="flex flex-wrap gap-[6px] pt-[4px]">
                  {cs.notificacoes.length === 0 && <span style={{ color: 'var(--text-muted)' }}>nenhuma notificação enviada</span>}
                  {cs.notificacoes.map((n) => (
                    <button key={n.id} className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" disabled={!n.temPdf}
                      style={{ background: NOTIFICACAO_COBRANCA_STATUS_COLORS[n.status].bg, color: NOTIFICACAO_COBRANCA_STATUS_COLORS[n.status].fg }}
                      onClick={() => void acao(() => svc.abrirPdf(n.id))}>
                      {n.titulo} · {n.statusRotulo}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {modal === 'retomada' && (
        <Modal open onClose={() => setModal(null)} title="Registrar retomada do veículo" largura={520}>
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p style={{ color: 'var(--text-muted)' }}>
              POP §14: registre a operação no momento em que ocorre. A retomada <b>não</b> extingue a dívida
              (o contrato segue ativo) e dispara a <b>5ª notificação</b> na próxima janela de envio.
            </p>
            <label className="flex flex-col gap-[4px]">Data e hora da retomada
              <input type="datetime-local" className={inputCls} style={inputStyle} value={form.dataHora} onChange={(ev) => setForm({ ...form, dataHora: ev.target.value })} />
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Em branco = agora.</span>
            </label>
            <label className="flex flex-col gap-[4px]">Local *
              <input className={inputCls} style={inputStyle} value={form.local} onChange={(ev) => setForm({ ...form, local: ev.target.value })} placeholder="Endereço onde o veículo foi retomado" />
            </label>
            <label className="flex flex-col gap-[4px]">Responsável pela operação *
              <input className={inputCls} style={inputStyle} value={form.responsavel} onChange={(ev) => setForm({ ...form, responsavel: ev.target.value })} />
            </label>
            <label className="flex flex-col gap-[4px]">Condições do veículo *
              <textarea rows={2} className={inputCls} style={inputStyle} value={form.condicoes} onChange={(ev) => setForm({ ...form, condicoes: ev.target.value })} placeholder="Estado geral, avarias, itens faltantes" />
            </label>
            <label className="flex flex-col gap-[4px]">Ocorrências / observações
              <textarea rows={2} className={inputCls} style={inputStyle} value={form.observacoes} onChange={(ev) => setForm({ ...form, observacoes: ev.target.value })} />
            </label>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Fotos e vistoria: fase 2 (por ora, anexe no cadastro do ativo).</p>
            <div className="flex justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => setModal(null)}>Cancelar</button>
              <button className={btn} style={{ background: FASE_POP_COLORS.pos_retomada.fg, color: '#fff' }} disabled={ocupado || !form.local.trim() || !form.responsavel.trim() || !form.condicoes.trim()}
                onClick={() => void acao(() => svc.registrarRetomada(contratoId, {
                  dataHora: form.dataHora ? new Date(form.dataHora).toISOString() : undefined,
                  local: form.local, responsavel: form.responsavel, condicoes: form.condicoes, observacoes: form.observacoes || undefined,
                }), 'Retomada registrada — a 5ª notificação sai na próxima janela.')}>
                Registrar retomada
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'devolver' && (
        <Modal open onClose={() => setModal(null)} title="Devolver veículo ao cliente">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p style={{ color: 'var(--text-muted)' }}>Use quando a situação foi negociada e o veículo volta ao cliente. O registro da retomada fica no histórico.</p>
            <textarea rows={3} className={inputCls} style={inputStyle} value={form.motivo} onChange={(ev) => setForm({ ...form, motivo: ev.target.value })} placeholder="Motivo (ex.: acordo firmado em …)" />
            <div className="flex justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => setModal(null)}>Cancelar</button>
              <button className={btn} style={{ background: 'var(--accent)', color: '#fff' }} disabled={ocupado || !form.motivo.trim()}
                onClick={() => void acao(() => svc.devolverVeiculo(contratoId, form.motivo), 'Devolução registrada.')}>
                Registrar devolução
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'juridico' && (
        <Modal open onClose={() => setModal(null)} title={p.intervencoes.juridicoEm ? 'Retirar do jurídico' : 'Encaminhar ao jurídico'}>
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p style={{ color: 'var(--text-muted)' }}>
              {p.intervencoes.juridicoEm
                ? 'O envio automático das notificações volta a valer para este caso.'
                : 'Casos no jurídico seguem a orientação do setor (POP §3): o envio automático das notificações fica pausado.'}
            </p>
            <textarea rows={2} className={inputCls} style={inputStyle} value={form.motivo} onChange={(ev) => setForm({ ...form, motivo: ev.target.value })} placeholder="Motivo (opcional)" />
            <div className="flex justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => setModal(null)}>Cancelar</button>
              <button className={btn} style={{ background: 'var(--navy)', color: '#fff' }} disabled={ocupado}
                onClick={() => void acao(() => svc.juridico(contratoId, !p.intervencoes.juridicoEm, form.motivo || undefined), p.intervencoes.juridicoEm ? 'Caso retirado do jurídico.' : 'Caso encaminhado ao jurídico.')}>
                Confirmar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'rescisao' && (
        <Modal open onClose={() => setModal(null)} title="Enviar notificação de rescisão (6ª)">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p style={{ color: 'var(--text-body)' }}>
              A 6ª notificação comunica formalmente a <b>rescisão do contrato</b> nº {numero} (Anexo VI do POP) e lista as
              notificações anteriores. Envio imediato pelo WhatsApp dedicado; o caso passa ao jurídico.
            </p>
            <p style={{ color: 'var(--text-muted)' }}>A rescisão em si (baixa do contrato, SPC/Serasa, protesto) segue com o jurídico — este envio só registra a comunicação.</p>
            <div className="flex justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => setModal(null)}>Cancelar</button>
              <button className={btn} style={{ background: FASE_POP_COLORS.bloqueio_liberado.fg, color: '#fff' }} disabled={ocupado}
                onClick={() => void acao(() => svc.enviarRescisao(contratoId), 'Notificação de rescisão processada.')}>
                Enviar 6ª notificação
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
