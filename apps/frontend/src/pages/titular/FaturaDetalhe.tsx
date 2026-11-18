import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { faturaService, type FaturaDetalhe as Detalhe } from '../../services/fatura.service';
import { dataBR, diasAtrasoBrasil, hojeBrasilISO } from '../../lib/datas';
import { FERRAMENTAS_TESTE } from '../../lib/ambiente';
import { toast } from '../../components/Toast';
import { mensagemErro } from '../../lib/permissoes';
import { Botao } from '../../components/Botao';
import { Campo } from '../../components/Metrica';
import { LinkFaturaAcoes } from '../../components/LinkFaturaAcoes';
import { FaturaAzitBloco } from '../../components/FaturaAzitBloco';

// Detalhe de uma fatura ABERTO NA PRÓPRIA LINHA da ficha do titular (doc 02
// §33.2) — o que antes era um modal por cima da lista: composição, o que já
// entrou, o link para o cliente e as ações de contingência.
export function FaturaDetalhe({ faturaId, contaId, recarregar }: { faturaId: string; contaId: string; recarregar: () => Promise<unknown> }) {
  const det = useQuery({ queryKey: ['fatura-detalhe', faturaId], queryFn: () => faturaService.detalhe(faturaId) });
  const [ocupado, setOcupado] = useState(false);
  const fd = det.data;

  async function executar(acao: () => Promise<unknown>) {
    setOcupado(true);
    try {
      await acao();
      await recarregar();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }
  // Cobrança existe no Asaas e a fatura segue em aberto: pergunta ao Asaas se foi
  // paga e reprocessa a conciliação (webhook perdido). A baixa é assíncrona.
  const conferirPagamento = () =>
    executar(async () => {
      const r = await faturaService.conferirPagamento(faturaId);
      if (r.enfileirado) await new Promise((ok) => setTimeout(ok, 2500));
      else toast.info(r.motivo ?? 'Nada a conferir.');
    });

  if (!fd) return <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{det.isError ? 'Não foi possível carregar a fatura.' : 'Carregando…'}</div>;

  const paga = fd.status === 'paga' || fd.status === 'paga_em_atraso';
  const atraso = diasAtrasoBrasil(fd.dataVencimento);
  return (
    <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-[10px]">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-label)' }}>Composição</div>
        <div className="flex flex-col gap-[4px]">
          {fd.itens.map((it, i) => (
            <div key={i} className="flex items-start justify-between gap-[10px] text-[12px]" style={{ color: 'var(--text-body)' }}>
              <span className="min-w-0 break-words">{it.descricao}</span>
              <span className="flex-none tabular-nums">{formatCurrency(it.valor)}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t pt-[8px] text-[13px] font-bold" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
          <span>Valor da fatura</span>
          <span className="tabular-nums">{formatCurrency(fd.valorTotal)}</span>
        </div>
        <div className="grid grid-cols-3 gap-[10px]">
          <Campo label="Vencimento" valor={dataBR(fd.dataVencimento)} />
          <Campo label="Fechamento" valor={dataBR(fd.dataFechamento)} />
          <Campo label="Pagamento" valor={fd.dataPagamento ? dataBR(fd.dataPagamento) : '—'} />
        </div>
        {/* Modelo antigo: a fatura guarda só o total que entrou; no Pix sob demanda o bloco ao lado detalha. */}
        {/* Modelo antigo em atraso: a mesma conta da página do cliente (multa + atualização de hoje). */}
        {!fd.azit && !paga && fd.encargoAtual > 0 && (
          <>
            <div className="flex items-center justify-between text-[12px]" style={{ color: 'var(--text-body)' }}>
              <span>Multa e atualização até hoje{atraso > 0 ? ` · ${atraso} dia${atraso === 1 ? '' : 's'} de atraso` : ''}</span>
              <span className="tabular-nums">{formatCurrency(fd.encargoAtual)}</span>
            </div>
            <div className="flex items-center justify-between text-[13px] font-bold" style={{ color: 'var(--danger-fg)' }}>
              <span>Falta hoje</span>
              <span className="tabular-nums">{formatCurrency(Math.max(0, fd.valorTotal - fd.valorPago) + fd.encargoAtual)}</span>
            </div>
          </>
        )}
        {!fd.azit && fd.valorPago > 0 && (
          <div className="flex items-center justify-between text-[12px]" style={{ color: 'var(--text-body)' }}>
            <span>Já recebido{fd.dataPagamento ? ` em ${dataBR(fd.dataPagamento)}` : ''}</span>
            <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(fd.valorPago)}</span>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-[12px]">
        {/* Fatura Azit (doc 02 §32.7): lugar principal do link — copiar ou mandar pelo WhatsApp. */}
        <LinkFaturaAcoes faturaId={fd.id} />

        {fd.temCobrancaAsaas && !paga && (
          <div className="flex flex-wrap items-center gap-[8px] text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            <span>O cliente pagou e a fatura não baixou?</span>
            <Botao variante="secundaria" tamanho="sm" disabled={ocupado} onClick={() => void conferirPagamento()}>Conferir pagamento no Asaas</Botao>
          </div>
        )}

        {/* Fatura Azit F2 (doc 02 §32.4-A): pagamentos com o que cada um quitou e o Pix ativo. */}
        {fd.azit && <FaturaAzitBloco fd={fd} contaId={contaId} recarregar={recarregar} />}

        {/* Reemissão só existe no modelo antigo: fatura de Pix sob demanda não tem cobrança pré-criada. */}
        {fd.status === 'fechada' && !fd.temCobrancaAsaas && fd.modeloEncargo !== 'AZIT' && (
          <BlocoReemissao
            fd={fd}
            ocupado={ocupado}
            emitir={(vencimento, incluirEncargo) => executar(() => faturaService.gerarCobranca(fd.id, { vencimento, incluirEncargo }))}
          />
        )}

        {/* Só fora de produção: em produção o cliente paga e o webhook concilia. */}
        {FERRAMENTAS_TESTE && !paga && (
          <div className="flex flex-wrap items-center gap-[8px] border-t pt-[10px]" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[11.5px] font-semibold" style={{ color: 'var(--text-muted)' }}>
              Simulação (teste){atraso > 0 ? ` · ${atraso} dia(s) de atraso` : ''}
            </span>
            {/* Fatura de Pix sob demanda é paga pelo Pix da conta (bloco acima), não por aqui. */}
            {fd.modeloEncargo !== 'AZIT' && (
              <Botao
                variante="primaria"
                tamanho="sm"
                disabled={ocupado}
                onClick={() => void executar(async () => { await faturaService.simularPagamento(fd.id); await new Promise((r) => setTimeout(r, 1200)); })}
              >
                Simular pagamento
              </Botao>
            )}
            <Botao variante="perigo" tamanho="sm" disabled={ocupado} onClick={() => void executar(() => faturaService.envelhecer(fd.id))}>
              + 1 dia de atraso
            </Botao>
          </div>
        )}
      </div>
    </div>
  );
}

// Contingência (08/09): fatura FECHADA sem cobrança no Asaas — a emissão sai
// DAQUI (o vínculo externalReference faz o webhook conciliar sozinho); nunca
// criar a cobrança pelo painel do Asaas. O Asaas rejeita vencimento no passado,
// então a vencida sai com vencimento de hoje em diante, com ou sem o encargo
// corrido — decisão do operador, caso a caso.
function BlocoReemissao({ fd, ocupado, emitir }: { fd: Detalhe; ocupado: boolean; emitir: (vencimento: string, incluirEncargo: boolean) => Promise<void> }) {
  const [venc, setVenc] = useState(hojeBrasilISO());
  const [comEncargo, setComEncargo] = useState(fd.encargoAtual > 0);
  const total = fd.valorTotal + (comEncargo ? fd.encargoAtual : 0);
  return (
    <div className="flex flex-col gap-[8px] rounded-[10px] p-[12px]" style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-fg)' }}>
      <div className="text-[12px] font-bold" style={{ color: 'var(--warn-ink)' }}>Sem cobrança no Asaas</div>
      <div className="text-[12px]" style={{ color: 'var(--warn-ink)' }}>
        A cobrança automática desta fatura falhou. Emita por aqui — o boleto sai vinculado à fatura e o pagamento concilia sozinho.
      </div>
      <div className="flex flex-wrap items-end gap-[10px]">
        <label className="flex flex-col gap-[3px] text-[11px] font-semibold" style={{ color: 'var(--warn-ink)' }}>
          Vencimento da cobrança
          <input
            type="date"
            value={venc}
            min={hojeBrasilISO()}
            onChange={(e) => setVenc(e.target.value)}
            className="rounded-[10px] px-[8px] py-[6px] text-[12px]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
        </label>
        {fd.encargoAtual > 0 && (
          <label className="flex items-center gap-[6px] pb-[8px] text-[12px]" style={{ color: 'var(--warn-ink)' }}>
            <input type="checkbox" checked={comEncargo} onChange={(e) => setComEncargo(e.target.checked)} />
            Incluir encargo de atraso até hoje ({formatCurrency(fd.encargoAtual)})
          </label>
        )}
      </div>
      <Botao variante="primaria" className="self-start" disabled={ocupado || !venc} onClick={() => void emitir(venc, comEncargo)}>
        Gerar cobrança de {formatCurrency(total)} no Asaas
      </Botao>
    </div>
  );
}
