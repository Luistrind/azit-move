import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import type { ContratoNovacao, NovacaoDetalhe } from '../../services/operacoes.service';
import { StatusBadge } from '../StatusBadge';
import { Campo } from '../Metrica';
import { Secao } from '../Secao';
import { BlocoDecomposicao } from '../NovacaoDecomposicao';
import { CONTRATO_STATUS_COLORS, RECEBIMENTO_NOVACAO_FG, TOM_DOSSIE_FG } from '../../config/statusColors';
import { ROTULO_STATUS_CONTRATO } from '../../lib/rotulos';
import { dataBR } from '../../lib/datas';
import { PERIODICIDADE_LABEL, fmtDataHora } from './AcordoBlocos';

// Blocos do DETALHE DA NOVAÇÃO (GET novacoes/:id) — uma fonte só para a tela de
// Renegociações e para o dossiê da Central de Aprovações (21/10).

const RECEBIMENTO_SITUACAO_LABEL: Record<string, string> = {
  sem_recebimento: 'Sem recebimento inicial',
  pago: 'Pago',
  aguardando: 'Aguardando pagamento',
  expirado: 'Venceu sem pagamento',
  pendente: 'Ainda não cobrado',
};
const ASSINATURA_LABEL: Record<string, string> = {
  enviado: 'Enviado — aguardando assinaturas',
  parcialmente_assinado: 'Parcialmente assinado',
  assinado: 'Assinado por todos',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
};
const PAPEL_SIGNATARIO: Record<string, string> = {
  titular: 'Titular', solidario: 'Comprador solidário', garantidor: 'Garantidor', azit: 'Pela Azit', testemunha1: 'Testemunha', testemunha2: 'Testemunha',
};

const th = 'py-[7px] pr-[10px] text-left font-semibold';
const thR = 'py-[7px] pl-[10px] text-right font-semibold';

