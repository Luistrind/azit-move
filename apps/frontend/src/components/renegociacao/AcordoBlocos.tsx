import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import type { AcordoDetalhe } from '../../services/operacoes.service';
import { StatusBadge } from '../StatusBadge';
import { Campo } from '../Metrica';
import { Secao } from '../Secao';
import {
  ENTRADA_ACORDO_FG,
  FATURA_SITUACAO_COLORS,
  FATURA_SITUACAO_LABEL,
  PARCELA_STATUS_COLORS,
  TOM_DOSSIE_FG,
} from '../../config/statusColors';
import { dataBR, horaBR, instanteBR } from '../../lib/datas';

// Blocos do DETALHE DO ACORDO (GET acordos/:id) — uma fonte só para a tela de
// Renegociações e para o dossiê da Central de Aprovações (21/10): o que um
// mostra, o outro mostra igual. Cada bloco recebe o detalhe por props.

export const ENTRADA_SITUACAO_LABEL: Record<string, string> = {
  sem_entrada: 'Sem entrada',
  paga: 'Paga',
  aguardando: 'Aguardando pagamento',
  aguardando_aprovacao: 'Aguardando aprovação',
  expirada: 'Venceu sem pagamento',
  nao_paga: 'Não paga',
};
export const PERIODICIDADE_LABEL: Record<string, string> = { semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'mensal' };

// Instante ISO → dd/mm/aaaa hh:mm no fuso do negócio.
export const fmtDataHora = (iso: string | null | undefined) => (iso ? `${instanteBR(iso)} ${horaBR(iso)}` : '—');

const th = 'py-[7px] pr-[10px] text-left font-semibold';
const thR = 'py-[7px] pl-[10px] text-right font-semibold';

