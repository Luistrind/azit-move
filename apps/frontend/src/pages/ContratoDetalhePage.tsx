import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { contratoService } from '../services/contrato.service';
import { operacoesService } from '../services/operacoes.service';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import {
  CONTRATO_STATUS_COLORS,
  PARCELA_STATUS_COLORS,
} from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, ROLE_REAJUSTE, mensagemErro } from '../lib/permissoes';

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
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const podeReajustar = pode(ROLE_REAJUSTE);
  const [tab, setTab] = useState<'cronograma' | 'extrato'>('cronograma');
  const [simulando, setSimulando] = useState(false);
  const [docOpen, setDocOpen] = useState(false);

  const documento = useQuery({
    queryKey: ['contrato', id, 'documento'],
    queryFn: () => contratoService.documento(id),
    enabled: docOpen,
  });

  function baixarDocumento() {
    const texto = documento.data?.texto;
    if (!texto) return;
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `contrato-${documento.data?.numero ?? id}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  const detalhe = useQuery({ queryKey: ['contrato', id], queryFn: () => contratoService.detalhe(id) });
  const cronograma = useQuery({
    queryKey: ['contrato', id, 'cronograma'],
    queryFn: () => contratoService.cronograma(id),
  });
  const extrato = useQuery({
    queryKey: ['contrato', id, 'extrato'],
    queryFn: () => contratoService.extrato(id),
  });

  async function recarregar() {
    await new Promise((r) => setTimeout(r, 1200));
    await queryClient.invalidateQueries({ queryKey: ['contrato', id] });
  }

  // Dev: simula pagamento da próxima parcela; a conciliação roda async (worker).
  async function simularPagamento() {
    setSimulando(true);
    try {
      await contratoService.simularPagamento(id);
      await recarregar();
    } catch (e) {
      alert(mensagemErro(e));
    } finally {
      setSimulando(false);
    }
  }

  // 6.6 — Quitação antecipada: simula (VP), confirma, aplica.
  async function quitar() {
    const sim = await operacoesService.simularQuitacao(id);
    const ok = window.confirm(
      `Quitação antecipada de ${sim.parcelas.length} parcela(s):\n` +
        `Valor nominal: ${(sim.valorNominalTotal / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n` +
        `Valor presente (quitação): ${(sim.valorQuitacao / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n` +
        `Desconto: ${(sim.desconto / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n\nConfirmar?`,
    );
    if (!ok) return;
    setSimulando(true);
    try {
      await operacoesService.quitar(id);
      await recarregar();
    } catch (e) {
      alert(mensagemErro(e));
    } finally {
      setSimulando(false);
    }
  }

  // 6.7 — Sinistro: indenização amortiza o saldo (não quita automaticamente).
  async function sinistro() {
    const v = window.prompt('Valor da indenização recebida (R$):', '20000');
    if (!v) return;
    setSimulando(true);
    try {
      await operacoesService.registrarSinistro(id, Math.round(Number(v) * 100));
      await recarregar();
    } catch (e) {
      alert(mensagemErro(e));
    } finally {
      setSimulando(false);
    }
  }

  // 6.8 — Reajuste IPCA (gera -> aprova -> aplica nas parcelas futuras).
  async function reajustar() {
    const v = window.prompt('Índice IPCA acumulado (%):', '4.5');
    if (!v) return;
    setSimulando(true);
    try {
      await operacoesService.reajustar(id, Number(v));
      await recarregar();
    } catch (e) {
      alert(mensagemErro(e));
    } finally {
      setSimulando(false);
    }
  }

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

      {/* Resumo financeiro + documento do contrato */}
      {c && (
        <div className="rounded-card flex flex-wrap items-center justify-between gap-[12px] p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex flex-wrap gap-[28px]">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-label)' }}>Valor do contrato</div>
              <div className="mt-[3px] font-display text-[16px] font-bold tabular-nums">{formatCurrency(c.valorTotal)}</div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-label)' }}>Valor pago</div>
              <div className="mt-[3px] font-display text-[16px] font-bold tabular-nums" style={{ color: '#1f9d5b' }}>{formatCurrency(c.resumo.valorPago)}</div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--text-label)' }}>Em aberto</div>
              <div className="mt-[3px] font-display text-[16px] font-bold tabular-nums">{formatCurrency(c.resumo.saldoDevedorAtual)}</div>
            </div>
          </div>
          <button onClick={() => setDocOpen(true)} className="h-[34px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>Ver documento do contrato</button>
        </div>
      )}

      {/* Tabs + ação dev de simular pagamento */}
      <div className="flex items-center justify-between">
        <div className="flex gap-[6px]">
          {(['cronograma', 'extrato'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="rounded-[8px] px-[14px] py-[7px] text-[12.5px] font-semibold capitalize"
              style={{
                background: tab === t ? 'var(--navy)' : 'var(--surface)',
                color: tab === t ? '#fff' : 'var(--text-body)',
                border: '1px solid var(--border)',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-[8px]">
          {podeOperar && (
            <button
              onClick={quitar}
              disabled={simulando}
              className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold"
              style={{ background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)', opacity: simulando ? 0.6 : 1 }}
            >
              Quitação antecipada
            </button>
          )}
          {podeOperar && (
            <button
              onClick={sinistro}
              disabled={simulando}
              className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold"
              style={{ background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)', opacity: simulando ? 0.6 : 1 }}
            >
              Sinistro
            </button>
          )}
          {podeReajustar && (
            <button
              onClick={reajustar}
              disabled={simulando}
              className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold"
              style={{ background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)', opacity: simulando ? 0.6 : 1 }}
            >
              Reajuste IPCA
            </button>
          )}
          {podeOperar && import.meta.env.DEV && (
            <button
              onClick={simularPagamento}
              disabled={simulando}
              className="rounded-[8px] px-[14px] py-[7px] text-[12px] font-semibold"
              style={{ background: 'var(--accent)', color: '#fff', opacity: simulando ? 0.6 : 1 }}
              title="Dev: dispara a conciliação da próxima fatura via fila"
            >
              {simulando ? '…' : 'Simular pagamento (dev)'}
            </button>
          )}
        </div>
      </div>

      {tab === 'cronograma' && (
        <div
          className="rounded-card overflow-x-auto"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                <th className="px-[18px] py-[11px] text-left font-semibold">Parcela</th>
                <th className="px-[18px] py-[11px] text-left font-semibold">Vencimento</th>
                <th className="px-[18px] py-[11px] text-right font-semibold">Valor</th>
                <th className="px-[18px] py-[11px] text-left font-semibold">Contrato</th>
                <th className="px-[18px] py-[11px] text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
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
                  {/* Natureza do contrato/produto que origina a parcela */}
                  <td className="px-[18px] py-[11px]" style={{ color: 'var(--text-body)' }}>
                    {p.composicao ?? '—'}
                  </td>
                  <td className="px-[18px] py-[11px]">
                    <StatusBadge label={p.status} colors={PARCELA_STATUS_COLORS} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'extrato' && (
        <div
          className="rounded-card overflow-x-auto"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                <th className="px-[18px] py-[11px] text-left font-semibold">Evento</th>
                <th className="px-[18px] py-[11px] text-left font-semibold">Data</th>
                <th className="px-[18px] py-[11px] text-right font-semibold">Valor</th>
                <th className="px-[18px] py-[11px] text-right font-semibold">Encargo</th>
              </tr>
            </thead>
            <tbody>
              {extrato.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-[18px] py-[20px] text-center" style={{ color: 'var(--text-muted)' }}>
                    Nenhum pagamento conciliado ainda.
                  </td>
                </tr>
              )}
              {extrato.data?.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td className="px-[18px] py-[11px]" style={{ color: 'var(--text-primary)' }}>
                    {e.label}
                  </td>
                  <td className="px-[18px] py-[11px] tabular-nums" style={{ color: 'var(--text-body)' }}>
                    {fmtData(e.data)}
                  </td>
                  <td className="px-[18px] py-[11px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {e.valor ? formatCurrency(e.valor) : '—'}
                  </td>
                  <td
                    className="px-[18px] py-[11px] text-right tabular-nums"
                    style={{ color: e.encargo ? '#c98a0a' : 'var(--text-muted)' }}
                  >
                    {e.encargo ? formatCurrency(e.encargo) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Documento do contrato (instrumento) — visualizar + baixar */}
      <Modal open={docOpen} onClose={() => setDocOpen(false)} title={`Documento — ${c?.numero ?? ''}`}>
        {documento.isLoading ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : (
          <div className="flex flex-col gap-[12px]">
            {documento.data && !documento.data.disponivel && (
              <div className="rounded-[8px] p-[10px] text-[11.5px]" style={{ background: '#fef6e9', color: '#8a5a0a' }}>
                Instrumento não disponível (contrato migrado do legado).
              </div>
            )}
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-[8px] p-[12px] text-[11.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>{documento.data?.texto}</pre>
            <button onClick={baixarDocumento} disabled={!documento.data?.texto} className="h-[34px] self-start rounded-[8px] px-[14px] text-[12px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Baixar (.txt)</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
