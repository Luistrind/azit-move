import { useState } from 'react';
import { OrigemIntencaoPagamento, OrigemPagamentoFatura } from '@azit/types';
import { formatCurrency } from '@azit/utils';
import { faturaService, type FaturaDetalhe } from '../services/fatura.service';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
import { dataBR, horaBR } from '../lib/datas';
import { mensagemErro, usePodeRole } from '../lib/permissoes';
import { Botao } from './Botao';
import { Secao } from './Secao';
import { toast } from './Toast';

// Fatura do modelo de Pix sob demanda (doc 02 §32.4-A), vista pelo OPERADOR na
// ficha do titular: o que falta hoje (com multa e atualização calculadas pela
// Azit), cada pagamento com o que quitou — os MESMOS nomes que o cliente lê na
// página — e o Pix ativo da conta. Componente genérico: recebe o detalhe da
// fatura; quem chama decide onde mostrar.

const ROLE_CONFERIR = ['ADMIN', 'OPERADOR', 'FINANCEIRO', 'DIRETOR'];
const ROLE_SIMULAR = ['ADMIN', 'OPERADOR'];
const mudo = { color: 'var(--text-muted)' } as const;
const corpo = { color: 'var(--text-body)' } as const;

const ORIGEM_PAGAMENTO: Record<OrigemPagamentoFatura, string> = {
  [OrigemPagamentoFatura.GATEWAY]: 'Pix confirmado pelo gateway',
  [OrigemPagamentoFatura.CONFERENCIA]: 'Baixado na conferência do operador',
  [OrigemPagamentoFatura.SINISTRO]: 'Quitado pela indenização do sinistro',
};
const ORIGEM_PIX: Record<OrigemIntencaoPagamento, string> = {
  [OrigemIntencaoPagamento.PAGINA_PUBLICA]: 'pedido pelo cliente na página da fatura',
  [OrigemIntencaoPagamento.OPERADOR]: 'gerado pelo operador',
};
const SITUACAO: Record<string, string> = { paga: 'Paga', parcial: 'Paga parcialmente', vencida: 'Vencida', hoje: 'Vence hoje', aberta: 'Em aberto' };

