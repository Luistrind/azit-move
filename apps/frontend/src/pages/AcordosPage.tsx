import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { operacoesService } from '../services/operacoes.service';
import { StatusBadge } from '../components/StatusBadge';
import { ACORDO_STATUS_COLORS, NOVACAO_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_RENEGOCIACAO, ROLE_NOVACAO, mensagemErro } from '../lib/permissoes';
import { toast } from '../components/Toast';

const LABEL_STATUS: Record<string, string> = {
  rascunho: 'Aguardando aprovação',
  aguardando_entrada: 'Aguardando entrada',
  ativo: 'Ativo',
  cumprido: 'Cumprido',
  novado: 'Novado', // saldo absorvido por uma novação (F2, 14/09)
  cancelado: 'Cancelado',
  expirado: 'Expirado',
};

// Novação ≠ Acordo (Regra 5): rótulos próprios. F2 (14/09): fluxo completo.
const LABEL_STATUS_NOVACAO: Record<string, string> = {
  rascunho: 'Aguardando aprovação',
  aguardando_assinatura: 'Aguardando assinatura',
  aguardando_recebimento: 'Aguardando recebimento',
  ativo: 'Ativa',
  cancelado: 'Cancelada',
  expirado: 'Expirada',
};

// Acompanhamento de acordos e novações. A CRIAÇÃO nasce da ficha do titular
// (Renegociar atraso) — aqui é esteira: status, entrada, efetivação.
export function AcordosPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeRenegociar = pode(ROLE_RENEGOCIACAO);
  const podeNovar = pode(ROLE_NOVACAO);
  const [ocupado, setOcupado] = useState(false);

  const acordos = useQuery({ queryKey: ['acordos'], queryFn: () => operacoesService.acordos() });
  const novacoes = useQuery({ queryKey: ['novacoes'], queryFn: () => operacoesService.novacoes() });

  async function refetch() {
    await new Promise((r) => setTimeout(r, 700));
    await queryClient.invalidateQueries({ queryKey: ['acordos'] });
    await queryClient.invalidateQueries({ queryKey: ['novacoes'] });
    await queryClient.invalidateQueries({ queryKey: ['contratos'] });
    await queryClient.invalidateQueries({ queryKey: ['aprovacoes-contagem'] });
  }

  async function simularRecebimento(novacaoId: string) {
    setOcupado(true);
    try {
      await operacoesService.simularRecebimentoNovacao(novacaoId);
      await refetch();
      toast.sucesso('Recebimento simulado — a ativação atômica roda no worker.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function efetivar(acordoId: string) {
    setOcupado(true);
    try {
      await operacoesService.simularEntrada(acordoId);
      await refetch();
      toast.sucesso('Entrada simulada — acordo efetivado.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {podeRenegociar && (
        <div className="rounded-[12px] px-[16px] py-[12px] text-[12.5px]" style={{ background: '#eaf1fb', color: 'var(--navy)' }}>
          💡 A renegociação nasce da <b>ficha do titular</b> (botão "Renegociar atraso") — ela cobre as
          parcelas em atraso de todos os contratos da conta e passa pela Central de Aprovações.
        </div>
      )}

      {/* Novação: o form manual (esqueleto pré-produto) saiu de cena em 13/09 —
          o produto Novação nasce da ficha do titular (prévia da decomposição do
          saldo por produto, F1) e a proposta completa vem com a F2. */}
      {podeNovar && (
        <div className="rounded-[12px] px-[16px] py-[12px] text-[12.5px]" style={{ background: '#eaf1fb', color: 'var(--navy)' }}>
          💡 A novação também nasce da <b>ficha do titular</b> (botão "Novação (prévia do saldo)"):
          o sistema decompõe o saldo da conta por produto — parte do veículo × demais produtos — e a
          proposta dos dois contratos será montada a partir daí.
        </div>
      )}

      {/* Lista de acordos */}
      <div className="rounded-card overflow-x-auto" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[12px] text-left font-semibold">Escopo</th>
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
                <td className="px-[18px] py-[12px]">
                  <button onClick={() => a.titularId && navigate(`/titulares/${a.titularId}`)} className="font-semibold" style={{ color: 'var(--navy)' }}>
                    {a.titular}
                  </button>
                </td>
                <td className="px-[18px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(a.valorTotalRenegociado)}</td>
                <td className="px-[18px] py-[12px] text-center tabular-nums" style={{ color: 'var(--text-body)' }}>{a.numeroParcelasNovas} × {formatCurrency(a.valorParcelaNova)}</td>
                <td className="px-[18px] py-[12px]"><StatusBadge label={LABEL_STATUS[a.status] ?? a.status} colors={ACORDO_STATUS_COLORS} /></td>
                <td className="px-[18px] py-[12px] text-right">
                  <div className="flex items-center justify-end gap-[6px]">
                    {(a.status === 'aguardando_entrada' || a.status === 'rascunho') && podeRenegociar && import.meta.env.DEV && (
                      <button onClick={() => efetivar(a.id)} disabled={ocupado} className="rounded-[7px] px-[12px] py-[5px] text-[11.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>
                        Simular entrada (dev)
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Lista de novações (F2 — conta-cêntrica: 2 contratos assinados juntos) */}
      <div className="rounded-card overflow-x-auto" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-[18px] pt-[14px] font-display text-[13px] font-bold">Novações</div>
        <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[12px] text-left font-semibold">Cliente</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Veículo (C1)</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Termo (C2)</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Parcela única</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Contratos</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Status</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {novacoes.data?.length === 0 && (
              <tr><td colSpan={7} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhuma novação ainda — ela nasce da ficha do titular.</td></tr>
            )}
            {novacoes.data?.map((nv) => (
              <tr key={nv.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="px-[18px] py-[12px]">
                  <button onClick={() => nv.titularId && navigate(`/titulares/${nv.titularId}`)} className="font-semibold" style={{ color: 'var(--navy)' }}>
                    {nv.titular}
                  </button>
                </td>
                <td className="px-[18px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(nv.saldoVeiculo)}</td>
                <td className="px-[18px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(nv.saldoDemais)}</td>
                <td className="px-[18px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-body)' }}>{formatCurrency(nv.valorParcela)}</td>
                <td className="px-[18px] py-[12px]">
                  {nv.contratoVeiculo || nv.contratoTermo ? (
                    <span className="flex flex-col gap-[2px]">
                      {nv.contratoVeiculo && <button onClick={() => navigate(`/contratos/${nv.contratoVeiculo!.id}`)} className="text-left font-semibold" style={{ color: 'var(--navy)' }}>{nv.contratoVeiculo.numero} · veículo</button>}
                      {nv.contratoTermo && <button onClick={() => navigate(`/contratos/${nv.contratoTermo!.id}`)} className="text-left font-semibold" style={{ color: 'var(--navy)' }}>{nv.contratoTermo.numero} · termo</button>}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>— na aprovação —</span>
                  )}
                </td>
                <td className="px-[18px] py-[12px]"><StatusBadge label={LABEL_STATUS_NOVACAO[nv.status] ?? nv.status} colors={NOVACAO_STATUS_COLORS} /></td>
                <td className="px-[18px] py-[12px] text-right">
                  {nv.status === 'aguardando_recebimento' && podeNovar && import.meta.env.DEV && (
                    <button onClick={() => simularRecebimento(nv.id)} disabled={ocupado} className="rounded-[7px] px-[12px] py-[5px] text-[11.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>
                      Simular recebimento (dev)
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
