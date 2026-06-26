import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { contratoService } from '../services/contrato.service';
import { StatusBadge } from '../components/StatusBadge';
import {
  CONTRATO_STATUS_COLORS,
  PARCELA_STATUS_COLORS,
} from '../config/statusColors';

const ORIGEM_CAPITAL_LABEL: Record<string, string> = {
  CAPITAL_PROPRIO: 'Capital próprio',
  EMPRESTIMO: 'Empréstimo',
  INVESTIDOR_ATIVO: 'Investidor de ativo',
  FUNDO: 'Fundo',
};

function Metrica({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--navy-text-meta)' }}>
        {label}
      </div>
      <div
        className="mt-[4px] font-display text-[16px] font-bold"
        style={{ color: destaque ? 'var(--accent)' : '#fff' }}
      >
        {valor}
      </div>
    </div>
  );
}

function fmtData(iso: string): string {
  return iso.slice(0, 10).split('-').reverse().join('/');
}

export function ContratoDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const detalhe = useQuery({ queryKey: ['contrato', id], queryFn: () => contratoService.detalhe(id) });
  const cronograma = useQuery({
    queryKey: ['contrato', id, 'cronograma'],
    queryFn: () => contratoService.cronograma(id),
  });

  const c = detalhe.data;

  return (
    <div className="flex flex-col gap-[16px]">
      <button
        onClick={() => navigate('/')}
        className="self-start text-[12px] font-semibold"
        style={{ color: 'var(--text-body)' }}
      >
        ← Voltar para a Carteira
      </button>

      {/* Entity header (escuro) — guia visual §5.10 */}
      <div className="rounded-card p-[22px]" style={{ background: 'var(--navy)' }}>
        {c ? (
          <>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] font-semibold" style={{ color: 'var(--navy-text-meta)' }}>
                  {c.numero} · {c.ativo.placa ?? 'sem placa'}
                </div>
                <div className="mt-[3px] font-display text-[23px] font-bold text-white">
                  {c.titular.nome}
                </div>
                <div className="mt-[2px] text-[12px]" style={{ color: 'var(--navy-text-body)' }}>
                  {c.ativo.descricao} · origem {fmtData(c.dataAssinatura)}
                </div>
              </div>
              <StatusBadge label={c.status} colors={CONTRATO_STATUS_COLORS} />
            </div>
            <div className="mt-[20px] grid grid-cols-4 gap-[16px]">
              <Metrica label="Saldo devedor" valor={formatCurrency(c.resumo.saldoDevedorAtual)} />
              <Metrica
                label="Parcela"
                valor={`${c.resumo.parcelasPagas}/${c.resumo.totalParcelas}`}
              />
              <Metrica
                label="Próxima parcela"
                valor={c.resumo.proximaParcela ? fmtData(c.resumo.proximaParcela.dataVencimento) : '—'}
                destaque
              />
              <Metrica
                label="Origem de capital"
                valor={c.ativo.origemCapitalTipo ? ORIGEM_CAPITAL_LABEL[c.ativo.origemCapitalTipo] ?? '—' : '—'}
              />
            </div>
          </>
        ) : (
          <div className="text-[13px]" style={{ color: 'var(--navy-text-body)' }}>
            {detalhe.isLoading ? 'Carregando…' : 'Contrato não encontrado.'}
          </div>
        )}
      </div>

      {/* Tab Cronograma */}
      <div
        className="rounded-card overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="px-[18px] py-[13px] font-display text-[13px] font-bold" style={{ borderBottom: '1px solid var(--border)' }}>
          Cronograma
        </div>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[11px] text-left font-semibold">Parcela</th>
              <th className="px-[18px] py-[11px] text-left font-semibold">Vencimento</th>
              <th className="px-[18px] py-[11px] text-right font-semibold">Valor</th>
              <th className="px-[18px] py-[11px] text-left font-semibold">Composição</th>
              <th className="px-[18px] py-[11px] text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {cronograma.isLoading && (
              <tr>
                <td colSpan={5} className="px-[18px] py-[20px] text-center" style={{ color: 'var(--text-muted)' }}>
                  Carregando…
                </td>
              </tr>
            )}
            {cronograma.data?.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="px-[18px] py-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {p.display}
                </td>
                <td className="px-[18px] py-[11px] tabular-nums" style={{ color: 'var(--text-body)' }}>
                  {fmtData(p.dataVencimento)}
                </td>
                <td className="px-[18px] py-[11px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {formatCurrency(p.valorNominal)}
                </td>
                {/* Placeholder de breakdown (guia visual §tab cronograma) */}
                <td className="px-[18px] py-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Principal + serviços
                </td>
                <td className="px-[18px] py-[11px]">
                  <StatusBadge label={p.status} colors={PARCELA_STATUS_COLORS} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
