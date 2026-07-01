import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { operacoesService } from '../services/operacoes.service';
import { contratoService } from '../services/contrato.service';
import { StatusBadge } from '../components/StatusBadge';
import { ACORDO_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_RENEGOCIACAO, ROLE_NOVACAO, mensagemErro } from '../lib/permissoes';

const LABEL_STATUS: Record<string, string> = {
  rascunho: 'Rascunho',
  ativo: 'Ativo',
  quitado: 'Quitado',
  cancelado: 'Cancelado',
};

export function AcordosPage() {
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeRenegociar = pode(ROLE_RENEGOCIACAO);
  const podeNovar = pode(ROLE_NOVACAO);
  const [ocupado, setOcupado] = useState(false);
  const [contratoId, setContratoId] = useState('');
  const [entrada, setEntrada] = useState('500');
  const [nParcelas, setNParcelas] = useState('6');

  // Novação (recuperação radical).
  const [novContratoId, setNovContratoId] = useState('');
  const [novValorTotal, setNovValorTotal] = useState('70000');
  const [novNParcelas, setNovNParcelas] = useState('24');
  const [novPeriodicidade, setNovPeriodicidade] = useState<'semanal' | 'quinzenal' | 'mensal'>('mensal');

  const acordos = useQuery({ queryKey: ['acordos'], queryFn: () => operacoesService.acordos() });
  const novacoes = useQuery({ queryKey: ['novacoes'], queryFn: () => operacoesService.novacoes() });
  const carteira = useQuery({ queryKey: ['contratos', 'lista'], queryFn: () => contratoService.listar({ limit: 50 }) });
  const elegivel = useQuery({
    queryKey: ['elegivel', contratoId],
    queryFn: () => operacoesService.elegivel(contratoId),
    enabled: !!contratoId,
  });

  const total = elegivel.data?.valorTotal ?? 0;
  const entradaCent = Math.round(Number(entrada || 0) * 100);
  const n = Math.max(1, Number(nParcelas || 1));
  const valorParcelaNova = Math.max(1, Math.round((total - entradaCent) / n));

  async function refetch() {
    await new Promise((r) => setTimeout(r, 700));
    await queryClient.invalidateQueries({ queryKey: ['acordos'] });
    await queryClient.invalidateQueries({ queryKey: ['novacoes'] });
    await queryClient.invalidateQueries({ queryKey: ['contratos'] });
  }

  const novValorTotalCent = Math.round(Number(novValorTotal || 0) * 100);
  const novN = Math.max(1, Number(novNParcelas || 1));
  const novParcela = Math.max(1, Math.round(novValorTotalCent / novN));

  async function novar() {
    if (!novContratoId || novValorTotalCent <= 0) return;
    setOcupado(true);
    try {
      const hoje = new Date();
      const primeira = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 10);
      await operacoesService.novar(novContratoId, {
        dataPrimeiraParcela: primeira.toISOString().slice(0, 10),
        valorTotal: novValorTotalCent,
        numeroParcelas: novN,
        valorParcelaInicial: novParcela,
        periodicidade: novPeriodicidade,
      });
      setNovContratoId('');
      await refetch();
    } catch (e) {
      alert(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function criar() {
    if (!contratoId || total <= 0) return;
    setOcupado(true);
    try {
      await operacoesService.criarRenegociacao(contratoId, {
        valorEntrada: entradaCent,
        numeroParcelasNovas: n,
        valorParcelaNova,
      });
      setContratoId('');
      await refetch();
    } catch (e) {
      alert(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function efetivar(acordoId: string) {
    setOcupado(true);
    try {
      await operacoesService.simularEntrada(acordoId);
      await refetch();
    } catch (e) {
      alert(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Nova renegociação (apenas papéis com alçada de renegociação) */}
      {podeRenegociar && (
      <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="mb-[12px] font-display text-[14px] font-bold">Nova renegociação</div>
        <div className="flex flex-wrap items-end gap-[14px]">
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Contrato</span>
            <select
              value={contratoId}
              onChange={(e) => setContratoId(e.target.value)}
              className="h-[36px] w-[260px] rounded-[8px] px-[10px] text-[12.5px]"
              style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
            >
              <option value="">Selecione…</option>
              {carteira.data?.data
                .filter((c) => c.status === 'Ativo' || c.status === 'Inadimplente' || c.status === 'Bloqueado')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.numero} · {c.titular.nome}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Entrada (R$)</span>
            <input value={entrada} onChange={(e) => setEntrada(e.target.value)} className="h-[36px] w-[110px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Nº parcelas</span>
            <input value={nParcelas} onChange={(e) => setNParcelas(e.target.value)} className="h-[36px] w-[90px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
          </label>
          <button
            onClick={criar}
            disabled={ocupado || !contratoId || total <= 0}
            className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
            style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado || !contratoId ? 0.6 : 1 }}
          >
            Criar acordo
          </button>
        </div>
        {contratoId && (
          <div className="mt-[12px] text-[12px]" style={{ color: 'var(--text-body)' }}>
            Saldo em aberto: <b>{formatCurrency(total)}</b> · Parcela nova ≈ <b>{formatCurrency(valorParcelaNova)}</b> × {n}
          </div>
        )}
      </div>
      )}

      {/* Nova novação (recuperação radical) — papéis ADMIN/APROVADOR/DIRETOR */}
      {podeNovar && (
      <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="mb-[4px] font-display text-[14px] font-bold">Nova novação</div>
        <div className="mb-[12px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          Liquida o contrato origem por inteiro e gera um contrato novo com estas condições.
        </div>
        <div className="flex flex-wrap items-end gap-[14px]">
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Contrato origem</span>
            <select
              value={novContratoId}
              onChange={(e) => setNovContratoId(e.target.value)}
              className="h-[36px] w-[260px] rounded-[8px] px-[10px] text-[12.5px]"
              style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
            >
              <option value="">Selecione…</option>
              {carteira.data?.data
                .filter((c) => c.status === 'Ativo' || c.status === 'Inadimplente' || c.status === 'Bloqueado')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.numero} · {c.titular.nome}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Novo total (R$)</span>
            <input value={novValorTotal} onChange={(e) => setNovValorTotal(e.target.value)} className="h-[36px] w-[120px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Nº parcelas</span>
            <input value={novNParcelas} onChange={(e) => setNovNParcelas(e.target.value)} className="h-[36px] w-[90px] rounded-[8px] px-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Periodicidade</span>
            <select
              value={novPeriodicidade}
              onChange={(e) => setNovPeriodicidade(e.target.value as 'semanal' | 'quinzenal' | 'mensal')}
              className="h-[36px] w-[120px] rounded-[8px] px-[10px] text-[12.5px]"
              style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
            >
              <option value="semanal">Semanal</option>
              <option value="quinzenal">Quinzenal</option>
              <option value="mensal">Mensal</option>
            </select>
          </label>
          <button
            onClick={novar}
            disabled={ocupado || !novContratoId || novValorTotalCent <= 0}
            className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
            style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado || !novContratoId ? 0.6 : 1 }}
          >
            Novar contrato
          </button>
        </div>
        {novContratoId && (
          <div className="mt-[12px] text-[12px]" style={{ color: 'var(--text-body)' }}>
            Parcela ≈ <b>{formatCurrency(novParcela)}</b> × {novN} ({novPeriodicidade})
          </div>
        )}
      </div>
      )}

      {/* Lista de acordos */}
      <div className="rounded-card overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[12px] text-left font-semibold">Contrato</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Cliente</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Renegociado</th>
              <th className="px-[18px] py-[12px] text-center font-semibold">Novas parcelas</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Status</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {acordos.data?.length === 0 && (
              <tr><td colSpan={6} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhum acordo ainda.</td></tr>
            )}
            {acordos.data?.map((a) => (
              <tr key={a.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="px-[18px] py-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{a.contratoNumero}</td>
                <td className="px-[18px] py-[12px]" style={{ color: 'var(--text-body)' }}>{a.titular}</td>
                <td className="px-[18px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(a.valorTotalRenegociado)}</td>
                <td className="px-[18px] py-[12px] text-center tabular-nums" style={{ color: 'var(--text-body)' }}>{a.numeroParcelasNovas} × {formatCurrency(a.valorParcelaNova)}</td>
                <td className="px-[18px] py-[12px]"><StatusBadge label={LABEL_STATUS[a.status] ?? a.status} colors={ACORDO_STATUS_COLORS} /></td>
                <td className="px-[18px] py-[12px] text-right">
                  {a.status === 'rascunho' && podeRenegociar && import.meta.env.DEV ? (
                    <button onClick={() => efetivar(a.id)} disabled={ocupado} className="rounded-[7px] px-[12px] py-[5px] text-[11.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>
                      Simular entrada (dev)
                    </button>
                  ) : (
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Lista de novações */}
      <div className="rounded-card overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-[18px] pt-[14px] font-display text-[13px] font-bold">Novações</div>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[12px] text-left font-semibold">Contrato origem</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Contrato novo</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Saldo liquidado</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {novacoes.data?.length === 0 && (
              <tr><td colSpan={4} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhuma novação ainda.</td></tr>
            )}
            {novacoes.data?.map((nv) => (
              <tr key={nv.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="px-[18px] py-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{nv.contratoOrigem}</td>
                <td className="px-[18px] py-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{nv.contratoNovo}</td>
                <td className="px-[18px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(nv.saldoLiquidado)}</td>
                <td className="px-[18px] py-[12px]"><StatusBadge label={LABEL_STATUS[nv.status] ?? nv.status} colors={ACORDO_STATUS_COLORS} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
