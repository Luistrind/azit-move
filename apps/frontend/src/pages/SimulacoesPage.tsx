import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { originacaoService } from '../services/originacao.service';
import { StatusBadge } from '../components/StatusBadge';
import { PROPOSTA_STATUS_COLORS } from '../config/statusColors';

const LABEL_STATUS: Record<string, string> = {
  pendente: 'Pendente', em_analise: 'Em análise', aprovada: 'Aprovada',
  reprovada: 'Reprovada', em_formalizacao: 'Em formalização', convertida: 'Convertida', cancelada: 'Cancelada',
};

export function SimulacoesPage() {
  const navigate = useNavigate();
  const sims = useQuery({ queryKey: ['simulacoes'], queryFn: () => originacaoService.listarSimulacoes() });

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-center justify-between">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Simulações são exploratórias; a escolhida vira proposta.</div>
        <button onClick={() => navigate('/originacao')} className="h-[34px] rounded-[8px] px-[16px] text-[12.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>
          + Novo atendimento
        </button>
      </div>
      <div className="rounded-card overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[12px] text-left font-semibold">Cliente</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Ativo</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">À vista</th>
              <th className="px-[18px] py-[12px] text-center font-semibold">Oferta escolhida</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Situação</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Proposta</th>
            </tr>
          </thead>
          <tbody>
            {sims.data?.length === 0 && (
              <tr><td colSpan={6} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhuma simulação.</td></tr>
            )}
            {sims.data?.map((s) => (
              <tr key={s.id}
                className={s.propostaId ? 'cursor-pointer hover:bg-[var(--surface-input)]' : ''}
                onClick={() => s.propostaId && navigate(`/propostas/${s.propostaId}`)}
                style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="px-[18px] py-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{s.cliente}</td>
                <td className="px-[18px] py-[12px]" style={{ color: 'var(--text-body)' }}>{s.ativo}</td>
                <td className="px-[18px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-body)' }}>{formatCurrency(s.valorAvista)}</td>
                <td className="px-[18px] py-[12px] text-center tabular-nums" style={{ color: 'var(--text-body)' }}>
                  {s.ofertaEscolhida ? `${s.ofertaEscolhida.numeroParcelas}× ${formatCurrency(s.ofertaEscolhida.valorParcela)} (${s.ofertaEscolhida.frequencia})` : '—'}
                </td>
                <td className="px-[18px] py-[12px]">
                  <span className="rounded-[6px] px-[8px] py-[3px] text-[11px] font-bold"
                    style={s.status === 'expirada'
                      ? { background: '#fdeceb', color: '#c0392b' }
                      : s.status === 'convertida'
                        ? { background: '#eafaf1', color: '#1f9d5b' }
                        : { background: 'var(--surface-input)', color: 'var(--text-body)' }}>
                    {s.status}
                  </span>
                </td>
                <td className="px-[18px] py-[12px]">
                  {s.propostaStatus
                    ? <StatusBadge label={LABEL_STATUS[s.propostaStatus] ?? s.propostaStatus} colors={PROPOSTA_STATUS_COLORS} />
                    : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
