import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { contratoService } from '../services/contrato.service';
import { StatusBadge } from '../components/StatusBadge';
import { CONTRATO_STATUS_COLORS } from '../config/statusColors';

function Kpi({ label, valor }: { label: string; valor: string }) {
  return (
    <div
      className="rounded-card p-[18px]"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-label)' }}>
        {label}
      </div>
      <div className="mt-[6px] font-display text-[22px] font-bold" style={{ color: 'var(--text-primary)' }}>
        {valor}
      </div>
    </div>
  );
}

export function CarteiraPage() {
  const navigate = useNavigate();
  const kpis = useQuery({ queryKey: ['contratos', 'kpis'], queryFn: () => contratoService.kpis() });
  const lista = useQuery({ queryKey: ['contratos', 'lista'], queryFn: () => contratoService.listar({ limit: 50 }) });

  const ativos = kpis.data?.porStatus.find((s) => s.status === 'Ativo')?.total ?? 0;

  return (
    <div className="flex flex-col gap-[18px]">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-[14px]">
        <Kpi label="Contratos" valor={String(kpis.data?.totalContratos ?? '—')} />
        <Kpi label="Contratos ativos" valor={String(ativos)} />
        <Kpi
          label="Saldo devedor total"
          valor={kpis.data ? formatCurrency(kpis.data.saldoDevedorTotal) : '—'}
        />
      </div>

      {/* Tabela de contratos */}
      <div
        className="rounded-card overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[12px] text-left font-semibold">Contrato</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Cliente</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Ativo</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Saldo devedor</th>
              <th className="px-[18px] py-[12px] text-center font-semibold">Parcelas</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {lista.isLoading && (
              <tr>
                <td colSpan={6} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>
                  Carregando…
                </td>
              </tr>
            )}
            {lista.data?.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>
                  Nenhum contrato na carteira.
                </td>
              </tr>
            )}
            {lista.data?.data.map((c) => (
              <tr
                key={c.id}
                onClick={() => navigate(`/contratos/${c.id}`)}
                className="cursor-pointer transition-colors hover:bg-[var(--surface-muted)]"
                style={{ borderBottom: '1px solid var(--border-light)' }}
              >
                <td className="px-[18px] py-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {c.numero}
                </td>
                <td className="px-[18px] py-[13px]" style={{ color: 'var(--text-body)' }}>
                  {c.titular.nome}
                </td>
                <td className="px-[18px] py-[13px]" style={{ color: 'var(--text-body)' }}>
                  {c.ativo.modelo ?? '—'}
                  {c.ativo.placa ? ` · ${c.ativo.placa}` : ''}
                </td>
                <td className="px-[18px] py-[13px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {formatCurrency(c.saldoDevedorAtual)}
                </td>
                <td className="px-[18px] py-[13px] text-center tabular-nums" style={{ color: 'var(--text-body)' }}>
                  {c.parcelasPagas}/{c.numeroParcelas}
                </td>
                <td className="px-[18px] py-[13px]">
                  <StatusBadge label={c.status} colors={CONTRATO_STATUS_COLORS} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
