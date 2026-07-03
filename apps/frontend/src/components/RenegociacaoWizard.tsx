import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { Stepper } from './Stepper';
import { toast } from './Toast';
import { operacoesService } from '../services/operacoes.service';
import { reaisParaCentavos } from '../lib/valor';
import { mensagemErro } from '../lib/permissoes';

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
  const [periodicidade, setPeriodicidade] = useState<'semanal' | 'quinzenal' | 'mensal'>('semanal');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ contratosAfetados: number } | null>(null);

  const eleg = useQuery({
    queryKey: ['renegociacao-elegivel', contaId],
    queryFn: () => operacoesService.elegivelConta(contaId),
  });

  const total = eleg.data?.valorTotal ?? 0;
  const entradaCent = reaisParaCentavos(entrada);
  const nParcelas = Math.max(1, parseInt(parcelas || '0', 10) || 0);
  const saldoNovo = Math.max(0, total - entradaCent);
  const valorParcela = nParcelas > 0 ? Math.round(saldoNovo / nParcelas) : 0;
  const propostaValida = total > 0 && entradaCent < total && nParcelas > 0 && valorParcela > 0;

  async function enviar() {
    setEnviando(true);
    try {
      const r = await operacoesService.criarRenegociacaoConta(contaId, {
        valorEntrada: entradaCent,
        numeroParcelasNovas: nParcelas,
        valorParcelaNova: valorParcela,
        periodicidade,
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
                    O pagamento é por fatura, então o atraso é da <b>conta</b>: a renegociação cobre as
                    parcelas vencidas de <b>todos os contratos</b> numa única negociação.
                  </p>
                  {eleg.data.contratos.map((c) => (
                    <div key={c.contratoId} className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
                      <div className="flex items-center justify-between text-[12.5px] font-bold">
                        <span>{c.numero} · {c.descricao}</span>
                        <span className="tabular-nums">{formatCurrency(c.valor)}</span>
                      </div>
                      <div className="mt-[4px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                        {c.parcelas.length} parcela(s) em atraso: {c.parcelas.map((p) => p.display).join(', ')}
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-[10px] px-[12px] py-[10px] text-[13px] font-bold" style={{ background: '#fdeceb', color: '#c0392b' }}>
                    <span>Total em atraso ({eleg.data.faturasVencidas} fatura(s) vencida(s))</span>
                    <span className="tabular-nums">{formatCurrency(total)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Passo 2 — Proposta */}
          {step === 1 && (
            <div className="flex flex-col gap-[12px]">
              <div className="grid grid-cols-2 gap-[10px]">
                <label className="flex flex-col gap-[4px] text-[12px]">
                  <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Entrada (R$)</span>
                  <input value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="0,00" className="h-[34px] rounded-[8px] px-[10px] text-right text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
                </label>
                <label className="flex flex-col gap-[4px] text-[12px]">
                  <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Nº de parcelas novas</span>
                  <input value={parcelas} onChange={(e) => setParcelas(e.target.value.replace(/\D/g, ''))} className="h-[34px] rounded-[8px] px-[10px] text-right text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
                </label>
                <label className="flex flex-col gap-[4px] text-[12px]">
                  <span className="font-semibold" style={{ color: 'var(--text-label)' }}>Periodicidade</span>
                  <select value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value as typeof periodicidade)} className="h-[34px] rounded-[8px] px-[10px] text-[13px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
                    <option value="semanal">Semanal</option>
                    <option value="quinzenal">Quinzenal</option>
                    <option value="mensal">Mensal</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-col gap-[6px] rounded-[10px] p-[12px] text-[12.5px]" style={{ background: 'var(--surface-input)' }}>
                <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Total em atraso</span><span className="font-bold tabular-nums">{formatCurrency(total)}</span></div>
                <div className="flex justify-between"><span style={{ color: 'var(--text-muted)' }}>Entrada</span><span className="font-bold tabular-nums">− {formatCurrency(entradaCent)}</span></div>
                <div className="flex justify-between border-t pt-[6px]" style={{ borderColor: 'var(--border)' }}><span style={{ color: 'var(--text-muted)' }}>Novo plano</span><span className="font-bold tabular-nums">{nParcelas}× {formatCurrency(valorParcela)}</span></div>
              </div>
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
                  <div className="flex justify-between"><span>Contratos cobertos</span><b>{eleg.data?.contratos.length ?? 0}</b></div>
                  <div className="flex justify-between"><span>Total renegociado</span><b className="tabular-nums">{formatCurrency(total)}</b></div>
                  <div className="flex justify-between"><span>Entrada (aceite do cliente)</span><b className="tabular-nums">{formatCurrency(entradaCent)}</b></div>
                  <div className="flex justify-between"><span>Plano novo</span><b className="tabular-nums">{nParcelas}× {formatCurrency(valorParcela)} ({periodicidade})</b></div>
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
            <button disabled={!eleg.data || total <= 0} onClick={() => setStep(1)} className="h-[36px] rounded-[9px] px-[16px] text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--navy)', color: '#fff' }}>Estruturar proposta →</button>
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
