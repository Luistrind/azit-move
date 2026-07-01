import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { originacaoService, PropostaResumo } from '../services/originacao.service';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { PROPOSTA_STATUS_COLORS } from '../config/statusColors';
import { mensagemErro } from '../lib/permissoes';

const LABEL_STATUS: Record<string, string> = {
  pendente: 'Pendente', em_analise: 'Em análise', aprovada: 'Aprovada',
  reprovada: 'Reprovada', em_formalizacao: 'Em formalização', convertida: 'Convertida', cancelada: 'Cancelada',
};
// Uma coluna por status do funil (Doc 3 §8-A.3).
const KANBAN_COLS = ['pendente', 'em_analise', 'aprovada', 'em_formalizacao', 'convertida', 'reprovada', 'cancelada'];
// Arrasto livre só entre Pendente e Em Análise.
const ARRASTAVEIS = ['pendente', 'em_analise'];

export function PropostasPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [vista, setVista] = useState<'lista' | 'kanban'>('lista');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('');
  const [modalP, setModalP] = useState<PropostaResumo | null>(null);
  const [dragId, setDragId] = useState<{ id: string; status: string } | null>(null);

  const propostas = useQuery({ queryKey: ['propostas'], queryFn: () => originacaoService.listarPropostas() });

  const filtradas = (propostas.data ?? []).filter((p) =>
    (!filtro || p.status === filtro) && (!busca || p.titular.toLowerCase().includes(busca.toLowerCase())),
  );

  async function moverPara(coluna: string) {
    if (!dragId) return;
    if (!ARRASTAVEIS.includes(dragId.status) || !ARRASTAVEIS.includes(coluna) || coluna === dragId.status) return;
    const alvo = dragId; setDragId(null);
    try {
      await originacaoService.patchStatus(alvo.id, coluna);
      await queryClient.invalidateQueries({ queryKey: ['propostas'] });
    } catch (e) { alert(mensagemErro(e)); }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Filtros + toggle */}
      <div className="flex flex-wrap items-center gap-[10px]">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente"
          className="h-[34px] w-[200px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}
          className="h-[34px] w-[170px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
          <option value="">Todos os status</option>
          {KANBAN_COLS.map((s) => <option key={s} value={s}>{LABEL_STATUS[s]}</option>)}
        </select>
        <div className="flex-1" />
        <div className="flex gap-[4px] rounded-[8px] p-[3px]" style={{ background: 'var(--surface-input)' }}>
          {(['lista', 'kanban'] as const).map((v) => (
            <button key={v} onClick={() => setVista(v)}
              className="rounded-[6px] px-[12px] py-[4px] text-[12px] font-semibold capitalize"
              style={{ background: vista === v ? 'var(--surface)' : 'transparent', color: vista === v ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {vista === 'lista' ? (
        <div className="rounded-card overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                <th className="px-[18px] py-[12px] text-left font-semibold">Cliente</th>
                <th className="px-[18px] py-[12px] text-left font-semibold">Ativo</th>
                <th className="px-[18px] py-[12px] text-center font-semibold">Parcelas</th>
                <th className="px-[18px] py-[12px] text-left font-semibold">Status</th>
                <th className="px-[18px] py-[12px] text-right font-semibold">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr><td colSpan={5} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhuma proposta.</td></tr>
              )}
              {filtradas.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-[var(--surface-input)]" onClick={() => setModalP(p)}
                  style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td className="px-[18px] py-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{p.titular}</td>
                  <td className="px-[18px] py-[12px]" style={{ color: 'var(--text-body)' }}>{p.ativo}</td>
                  <td className="px-[18px] py-[12px] text-center tabular-nums" style={{ color: 'var(--text-body)' }}>{p.numeroParcelas}× {formatCurrency(p.valorParcela)}</td>
                  <td className="px-[18px] py-[12px]"><StatusBadge label={LABEL_STATUS[p.status] ?? p.status} colors={PROPOSTA_STATUS_COLORS} /></td>
                  <td className="px-[18px] py-[12px] text-right">
                    <button onClick={(e) => { e.stopPropagation(); navigate(`/propostas/${p.id}`); }}
                      className="text-[11.5px] font-semibold" style={{ color: 'var(--accent)' }}>Abrir análise →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-[12px] overflow-x-auto pb-[8px]">
          {KANBAN_COLS.map((col) => {
            const itens = filtradas.filter((p) => p.status === col);
            const podeSoltar = !!dragId && ARRASTAVEIS.includes(dragId.status) && ARRASTAVEIS.includes(col);
            return (
              <div key={col} className="flex w-[220px] flex-none flex-col gap-[8px]"
                onDragOver={(e) => { if (podeSoltar) e.preventDefault(); }} onDrop={() => moverPara(col)}>
                <div className="flex items-center justify-between px-[4px]">
                  <span className="text-[11px] font-bold uppercase tracking-[0.03em]" style={{ color: 'var(--text-label)' }}>{LABEL_STATUS[col]}</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{itens.length}</span>
                </div>
                <div className="flex min-h-[60px] flex-col gap-[8px] rounded-[10px] p-[8px]"
                  style={{ background: podeSoltar ? 'var(--surface-input)' : 'transparent', border: '1px dashed var(--border-light)' }}>
                  {itens.map((p) => (
                    <div key={p.id} draggable={ARRASTAVEIS.includes(p.status)} onDragStart={() => setDragId({ id: p.id, status: p.status })}
                      onClick={() => setModalP(p)} className="cursor-pointer rounded-[8px] p-[10px] text-[12px]"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{p.titular}</div>
                      <div style={{ color: 'var(--text-muted)' }}>{p.ativo}</div>
                      <div className="mt-[4px] tabular-nums" style={{ color: 'var(--text-body)' }}>{p.numeroParcelas}× {formatCurrency(p.valorParcela)} · {p.prazoSemanas}sem</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!modalP} onClose={() => setModalP(null)} title="Detalhes da proposta">
        {modalP && (
          <div className="flex flex-col gap-[12px] text-[12.5px]">
            <div className="flex items-center justify-between">
              <span className="font-display text-[15px] font-bold">{modalP.titular}</span>
              <StatusBadge label={LABEL_STATUS[modalP.status] ?? modalP.status} colors={PROPOSTA_STATUS_COLORS} />
            </div>
            <div style={{ color: 'var(--text-body)' }}>{modalP.ativo}</div>
            <div className="grid grid-cols-2 gap-[8px]">
              <div><span style={{ color: 'var(--text-label)' }}>Entrada:</span> {formatCurrency(modalP.valorEntrada)}</div>
              <div><span style={{ color: 'var(--text-label)' }}>Modalidade:</span> {modalP.modalidade}</div>
              <div><span style={{ color: 'var(--text-label)' }}>Parcelas:</span> {modalP.numeroParcelas}× {formatCurrency(modalP.valorParcela)}</div>
              <div><span style={{ color: 'var(--text-label)' }}>Prazo:</span> {modalP.prazoSemanas} semanas</div>
            </div>
            <button onClick={() => { const pid = modalP.id; setModalP(null); navigate(`/propostas/${pid}`); }}
              className="mt-[4px] h-[34px] rounded-[8px] text-[12.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>
              Abrir análise documental
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
