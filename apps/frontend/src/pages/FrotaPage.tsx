import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { frotaService as svc, type ItemQuadro } from '../services/frota.service';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole, ROLE_OPERACAO } from '../lib/permissoes';
import { SITUACAO_FROTA_COLORS, OCORRENCIA_STATUS_COLORS } from '../config/statusColors';

// Quadro da frota (doc 02 §25.1): ONDE cada veículo está. É a camada operacional,
// separada do status do ativo (que diz a relação com o contrato).

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const btn = 'h-[32px] rounded-[8px] px-[12px] text-[12px] font-semibold disabled:opacity-50';
const btnSec = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-body)' } as const;
const inputCls = 'w-full rounded-[8px] px-[10px] py-[7px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;

function Card({ item, onMover, podeOperar }: { item: ItemQuadro; onMover: () => void; podeOperar: boolean }) {
  return (
    <div className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-[8px]">
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>{item.placa ?? 'sem placa'}</div>
          <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>{item.descricao}</div>
        </div>
        {item.ocorrenciasAbertas > 0 && (
          <Link to={`/frota/ocorrencias?ativo=${item.id}`} title="Ocorrências em aberto"
            className="rounded-full px-[8px] py-[1px] text-[10.5px] font-bold"
            style={{ background: OCORRENCIA_STATUS_COLORS.REGISTRADA.bg, color: OCORRENCIA_STATUS_COLORS.REGISTRADA.fg }}>
            {item.ocorrenciasAbertas} pend.
          </Link>
        )}
      </div>
      <div className="mt-[6px] text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {item.contrato ? (
          <Link to={`/contratos/${item.contrato.id}`} className="hover:underline">{item.contrato.titular.nome} · {item.contrato.numero}</Link>
        ) : (
          <span>Sem contrato ativo</span>
        )}
      </div>
      <div className="mt-[6px] flex items-center justify-between text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
        <span className="tabular-nums">{item.diasNaSituacao !== null ? `${item.diasNaSituacao} dia(s) aqui` : '—'}</span>
        {item.previsaoRetorno && (
          <span className="tabular-nums" style={item.atrasadoNoRetorno ? { color: '#c0392b', fontWeight: 700 } : undefined}>
            retorno {data(item.previsaoRetorno)}
          </span>
        )}
      </div>
      {podeOperar && (
        <button className={`${btn} mt-[9px] w-full`} style={btnSec} onClick={onMover}>Mover</button>
      )}
    </div>
  );
}

export function FrotaPage() {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const quadro = useQuery({ queryKey: ['frota-quadro'], queryFn: () => svc.quadro() });
  const opcoes = useQuery({ queryKey: ['frota-opcoes'], queryFn: () => svc.opcoes() });
  const [movendo, setMovendo] = useState<ItemQuadro | null>(null);
  const [form, setForm] = useState({ situacao: '', motivo: '', previsaoRetorno: '' });
  const [ocupado, setOcupado] = useState(false);
  const historico = useQuery({
    queryKey: ['frota-historico', movendo?.id],
    queryFn: () => svc.historico(movendo!.id),
    enabled: !!movendo,
  });

  const itens = quadro.data ?? [];
  const situacoes = opcoes.data?.situacoes ?? [];

  async function salvarMovimento() {
    if (!movendo) return;
    setOcupado(true);
    try {
      await svc.mover(movendo.id, {
        situacao: form.situacao,
        motivo: form.motivo || undefined,
        previsaoRetorno: form.previsaoRetorno ? new Date(form.previsaoRetorno).toISOString() : undefined,
      });
      toast.sucesso('Situação atualizada.');
      setMovendo(null);
      await qc.invalidateQueries({ queryKey: ['frota-quadro'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p className="max-w-[720px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Onde cada veículo está agora. É uma camada separada do estoque: um carro pode estar <b>em contrato</b> e
          <b> na oficina</b> ao mesmo tempo.
        </p>
        <Link to="/frota/ocorrencias" className={btn} style={{ background: 'var(--navy)', color: '#fff', lineHeight: '32px' }}>
          Multas e pendências
        </Link>
      </div>

      <div className="flex flex-1 gap-[13px] overflow-x-auto pb-[8px]">
        {situacoes.map((s) => {
          const cards = itens.filter((i) => i.situacao === s.valor);
          const cor = SITUACAO_FROTA_COLORS[s.valor] ?? SITUACAO_FROTA_COLORS.EM_ESTOQUE;
          return (
            <div key={s.valor} className="flex w-[210px] flex-none flex-col rounded-card" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-[8px] px-[13px] py-[11px]" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: cor.fg }} />
                <div className="min-w-0 flex-1 text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>{s.rotulo}</div>
                <div className="font-display text-[14px] font-bold" style={{ color: cor.fg }}>{cards.length}</div>
              </div>
              <div className="flex flex-1 flex-col gap-[9px] overflow-auto p-[11px]">
                {cards.length === 0 && <div className="py-[10px] text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>Vazio</div>}
                {cards.map((item) => (
                  <Card key={item.id} item={item} podeOperar={podeOperar}
                    onMover={() => { setForm({ situacao: item.situacao, motivo: '', previsaoRetorno: '' }); setMovendo(item); }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {movendo && (
        <Modal open onClose={() => setMovendo(null)} title={`Mover ${movendo.placa ?? 'veículo'} — ${movendo.descricao}`} largura={520}>
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <label className="flex flex-col gap-[4px]">Nova situação
              <select className={inputCls} style={inputStyle} value={form.situacao} onChange={(e) => setForm({ ...form, situacao: e.target.value })}>
                {situacoes.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-[4px]">Motivo
              <input className={inputCls} style={inputStyle} value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                placeholder="Ex.: revisão de 20 mil km na oficina X" />
            </label>
            <label className="flex flex-col gap-[4px]">Previsão de retorno
              <input type="date" className={inputCls} style={inputStyle} value={form.previsaoRetorno} onChange={(e) => setForm({ ...form, previsaoRetorno: e.target.value })} />
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Opcional. Passou da data, o card avisa.</span>
            </label>

            <div className="rounded-[10px] p-[10px] text-[11.5px]" style={{ background: 'var(--surface-input)' }}>
              <div className="mb-[4px] font-bold">Histórico</div>
              {historico.isLoading && <div style={{ color: 'var(--text-muted)' }}>Carregando…</div>}
              {historico.data?.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Sem movimentações.</div>}
              {(historico.data ?? []).slice(0, 8).map((h) => (
                <div key={h.id} className="tabular-nums" style={{ color: 'var(--text-body)' }}>
                  {new Date(h.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })} ·{' '}
                  {h.deRotulo ? `${h.deRotulo} → ` : ''}{h.paraRotulo}{h.motivo ? ` — ${h.motivo}` : ''}{h.usuario ? ` (${h.usuario})` : ''}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-[8px]">
              <button className={btn} style={btnSec} onClick={() => setMovendo(null)}>Cancelar</button>
              <button className={btn} style={{ background: 'var(--navy)', color: '#fff' }} disabled={ocupado || form.situacao === movendo.situacao}
                onClick={() => void salvarMovimento()}>
                Mover veículo
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
