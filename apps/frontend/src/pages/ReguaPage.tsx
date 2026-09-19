import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, resolverEstagioRegua } from '@azit/utils';
import { reguaService, type ReguaItem } from '../services/regua.service';
import { operacoesService } from '../services/operacoes.service';
import { Modal } from '../components/Modal';
import { RenegociacaoWizard } from '../components/RenegociacaoWizard';
import { FASE_POP_COLORS, FASE_POP_LABEL, NOTIFICACAO_COBRANCA_STATUS_COLORS, REGUA_STAGE_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { notificacaoCobrancaService } from '../services/notificacaoCobranca.service';
import { toast } from '../components/Toast';

// Kanban por DIAS DE ATRASO (decisão Luís 31/08): colunas 1 a 7 dias + "+7";
// o caso se MOVE de coluna conforme o atraso da parcela vencida mais antiga.
// Os marcos seguem o POP-COB-001 (doc 02 §23, 19/09) — que conta PARCELAS e
// horas desde a notificação anterior; o subtítulo da coluna é o marco típico
// de um contrato semanal, e o card mostra a etapa REAL de cada caso.
const COLUNAS_DIAS: { chave: string; rotulo: string; marco: string; corresponde: (d: number) => boolean }[] = [
  { chave: 'd1', rotulo: '1 dia', marco: '1ª notificação (D1)', corresponde: (d) => d === 1 },
  { chave: 'd2', rotulo: '2 dias', marco: 'Cobrança diária', corresponde: (d) => d === 2 },
  { chave: 'd3', rotulo: '3 dias', marco: 'Cobrança diária', corresponde: (d) => d === 3 },
  { chave: 'd4', rotulo: '4 dias', marco: '2ª notificação (+72h)', corresponde: (d) => d === 4 },
  { chave: 'd5', rotulo: '5 dias', marco: '', corresponde: (d) => d === 5 },
  { chave: 'd6', rotulo: '6 dias', marco: '', corresponde: (d) => d === 6 },
  { chave: 'd7', rotulo: '7 dias', marco: 'Conferência D7', corresponde: (d) => d === 7 },
  { chave: 'd7mais', rotulo: '+7 dias', marco: '2 parcelas: 3ª → 4ª → bloqueio', corresponde: (d) => d > 7 },
];

const dhCurta = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Linha do POP no card: etapa atual, próxima e sinais que pedem ação humana.
function LinhaPop({ pop }: { pop: NonNullable<ReguaItem['pop']> }) {
  const cor = FASE_POP_COLORS[pop.fase] ?? FASE_POP_COLORS.ordinaria;
  const prox = pop.proxima;
  return (
    <div className="mb-[8px] flex flex-col gap-[4px]">
      <span className="self-start rounded-full px-[8px] py-[1px] text-[10px] font-bold" style={{ background: cor.bg, color: cor.fg }}>
        {FASE_POP_LABEL[pop.fase] ?? pop.fase}
      </span>
      <div className="text-[10.5px] leading-tight" style={{ color: 'var(--text-secondary)' }}>
        {pop.ultimaEtapa ? `Última: ${pop.ultimaEtapa}ª` : 'Nenhuma notificação ainda'}
        {prox && (prox.prevista ? ` · ${prox.etapa}ª em ${dhCurta(prox.prevista)}` : ` · ${prox.etapa}ª: ${prox.condicao.toLowerCase()}`)}
      </div>
      {(pop.monitorarVeiculo || pop.rescisaoSinalizada) && (
        <div className="flex flex-wrap gap-[4px]">
          {pop.monitorarVeiculo && pop.fase !== 'pos_retomada' && pop.fase !== 'juridico' && (
            <span className="rounded-full px-[7px] py-[1px] text-[9.5px] font-bold" style={{ background: FASE_POP_COLORS.escalonamento.bg, color: FASE_POP_COLORS.escalonamento.fg }}>monitorar</span>
          )}
          {pop.rescisaoSinalizada && (
            <span className="rounded-full px-[7px] py-[1px] text-[9.5px] font-bold" style={{ background: FASE_POP_COLORS.juridico.bg, color: FASE_POP_COLORS.juridico.fg }}>rescisão</span>
          )}
        </div>
      )}
    </div>
  );
}
// Dia representativo da coluna p/ resolver a cor pelo estágio (statusColors).
const DIA_COR: Record<string, number> = { d1: 1, d2: 2, d3: 3, d4: 4, d5: 5, d6: 6, d7: 7, d7mais: 12 };

function Card({ item, onAcao, onAbrir, ocupado, podeOperar }: { item: ReguaItem; onAcao: (acao: 'bloquear' | 'desbloquear', item: ReguaItem) => void; onAbrir: () => void; ocupado: boolean; podeOperar: boolean }) {
  // Regra 6 (POP-COB-001): o botão existe a partir do D+1; antes do marco do
  // POP (24h após a 4ª) o bloqueio pede justificativa no modal.
  // Contrato sem veículo (Reembolso Parcelado) não tem o que bloquear.
  const podeBloquear = podeOperar && !item.bloqueado && item.diasAtraso >= 1 && !!item.ativo?.placa;
  const liberado = !!item.pop?.bloqueioLiberado;
  return (
    <div
      onClick={onAbrir}
      role="button"
      title="Abrir o caso de cobrança"
      className="cursor-pointer rounded-[10px] p-[12px] transition-shadow hover:shadow-[0_4px_14px_rgba(0,16,41,.12)]"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-[8px]">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>
            {item.titular.nome}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {item.ativo?.placa ?? '—'}
          </div>
          <div className="mb-[9px] text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {item.ativo?.modelo ?? '—'} · {item.numero}
          </div>
        </div>
        {item.bloqueado && (
          <span
            className="rounded-[20px] px-[9px] py-[3px] text-[10.5px] font-bold"
            style={{ background: '#fdeceb', color: '#e0413c' }}
          >
            {item.retomado ? 'Retomado' : 'Bloqueado'}
          </span>
        )}
      </div>
      {item.pop && <LinhaPop pop={item.pop} />}
      {item.mensagensNaoLidas > 0 && (
        <span className="mb-[8px] inline-block rounded-full px-[8px] py-[1px] text-[10px] font-bold" style={{ background: NOTIFICACAO_COBRANCA_STATUS_COLORS.ENVIADA.bg, color: NOTIFICACAO_COBRANCA_STATUS_COLORS.ENVIADA.fg }}>
          {item.mensagensNaoLidas} resposta(s) nova(s) no WhatsApp
        </span>
      )}
      <div className="flex items-center justify-between">
        <div className="font-display text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>
          {formatCurrency(item.valorVencido)}
        </div>
        <div className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
          {item.diasAtraso}d · {item.parcelasVencidas}p
        </div>
      </div>
      {(podeBloquear || (item.bloqueado && podeOperar)) && (
        <button
          onClick={(e) => { e.stopPropagation(); onAcao(item.bloqueado ? 'desbloquear' : 'bloquear', item); }}
          disabled={ocupado}
          className="mt-[10px] w-full rounded-[7px] py-[6px] text-[11.5px] font-semibold"
          title={!item.bloqueado && !liberado ? 'Antes do marco do POP — exige justificativa (risco concreto)' : undefined}
          style={{
            background: item.bloqueado || !liberado ? 'var(--surface-input)' : '#e0413c',
            color: item.bloqueado || !liberado ? 'var(--text-body)' : '#fff',
            border: !item.bloqueado && !liberado ? '1px solid #e0413c' : undefined,
            opacity: ocupado ? 0.6 : 1,
          }}
        >
          {item.bloqueado ? 'Desbloquear' : liberado ? 'Bloquear veículo (liberado)' : 'Bloquear com justificativa'}
        </button>
      )}
    </div>
  );
}

// Caso de cobrança (fluxo do operador, 18/08): o card do kanban abre as faturas
// vencidas do titular — valores CORRIGIDOS com mora (mesma fonte da renegociação,
// RAP007) — e o botão "Renegociar atraso" aciona o MESMO wizard da ficha.
function CasoModal({ item, onClose, onRenegociar }: { item: ReguaItem; onClose: () => void; onRenegociar: () => void }) {
  const navigate = useNavigate();
  const eleg = useQuery({
    queryKey: ['renegociacao-elegivel', item.contaId],
    queryFn: () => operacoesService.elegivelConta(item.contaId),
  });
  const faturas = eleg.data?.faturas ?? [];
  return (
    <Modal open onClose={onClose} title={`Caso de cobrança — ${item.titular.nome}`}>
      <div className="flex flex-col gap-[10px]">
        <div className="flex flex-wrap items-center gap-[8px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span className="rounded-full px-[10px] py-[2px] font-bold" style={{ background: '#fdeceb', color: '#c0392b' }}>{item.estagio} · {item.diasAtraso} dia(s) de atraso</span>
          <span>{item.ativo?.modelo ?? '—'} · {item.ativo?.placa ?? 'sem placa'} · contrato {item.numero}</span>
          {item.bloqueado && <span className="rounded-full px-[10px] py-[2px] font-bold" style={{ background: '#fdeceb', color: '#e0413c' }}>Veículo bloqueado</span>}
        </div>

        {item.pop && (
          <div className="flex flex-wrap items-center justify-between gap-[8px] rounded-[10px] px-[12px] py-[8px] text-[12px]" style={{ background: 'var(--surface-input)' }}>
            <div>
              <b>Notificações (POP):</b> {FASE_POP_LABEL[item.pop.fase] ?? item.pop.fase}
              {item.pop.ultimaEtapa ? ` · última ${item.pop.ultimaEtapa}ª` : ' · nenhuma enviada'}
              {item.pop.proxima && ` · próxima ${item.pop.proxima.etapa}ª ${item.pop.proxima.prevista ? `em ${dhCurta(item.pop.proxima.prevista)}` : `(${item.pop.proxima.condicao.toLowerCase()})`}`}
            </div>
            <button onClick={() => navigate(`/contratos/${item.id}`)} className="font-semibold underline" style={{ color: 'var(--navy)' }}>
              Ver notificações e prova
            </button>
          </div>
        )}

        {eleg.isLoading ? (
          <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Carregando faturas vencidas…</div>
        ) : faturas.length === 0 ? (
          <div className="rounded-[10px] p-[12px] text-[12.5px]" style={{ background: '#e8f7ef', color: '#1f9d5b' }}>
            Sem faturas vencidas fora de acordo — o atraso pode já estar coberto por uma renegociação.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-[6px]">
              {faturas.map((f) => (
                <div key={f.faturaId} className="rounded-[10px] px-[12px] py-[8px]" style={{ background: 'var(--surface-input)' }}>
                  <div className="flex items-center justify-between text-[12.5px] font-bold">
                    <span>Fatura {f.numero ?? '—'}{f.dataVencimento ? ` · venc. ${new Date(f.dataVencimento).toLocaleDateString('pt-BR')}` : ''}</span>
                    <span className="tabular-nums">{formatCurrency(f.valorAtualizado)}</span>
                  </div>
                  <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                    {f.itens.map((it) => `${it.display} (${it.contratoNumero})`).join(', ')}
                    {f.encargosMora > 0 && ` · encargos de mora ${formatCurrency(f.encargosMora)}`}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-[10px] px-[12px] py-[8px] text-[13px] font-bold" style={{ background: '#fdeceb', color: '#c0392b' }}>
              <span>Total corrigido ({faturas.length} fatura(s))</span>
              <span className="tabular-nums">{formatCurrency(eleg.data?.valorTotal ?? 0)}</span>
            </div>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-[8px] pt-[4px]">
          <button onClick={() => navigate(`/titulares/${eleg.data?.titularId ?? ''}`)} disabled={!eleg.data}
            className="h-[34px] rounded-[8px] px-[14px] text-[12.5px] font-semibold disabled:opacity-50" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
            Abrir ficha do titular
          </button>
          <button onClick={onRenegociar} disabled={faturas.length === 0}
            className="h-[34px] rounded-[8px] px-[14px] text-[12.5px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>
            Renegociar atraso
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ReguaPage() {
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [caso, setCaso] = useState<ReguaItem | null>(null);
  const [renegociando, setRenegociando] = useState<ReguaItem | null>(null);
  // Bloqueio antes do marco do POP: justificativa obrigatória (Regra 6).
  const [justificando, setJustificando] = useState<ReguaItem | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const regua = useQuery({ queryKey: ['regua'], queryFn: () => reguaService.listar() });

  async function comRefetch(fn: () => Promise<void>) {
    setOcupado(true);
    try {
      await fn();
      await new Promise((r) => setTimeout(r, 600));
      await queryClient.invalidateQueries({ queryKey: ['regua'] });
    } catch (e) {
      alert(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const itens = regua.data ?? [];

  return (
    <div className="flex h-full flex-col gap-[14px]">
      <div className="flex items-center justify-between">
        <div className="text-[12.5px]" style={{ color: 'var(--text-body)' }}>
          {itens.length} contrato(s) em régua de cobrança
        </div>
        {/* Auditoria 15/09 (Bloco D): era o ÚNICO botão dev sem gate — aparecia
            em produção. Em produção a régua roda pelo cron diário. */}
        {podeOperar && FERRAMENTAS_TESTE && (
          <button
            onClick={() =>
              comRefetch(async () => {
                await reguaService.rodar();
                const r = await notificacaoCobrancaService.varrerTeste();
                toast.sucesso(`${r.casosAbertos} caso(s) aberto(s), ${r.enfileirados} notificação(ões) na fila${r.disparoAutomatico ? '' : ' — disparo automático DESLIGADO em Configurações > Notificações de cobrança'}`);
              })
            }
            disabled={ocupado}
            className="rounded-[8px] px-[14px] py-[7px] text-[12px] font-semibold"
            style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}
            title="Teste: roda a régua e as notificações do POP agora, ignorando a janela de dias úteis"
          >
            {ocupado ? 'Processando…' : 'Rodar régua e notificações (teste)'}
          </button>
        )}
      </div>

      <div className="flex flex-1 gap-[13px] overflow-x-auto pb-[8px]">
        {COLUNAS_DIAS.map((col) => {
          const cards = itens.filter((i) => col.corresponde(i.diasAtraso));
          const estagioCor = resolverEstagioRegua(DIA_COR[col.chave]);
          const cor = (estagioCor && REGUA_STAGE_COLORS[estagioCor]) || '#8694a4';
          return (
            <div
              key={col.chave}
              className="flex w-[200px] flex-none flex-col rounded-card"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-[8px] px-[13px] py-[11px]" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: cor }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>
                    {col.rotulo}
                  </div>
                  {col.marco && (
                    <div className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }} title={col.marco}>
                      {col.marco}
                    </div>
                  )}
                </div>
                <div className="font-display text-[14px] font-bold" style={{ color: cor }}>
                  {cards.length}
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-[9px] overflow-auto p-[11px]">
                {cards.length === 0 && (
                  <div className="py-[10px] text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Vazio
                  </div>
                )}
                {cards.map((item) => (
                  <Card key={item.id} item={item} ocupado={ocupado} podeOperar={podeOperar} onAbrir={() => setCaso(item)} onAcao={(acao, alvo) => {
                    if (acao === 'desbloquear') return void comRefetch(() => reguaService.desbloquear(alvo.id));
                    if (alvo.pop?.bloqueioLiberado) return void comRefetch(() => reguaService.bloquear(alvo.id));
                    setJustificativa('');
                    setJustificando(alvo);
                  }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {caso && (
        <CasoModal
          item={caso}
          onClose={() => setCaso(null)}
          onRenegociar={() => { setRenegociando(caso); setCaso(null); }}
        />
      )}
      {justificando && (
        <Modal open onClose={() => setJustificando(null)} title={`Bloquear antes do marco do POP — ${justificando.titular.nome}`}>
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p style={{ color: 'var(--text-body)' }}>
              O POP-COB-001 libera o bloqueio <b>24h após a 4ª notificação</b>
              {justificando.pop?.bloqueioLiberadoEm ? ` (${dhCurta(justificando.pop.bloqueioLiberadoEm)})` : ''}. O contrato
              (cláusulas 8.3/7.7) permite agir antes em <b>risco concreto</b> — indícios de venda, ocultação, dano ao
              veículo ou circulação fora da área. Registre o motivo: ele fica na auditoria do bloqueio.
            </p>
            <textarea rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Ex.: veículo anunciado para venda em rede social em 18/09"
              className="w-full rounded-[8px] px-[10px] py-[7px] text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            <div className="flex items-center justify-between gap-[8px]">
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{justificativa.trim().length}/15 caracteres mínimos</span>
              <div className="flex gap-[8px]">
                <button onClick={() => setJustificando(null)} className="h-[34px] rounded-[8px] px-[14px] text-[12.5px] font-semibold" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
                  Cancelar
                </button>
                <button disabled={ocupado || justificativa.trim().length < 15}
                  onClick={() => { const alvo = justificando; setJustificando(null); void comRefetch(() => reguaService.bloquear(alvo.id, justificativa.trim())); }}
                  className="h-[34px] rounded-[8px] px-[14px] text-[12.5px] font-semibold disabled:opacity-50" style={{ background: '#e0413c', color: '#fff' }}>
                  Bloquear veículo
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {renegociando && (
        <RenegociacaoWizard
          contaId={renegociando.contaId}
          titular={renegociando.titular.nome}
          onClose={() => {
            setRenegociando(null);
            void queryClient.invalidateQueries({ queryKey: ['regua'] });
          }}
        />
      )}
    </div>
  );
}