// O que o acordo cobre/cobriu, por fatura. `compacto` (dossiê da Central): uma
// linha por fatura — vencimento, valor coberto e mora na data-base — com o
// detalhe completo (parcelas + demais itens da fatura) a um clique.
export function CoberturaAcordo({ d, onContrato, compacto = false }: { d: AcordoDetalhe; onContrato: (id: string) => void; compacto?: boolean }) {
  const [aberto, setAberto] = useState(!compacto);
  const titulo = `${d.coberturaPrevista ? 'O que o acordo vai cobrir (seleção aprovada na proposta)' : 'O que o acordo cobriu'} — ${d.totaisCobertura.quantidadeParcelas} parcela(s) em ${d.totaisCobertura.quantidadeFaturas} fatura(s)`;
  if (d.faturasCobertas.length === 0 && d.cobertasSemFatura.length === 0) {
    return (
      <Secao titulo={titulo}>
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {d.status === 'rascunho' || d.status === 'aguardando_entrada'
            ? 'Proposta sem faturas selecionadas no snapshot — as parcelas recebem o vínculo do acordo na efetivação (pagamento da entrada).'
            : 'Nenhuma parcela vinculada a este acordo.'}
        </div>
      </Secao>
    );
  }
  return (
    <Secao
      titulo={titulo}
      acao={compacto ? (
        <button onClick={() => setAberto((x) => !x)} className="text-[11.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {aberto ? 'ver só o resumo por fatura' : 'ver parcelas e itens de cada fatura'}
        </button>
      ) : null}
    >
      <div className="flex flex-col gap-[10px]">
        {compacto && !aberto && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-[12.5px]">
              <thead>
                <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                  <th className={th}>Fatura</th>
                  <th className={th}>Vencimento</th>
                  <th className={thR}>Valor coberto</th>
                  <th className={thR}>Mora na data-base</th>
                </tr>
              </thead>
              <tbody>
                {d.faturasCobertas.map((f) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="py-[7px] pr-[10px] font-semibold">#{f.numero}</td>
                    <td className="py-[7px] pr-[10px] tabular-nums">{dataBR(f.dataVencimento)} <span style={{ color: 'var(--text-muted)' }}>· {f.diasAtrasoNaDataBase} dia(s)</span></td>
                    <td className="py-[7px] pl-[10px] text-right tabular-nums">{formatCurrency(f.parcelas.reduce((s, p) => s + p.valorNominal, 0))}</td>
                    <td className="py-[7px] pl-[10px] text-right tabular-nums">{formatCurrency(f.parcelas.reduce((s, p) => s + p.encargoMoraNaDataBase, 0))}</td>
                  </tr>
                ))}
                {d.cobertasSemFatura.map((p) => (
                  <tr key={p.parcelaId} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="py-[7px] pr-[10px]" style={{ color: 'var(--text-muted)' }}>sem fatura · {p.display}</td>
                    <td className="py-[7px] pr-[10px] tabular-nums">{dataBR(p.dataVencimento)}</td>
                    <td className="py-[7px] pl-[10px] text-right tabular-nums">{formatCurrency(p.valorNominal)}</td>
                    <td className="py-[7px] pl-[10px] text-right tabular-nums">{formatCurrency(p.encargoMoraNaDataBase)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {aberto && d.coberturaPrevista && (
          <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            As parcelas abaixo recebem o vínculo do acordo na efetivação (pagamento da entrada); até lá seguem com a situação própria e a cobrança original.
          </div>
        )}
        {aberto && d.faturasCobertas.map((f) => (
          <div key={f.id} className="rounded-[10px] p-[10px]" style={{ background: 'var(--surface-input)' }}>
            <div className="flex flex-wrap items-center gap-[8px] text-[12px]">
              <span className="font-bold">Fatura #{f.numero}</span>
              <span style={{ color: 'var(--text-muted)' }}>venceu em {dataBR(f.dataVencimento)} · {f.diasAtrasoNaDataBase} dia(s) de atraso na data-base</span>
              <StatusBadge label={FATURA_SITUACAO_LABEL[f.status] ?? f.status} colors={FATURA_SITUACAO_COLORS} />
              <span className="ml-auto font-semibold tabular-nums">total {formatCurrency(f.valorTotal)}</span>
            </div>
            <table className="mt-[6px] w-full text-[12px]">
              <tbody>
                {f.parcelas.map((p) => (
                  <tr key={p.parcelaId} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="py-[5px] pr-[8px] font-semibold">Parcela {p.display}</td>
                    <td className="py-[5px] pr-[8px]" style={{ color: 'var(--text-body)' }}>
                      <button onClick={() => onContrato(p.contratoId)} className="font-semibold" style={{ color: 'var(--text-primary)' }}>{p.contratoNumero}</button> · {p.produto}
                    </td>
                    <td className="py-[5px] pr-[8px] tabular-nums" style={{ color: 'var(--text-muted)' }}>venc. {dataBR(p.dataVencimento)} · {p.diasAtrasoNaDataBase} dia(s){p.encargoMoraNaDataBase > 0 ? ` · mora ${formatCurrency(p.encargoMoraNaDataBase)}` : ''}</td>
                    <td className="py-[5px] pr-[8px]"><StatusBadge label={p.status} colors={PARCELA_STATUS_COLORS} /></td>
                    <td className="py-[5px] text-right font-semibold tabular-nums">{formatCurrency(p.valorNominal)}</td>
                  </tr>
                ))}
                {f.itens.filter((it) => !it.coberto).map((it, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <td className="py-[4px] pr-[8px]" colSpan={2}>{it.descricao}</td>
                    <td className="py-[4px] pr-[8px]" colSpan={2}>também nesta fatura · {it.tipo}</td>
                    <td className="py-[4px] text-right tabular-nums">{formatCurrency(it.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {aberto && d.cobertasSemFatura.length > 0 && (
          <div className="rounded-[10px] p-[10px] text-[12px]" style={{ background: 'var(--surface-input)' }}>
            <div className="font-bold">Parcelas cobertas sem fatura</div>
            {d.cobertasSemFatura.map((p) => (
              <div key={p.parcelaId} className="flex justify-between py-[3px]">
                <span>Parcela {p.display} · {p.contratoNumero} · venc. {dataBR(p.dataVencimento)} · {p.diasAtrasoNaDataBase} dia(s)</span>
                <span className="tabular-nums">{formatCurrency(p.valorNominal)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-[8px] text-[12px] sm:grid-cols-4">
          <Campo label="Nominal coberto" valor={formatCurrency(d.totaisCobertura.valorNominal)} />
          <Campo label="Multa e juros na data-base" valor={d.totaisCobertura.encargosMora !== null ? formatCurrency(d.totaisCobertura.encargosMora) : 'não registrado (legado)'} />
          <Campo label="Saldo atualizado (renegociado)" valor={d.totaisCobertura.valorAtualizado !== null ? formatCurrency(d.totaisCobertura.valorAtualizado) : formatCurrency(d.plano.valorTotalRenegociado)} />
          <Campo label="Data-base" valor={fmtDataHora(d.dataBase)} />
        </div>
        {d.totaisCobertura.moraHerdada && <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Mora: {d.totaisCobertura.moraHerdada}.</div>}
      </div>
    </Secao>
  );
}

// Seleção aprovada: exclusões com justificativa e vincendas incluídas (snapshot).
export function SelecaoAcordo({ d }: { d: AcordoDetalhe }) {
  if (d.exclusoes.length === 0 && d.vincendasIncluidas.length === 0) return null;
  return (
    <Secao titulo="Seleção aprovada na proposta">
      {d.exclusoes.length > 0 && (
        <ul className="flex flex-col gap-[3px] text-[12px]">
          {d.exclusoes.map((e) => (
            <li key={e.faturaId} className="flex items-start gap-[6px]">
              <span style={{ color: TOM_DOSSIE_FG.atencao }}>⚠</span>
              <span>
                Fatura {e.numero !== null ? `#${e.numero}` : ''} {e.dataVencimento ? `de ${dataBR(e.dataVencimento)}` : ''}{e.valorTotal !== null ? ` (${formatCurrency(e.valorTotal)})` : ''} <b>excluída</b> — {e.justificativa}
              </span>
            </li>
          ))}
        </ul>
      )}
      {d.vincendasIncluidas.length > 0 && (
        <ul className="mt-[4px] flex flex-col gap-[3px] text-[12px]">
          {d.vincendasIncluidas.map((v) => (
            <li key={v.faturaId}>Fatura vincenda {v.numero !== null ? `#${v.numero}` : ''} {v.dataVencimento ? `de ${dataBR(v.dataVencimento)}` : ''} <b>incluída</b> por opção do operador (entra pelo nominal, sem mora).</li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

// Entrada do acordo + o "de acordo" do cliente pelo WhatsApp.
export function EntradaAcordo({ d }: { d: AcordoDetalhe }) {
  return (
    <Secao titulo="Entrada">
      <div className="grid grid-cols-2 gap-[8px] text-[12px] sm:grid-cols-5">
        <Campo label="Valor" valor={d.entrada.valor > 0 ? formatCurrency(d.entrada.valor) : 'sem entrada'} />
        <Campo label="Situação"><span className="font-semibold" style={{ color: ENTRADA_ACORDO_FG[d.entrada.situacao] ?? 'var(--text-muted)' }}>{ENTRADA_SITUACAO_LABEL[d.entrada.situacao] ?? d.entrada.situacao}</span></Campo>
        <Campo label="Data-limite" valor={instanteBR(d.entrada.dataLimite)} />
        <Campo label="Paga em" valor={d.entrada.pagaEm ? fmtDataHora(d.entrada.pagaEm) : '—'} />
        <Campo label="Cobrança no Asaas" valor={d.entrada.cobrancaAsaasId ?? '—'} />
      </div>
      {d.aceiteWhatsapp && <AceiteWhatsapp d={d} />}
      {d.temTermoAntigo && <div className="mt-[4px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Acordo anterior a 09/09: possui termo de confissão gravado no histórico.</div>}
    </Secao>
  );
}

// "De acordo" do cliente (doc 02 §7.7, 09/09; texto da resposta desde 21/10).
export function AceiteWhatsapp({ d, destaque = false }: { d: AcordoDetalhe; destaque?: boolean }) {
  const [verMensagem, setVerMensagem] = useState(false);
  const ac = d.aceiteWhatsapp;
  if (!ac) {
    return <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Sem "de acordo" registrado (acordo anterior a 09/09 ou importado do legado).</div>;
  }
  return (
    <div className={destaque ? '' : 'mt-[6px]'}>
      {ac.respostaCliente ? (
        <div className="whitespace-pre-wrap rounded-[10px] px-[12px] py-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>
          “{ac.respostaCliente}” <span style={{ color: 'var(--text-muted)' }}>— resposta do cliente no WhatsApp, registrada por {d.criadoPor} em {fmtDataHora(ac.confirmadoPeloOperadorEm)}.</span>
        </div>
      ) : (
        <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          De acordo do cliente pelo WhatsApp confirmado por {d.criadoPor} em {fmtDataHora(ac.confirmadoPeloOperadorEm)}{destaque ? ' — o texto da resposta não foi registrado (o campo existe desde 21/10).' : '.'}
        </div>
      )}
      {ac.mensagemEnviada && (
        <div className="mt-[4px]">
          <button onClick={() => setVerMensagem((x) => !x)} className="text-[11.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {verMensagem ? 'ocultar a mensagem enviada' : 'ver a mensagem enviada ao cliente'}
          </button>
          {verMensagem && (
            <pre className="mt-[4px] whitespace-pre-wrap rounded-[8px] p-[10px] font-sans text-[12px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-body)' }}>{ac.mensagemEnviada}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// Cálculo do plano (motor do Catálogo ou placeholder).
export function CalculoAcordo({ d }: { d: AcordoDetalhe }) {
  if (!d.calculo) return null;
  const periodicidade = PERIODICIDADE_LABEL[d.plano.periodicidade] ?? d.plano.periodicidade;
  return (
    <Secao titulo={d.calculo.motor === 'catalogo' ? 'Cálculo do plano — motor do Catálogo (Acordo de Pagamento)' : 'Cálculo do plano — divisão simples (produto do Catálogo em rascunho)'}>
      <div className="grid grid-cols-2 gap-[8px] text-[12px] sm:grid-cols-4">
        <Campo label="Saldo negociado" valor={formatCurrency(d.calculo.saldoNegociado ?? d.plano.valorTotalRenegociado)} />
        <Campo label="Entrada mínima" valor={formatCurrency(d.calculo.entradaMinima ?? 0)} />
        <Campo label="Taxa inicial" valor={formatCurrency(d.calculo.taxaInicial ?? 0)} />
        <Campo label="Encargo do período" valor={d.calculo.taxaPeriodo ? `${(d.calculo.taxaPeriodo * 100).toFixed(2)}% (${d.calculo.encargoMensal ? `${(d.calculo.encargoMensal * 100).toFixed(2)}% a.m.` : periodicidade})` : '—'} />
        <Campo label="Saldo a parcelar" valor={formatCurrency(d.calculo.saldoAParcelar ?? 0)} />
        <Campo label="Parcela" valor={`${d.plano.numeroParcelasNovas} × ${formatCurrency(d.calculo.valorParcela ?? d.plano.valorParcelaNova)}`} />
        <Campo label="Total a pagar" valor={formatCurrency(d.calculo.totalAPagar ?? d.plano.totalPlano)} />
        <Campo label="Exceções" valor={d.calculo.excecoes?.length ? d.calculo.excecoes.join('; ') : 'nenhuma'} />
      </div>
    </Secao>
  );
}

// Cotas novas do plano (parcelas do item ACORDO).
export function CotasAcordo({ d, onContrato }: { d: AcordoDetalhe; onContrato: (id: string) => void }) {
  const r = d.resumoCotas;
  return (
    <Secao titulo={`Cotas do plano — ${r.quantidade} de ${d.plano.numeroParcelasNovas} · ${r.pagas} paga(s) · ${r.vencidas} vencida(s)${r.venceHoje ? ` · ${r.venceHoje} vence(m) hoje` : ''} · ${r.aVencer} a vencer${r.novadas ? ` · ${r.novadas} novada(s)` : ''}`}>
      {d.cotas.length === 0 ? (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {d.status === 'rascunho' || d.status === 'aguardando_entrada' ? 'As cotas nascem na efetivação (pagamento da entrada) e entram nas faturas seguintes da conta.' : 'Nenhuma cota gerada.'}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                  <th className={th}>Cota</th>
                  <th className={th}>Contrato</th>
                  <th className={th}>Vencimento</th>
                  <th className={thR}>Valor</th>
                  <th className={th + ' pl-[10px]'}>Fatura</th>
                  <th className={th}>Paga em</th>
                  <th className={th}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {d.cotas.map((c) => (
                  <tr key={c.parcelaId} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="py-[6px] pr-[10px] font-semibold tabular-nums">{c.display}</td>
                    <td className="py-[6px] pr-[10px]"><button onClick={() => onContrato(c.contratoId)} className="font-semibold" style={{ color: 'var(--text-primary)' }}>{c.contratoNumero}</button></td>
                    <td className="py-[6px] pr-[10px] tabular-nums">{dataBR(c.dataVencimento)}</td>
                    <td className="py-[6px] pl-[10px] text-right tabular-nums">{formatCurrency(c.valorNominal)}</td>
                    <td className="py-[6px] pl-[10px]" style={{ color: 'var(--text-body)' }}>{c.fatura ? `#${c.fatura.numero} · ${dataBR(c.fatura.dataVencimento)}` : <span style={{ color: 'var(--text-muted)' }}>ainda sem fatura</span>}</td>
                    <td className="py-[6px] pr-[10px] tabular-nums">{c.dataPagamento ? `${dataBR(c.dataPagamento)}${c.valorEncargo > 0 ? ` (+${formatCurrency(c.valorEncargo)} de juros)` : ''}` : '—'}</td>
                    <td className="py-[6px]"><StatusBadge label={c.status} colors={PARCELA_STATUS_COLORS} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-[8px] flex flex-wrap gap-[14px] text-[12px]" style={{ color: 'var(--text-body)' }}>
            <span>Plano: <b className="tabular-nums">{formatCurrency(r.totalPlano)}</b></span>
            <span>Pago: <b className="tabular-nums">{formatCurrency(r.valorPago)}</b>{r.encargosPagos > 0 ? <span style={{ color: 'var(--text-muted)' }}> (+{formatCurrency(r.encargosPagos)} de juros e multa)</span> : null}</span>
            <span>A pagar: <b className="tabular-nums">{formatCurrency(r.valorAPagar)}</b></span>
            {r.valorVencido > 0 && <span style={{ color: TOM_DOSSIE_FG.alerta }}>Vencido: <b className="tabular-nums">{formatCurrency(r.valorVencido)}</b></span>}
          </div>
          <div className="mt-[4px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Cota vencida é parcela vencida do contrato: conta como atraso na régua de cobrança e na carteira. As parcelas cobertas não contam enquanto o acordo estiver ativo.
          </div>
        </>
      )}
    </Secao>
  );
}

// Acordo importado do legado (Asaas) — origem e caso de migração.
export function LegadoAcordo({ d }: { d: AcordoDetalhe }) {
  const navigate = useNavigate();
  if (!d.legado) return null;
  return (
    <Secao titulo="Importado do legado (Asaas)">
      <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>
        Declarado na migração: parcelas {d.legado.parcelasCobertasDeclaradas.join(', ')} cobertas · cotas de {dataBR(d.legado.primeiraCotaEm)} a {dataBR(d.legado.ultimaCotaEm)}.{' '}
        <button onClick={() => navigate(`/migracao-legado/${d.legado!.casoId}`)} className="font-semibold" style={{ color: 'var(--text-primary)' }}>Abrir o caso de migração →</button>
      </div>
      {d.observacao && <div className="mt-[4px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{d.observacao}</div>}
    </Secao>
  );
}
