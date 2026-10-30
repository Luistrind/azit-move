import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { rotuloAtivo, formatCurrency } from '@azit/utils';
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
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { Tabela } from '../components/Tabela';
import { Chips } from '../components/Chips';
import { Botao } from '../components/Botao';
import { Bloco } from '../components/Bloco';
import { Secao } from '../components/Secao';

// Layout v2 (doc 03 §11): header navy com Metrica escura, resumo em Bloco com
// Leitura, abas em Chips, cronograma/extrato em Tabela responsiva (celular =
// cartão por parcela), ações em Botao; só tokens.

const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

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
              <div className="flex justify-between"><span>Valor nominal</span><b className="tabular-nums">{formatCurrency(simQuitacao.valorNominalTotal)}</b></div>
              <div className="flex justify-between"><span>Valor para quitar hoje</span><b className="tabular-nums">{formatCurrency(simQuitacao.valorQuitacao)}</b></div>
              <div className="flex justify-between" style={{ color: 'var(--ok-fg)' }}><span>Desconto</span><b className="tabular-nums">{formatCurrency(simQuitacao.desconto)}</b></div>
            </div>
            {simQuitacao.fonte === 'catalogo' && (
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                Cálculo por componente (regras do produto no Catálogo): o bem é trazido a valor presente pela taxa de desconto da variante
                {simQuitacao.liquidacaoTotal
                  ? `; comissão recorrente e proteção futuras ISENTAS na liquidação total (comissão ${formatCurrency(simQuitacao.comissaoIsentada ?? 0)} + proteção ${formatCurrency(simQuitacao.protecaoIsentada ?? 0)}).`
                  : '; na antecipação parcial a comissão recorrente e a proteção são cobradas integralmente.'}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-[8px]">
              <Botao variante="secundaria" tamanho="sm" onClick={() => setSimQuitacao(null)}>Cancelar</Botao>
              <Botao variante="primaria" tamanho="sm" disabled={simulando} onClick={confirmarQuitacao}>
                {simulando ? 'Quitando…' : 'Confirmar quitação'}
              </Botao>
            </div>
          </div>
        </Modal>
      )}
      <button
        type="button"
        onClick={() => navigate('/carteira')}
        className="self-start text-[12px] font-semibold"
        style={{ color: 'var(--text-body)' }}
      >
        ← Voltar para a Carteira
      </button>

      {/* Entity header (escuro) — guia visual §5.10 / §11.3: navy é o único fundo com texto #fff */}
      <div className="rounded-card p-[18px] sm:p-[22px]" style={{ background: 'var(--navy)' }}>
        {c ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-[10px]">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold" style={{ color: 'var(--navy-text-meta)' }}>
                  {c.numero} · {c.ativo?.placa ?? 'sem placa'}
                </div>
                <div className="mt-[3px] font-display text-[20px] font-bold sm:text-[23px]" style={{ color: '#fff' }}>
                  {c.titular.nome}
                </div>
                <div className="mt-[2px] text-[12px]" style={{ color: 'var(--navy-text-body)' }}>
                  {c.ativo ? rotuloAtivo(c.ativo) : 'Reembolso Parcelado'} · origem {fmtData(c.dataAssinatura)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-[6px] sm:justify-end">
                {/* Três camadas (doc 02 §5.2, 07/09): fase + situação calculada + selos. */}
                <StatusBadge label={c.status} colors={CONTRATO_STATUS_COLORS} />
                {c.situacaoFinanceira && (
                  <StatusBadge
                    label={`${SITUACAO_CONTRATO_LABEL[c.situacaoFinanceira]}${c.situacaoFinanceira === 'em_atraso' && c.diasAtraso > 0 ? ` (${c.diasAtraso}d)` : ''}`}
                    colors={{ [`${SITUACAO_CONTRATO_LABEL[c.situacaoFinanceira]}${c.situacaoFinanceira === 'em_atraso' && c.diasAtraso > 0 ? ` (${c.diasAtraso}d)` : ''}`]: SITUACAO_CONTRATO_COLORS[c.situacaoFinanceira] }}
                  />
                )}
                {c.veiculoBloqueadoEm && (
                  <span className="rounded-full px-[9px] py-[3px] text-[10.5px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
                    Veículo bloqueado
                  </span>
                )}
                {c.recuperacaoIniciadaEm && (
                  <span className="rounded-full px-[9px] py-[3px] text-[10.5px] font-bold" style={{ background: 'var(--purple-bg)', color: 'var(--purple-fg)' }}>
                    Em recuperação
                  </span>
                )}
                {c.status === 'Encerrado' && c.motivoEncerramento && (
                  <span className="rounded-full px-[9px] py-[3px] text-[10.5px] font-bold" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>
                    {c.motivoEncerramento}
                  </span>
                )}
              </div>
            </div>
            {/* Encerrado por novação: o detalhe da operação (origens, contratos
                novos, trilha) vive em Renegociações — uma tela só (21/10). */}
            {c.status === 'Encerrado' && c.motivoEncerramento === 'novacao' && c.novacaoOrigemId && (
              <div className="mt-[12px] text-[12px]" style={{ color: 'var(--navy-text-body)' }}>
                Este contrato foi extinto por uma novação.{' '}
                <button type="button" onClick={() => navigate(`/acordos?novacao=${c.novacaoOrigemId}`)} className="font-semibold underline" style={{ color: 'var(--accent)' }}>Ver a novação →</button>
              </div>
            )}
            {/* Transferência da reserva de domínio (doc 02 §5.2): ação manual do
                encerrado por quitação. */}
            {c.status === 'Encerrado' && c.motivoEncerramento === 'quitacao' && (
              <div className="mt-[12px] flex flex-wrap items-center gap-[10px] text-[12px]" style={{ color: 'var(--navy-text-body)' }}>
                {c.transferenciaEfetivadaEm ? (
                  <span>✓ Transferência do veículo efetivada em {fmtData(c.transferenciaEfetivadaEm)}</span>
                ) : (
                  <>
                    <span>Transferência da reserva de domínio pendente.</span>
                    <Botao variante="primaria" tamanho="sm" onClick={() => void registrarTransferencia()}>
                      Registrar transferência efetivada
                    </Botao>
                  </>
                )}
              </div>
            )}
            <div className="mt-[20px] grid grid-cols-2 gap-[16px] lg:grid-cols-4">
              <Metrica tom="escuro" label="Saldo devedor" valor={formatCurrency(c.resumo.saldoDevedorAtual)} />
              <Metrica
                tom="escuro"
                label="Parcela"
                valor={`${c.resumo.parcelasPagas}/${c.resumo.totalParcelas}`}
              />
              <Metrica
                tom="escuro"
                label="Próxima parcela"
                valor={c.resumo.proximaParcela ? fmtData(c.resumo.proximaParcela.dataVencimento) : '—'}
                destaque
              />
              <Metrica
                tom="escuro"
                label="Estrutura jurídica"
                valor={c.ativo?.estruturaJuridica ?? '—'}
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
        <div className="rounded-card p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Secao titulo="Assinatura pendente">
            <div className="mb-[8px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {c.ativo ? 'O contrato aguarda assinatura digital.' : 'O termo do Reembolso Parcelado aguarda assinatura — as parcelas só entram nas faturas e o pagamento ao fornecedor só é criado quando todos assinarem.'}
            </div>
            <BlocoAssinaturaDigital
              contratoId={c.id}
              ocupado={assinando}
              run={runAssinatura}
              titulo={c.ativo ? undefined : 'Termo do Reembolso Parcelado (ZapSign)'}
            />
          </Secao>
        </div>
      )}

      {/* Resumo financeiro + documento do contrato — Bloco com a Leitura do Hub */}
      {c && (
        <Bloco
          titulo="Resumo financeiro"
          acao={<Botao variante="secundaria" tamanho="sm" onClick={() => setDocOpen(true)}>Ver documento do contrato</Botao>}
          leitura={
            <>
              Pagas <b>{c.resumo.parcelasPagas}</b> de <b>{c.resumo.totalParcelas}</b> parcelas · <b>{formatCurrency(c.resumo.saldoDevedorAtual)}</b> em aberto
              {c.resumo.proximaParcela ? <> · próxima em <b>{fmtData(c.resumo.proximaParcela.dataVencimento)}</b></> : null}.
            </>
          }
        >
          <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2 lg:grid-cols-4">
            <Metrica tom="claro" label="Valor do contrato" valor={formatCurrency(c.valorTotal)} />
            <Metrica tom="claro" label="Valor pago" valor={<span style={{ color: 'var(--ok-fg)' }}>{formatCurrency(c.resumo.valorPago)}</span>} />
            {(c.resumo.encargosPagos ?? 0) > 0 && (
              <Metrica tom="claro" label="Juros e multa pagos" valor={formatCurrency(c.resumo.encargosPagos ?? 0)} detalhe="Não abatem o saldo devedor." />
            )}
            <Metrica tom="claro" label="Em aberto" valor={formatCurrency(c.resumo.saldoDevedorAtual)} />
          </div>
        </Bloco>
      )}

      {/* Abas (chips) + ações do contrato (dev: simular pagamento) */}
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <Chips
          itens={[
            { chave: 'cronograma', rotulo: 'Cronograma', contagem: cronograma.data?.length },
            { chave: 'extrato', rotulo: 'Extrato', contagem: extrato.data?.length },
          ]}
          valor={tab}
          onChange={(k) => setTab((k as 'cronograma' | 'extrato') ?? 'cronograma')}
          todos={null}
        />
        <div className="flex flex-wrap gap-[8px]">
          {podeOperar && (
            <Botao variante="secundaria" tamanho="sm" onClick={quitar} disabled={simulando}>
              Quitação antecipada
            </Botao>
          )}
          {podeOperar && (
            <Botao variante="secundaria" tamanho="sm" onClick={() => setSinistroAberto(true)} disabled={simulando}>
              Sinistro
            </Botao>
          )}
          {podeReajustar && (
            <Botao variante="secundaria" tamanho="sm" onClick={() => setReajusteAberto(true)} disabled={simulando}>
              Reajuste IPCA
            </Botao>
          )}
          {podeOperar && podeCancelar && (
            <Botao variante="perigo" tamanho="sm" onClick={() => setCancelandoAberto(true)} disabled={simulando}>
              Cancelar contrato
            </Botao>
          )}
          {podeOperar && FERRAMENTAS_TESTE && (
            <Botao
              variante="primaria"
              tamanho="sm"
              onClick={simularPagamento}
              carregando={simulando}
              title="Dev: dispara a conciliação da próxima fatura via fila"
            >
              Simular pagamento (dev)
            </Botao>
          )}
        </div>
      </div>

      {sinistroAberto && (
        <Modal open onClose={() => setSinistroAberto(false)} title="Registrar sinistro">
          <div className="flex flex-col gap-[10px] text-[12.5px]">
            <p>A indenização recebida amortiza o saldo devedor (a dívida não se extingue com o bem — Regra 3).</p>
            <label className="flex flex-col gap-[4px] text-[12px]">
              <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Valor da indenização (R$)</span>
              <input value={valorSinistro} onChange={(e) => setValorSinistro(e.target.value)} className="h-[34px] rounded-[10px] px-[10px] text-right text-[13px]" style={inputStyle} />
            </label>
            <div className="flex flex-wrap justify-end gap-[8px]">
              <Botao variante="secundaria" tamanho="sm" onClick={() => setSinistroAberto(false)}>Voltar</Botao>
              <Botao variante="primaria" tamanho="sm" onClick={() => void confirmarSinistro()} disabled={simulando}>Registrar sinistro</Botao>
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
              <input value={indiceReajuste} onChange={(e) => setIndiceReajuste(e.target.value)} className="h-[34px] rounded-[10px] px-[10px] text-right text-[13px]" style={inputStyle} />
            </label>
            <div className="flex flex-wrap justify-end gap-[8px]">
              <Botao variante="secundaria" tamanho="sm" onClick={() => setReajusteAberto(false)}>Voltar</Botao>
              <Botao variante="primaria" tamanho="sm" onClick={() => void confirmarReajuste()} disabled={simulando}>Propor reajuste</Botao>
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
              <input value={motivoCancel} onChange={(e) => setMotivoCancel(e.target.value)} placeholder="ex: cliente desistiu / dados incorretos" className="h-[34px] rounded-[10px] px-[10px] text-[13px]" style={inputStyle} />
            </label>
            <div className="flex flex-wrap justify-end gap-[8px]">
              <Botao variante="secundaria" tamanho="sm" onClick={() => setCancelandoAberto(false)}>Voltar</Botao>
              <Botao variante="perigo" tamanho="sm" onClick={() => void confirmarCancelamento()} disabled={simulando}>Cancelar contrato</Botao>
            </div>
          </div>
        </Modal>
      )}

      {tab === 'cronograma' && (
        <Tabela
          colunas={[
            { chave: 'parcela', titulo: 'Parcela', celular: 'titulo', classe: 'tabular-nums', render: (p) => p.display },
            { chave: 'vencimento', titulo: 'Vencimento', celular: 'subtitulo', classe: 'tabular-nums', render: (p) => fmtData(p.dataVencimento) },
            { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums', render: (p) => formatCurrency(p.valorNominal) },
            // Natureza do contrato/produto que origina a parcela
            { chave: 'contrato', titulo: 'Contrato', celular: 'campo', render: (p) => p.composicao ?? '—' },
            { chave: 'status', titulo: 'Status', celular: 'campo', render: (p) => <StatusBadge label={p.status} colors={PARCELA_STATUS_COLORS} /> },
          ]}
          linhas={cronograma.data ?? []}
          chave={(p) => p.id}
          carregando={cronograma.isLoading}
          vazio="Sem cronograma — nasce na ativação do contrato."
        />
      )}

      {tab === 'extrato' && (
        <Tabela
          colunas={[
            { chave: 'evento', titulo: 'Evento', celular: 'titulo', render: (e) => e.label },
            { chave: 'data', titulo: 'Data', celular: 'subtitulo', classe: 'tabular-nums', render: (e) => fmtData(e.data) },
            { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums', render: (e) => (e.valor ? formatCurrency(e.valor) : '—') },
            {
              chave: 'encargo',
              titulo: 'Encargo',
              alinhar: 'right',
              celular: 'campo',
              classe: 'tabular-nums',
              render: (e) => <span style={{ color: e.encargo ? 'var(--warn-fg)' : 'var(--text-muted)' }}>{e.encargo ? formatCurrency(e.encargo) : '—'}</span>,
            },
          ]}
          linhas={(extrato.data ?? []).map((e, i) => ({ ...e, _chave: `${e.data}-${i}` }))}
          chave={(e) => e._chave}
          carregando={extrato.isLoading}
          vazio="Nenhum pagamento conciliado ainda."
        />
      )}

      {/* Documento do contrato (instrumento) — visualizar + baixar */}
      <Modal open={docOpen} onClose={() => setDocOpen(false)} title={`Documento — ${c?.numero ?? ''}`}>
        {documento.isLoading ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : (
          <div className="flex flex-col gap-[12px]">
            {documento.data && !documento.data.disponivel && (
              <div className="rounded-[10px] p-[10px] text-[11.5px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
                Instrumento não disponível (contrato migrado do legado).
              </div>
            )}
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-[10px] p-[12px] text-[11.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>{documento.data?.texto}</pre>
            <Botao variante="primaria" className="self-start" onClick={baixarDocumento} disabled={!documento.data?.texto}>Baixar (.txt)</Botao>
          </div>
        )}
      </Modal>
    </div>
  );
}
