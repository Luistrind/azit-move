import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { contratoService } from '../services/contrato.service';
import { operacoesService, SimulacaoQuitacao } from '../services/operacoes.service';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import {
  CONTRATO_STATUS_COLORS,
  SITUACAO_CONTRATO_COLORS,
  SITUACAO_CONTRATO_LABEL,
  PARCELA_STATUS_COLORS,
} from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, ROLE_REAJUSTE, mensagemErro } from '../lib/permissoes';
import { reaisParaCentavos, numeroBR } from '../lib/valor';
import { Metrica } from '../components/Metrica';
import { BlocoAssinaturaDigital } from '../components/BlocoAssinaturaDigital';

const ORIGEM_CAPITAL_LABEL: Record<string, string> = {
  CAPITAL_PROPRIO: 'Capital próprio',
  EMPRESTIMO: 'Empréstimo',
  INVESTIDOR_ATIVO: 'Investidor de ativo',
  FUNDO: 'Fundo',
};


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
  // Assinatura do termo (RP — doc 02 §18.5, 13/09).
  const [assinando, setAssinando] = useState(false);
  async function runAssinatura(fn: () => Promise<unknown>) {
    setAssinando(true);
    try {
      await fn();
      // Auditoria 15/09 (Bloco D): a chave era 'contrato-detalhe', que NENHUMA
      // query usa — a tela não refletia a assinatura sem F5.
      await queryClient.invalidateQueries({ queryKey: ['contrato', id] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setAssinando(false);
    }
  }
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

  async function registrarTransferencia() {
    try {
      await contratoService.registrarTransferencia(id);
      await queryClient.invalidateQueries({ queryKey: ['contrato', id] });
      toast.sucesso('Transferência registrada.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
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
      toast.erro(mensagemErro(e));
    } finally {
      setSimulando(false);
    }
  }

  // 6.6 — Quitação antecipada (F4: por componente quando o Catálogo está ativo).
  // Modal com o resumo e as isenções — princípio P6 (nunca confirm/prompt).
  const [simQuitacao, setSimQuitacao] = useState<SimulacaoQuitacao | null>(null);
  async function quitar() {
    try {
      setSimQuitacao(await operacoesService.simularQuitacao(id));
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }
  async function confirmarQuitacao() {
    setSimulando(true);
    try {
      await operacoesService.quitar(id);
      setSimQuitacao(null);
      await recarregar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setSimulando(false);
    }
  }

  // Bloco B (15/09): cancelamento de contrato NÃO efetivado (aguardando
  // assinatura/entrada) — libera o veículo e devolve a proposta para
  // reformalização. Novação desmonta o par de contratos junto.
  const [cancelandoAberto, setCancelandoAberto] = useState(false);
  const [motivoCancel, setMotivoCancel] = useState('');
  const podeCancelar =
    !!detalhe.data && ['Aguardando assinatura', 'Aguardando pagamento inicial'].includes(detalhe.data.status);
  async function confirmarCancelamento() {
    setSimulando(true);
    try {
      await contratoService.cancelarNaoEfetivado(id, motivoCancel.trim() || undefined);
      setCancelandoAberto(false);
      setMotivoCancel('');
      toast.sucesso('Contrato cancelado — veículo liberado e proposta reformalizável.');
      await recarregar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setSimulando(false);
    }
  }

  // 6.7 — Sinistro: indenização amortiza o saldo (não quita automaticamente).
  // Auditoria 15/09 (Bloco D): window.prompt/alert saíram — Modal + toast (P6).
  const [sinistroAberto, setSinistroAberto] = useState(false);
  const [valorSinistro, setValorSinistro] = useState('20.000,00');
  async function confirmarSinistro() {
    setSimulando(true);
    try {
      await operacoesService.registrarSinistro(id, reaisParaCentavos(valorSinistro));
      setSinistroAberto(false);
      toast.sucesso('Sinistro registrado — indenização amortizada no saldo.');
      await recarregar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setSimulando(false);
    }
  }

  // 6.8 — Reajuste IPCA (gera -> aprova -> aplica nas parcelas futuras).
  const [reajusteAberto, setReajusteAberto] = useState(false);
  const [indiceReajuste, setIndiceReajuste] = useState('4,5');
  async function confirmarReajuste() {
    setSimulando(true);
    try {
      await operacoesService.reajustar(id, numeroBR(indiceReajuste));
      setReajusteAberto(false);
      toast.sucesso('Reajuste proposto — segue para a Central de Aprovações.');
      await recarregar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setSimulando(false);
    }
  }

  const c = detalhe.data;

  return (
    <div className="flex flex-col gap-[16px]">
      {simQuitacao && (
        <Modal open onClose={() => setSimQuitacao(null)} title="Quitação antecipada">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <div>
              {simQuitacao.liquidacaoTotal ? 'Liquidação TOTAL do contrato' : 'Antecipação parcial'} — {simQuitacao.parcelas.length} parcela(s).
            </div>
            <div className="rounded-[10px] p-[10px]" style={{ background: 'var(--surface-input)' }}>
              <div className="flex justify-between"><span>Valor nominal</span><b>{formatCurrency(simQuitacao.valorNominalTotal)}</b></div>
              <div className="flex justify-between"><span>Valor para quitar hoje</span><b>{formatCurrency(simQuitacao.valorQuitacao)}</b></div>
              <div className="flex justify-between" style={{ color: '#1c7a3d' }}><span>Desconto</span><b>{formatCurrency(simQuitacao.desconto)}</b></div>
            </div>
            {simQuitacao.fonte === 'catalogo' && (
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                Cálculo por componente (regras do produto no Catálogo): o bem é trazido a valor presente pela taxa de desconto da variante
                {simQuitacao.liquidacaoTotal
                  ? `; comissão recorrente e proteção futuras ISENTAS na liquidação total (comissão ${formatCurrency(simQuitacao.comissaoIsentada ?? 0)} + proteção ${formatCurrency(simQuitacao.protecaoIsentada ?? 0)}).`
                  : '; na antecipação parcial a comissão recorrente e a proteção são cobradas integralmente.'}
              </div>
            )}
            <div className="flex justify-end gap-[8px]">
              <button className="rounded-[8px] border border-[var(--border)] px-[12px] py-[7px] text-[12px] font-bold" onClick={() => setSimQuitacao(null)}>Cancelar</button>
              <button className="rounded-[8px] bg-[var(--navy)] px-[12px] py-[7px] text-[12px] font-bold text-white disabled:opacity-50" disabled={simulando} onClick={confirmarQuitacao}>
                {simulando ? 'Quitando…' : 'Confirmar quitação'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <button
        onClick={() => navigate('/carteira')}
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
                  {c.numero} · {c.ativo?.placa ?? 'sem placa'}
                </div>
                <div className="mt-[3px] font-display text-[23px] font-bold text-white">
                  {c.titular.nome}
                </div>
                <div className="mt-[2px] text-[12px]" style={{ color: 'var(--navy-text-body)' }}>
                  {c.ativo?.descricao ?? 'Reembolso Parcelado'} · origem {fmtData(c.dataAssinatura)}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-[6px]">
                {/* Três camadas (doc 02 §5.2, 07/09): fase + situação calculada + selos. */}
                <StatusBadge label={c.status} colors={CONTRATO_STATUS_COLORS} />
                {c.situacaoFinanceira && (
                  <StatusBadge
                    label={`${SITUACAO_CONTRATO_LABEL[c.situacaoFinanceira]}${c.situacaoFinanceira === 'em_atraso' && c.diasAtraso > 0 ? ` (${c.diasAtraso}d)` : ''}`}
                    colors={{ [`${SITUACAO_CONTRATO_LABEL[c.situacaoFinanceira]}${c.situacaoFinanceira === 'em_atraso' && c.diasAtraso > 0 ? ` (${c.diasAtraso}d)` : ''}`]: SITUACAO_CONTRATO_COLORS[c.situacaoFinanceira] }}
                  />
                )}
                {c.veiculoBloqueadoEm && (
                  <span className="rounded-[20px] px-[9px] py-[3px] text-[10.5px] font-bold" style={{ background: '#fdeceb', color: '#e0413c' }}>
                    Veículo bloqueado
                  </span>
                )}
                {c.recuperacaoIniciadaEm && (
                  <span className="rounded-[20px] px-[9px] py-[3px] text-[10.5px] font-bold" style={{ background: '#f3eafb', color: '#9a3bd1' }}>
                    Em recuperação
                  </span>
                )}
                {c.status === 'Encerrado' && c.motivoEncerramento && (
                  <span className="rounded-[20px] px-[9px] py-[3px] text-[10.5px] font-bold" style={{ background: '#f1f4f8', color: '#5b6b7f' }}>
                    {c.motivoEncerramento}
                  </span>
                )}
              </div>
            </div>
            {/* Transferência da reserva de domínio (doc 02 §5.2): ação manual do
                encerrado por quitação. */}
            {c.status === 'Encerrado' && c.motivoEncerramento === 'quitacao' && (
              <div className="mt-[12px] flex items-center gap-[10px] text-[12px]" style={{ color: 'var(--navy-text-body)' }}>
                {c.transferenciaEfetivadaEm ? (
                  <span>✓ Transferência do veículo efetivada em {fmtData(c.transferenciaEfetivadaEm)}</span>
                ) : (
                  <>
                    <span>Transferência da reserva de domínio pendente.</span>
                    <button
                      onClick={() => void registrarTransferencia()}
                      className="rounded-[7px] px-[10px] py-[5px] text-[11.5px] font-semibold"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      Registrar transferência efetivada
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="mt-[20px] grid grid-cols-4 gap-[16px]">
              <Metrica tom="escuro" label="Saldo devedor" valor={formatCurrency(c.resumo.saldoDevedorAtual)} />
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
                valor={c.ativo?.origemCapitalTipo ? ORIGEM_CAPITAL_LABEL[c.ativo.origemCapitalTipo] ?? '—' : '—'}
              />
            </div>
          </>
        ) : (
          <div className="text-[13px]" style={{ color: 'var(--navy-text-body)' }}>
            {detalhe.isLoading ? 'Carregando…' : 'Contrato não encontrado.'}
          </div>
        )}
      </div>

      {/* Termo do Reembolso Parcelado aguardando assinatura (doc 02 §18.5, 13/09):
          cronograma e pagamento ao fornecedor só nascem quando TODOS assinam. */}
      {c && c.status === 'Aguardando assinatura' && (
        <div className="rounded-card flex flex-col gap-[8px] p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="text-[13px] font-bold">Assinatura pendente</div>
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {c.ativo ? 'O contrato aguarda assinatura digital.' : 'O termo do Reembolso Parcelado aguarda assinatura — as parcelas só entram nas faturas e o pagamento ao fornecedor só é criado quando todos assinarem.'}
          </div>
          <BlocoAssinaturaDigital
            contratoId={c.id}
            ocupado={assinando}
            run={runAssinatura}
            titulo={c.ativo ? undefined : 'Termo do Reembolso Parcelado (ZapSign)'}
          />
        </div>
      )}

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
              onClick={() => setSinistroAberto(true)}
              disabled={simulando}
              className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold"
              style={{ background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)', opacity: simulando ? 0.6 : 1 }}
            >
              Sinistro
            </button>
          )}
          {podeReajustar && (
            <button
              onClick={() => setReajusteAberto(true)}
              disabled={simulando}
              className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold"
              style={{ background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)', opacity: simulando ? 0.6 : 1 }}
            >
              Reajuste IPCA
            </button>
          )}
          {podeOperar && podeCancelar && (
            <button
              onClick={() => setCancelandoAberto(true)}
              disabled={simulando}
              className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold"
              style={{ background: '#fdeceb', color: '#c0392b', border: '1px solid #f2c6c2', opacity: simulando ? 0.6 : 1 }}
            >
              Cancelar contrato
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

      {sinistroAberto && (
        <Modal open onClose={() => setSinistroAberto(false)} title="Registrar sinistro">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p>A indenização recebida amortiza o saldo devedor (a dívida não se extingue com o bem — Regra 3).</p>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Valor da indenização (R$)</span>
              <input value={valorSinistro} onChange={(e) => setValorSinistro(e.target.value)} className="h-[34px] rounded-[8px] px-[10px] text-right text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            </label>
            <div className="flex justify-end gap-[8px]">
              <button onClick={() => setSinistroAberto(false)} className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>Voltar</button>
              <button onClick={() => void confirmarSinistro()} disabled={simulando} className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold" style={{ background: 'var(--navy)', color: '#fff', opacity: simulando ? 0.6 : 1 }}>Registrar sinistro</button>
            </div>
          </div>
        </Modal>
      )}

      {reajusteAberto && (
        <Modal open onClose={() => setReajusteAberto(false)} title="Reajuste IPCA">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p>Propõe o reajuste das parcelas futuras pelo índice acumulado — a aplicação depende da Central de Aprovações.</p>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Índice IPCA acumulado (%)</span>
              <input value={indiceReajuste} onChange={(e) => setIndiceReajuste(e.target.value)} className="h-[34px] rounded-[8px] px-[10px] text-right text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            </label>
            <div className="flex justify-end gap-[8px]">
              <button onClick={() => setReajusteAberto(false)} className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>Voltar</button>
              <button onClick={() => void confirmarReajuste()} disabled={simulando} className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold" style={{ background: 'var(--navy)', color: '#fff', opacity: simulando ? 0.6 : 1 }}>Propor reajuste</button>
            </div>
          </div>
        </Modal>
      )}

      {cancelandoAberto && (
        <Modal open onClose={() => setCancelandoAberto(false)} title="Cancelar contrato não efetivado">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p>
              O contrato ainda não virou obrigação ({c?.status.toLowerCase()}). Cancelar libera o veículo
              de volta ao estoque e permite reformalizar a proposta. Esta ação não tem desfazer.
            </p>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Motivo (opcional)</span>
              <input value={motivoCancel} onChange={(e) => setMotivoCancel(e.target.value)} placeholder="ex: cliente desistiu / dados incorretos" className="h-[34px] rounded-[8px] px-[10px] text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
            </label>
            <div className="flex justify-end gap-[8px]">
              <button onClick={() => setCancelandoAberto(false)} className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>Voltar</button>
              <button onClick={() => void confirmarCancelamento()} disabled={simulando} className="rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold" style={{ background: '#c0392b', color: '#fff', opacity: simulando ? 0.6 : 1 }}>Cancelar contrato</button>
            </div>
          </div>
        </Modal>
      )}

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
