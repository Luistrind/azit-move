import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { Stepper } from './Stepper';
import { toast } from './Toast';
import { operacoesService } from '../services/operacoes.service';
import { reaisParaCentavos } from '../lib/valor';
import { mensagemErro } from '../lib/permissoes';
import { somarDiasISO } from '../lib/datas';

const STEPS = [
  { key: 'diagnostico', label: 'Diagnóstico' },
  { key: 'proposta', label: 'Proposta' },
  { key: 'revisao', label: 'Revisão e envio' },
  { key: 'confirmacao', label: 'Confirmação' },
];

// Wizard de renegociação CONTA-cêntrica (Doc 2 §7.7): aberto da ficha do titular.
// Diagnóstico (atraso de todos os contratos) → proposta → envio p/ aprovação (§7.9-A).
export function RenegociacaoWizard({
  contaId,
  titular,
  onClose,
}: {
  contaId: string;
  titular: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [entrada, setEntrada] = useState('');
  const [parcelas, setParcelas] = useState('4');
  // Data-limite DURA da entrada (decisão 2026-08-18): default hoje + 5 dias.
  const [dataEntrada, setDataEntrada] = useState(() => somarDiasISO(5));
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ contratosAfetados: number } | null>(null);
  // Seleção por FATURA (doc Acordo de Pagamento V1.0 RAP005/006): todas entram
  // pré-selecionadas; desmarcar exige justificativa auditável.
  const [exclusoes, setExclusoes] = useState<Record<string, string>>({});
  // Faturas VINCENDAS incluídas por opção do operador (decisão 30/08): entram
  // DESMARCADAS por padrão — incluir aumenta a entrada mínima e antecipa a segurança.
  const [vincendas, setVincendas] = useState<string[]>([]);

  const eleg = useQuery({
    queryKey: ['renegociacao-elegivel', contaId],
    queryFn: () => operacoesService.elegivelConta(contaId),
  });

  const faturas = eleg.data?.faturas ?? [];
  const proximas = eleg.data?.faturasProximas ?? [];
  const vincendasSel = proximas.filter((f) => vincendas.includes(f.faturaId));
  const selecionadas = [...faturas.filter((f) => !(f.faturaId in exclusoes)), ...vincendasSel];
  const total = selecionadas.reduce((s, f) => s + f.valorAtualizado, 0);
  const encargosSelecionados = selecionadas.reduce((s, f) => s + f.encargosMora, 0);
  const justificativasOk = Object.values(exclusoes).every((j) => j.trim().length >= 10);
  const entradaCent = reaisParaCentavos(entrada);
  const nParcelas = Math.max(1, parseInt(parcelas || '0', 10) || 0);

  // Números do SERVIDOR (RAP031): motor do Catálogo (TP + TR Price + entrada
  // mínima + frequência herdada) quando o produto está ATIVO; senão divisão simples.
  const listaExclusoes = Object.entries(exclusoes).map(([faturaId, justificativa]) => ({ faturaId, justificativa: justificativa.trim() }));
  const previa = useQuery({
    queryKey: ['renegociacao-previa', contaId, entradaCent, nParcelas, listaExclusoes.map((e) => e.faturaId).join(','), vincendas.join(',')],
    queryFn: () => operacoesService.simularRenegociacaoConta(contaId, { valorEntrada: entradaCent, numeroParcelasNovas: nParcelas, faturasExcluidas: listaExclusoes, faturasVincendasIncluidas: vincendas }),
    enabled: total > 0 && nParcelas > 0 && entradaCent < total && justificativasOk,
    retry: false,
  });
  const p = previa.data;
  const valorParcela = p?.valorParcela ?? (nParcelas > 0 ? Math.round(Math.max(0, total - entradaCent) / nParcelas) : 0);
  const propostaValida = total > 0 && entradaCent < total && nParcelas > 0 && valorParcela > 0 && justificativasOk && !!dataEntrada;

  function alternarFatura(faturaId: string) {
    setExclusoes((atual) => {
      const novo = { ...atual };
      if (faturaId in novo) delete novo[faturaId];
      else novo[faturaId] = '';
      return novo;
    });
  }

  async function enviar() {
    setEnviando(true);
    try {
      const r = await operacoesService.criarRenegociacaoConta(contaId, {
        valorEntrada: entradaCent,
        numeroParcelasNovas: nParcelas,
        dataPagamentoEntrada: dataEntrada,
        faturasExcluidas: listaExclusoes,
        faturasVincendasIncluidas: vincendas,
      });
      setResultado({ contratosAfetados: r.contratosAfetados });
      setStep(3);
      await queryClient.invalidateQueries({ queryKey: ['aprovacoes-contagem'] });
      await queryClient.invalidateQueries({ queryKey: ['acordos'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-[20px]"
      style={{ background: 'rgba(0,16,41,.45)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-[640px] max-w-full flex-col overflow-hidden rounded-[18px]"
        style={{ background: 'var(--surface)', boxShadow: '0 30px 80px rgba(0,16,41,.4)' }}
      >
        <div className="flex items-center justify-between px-[18px] py-[14px]" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="font-display text-[14px] font-bold">Renegociação — {titular}</span>
          <button onClick={onClose} className="text-[18px] leading-none" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>

        <div className="px-[18px] pt-[14px]">
          <Stepper steps={STEPS} current={step} maxReachable={resultado ? 3 : step} onSelect={setStep} />
        </div>

        <div className="flex-1 overflow-auto p-[18px]">
          {/* Passo 1 — Diagnóstico do atraso da conta */}
          {step === 0 && (
            <div className="flex flex-col gap-[12px]">
              {eleg.isLoading ? (
                <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Levantando o atraso…</div>
              ) : !eleg.data || eleg.data.valorTotal <= 0 ? (
                <div className="rounded-[10px] p-[14px] text-[13px]" style={{ background: '#e8f7ef', color: '#1f9d5b' }}>
                  Este titular não tem parcelas em atraso — nada a renegociar. 🎉
                </div>
              ) : (
                <>
                  <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                    A unidade da negociação é a <b>fatura vencida</b> — todas entram pré-selecionadas
                    (com os itens completos de todos os contratos). Desmarcar uma fatura exige
                    justificativa, que fica registrada na proposta. Valores já <b>atualizados com
                    multa e juros de mora</b> na data de hoje.
                  </p>
                  {faturas.map((f) => {
                    const excluida = f.faturaId in exclusoes;
                    return (
                      <div key={f.faturaId} className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)', opacity: excluida ? 0.75 : 1 }}>
                        <div className="flex items-center justify-between gap-[8px] text-[12.5px] font-bold">
                          <label className="flex cursor-pointer items-center gap-[8px]">
                            <input type="checkbox" checked={!excluida} onChange={() => alternarFatura(f.faturaId)} />
                            <span>Fatura {f.numero ?? '—'}{f.dataVencimento ? ` · venc. ${new Date(f.dataVencimento).toLocaleDateString('pt-BR')}` : ''}</span>
                          </label>
                          <span className="tabular-nums" style={excluida ? { textDecoration: 'line-through' } : undefined}>{formatCurrency(f.valorAtualizado)}</span>
                        </div>
                        <div className="mt-[4px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                          {f.itens.map((it) => `${it.display} (${it.contratoNumero})`).join(', ')}
                          {f.encargosMora > 0 && ` · encargos de mora ${formatCurrency(f.encargosMora)}`}
                        </div>
                        {excluida && (
                          <div className="mt-[8px]">
                            <input
                              value={exclusoes[f.faturaId]}
                              onChange={(e) => setExclusoes({ ...exclusoes, [f.faturaId]: e.target.value })}
                              placeholder="Justificativa da exclusão (obrigatória, mín. 10 caracteres) — fica auditada na proposta"
                              className="h-[32px] w-full rounded-[8px] px-[10px] text-[12px]"
                              style={{ background: 'var(--surface)', border: '1px solid #e0a800' }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {proximas.length > 0 && (
                    <div className="flex flex-col gap-[8px]">
                      <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                        <b>Faturas a vencer</b> (opcional): você pode trazer as próximas faturas para
                        dentro do acordo — elas entram pelo valor nominal, sem mora, aumentam a
                        entrada mínima e antecipam a segurança do pagamento.
                      </p>
                      {proximas.map((f) => {
                        const incluida = vincendas.includes(f.faturaId);
                        return (
                          <div key={f.faturaId} className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)', border: incluida ? '1px solid var(--accent)' : '1px dashed var(--border)' }}>
                            <div className="flex items-center justify-between gap-[8px] text-[12.5px] font-bold">
                              <label className="flex cursor-pointer items-center gap-[8px]">
                                <input
                                  type="checkbox"
                                  checked={incluida}
                                  onChange={() => setVincendas((v) => (v.includes(f.faturaId) ? v.filter((id) => id !== f.faturaId) : [...v, f.faturaId]))}
                                />
                                <span>Fatura {f.numero ?? '—'}{f.dataVencimento ? ` · vence ${new Date(f.dataVencimento).toLocaleDateString('pt-BR')}` : ''} · a vencer</span>
                              </label>
                              <span className="tabular-nums">{formatCurrency(f.valorAtualizado)}</span>
                            </div>
                            <div className="mt-[4px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                              {f.itens.map((it) => `${it.display} (${it.contratoNumero})`).join(', ')}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex items-center justify-between rounded-[10px] px-[12px] py-[10px] text-[13px] font-bold" style={{ background: '#fdeceb', color: '#c0392b' }}>
                    <span>Total selecionado ({selecionadas.length} fatura(s){vincendasSel.length > 0 ? `, ${vincendasSel.length} a vencer` : ''})</span>
                    <span className="tabular-nums">{formatCurrency(total)}</span>
                  </div>
                  {encargosSelecionados > 0 && (
                    <div className="text-right text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                      inclui {formatCurrency(encargosSelecionados)} de multa e juros de mora (regra geral do contrato)
                    </div>
                  )}
                  {!justificativasOk && (
                    <div className="rounded-[10px] p-[10px] text-[12px]" style={{ background: '#fff7e6', color: '#8a5a00' }}>
                      Preencha a justificativa das faturas excluídas para avançar.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Passo 2 — Proposta (números do servidor — RAP031) */}
          {step === 1 && (
            <div className="flex flex-col gap-[12px]">
              <div className="grid grid-cols-2 gap-[10px]">
                <label className="flex flex-col gap-[4px] text-[12px]">
                  <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Entrada (R$){p?.motor === 'catalogo' ? ` — mínima ${formatCurrency(p.entradaMinima)}` : ''}</span>
                  <input value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="0,00" className="h-[34px] rounded-[8px] px-[10px] text-right text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
                </label>
                <label className="flex flex-col gap-[4px] text-[12px]">
                  <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Nº de parcelas novas</span>
                  <input value={parcelas} onChange={(e) => setParcelas(e.target.value.replace(/\D/g, ''))} className="h-[34px] rounded-[8px] px-[10px] text-right text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
                </label>
                <label className="flex flex-col gap-[4px] text-[12px]">
                  <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Pagamento da entrada até</span>
                  <input type="date" value={dataEntrada} onChange={(e) => setDataEntrada(e.target.value)} className="h-[34px] rounded-[8px] px-[10px] text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
                </label>
                <label className="flex flex-col gap-[4px] text-[12px]">
                  <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Periodicidade</span>
                  <div className="flex h-[34px] items-center rounded-[8px] px-[10px] text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    {p?.periodicidade ? p.periodicidade.charAt(0).toUpperCase() + p.periodicidade.slice(1) : '…'} · herdada do contrato
                  </div>
                </label>
              </div>
              <div className="flex flex-col gap-[6px] rounded-[10px] p-[12px] text-[12.5px]" style={{ background: 'var(--surface-input)' }}>
                <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Saldo negociado (com mora)</span><span className="font-bold tabular-nums">{formatCurrency(total)}</span></div>
                <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Entrada</span><span className="font-bold tabular-nums">− {formatCurrency(entradaCent)}</span></div>
                {p?.motor === 'catalogo' && (
                  <>
                    <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Taxa de processamento (TP{(p.tpFinanciada ?? 0) > 0 ? ' — parte financiada' : ', dentro da entrada'})</span><span className="font-bold tabular-nums">{formatCurrency(p.taxaInicial)}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Amortiza as faturas de origem</span><span className="font-bold tabular-nums">{formatCurrency(p.amortizacaoEntrada ?? 0)}</span></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Saldo a parcelar (com TR {((p.encargoMensal ?? 0) * 100).toFixed(2)}% a.m.)</span><span className="font-bold tabular-nums">{formatCurrency(p.saldoAParcelar)}</span></div>
                  </>
                )}
                <div className="flex justify-between border-t pt-[6px]" style={{ borderColor: 'var(--border)' }}><span style={{ color: 'var(--text-muted)' }}>Novo plano</span><span className="font-bold tabular-nums">{nParcelas}× {formatCurrency(valorParcela)}</span></div>
                {p && <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Total a pagar (entrada + parcelas)</span><span className="font-bold tabular-nums">{formatCurrency(p.totalAPagar)}</span></div>}
              </div>
              {p?.motor === 'placeholder' && (
                <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                  Cálculo provisório (divisão simples) — ative o produto <b>Acordo de Pagamento</b> no Catálogo para ligar TP, TR e entrada mínima.
                </div>
              )}
              {(p?.excecoes ?? []).map((e) => (
                <div key={e} className="rounded-[10px] p-[10px] text-[12px]" style={{ background: '#fff7e6', color: '#8a5a00' }}>
                  ⚠ Exceção (vai destacada para a alçada): {e}
                </div>
              ))}
              {entradaCent >= total && total > 0 && (
                <div className="rounded-[10px] p-[10px] text-[12px]" style={{ background: '#fff7e6', color: '#8a5a00' }}>
                  A entrada cobre o total em atraso — nesse caso, quite as faturas em vez de renegociar.
                </div>
              )}
            </div>
          )}

          {/* Passo 3 — Revisão e envio */}
          {step === 2 && (
            <div className="flex flex-col gap-[12px] text-[13px]">
              <div className="rounded-[10px] p-[14px]" style={{ background: 'var(--surface-input)' }}>
                <div className="mb-[8px] font-bold">Resumo do acordo</div>
                <div className="flex flex-col gap-[4px] text-[12.5px]">
                  <div className="flex justify-between"><span>Faturas selecionadas</span><b>{selecionadas.length}{vincendasSel.length > 0 ? ` (${vincendasSel.length} a vencer incluída(s))` : ''}{Object.keys(exclusoes).length > 0 ? ` (${Object.keys(exclusoes).length} excluída(s) com justificativa)` : ''}</b></div>
                  <div className="flex justify-between"><span>Total renegociado (com mora)</span><b className="tabular-nums">{formatCurrency(total)}</b></div>
                  <div className="flex justify-between"><span>Entrada (aceite do cliente)</span><b className="tabular-nums">{formatCurrency(entradaCent)}</b></div>
                  <div className="flex justify-between"><span>Plano novo</span><b className="tabular-nums">{nParcelas}× {formatCurrency(valorParcela)} ({p?.periodicidade ?? 'semanal'} · herdada)</b></div>
                  <div className="flex justify-between"><span>Entrada paga até</span><b>{dataEntrada.split('-').reverse().join('/')}</b></div>
                  {p?.motor === 'catalogo' && <div className="flex justify-between"><span>TP + TR (motor do Catálogo)</span><b className="tabular-nums">{formatCurrency(p.taxaInicial)} + {((p.encargoMensal ?? 0) * 100).toFixed(2)}% a.m.</b></div>}
                </div>
              </div>
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Ao enviar, a proposta segue para a <b>Central de Aprovações</b> (alçada). Aprovada, a
                cobrança da entrada é gerada no Asaas — o pagamento da entrada é o aceite formal do
                cliente e efetiva o plano nas próximas faturas.
              </p>
            </div>
          )}

          {/* Passo 4 — Confirmação */}
          {step === 3 && resultado && (
            <div className="flex flex-col items-center gap-[10px] py-[18px] text-center">
              <div className="text-[38px]">✅</div>
              <div className="font-display text-[15px] font-bold">Proposta enviada para aprovação</div>
              <p className="max-w-[420px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                Acordo cobrindo {resultado.contratosAfetados} contrato(s) aguardando alçada na
                Central de Aprovações. Após aprovado, a entrada é cobrada e o pagamento efetiva o plano.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-[18px] py-[14px]" style={{ borderTop: '1px solid var(--border)' }}>
          {step > 0 && step < 3 ? (
            <button onClick={() => setStep(step - 1)} className="h-[36px] rounded-[9px] px-[16px] text-[13px] font-semibold" style={{ background: 'var(--surface-input)' }}>← Voltar</button>
          ) : <span />}
          {step === 0 && (
            <button disabled={!eleg.data || total <= 0 || !justificativasOk} onClick={() => setStep(1)} className="h-[36px] rounded-[9px] px-[16px] text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--navy)', color: '#fff' }}>Estruturar proposta →</button>
          )}
          {step === 1 && (
            <button disabled={!propostaValida} onClick={() => setStep(2)} className="h-[36px] rounded-[9px] px-[16px] text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--navy)', color: '#fff' }}>Revisar →</button>
          )}
          {step === 2 && (
            <button disabled={enviando || !propostaValida} onClick={enviar} className="h-[36px] rounded-[9px] px-[16px] text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>
              {enviando ? 'Enviando…' : 'Enviar para aprovação'}
            </button>
          )}
          {step === 3 && (
            <button onClick={onClose} className="h-[36px] rounded-[9px] px-[16px] text-[13px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>Fechar</button>
          )}
        </div>
      </div>
    </div>
  );
}
