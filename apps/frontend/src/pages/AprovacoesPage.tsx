import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { creditoService, CreditoPendente } from '../services/credito.service';
import { usePodeRole, mensagemErro, ROLE_PARECER } from '../lib/permissoes';

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function AprovacoesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeAprovar = pode(ROLE_PARECER);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const pendentes = useQuery({
    queryKey: ['creditos-pendentes'],
    queryFn: () => creditoService.pendentes(),
  });

  async function recarregar() {
    await queryClient.invalidateQueries({ queryKey: ['creditos-pendentes'] });
  }

  async function aprovar(c: CreditoPendente) {
    setOcupado(c.contratoId);
    try {
      const r = await creditoService.aprovar(c.contratoId);
      await recarregar();
      window.alert(
        r.status === 'ativo'
          ? `Crédito ${c.numero} aprovado e ativado — parcelas lançadas na fatura do titular.`
          : `Crédito ${c.numero} aprovado — cobrança da entrada gerada no Asaas.`,
      );
    } catch (e) {
      window.alert(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function reprovar(c: CreditoPendente) {
    const motivo = window.prompt(`Reprovar o crédito ${c.numero}? Motivo (opcional):`);
    if (motivo === null) return;
    setOcupado(c.contratoId);
    try {
      await creditoService.reprovar(c.contratoId, motivo || undefined);
      await recarregar();
    } catch (e) {
      window.alert(mensagemErro(e));
    } finally {
      setOcupado(null);
    }
  }

  const lista = pendentes.data ?? [];

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="font-display text-[20px] font-bold">Aprovações</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Créditos de manutenção aguardando aprovação pela alçada.
        </p>
      </div>

      <div className="rounded-[14px] p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {pendentes.isLoading ? (
          <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : lista.length === 0 ? (
          <div className="py-[24px] text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Nenhum crédito aguardando aprovação.
          </div>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th className="pb-[8px] font-semibold">Contrato</th>
                <th className="pb-[8px] font-semibold">Titular</th>
                <th className="pb-[8px] font-semibold">Descrição</th>
                <th className="pb-[8px] text-right font-semibold">Valor</th>
                <th className="pb-[8px] text-right font-semibold">Entrada</th>
                <th className="pb-[8px] text-right font-semibold">Parcelas</th>
                <th className="pb-[8px]">Solicitado</th>
                <th className="pb-[8px] text-right font-semibold">Ação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.contratoId} style={{ borderTop: '1px solid var(--border-light)' }}>
                  <td className="py-[10px] font-semibold">{c.numero}</td>
                  <td className="py-[10px]">
                    <button onClick={() => navigate(`/titulares/${c.titularId}`)} className="font-semibold" style={{ color: 'var(--navy)' }}>
                      {c.titular}
                    </button>
                  </td>
                  <td className="py-[10px]">{c.descricao}</td>
                  <td className="py-[10px] text-right">{formatCurrency(c.valorTotal)}</td>
                  <td className="py-[10px] text-right">{c.valorEntrada > 0 ? formatCurrency(c.valorEntrada) : '—'}</td>
                  <td className="py-[10px] text-right">{c.numeroParcelas}× {formatCurrency(c.valorParcela)}</td>
                  <td className="py-[10px]">{fmtData(c.solicitadoEm)}</td>
                  <td className="py-[10px] text-right">
                    {podeAprovar ? (
                      <div className="flex justify-end gap-[6px]">
                        <button
                          disabled={ocupado === c.contratoId}
                          onClick={() => aprovar(c)}
                          className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold disabled:opacity-50"
                          style={{ background: 'var(--accent)', color: '#fff' }}
                        >
                          Aprovar
                        </button>
                        <button
                          disabled={ocupado === c.contratoId}
                          onClick={() => reprovar(c)}
                          className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold disabled:opacity-50"
                          style={{ background: '#fdeceb', color: '#c0392b' }}
                        >
                          Reprovar
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Sem alçada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
