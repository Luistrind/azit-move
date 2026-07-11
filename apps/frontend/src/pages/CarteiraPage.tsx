import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { contratoService } from '../services/contrato.service';
import { contaService } from '../services/conta.service';

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

const SITUACAO: Record<string, { rotulo: string; bg: string; fg: string }> = {
  em_dia: { rotulo: 'Em dia', bg: '#eafaf1', fg: '#1f9d5b' },
  em_atraso: { rotulo: 'Em atraso', bg: '#fef6e9', fg: '#c98a0a' },
  bloqueada: { rotulo: 'Bloqueada', bg: '#fdeceb', fg: '#e0413c' },
};

// Carteira TITULAR-cêntrica (Doc 2: arquitetura centrada no titular): a lista é de
// pessoas com posição consolidada; o contrato é o drill-down (ficha do titular).
export function CarteiraPage() {
  const navigate = useNavigate();
  const kpis = useQuery({ queryKey: ['contratos', 'kpis'], queryFn: () => contratoService.kpis() });
  const carteira = useQuery({ queryKey: ['carteira-contas'], queryFn: () => contaService.carteira() });

  const k = kpis.data;
  const lista = carteira.data ?? [];

  return (
    <div className="flex flex-col gap-[18px]">
      {/* KPIs (Doc 3 §8.1) */}
      <div className="grid grid-cols-2 gap-[10px] lg:grid-cols-4 lg:gap-[14px]">
        <Kpi label="Carteira sob gestão" valor={k ? formatCurrency(k.carteiraSobGestao) : '—'} />
        <Kpi label="Contratos ativos" valor={String(k?.contratosAtivos ?? '—')} />
        <Kpi label="Inadimplência" valor={k ? `${k.inadimplenciaPct}%` : '—'} />
        <Kpi label="Recebido na semana" valor={k ? formatCurrency(k.recebidoNaSemana) : '—'} />
      </div>

      {/* Posição consolidada por titular */}
      <div
        className="rounded-card overflow-x-auto"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[12px] text-left font-semibold">Titular</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">CPF/CNPJ</th>
              <th className="px-[18px] py-[12px] text-center font-semibold">Contratos</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Saldo devedor</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Em atraso</th>
              <th className="px-[18px] py-[12px] text-center font-semibold">Faturas vencidas</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Situação</th>
            </tr>
          </thead>
          <tbody>
            {carteira.isLoading && (
              <tr>
                <td colSpan={7} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>
                  Carregando…
                </td>
              </tr>
            )}
            {!carteira.isLoading && lista.length === 0 && (
              <tr>
                <td colSpan={7} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>
                  Nenhum titular com contratos na carteira.
                </td>
              </tr>
            )}
            {lista.map((c) => {
              const s = SITUACAO[c.situacao] ?? SITUACAO.em_dia;
              return (
                <tr
                  key={c.contaId}
                  onClick={() => navigate(`/titulares/${c.titularId}`)}
                  className="cursor-pointer transition-colors hover:bg-[var(--surface-muted)]"
                  style={{ borderBottom: '1px solid var(--border-light)' }}
                >
                  <td className="px-[18px] py-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {c.titular}
                  </td>
                  <td className="px-[18px] py-[13px] tabular-nums" style={{ color: 'var(--text-body)' }}>
                    {c.cpfCnpj}
                  </td>
                  <td className="px-[18px] py-[13px] text-center tabular-nums" style={{ color: 'var(--text-body)' }}>
                    {c.contratosAtivos}
                  </td>
                  <td className="px-[18px] py-[13px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(c.saldoDevedor)}
                  </td>
                  <td className="px-[18px] py-[13px] text-right tabular-nums" style={{ color: c.valorEmAtraso > 0 ? '#c0392b' : 'var(--text-body)' }}>
                    {c.valorEmAtraso > 0 ? formatCurrency(c.valorEmAtraso) : '—'}
                  </td>
                  <td className="px-[18px] py-[13px] text-center tabular-nums" style={{ color: c.faturasVencidas > 0 ? '#c0392b' : 'var(--text-body)' }}>
                    {c.faturasVencidas || '—'}
                  </td>
                  <td className="px-[18px] py-[13px]">
                    <span className="rounded-[6px] px-[8px] py-[3px] text-[11px] font-bold" style={{ background: s.bg, color: s.fg }}>
                      {s.rotulo}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
