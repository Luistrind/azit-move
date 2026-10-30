import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { contaService } from '../services/conta.service';
import { CartaoIndicador } from '../components/CartaoIndicador';
import { CONTA_SITUACAO_COLORS, CONTA_SITUACAO_LABEL } from '../config/statusColors';

// Clientes da carteira (doc 02 §27.8, decisão Luís 30/10): a grade TITULAR-cêntrica
// de sempre (posição consolidada por conta — o contrato é o drill-down na ficha),
// agora tela própria do módulo Carteira, com filtro por situação pela URL
// (?situacao=em_atraso — é para cá que os cartões da visão geral apontam) e o
// valor sob gestão a VALOR PRESENTE (mesma conta da quitação antecipada). Os
// indicadores de cobrança ficaram na visão geral.
const SITUACOES = ['em_dia', 'em_atraso', 'em_acordo', 'bloqueada'] as const;
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export function CarteiraClientesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filtro = params.get('situacao');
  const [busca, setBusca] = useState('');

  const carteira = useQuery({ queryKey: ['carteira-contas'], queryFn: () => contaService.carteira() });
  const resumo = useQuery({ queryKey: ['carteira-resumo'], queryFn: () => contaService.resumo(), staleTime: 5 * 60_000 });

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (carteira.data ?? []).filter((c) => (!filtro || c.situacao === filtro) && (!q || c.titular.toLowerCase().includes(q) || c.cpfCnpj.includes(q)));
  }, [carteira.data, filtro, busca]);
  const situacaoDe = (chave: string) => ({ ...(CONTA_SITUACAO_COLORS[chave] ?? CONTA_SITUACAO_COLORS.em_dia), rotulo: CONTA_SITUACAO_LABEL[chave] ?? chave });
  const r = resumo.data;

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2 lg:grid-cols-4">
        <CartaoIndicador
          rotulo="Valor sob gestão"
          tom="neutro"
          valor={r ? formatCurrency(r.valorSobGestaoPresente) : '—'}
          detalhe={r ? `a valor presente · ${formatCurrency(r.valorSobGestaoNominal)} nominal` : 'a valor presente'}
        />
        <CartaoIndicador rotulo="Contratos ativos" tom="neutro" valor={r ? String(r.contratosAtivos) : '—'} detalhe={r ? `${r.contas} contas` : undefined} />
        <CartaoIndicador
          rotulo="Em atraso"
          tom="bad"
          valor={r ? formatCurrency(r.valorEmAtraso) : '—'}
          detalhe={r ? `${r.contasEmAtraso} de ${r.contas} contas · ${pct(r.contasEmAtraso, r.contas)}%` : undefined}
          onClick={() => setParams({ situacao: 'em_atraso' })}
          ativo={filtro === 'em_atraso'}
        />
        <CartaoIndicador
          rotulo="Bloqueadas"
          tom="warn"
          valor={r ? String(r.contasBloqueadas) : '—'}
          detalhe="contas com veículo bloqueado"
          onClick={() => setParams({ situacao: 'bloqueada' })}
          ativo={filtro === 'bloqueada'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-[6px]">
        {[null, ...SITUACOES].map((s) => {
          const on = (filtro ?? null) === s;
          return (
            <button
              key={s ?? 'todas'}
              type="button"
              onClick={() => (s ? setParams({ situacao: s }) : setParams({}))}
              className="min-h-[30px] rounded-full border px-[11px] text-[12px]"
              style={on ? { background: 'var(--text-primary)', color: 'var(--surface)', borderColor: 'var(--text-primary)', fontWeight: 600 } : { color: 'var(--text-body)', borderColor: 'var(--border)' }}
            >
              {s ? CONTA_SITUACAO_LABEL[s] ?? s : 'Todas'}
            </button>
          );
        })}
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou CPF"
          aria-label="Buscar cliente"
          className="min-h-[30px] min-w-[180px] flex-1 rounded-full border px-[12px] text-[12.5px] sm:max-w-[280px]"
          style={{ background: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
        />
        <span className="ml-auto text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {lista.length} conta{lista.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Celular: cartões */}
      <div className="flex flex-col gap-[8px] md:hidden">
        {lista.map((c) => {
          const s = situacaoDe(c.situacao);
          return (
            <button key={c.contaId} type="button" onClick={() => navigate(`/titulares/${c.titularId}`)} className="rounded-card p-[14px] text-left" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between gap-[8px]">
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{c.titular}</div>
                  <div className="text-[11.5px] tabular-nums" style={{ color: 'var(--text-body)' }}>{c.cpfCnpj} · {c.contratosAtivos} contrato{c.contratosAtivos === 1 ? '' : 's'}</div>
                </div>
                <span className="flex-none rounded-[6px] px-[8px] py-[3px] text-[11px] font-bold" style={{ background: s.bg, color: s.fg }}>{s.rotulo}</span>
              </div>
              <div className="mt-[8px] grid grid-cols-2 gap-[8px] text-[12px]">
                <div><div style={{ color: 'var(--text-label)' }}>Saldo devedor</div><div className="font-display font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(c.saldoDevedor)}</div></div>
                <div><div style={{ color: 'var(--text-label)' }}>Em atraso</div><div className="font-display font-semibold tabular-nums" style={{ color: c.valorEmAtraso > 0 ? 'var(--danger-fg)' : 'var(--text-primary)' }}>{c.valorEmAtraso > 0 ? `${formatCurrency(c.valorEmAtraso)} · ${c.faturasVencidas} fat.` : '—'}</div></div>
              </div>
            </button>
          );
        })}
        {!carteira.isLoading && lista.length === 0 ? <div className="py-[18px] text-center text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Nenhuma conta aqui.</div> : null}
      </div>

      {/* Desktop: a grade */}
      <div className="hidden overflow-x-auto rounded-card md:block" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
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
              <tr><td colSpan={7} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Carregando…</td></tr>
            )}
            {!carteira.isLoading && lista.length === 0 && (
              <tr><td colSpan={7} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>{filtro || busca ? 'Nenhuma conta com esse filtro.' : 'Nenhum titular com contratos na carteira.'}</td></tr>
            )}
            {lista.map((c) => {
              const s = situacaoDe(c.situacao);
              return (
                <tr key={c.contaId} onClick={() => navigate(`/titulares/${c.titularId}`)} className="cursor-pointer transition-colors hover:bg-[var(--surface-muted)]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td className="px-[18px] py-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{c.titular}</td>
                  <td className="px-[18px] py-[13px] tabular-nums" style={{ color: 'var(--text-body)' }}>{c.cpfCnpj}</td>
                  <td className="px-[18px] py-[13px] text-center tabular-nums" style={{ color: 'var(--text-body)' }}>{c.contratosAtivos}</td>
                  <td className="px-[18px] py-[13px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(c.saldoDevedor)}</td>
                  <td className="px-[18px] py-[13px] text-right tabular-nums" style={{ color: c.valorEmAtraso > 0 ? 'var(--danger-fg)' : 'var(--text-body)' }}>{c.valorEmAtraso > 0 ? formatCurrency(c.valorEmAtraso) : '—'}</td>
                  <td className="px-[18px] py-[13px] text-center tabular-nums" style={{ color: c.faturasVencidas > 0 ? 'var(--danger-fg)' : 'var(--text-body)' }}>{c.faturasVencidas || '—'}</td>
                  <td className="px-[18px] py-[13px]"><span className="rounded-[6px] px-[8px] py-[3px] text-[11px] font-bold" style={{ background: s.bg, color: s.fg }}>{s.rotulo}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