export function FaturaAzitBloco({ fd, contaId, recarregar }: { fd: FaturaDetalhe; contaId: string; recarregar: () => Promise<unknown> }) {
  const pode = usePodeRole();
  const [ocupado, setOcupado] = useState(false);
  const a = fd.azit;
  if (!a) return null;
  const paga = a.situacao === 'paga';
  const ativos = a.intencoesAtivas;

  async function conferir() {
    setOcupado(true);
    try {
      const r = await faturaService.conferirPix(contaId);
      if (r.simulado) toast.info('Gateway em modo simulado: não há o que conferir.');
      else if (r.enfileiradas > 0) {
        toast.sucesso(`${r.enfileiradas} Pix confirmado(s) pelo gateway — baixa em andamento.`);
        await new Promise((ok) => setTimeout(ok, 2500));
        await recarregar();
      } else toast.info(r.conferidas ? 'O gateway não registra pagamento em nenhum Pix recente desta conta.' : 'Esta conta não tem Pix recente para conferir.');
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function simular(intencaoId: string) {
    setOcupado(true);
    try {
      await faturaService.simularPagamentoPix(intencaoId);
      await new Promise((ok) => setTimeout(ok, 1500));
      await recarregar();
      toast.sucesso('Pagamento do Pix simulado.');
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  return (
    <div className="flex flex-col gap-[12px] border-t pt-[10px]" style={{ borderColor: 'var(--border)' }}>
      <Secao titulo="Pix sob demanda" tag={SITUACAO[a.situacao] ?? a.situacao}>
        <div className="flex flex-col gap-[4px] text-[12px]" style={corpo}>
          <span style={mudo}>
            Esta fatura não tem cobrança pré-criada: o cliente gera o Pix na página da fatura, no valor do dia.
            {a.contaMista ? ' A conta ainda tem fatura do modelo antigo em aberto: até ela ser paga, o cliente só paga uma fatura por vez, sem "outro valor".' : ''}
          </span>
          {!paga && (
            <>
              <Linha rotulo="Falta do valor da fatura" valor={formatCurrency(a.saldoNominal)} />
              {a.diasAtraso > 0 && <Linha rotulo={a.multa > 0 ? 'Multa por atraso' : 'Multa por atraso (já paga)'} valor={formatCurrency(a.multa)} />}
              {a.diasAtraso > 0 && (
                <Linha
                  rotulo={`Atualização por dias de atraso · ${a.diasAtualizacao} dia(s) desde ${a.pagamentos.length ? `o pagamento de ${dataBR(a.atualizacaoDesde)}` : 'o vencimento'}`}
                  valor={formatCurrency(a.atualizacao)}
                />
              )}
              <div className="flex items-center justify-between gap-[8px] text-[12.5px] font-bold" style={{ color: 'var(--text-primary)' }}>
                <span>Total a pagar hoje</span>
                <span className="tabular-nums">{formatCurrency(a.totalHoje)}</span>
              </div>
            </>
          )}
        </div>
      </Secao>

      <Secao titulo="Pagamentos recebidos" tag={a.pagamentos.length ? `${formatCurrency(a.pagoTotal)} no total` : undefined}>
        {a.pagamentos.length === 0 ? (
          <div className="text-[12px]" style={mudo}>Nenhum pagamento nesta fatura.</div>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {a.pagamentos.map((p) => (
              <div key={p.id} className="rounded-[10px] px-[10px] py-[8px] text-[12px]" style={{ background: 'var(--surface-input)' }}>
                <div className="flex flex-wrap items-baseline justify-between gap-[8px]" style={{ color: 'var(--text-primary)' }}>
                  <b>{dataBR(p.data)}{p.pagoEm ? ` às ${horaBR(p.pagoEm)}` : ''}</b>
                  <b className="tabular-nums">{formatCurrency(p.valor)}</b>
                </div>
                <div style={mudo}>{ORIGEM_PAGAMENTO[p.origem]}{p.identificadorPix ? ` · ${p.identificadorPix}` : ''}</div>
                {p.valorPix > p.valor && (
                  <div className="mt-[2px]" style={corpo}>
                    Pix de {formatCurrency(p.valorPix)} · {formatCurrency(p.valor)} nesta fatura
                    {p.outrasFaturas.map((o) => ` · ${formatCurrency(o.valor)} foi para a fatura nº ${o.numero}`).join('')}
                  </div>
                )}
                {p.alocacoes.length > 0 && (
                  <div className="mt-[4px] flex flex-col gap-[2px]">
                    {p.alocacoes.map((al, i) => (
                      <div key={i} className="flex items-center justify-between gap-[8px]" style={corpo}>
                        <span>{al.nivel}º · {al.nome}{al.quitou ? '' : ' (parte)'}</span>
                        <span className="flex-none tabular-nums">{formatCurrency(al.valor)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {p.valorExcedente > 0 && (
                  <div className="mt-[4px] font-semibold" style={{ color: 'var(--warn-ink)' }}>
                    Sobraram {formatCurrency(p.valorExcedente)} além do que a conta devia — só registrado, ainda não vira crédito do cliente.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Secao>

      {!paga && (
        <Secao titulo="Pix ativos da conta" tag={ativos.length > 1 ? `${ativos.length} valores gerados hoje` : undefined}>
          {ativos.length ? (
            <div className="flex flex-col gap-[8px]">
              {ativos.map((pix) => (
                <div key={pix.id} className="flex flex-col gap-[2px] rounded-[10px] px-[10px] py-[8px] text-[12px]" style={{ ...corpo, background: 'var(--surface-input)' }}>
                  <div className="flex items-baseline justify-between gap-[8px]" style={{ color: 'var(--text-primary)' }}>
                    <b>{formatCurrency(pix.valor)}{pix.outroValor ? ' · outro valor' : ''}</b>
                    <span>vale até {horaBR(pix.validoAte)} de hoje</span>
                  </div>
                  <span style={mudo}>Gerado às {horaBR(pix.criadaEm)}, {ORIGEM_PIX[pix.origem]}{pix.simulado ? ' · gateway simulado' : ''}.</span>
                  {pix.faturas.map((x) => (
                    <div key={x.numero} className="flex items-center justify-between gap-[8px]">
                      <span>Fatura #{x.numero} · vencimento {dataBR(x.vencimento)}</span>
                      <span className="flex-none tabular-nums">{formatCurrency(x.valor)}</span>
                    </div>
                  ))}
                  {/* Só fora de produção. */}
                  {FERRAMENTAS_TESTE && pode(ROLE_SIMULAR) && (
                    <Botao variante="primaria" tamanho="sm" className="mt-[4px] self-start" disabled={ocupado} onClick={() => void simular(pix.id)}>Simular pagamento deste Pix (teste)</Botao>
                  )}
                </div>
              ))}
              {ativos.length > 1 && (
                <span className="text-[12px]" style={mudo}>O cliente pode pagar qualquer um deles. Quando um pagamento entra, os outros são cancelados.</span>
              )}
            </div>
          ) : (
            <div className="text-[12px]" style={mudo}>Nenhum Pix gerado hoje para esta conta.</div>
          )}
          <div className="mt-[8px] flex flex-wrap items-center gap-[8px] text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            {/* Conferir só faz sentido com gateway real — em modo simulado a ação não aparece. */}
            {pode(ROLE_CONFERIR) && !a.gatewaySimulado && (
              <>
                <span>O cliente pagou e a fatura não baixou?</span>
                <Botao variante="secundaria" tamanho="sm" disabled={ocupado} onClick={() => void conferir()}>Conferir Pix no gateway</Botao>
              </>
            )}
          </div>
        </Secao>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-[8px]">
      <span>{rotulo}</span>
      <span className="flex-none tabular-nums">{valor}</span>
    </div>
  );
}