// Contratos de origem liquidados por novação (só existem depois da ativação).
export function OrigensNovacao({ d, onContrato }: { d: NovacaoDetalhe; onContrato: (id: string) => void }) {
  const navigate = useNavigate();
  return (
    <Secao titulo={`Contratos de origem liquidados por novação — ${d.origens.length}`}>
      {d.origens.length === 0 ? (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {d.status === 'ativo' ? 'Nenhum contrato de origem vinculado.' : 'Os contratos de origem são extintos na ativação (depois da assinatura e do recebimento inicial, se houver). Até lá seguem vivos.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead>
              <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                <th className={th}>Contrato</th>
                <th className={th}>Produto</th>
                <th className={thR}>Parcelas extintas</th>
                <th className={thR}>Nominal extinto</th>
                <th className={th + ' pl-[10px]'}>Acordos absorvidos</th>
                <th className={th}>Encerrado em</th>
              </tr>
            </thead>
            <tbody>
              {d.origens.map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td className="py-[6px] pr-[10px]"><button onClick={() => onContrato(o.id)} className="font-semibold" style={{ color: 'var(--text-primary)' }}>{o.numero}</button></td>
                  <td className="py-[6px] pr-[10px]">{o.descricao}{o.placa ? ` · ${o.placa}` : ''}</td>
                  <td className="py-[6px] pl-[10px] text-right tabular-nums">{o.parcelasNovadas}</td>
                  <td className="py-[6px] pl-[10px] text-right tabular-nums">{formatCurrency(o.valorNominalNovado)}</td>
                  <td className="py-[6px] pl-[10px]">
                    {o.acordosNovados.length === 0 ? <span style={{ color: 'var(--text-muted)' }}>—</span> : o.acordosNovados.map((a) => (
                      <button key={a.id} onClick={() => navigate(`/acordos?acordo=${a.id}`)} className="mr-[8px] font-semibold" style={{ color: 'var(--text-primary)' }}>acordo {a.plano} →</button>
                    ))}
                  </td>
                  <td className="py-[6px] tabular-nums">{o.encerradoEm ? fmtDataHora(o.encerradoEm) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-[6px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {d.faturasNovadas} fatura(s) da conta extinta(s) ("Novada") — a dívida não some (Regra 3): ela vive agora nos contratos novos. Parcelas extintas são o valor nominal; o saldo reorganizado (acima) é a valor presente na data-base.
          </div>
        </div>
      )}
    </Secao>
  );
}

// Decomposição do saldo (snapshot) + termos da proposta.
export function DecomposicaoNovacao({ d, titulo }: { d: NovacaoDetalhe; titulo?: string }) {
  const sim = d.simulacao;
  const freq = d.termos?.frequencia ? PERIODICIDADE_LABEL[d.termos.frequencia] ?? d.termos.frequencia : null;
  return (
    <Secao titulo={titulo ?? `Decomposição do saldo na data-base${d.dataBase ? ` (${fmtDataHora(d.dataBase)})` : ''}`}>
      {sim ? (
        <div className="flex flex-col gap-[12px]">
          <BlocoDecomposicao parteVeiculo={sim.decomposicao.parteVeiculo} demaisProdutos={sim.decomposicao.demaisProdutos} totalGeral={sim.decomposicao.totalGeral} rotuloTotal="Saldo total reorganizado" />
          <div className="grid grid-cols-2 gap-[8px] text-[12px] sm:grid-cols-4">
            <Campo label="Prazo" valor={d.termos?.prazoMeses ? `${d.termos.prazoMeses} meses` : d.termos?.numeroParcelasVeiculo ? `${d.termos.numeroParcelasVeiculo} parcelas` : '—'} />
            <Campo label="Frequência" valor={freq ?? '—'} />
            <Campo label="1ª parcela" valor={dataBR(d.termos?.dataPrimeiraParcela)} />
            <Campo label="Taxa inicial" valor={formatCurrency(sim.taxaInicial)} />
            <Campo label="Desconto (comitê)" valor={d.termos?.desconto ? formatCurrency(d.termos.desconto) : '—'} />
            <Campo label="Acréscimo" valor={d.termos?.acrescimo ? `${formatCurrency(d.termos.acrescimo)} — ${d.termos.acrescimoMotivo ?? 'sem motivo'}` : '—'} />
            <Campo label="Troca de veículo" valor={sim.troca ? `sai ${sim.troca.saiDescricao} · entra ${sim.troca.entraDescricao} (ajuste ${formatCurrency(sim.troca.ajuste)})` : 'não'} />
            <Campo label="Total a pagar" valor={formatCurrency(sim.totalAPagar)} />
          </div>
          <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>
            {d.contratoUnico
              ? `Contrato único: ${sim.contrato2.totalParcelas + sim.contrato1.totalParcelas} parcelas de ${formatCurrency(sim.valorParcelaTotal ?? sim.valorParcela)}.`
              : `Termo primeiro: ${sim.contrato2.totalParcelas} parcela(s)${sim.contrato2.antecipacaoTransicao > 0 ? ` (a última com antecipação do veículo de ${formatCurrency(sim.contrato2.antecipacaoTransicao)} — fatura de transição)` : ''}; depois o veículo: ${sim.contrato1.totalParcelas} parcelas. Parcela composta ${formatCurrency(sim.valorParcelaTotal ?? sim.valorParcela)} = financeira ${formatCurrency(sim.valorParcela)}${sim.comissaoPorPeriodo ? ` + comissão ${formatCurrency(sim.comissaoPorPeriodo)}` : ''}${sim.protecaoPorPeriodo ? ` + proteção ${formatCurrency(sim.protecaoPorPeriodo)}` : ''}.`}
          </div>
          {sim.excecoes?.length > 0 && (
            <ul className="flex flex-col gap-[3px] text-[12px]">
              {sim.excecoes.map((e) => <li key={e} className="flex gap-[6px]"><span style={{ color: TOM_DOSSIE_FG.atencao }}>⚠</span><span>{e}</span></li>)}
            </ul>
          )}
        </div>
      ) : (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Proposta sem snapshot de simulação.</div>
      )}
    </Secao>
  );
}

// Contratos gerados pela novação (nascem na aprovação, já com o instrumento).
export function ContratosNovacao({ d, onContrato }: { d: NovacaoDetalhe; onContrato: (id: string) => void }) {
  return (
    <Secao titulo="Contratos gerados">
      {!d.contratoVeiculo && !d.contratoTermo ? (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Os contratos nascem na aprovação pela Central (CONAC), já com o instrumento enviado à assinatura.</div>
      ) : (
        <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-2">
          {[d.contratoTermo, d.contratoVeiculo].filter((c): c is ContratoNovacao => !!c).map((c) => <CartaoContratoNovo key={c.id} c={c} unico={d.contratoUnico} onContrato={onContrato} />)}
        </div>
      )}
    </Secao>
  );
}

export function RecebimentoNovacao({ d }: { d: NovacaoDetalhe }) {
  const sit = d.recebimentoInicial.situacao;
  return (
    <Secao titulo="Recebimento inicial">
      <div className="grid grid-cols-2 gap-[8px] text-[12px] sm:grid-cols-4">
        <Campo label="Valor" valor={d.recebimentoInicial.valor > 0 ? formatCurrency(d.recebimentoInicial.valor) : 'não há — a taxa inicial é diluída nas parcelas'} />
        <Campo label="Situação"><span className="font-semibold" style={{ color: RECEBIMENTO_NOVACAO_FG[sit] ?? 'var(--text-muted)' }}>{RECEBIMENTO_SITUACAO_LABEL[sit] ?? sit}</span></Campo>
        <Campo label="Pago em" valor={d.recebimentoInicial.pagoEm ? fmtDataHora(d.recebimentoInicial.pagoEm) : '—'} />
        <Campo label="Cobrança no Asaas" valor={d.recebimentoInicial.cobrancaAsaasId ?? '—'} />
      </div>
    </Secao>
  );
}

function CartaoContratoNovo({ c, unico, onContrato }: { c: ContratoNovacao; unico: boolean; onContrato: (id: string) => void }) {
  const statusLabel = ROTULO_STATUS_CONTRATO[c.status.toUpperCase()] ?? c.status;
  return (
    <div className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="text-[11px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-label)' }}>{unico ? 'Contrato único' : c.papel === 'termo' ? 'Contrato 2 — Termo' : 'Contrato 1 — Veículo'}</span>
        <button onClick={() => onContrato(c.id)} className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>{c.numero} →</button>
        <StatusBadge label={statusLabel} colors={CONTRATO_STATUS_COLORS} />
      </div>
      <div className="mt-[4px] text-[12px]" style={{ color: 'var(--text-body)' }}>{c.descricao}{c.placa ? ` · ${c.placa}` : ''}</div>
      <div className="mt-[6px] grid grid-cols-2 gap-[6px] text-[12px]">
        <Campo label="Plano" valor={`${c.numeroParcelas} × ${formatCurrency(c.valorParcela)} (${PERIODICIDADE_LABEL[c.periodicidade] ?? c.periodicidade})`} />
        <Campo label="1ª parcela" valor={dataBR(c.dataPrimeiraParcela)} />
        <Campo label="Cronograma" valor={c.cronogramaGerado ? `${c.cronograma.total} parcelas · ${c.cronograma.pagas} paga(s) · ${c.cronograma.vencidas} vencida(s) · ${c.cronograma.aVencer} a vencer${c.cronograma.proximoVencimento ? ` · próxima ${dataBR(c.cronograma.proximoVencimento)}` : ''}` : 'ainda não gerado (nasce na ativação)'} />
        <Campo label="Assinatura digital">
          {c.assinatura ? (
            <div>
              <div className="font-semibold">{ASSINATURA_LABEL[c.assinatura.status] ?? c.assinatura.status}{c.assinatura.simulado ? ' (simulada)' : ''}</div>
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>enviado {fmtDataHora(c.assinatura.enviadoEm)}{c.assinatura.concluidoEm ? ` · concluído ${fmtDataHora(c.assinatura.concluidoEm)}` : ''}</div>
              <ul className="mt-[2px] text-[11.5px]">
                {c.assinatura.signatarios.map((s, i) => (
                  <li key={i} style={{ color: s.assinouEm ? TOM_DOSSIE_FG.ok : 'var(--text-muted)' }}>
                    {s.assinouEm ? '✓' : '○'} {s.nome} ({PAPEL_SIGNATARIO[s.papel] ?? s.papel}){s.assinouEm ? ` — assinou ${fmtDataHora(s.assinouEm)}` : s.visualizouEm ? ` — visualizou ${fmtDataHora(s.visualizouEm)}` : ''}
                  </li>
                ))}
              </ul>
              {c.assinatura.motivoRecusa && <div className="text-[11.5px]" style={{ color: TOM_DOSSIE_FG.alerta }}>Recusa: {c.assinatura.motivoRecusa}</div>}
              {c.papel === 'termo' && !unico && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Instrumento único: o Termo é assinado no mesmo ato do contrato do veículo.</div>}
            </div>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>sem documento enviado</span>
          )}
        </Campo>
      </div>
    </div>
  );
}
