import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { migracaoLegadoService as svc } from '../services/migracao-legado.service';
import { Modal } from '../components/Modal';
import { Metrica } from '../components/Metrica';
import { StatusBadge } from '../components/StatusBadge';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole } from '../lib/permissoes';
import { CASO_LEGADO_STATUS_COLORS, COBRANCA_LEGADA_COLORS, SITUACAO_LEGADO_COLORS } from '../config/statusColors';

// Migração do legado — F1 (doc 02 §26): a bancada. Lê o Asaas, monta um caso
// por cliente e ordena pela triagem do Luís (em dia primeiro; complicados por
// último). O operador vai ao PopHub nessa ordem. Nada aqui vira contrato.

const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const dataHoraBR = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const cpfBR = (v: string | null) => {
  if (!v) return '—';
  if (v.length === 11) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (v.length === 14) return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v;
};
const CICLO: Record<string, string> = { WEEKLY: 'semanal', BIWEEKLY: 'quinzenal', MONTHLY: 'mensal', SEMIANNUALLY: 'semestral', YEARLY: 'anual' };
const AMBIENTE_ROTULO: Record<string, string> = { simulado: 'simulado (sem chave)', sandbox: 'sandbox do Asaas', producao: 'conta REAL do Asaas' };
const ROLE_LEGADO = ['ADMIN', 'DIRETOR', 'OPERADOR', 'FINANCEIRO'];

const btn = 'h-[32px] rounded-[8px] px-[12px] text-[12px] font-semibold disabled:opacity-50';
const btnPri = { background: 'var(--accent)', color: '#fff' } as const;
const btnSec = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-body)' } as const;
const inputCls = 'rounded-[8px] px-[10px] py-[7px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const th = 'px-[10px] py-[8px] text-left text-[10.5px] font-bold uppercase tracking-[.04em]';
const td = 'px-[10px] py-[8px] text-[12.5px] align-top';

export function MigracaoLegadoPage() {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_LEGADO);
  const [filtros, setFiltros] = useState({ status: '', situacao: '', busca: '' });
  const [casoId, setCasoId] = useState<string | null>(null);

  const resumo = useQuery({
    queryKey: ['legado-resumo'],
    queryFn: () => svc.resumo(),
    refetchInterval: (q) => (q.state.data?.coleta?.emAndamento ? 3000 : false),
  });
  const emAndamento = !!resumo.data?.coleta?.emAndamento;
  const lista = useQuery({
    queryKey: ['legado-casos', filtros],
    queryFn: () => svc.casos({ status: filtros.status || undefined, situacao: filtros.situacao || undefined, busca: filtros.busca || undefined }),
  });
  // Quando a coleta termina, a lista precisa refletir.
  useEffect(() => {
    if (!emAndamento) qc.invalidateQueries({ queryKey: ['legado-casos'] });
  }, [emAndamento, qc]);

  async function coletar() {
    try {
      const r = await svc.coletar();
      toast.info(`Lendo o Asaas (${AMBIENTE_ROTULO[r.ambiente] ?? r.ambiente})…`);
      await qc.invalidateQueries({ queryKey: ['legado-resumo'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }

  const r = resumo.data;
  const casos = lista.data ?? [];
  const porSit = r?.porSituacao ?? {};
  const porStatus = r?.porStatus ?? {};

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Coleta */}
      <div className="rounded-[12px] p-[14px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-[12px]">
          <div className="min-w-0">
            <div className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>Leitura do Asaas</div>
            <div className="mt-[3px] text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              Fonte: <b>{AMBIENTE_ROTULO[r?.ambiente ?? ''] ?? r?.ambiente ?? '…'}</b>.
              {r?.coleta ? (
                r.coleta.emAndamento ? (
                  <> Em andamento desde {dataHoraBR(r.coleta.iniciadaEm)} — {r.coleta.clientesLidos} clientes e {r.coleta.cobrancasLidas} cobranças lidas até agora.</>
                ) : r.coleta.erro ? (
                  <> Última leitura em {dataHoraBR(r.coleta.iniciadaEm)} <b style={{ color: CASO_LEGADO_STATUS_COLORS.DESCARTADO.fg }}>falhou</b> após {r.coleta.clientesLidos} clientes: {r.coleta.erro}</>
                ) : (
                  <> Última leitura concluída em {dataHoraBR(r.coleta.concluidaEm)}: {r.coleta.clientesLidos} clientes, {r.coleta.cobrancasLidas} cobranças ({r.coleta.casosNovos} casos novos, {r.coleta.casosAtualizados} atualizados).</>
                )
              ) : (
                <> Nenhuma leitura feita ainda — clique para montar a fila de casos.</>
              )}
            </div>
            <div className="mt-[4px] text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Reler atualiza a triagem e as cobranças de cada caso; o que você já decidiu (status, observação) não é sobrescrito.
            </div>
          </div>
          {podeOperar && (
            <button className={btn} style={btnPri} onClick={coletar} disabled={emAndamento}>
              {emAndamento ? 'Lendo…' : r?.coleta ? 'Reler o Asaas' : 'Ler o Asaas'}
            </button>
          )}
        </div>
        <div className="mt-[12px] grid grid-cols-2 gap-[10px] sm:grid-cols-3 lg:grid-cols-6">
          <Metrica label="Em dia (tratar primeiro)" valor={porSit.SEM_VENCIDA ?? 0} tom="claro" />
          <Metrica label="Com vencida" valor={porSit.COM_VENCIDA ?? 0} tom="claro" alerta={(porSit.COM_VENCIDA ?? 0) > 0} />
          <Metrica label="Sem movimento" valor={porSit.SEM_MOVIMENTO ?? 0} tom="claro" />
          <Metrica label="Em revisão" valor={porStatus.EM_REVISAO ?? 0} tom="claro" />
          <Metrica label="Validados" valor={porStatus.VALIDADO ?? 0} tom="claro" />
          <Metrica label="Migrados" valor={porStatus.MIGRADO ?? 0} tom="claro" />
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-[8px]">
        <input className={`${inputCls} w-[240px]`} style={inputStyle} placeholder="Buscar nome, CPF/CNPJ ou id do Asaas"
          value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} />
        <select className={inputCls} style={inputStyle} value={filtros.situacao} onChange={(e) => setFiltros({ ...filtros, situacao: e.target.value })}>
          <option value="">Todas as situações</option>
          {(r?.opcoes.situacao ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
        <select className={inputCls} style={inputStyle} value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
          <option value="">Todos os status</option>
          {(r?.opcoes.status ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{casos.length} caso(s) · ordem: em dia primeiro, depois menos vencidas</span>
      </div>

      {/* Lista */}
      <div className="overflow-x-auto rounded-[12px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full min-w-[980px] border-collapse">
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <th className={th}>#</th>
              <th className={th}>Cliente</th>
              <th className={th}>Situação</th>
              <th className={th}>Parcela</th>
              <th className={th}>Assinatura</th>
              <th className={`${th} text-right`}>Pagas</th>
              <th className={`${th} text-right`}>Abertas</th>
              <th className={`${th} text-right`}>Vencidas</th>
              <th className={th}>Histórico</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {lista.isLoading && (
              <tr><td className={td} colSpan={10} style={{ color: 'var(--text-muted)' }}>Carregando…</td></tr>
            )}
            {!lista.isLoading && casos.length === 0 && (
              <tr><td className={td} colSpan={10} style={{ color: 'var(--text-muted)' }}>
                {r?.coleta ? 'Nenhum caso com esses filtros.' : 'Nenhum caso ainda — faça a primeira leitura do Asaas.'}
              </td></tr>
            )}
            {casos.map((c, i) => (
              <tr key={c.id} onClick={() => setCasoId(c.id)} role="button" className="cursor-pointer hover:bg-[var(--surface-input)]"
                style={{ borderBottom: '1px solid var(--border)', opacity: c.status === 'DESCARTADO' ? 0.55 : 1 }}>
                <td className={`${td} tabular-nums`} style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                <td className={td}>
                  <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{c.nome}</div>
                  <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{cpfBR(c.cpfCnpj)} · {c.asaasCustomerId}</div>
                </td>
                <td className={td}>
                  <StatusBadge label={c.situacaoRotulo} colors={{ [c.situacaoRotulo]: SITUACAO_LEGADO_COLORS[c.situacao] }} />
                  {c.recente && <div className="mt-[3px] text-[10.5px] font-semibold" style={{ color: CASO_LEGADO_STATUS_COLORS.VALIDADO.fg }}>recente · sem parcela paga</div>}
                </td>
                <td className={td}>
                  <div className="font-display font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{c.valorParcelaPadrao == null ? '—' : formatCurrency(c.valorParcelaPadrao)}</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{c.modeloRotulo ?? (c.valorParcelaPadrao == null ? '' : 'fora do padrão')}</div>
                </td>
                <td className={td} style={{ color: c.assinaturaAtiva ? 'var(--text-body)' : 'var(--text-muted)' }}>
                  {c.assinaturaValor == null ? '—' : `${formatCurrency(c.assinaturaValor)} ${CICLO[c.assinaturaCiclo ?? ''] ?? c.assinaturaCiclo ?? ''}`}
                  <div className="text-[11px]">{c.assinaturaAtiva ? 'ativa' : c.assinaturaValor == null ? '' : 'inativa'}</div>
                </td>
                <td className={`${td} text-right tabular-nums`}>{c.cobrancasPagas}</td>
                <td className={`${td} text-right tabular-nums`}>{c.cobrancasPendentes}</td>
                <td className={`${td} text-right tabular-nums`} style={{ color: c.cobrancasVencidas ? SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg : undefined, fontWeight: c.cobrancasVencidas ? 700 : 400 }}>{c.cobrancasVencidas}</td>
                <td className={`${td} tabular-nums`} style={{ color: 'var(--text-secondary)' }}>{dataBR(c.primeiraCobrancaEm)} → {dataBR(c.ultimaCobrancaEm)}</td>
                <td className={td}><StatusBadge label={c.statusRotulo} colors={{ [c.statusRotulo]: CASO_LEGADO_STATUS_COLORS[c.status] }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {casoId && <CasoModal id={casoId} onClose={() => setCasoId(null)} podeOperar={podeOperar} />}
    </div>
  );
}

// ---------------- Caso ----------------

function CasoModal({ id, onClose, podeOperar }: { id: string; onClose: () => void; podeOperar: boolean }) {
  const qc = useQueryClient();
  const caso = useQuery({ queryKey: ['legado-caso', id], queryFn: () => svc.caso(id) });
  const [obs, setObs] = useState('');
  const [motivo, setMotivo] = useState('');
  const [descartando, setDescartando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [soAbertas, setSoAbertas] = useState(false);
  const c = caso.data;

  useEffect(() => {
    if (c) setObs(c.observacao ?? '');
  }, [c?.id, c?.observacao]); // eslint-disable-line react-hooks/exhaustive-deps

  async function rodar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await fn();
      toast.sucesso(ok);
      await Promise.all([qc.invalidateQueries({ queryKey: ['legado-caso', id] }), qc.invalidateQueries({ queryKey: ['legado-casos'] }), qc.invalidateQueries({ queryKey: ['legado-resumo'] })]);
      setDescartando(false);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function salvarObs() {
    if (!c || (c.observacao ?? '') === obs.trim()) return;
    try {
      await svc.anotar(id, obs);
      await qc.invalidateQueries({ queryKey: ['legado-casos'] });
    } catch (e) {
      toast.erro(mensagemErro(e));
    }
  }

  const cobrancas = (c?.cobrancas ?? []).filter((p) => !soAbertas || p.classe === 'pendente' || p.classe === 'vencida');

  return (
    <Modal open onClose={onClose} title={c ? c.nome : 'Caso'} largura={980}>
      {!c ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
      ) : (
        <div className="flex flex-col gap-[14px]">
          {/* Cabeçalho do caso */}
          <div className="flex flex-wrap items-center gap-[8px]">
            <StatusBadge label={c.statusRotulo} colors={{ [c.statusRotulo]: CASO_LEGADO_STATUS_COLORS[c.status] }} />
            <StatusBadge label={c.situacaoRotulo} colors={{ [c.situacaoRotulo]: SITUACAO_LEGADO_COLORS[c.situacao] }} />
            <span className="text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              {cpfBR(c.cpfCnpj)} · {c.telefone ?? 'sem telefone'} · {c.email ?? 'sem e-mail'} · Asaas <b>{c.asaasCustomerId}</b>
            </span>
            <span className="ml-auto text-[11px]" style={{ color: 'var(--text-muted)' }}>lido em {dataHoraBR(c.coletadoEm)}</span>
          </div>

          <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-4">
            <Metrica label="Parcela padrão" valor={c.valorParcelaPadrao == null ? '—' : formatCurrency(c.valorParcelaPadrao)} />
            <Metrica label="Modelo sugerido" valor={c.modeloRotulo ?? (c.valorParcelaPadrao == null ? '—' : 'fora do padrão')} />
            <Metrica label="Pagas / abertas / vencidas" valor={`${c.cobrancasPagas} / ${c.cobrancasPendentes} / ${c.cobrancasVencidas}`} alerta={c.cobrancasVencidas > 0} />
            <Metrica label="Histórico" valor={`${dataBR(c.primeiraCobrancaEm)} → ${dataBR(c.ultimaCobrancaEm)}`} />
          </div>

          {/* Assinatura + decomposição */}
          <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-2">
            <div className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
              <div className="text-[11px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-muted)' }}>Assinatura no Asaas (recorrência)</div>
              {c.assinatura ? (
                <div className="mt-[6px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
                  <div><b>{formatCurrency(c.assinatura.valor ?? 0)}</b> {CICLO[c.assinatura.ciclo ?? ''] ?? c.assinatura.ciclo} · {c.assinatura.status === 'ACTIVE' ? 'ativa' : (c.assinatura.status ?? '').toLowerCase()} · próxima {dataBR(c.assinatura.proximoVencimento)}</div>
                  <div className="mt-[3px] text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>{c.assinatura.descricao ?? 'sem descrição'}</div>
                  <div className="mt-[3px] text-[11px]" style={{ color: 'var(--text-muted)' }}>{c.assinatura.id} — é ela que emite as cobranças aos poucos; no corte (F3) ela é parada.</div>
                </div>
              ) : (
                <div className="mt-[6px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Sem assinatura — as cobranças foram avulsas.</div>
              )}
            </div>
            <div className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
              <div className="text-[11px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-muted)' }}>Proposta de decomposição da parcela (doc 02 §26.2)</div>
              {c.decomposicao ? (
                <div className="mt-[6px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
                  <div>Parcelamento do veículo <b>{formatCurrency(c.decomposicao.parcelamento)}</b> + seguro <b>{formatCurrency(c.decomposicao.seguro)}</b> + repasse da taxa de mensagens <b>{formatCurrency(c.decomposicao.taxaMensagens)}</b></div>
                  <div className="mt-[3px] text-[11px]" style={{ color: c.decomposicao.padrao ? 'var(--text-muted)' : CASO_LEGADO_STATUS_COLORS.EM_REVISAO.fg }}>
                    {c.decomposicao.padrao ? 'Parcela padrão — decomposição automática.' : 'Parcela fora do padrão — a decomposição é só uma proposta; confirme pela descrição das cobranças.'}
                  </div>
                </div>
              ) : (
                <div className="mt-[6px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Sem cobranças para inferir a parcela.</div>
              )}
            </div>
          </div>

          {/* Observação + ações */}
          <div className="flex flex-col gap-[8px]">
            <label className="text-[11px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-muted)' }}>Anotações do caso (o que achou no PopHub, dúvidas, combinados)</label>
            <textarea className={`${inputCls} w-full`} style={inputStyle} rows={3} value={obs} onChange={(e) => setObs(e.target.value)} onBlur={salvarObs}
              placeholder="Ex.: contrato PopHub nº 123, assinado em 03/11/2025, entrada R$ 3.000 diluída em 20 parcelas…" disabled={!podeOperar} />
            {podeOperar && (
              <div className="flex flex-wrap items-center gap-[8px]">
                {c.status === 'COLETADO' && (
                  <button className={btn} style={btnPri} disabled={ocupado} onClick={() => rodar(() => svc.mudarStatus(id, 'EM_REVISAO'), 'Caso em revisão')}>Começar a revisão</button>
                )}
                {c.status === 'EM_REVISAO' && (
                  <button className={btn} style={btnSec} disabled={ocupado} onClick={() => rodar(() => svc.mudarStatus(id, 'COLETADO'), 'Caso devolvido à fila')}>Devolver à fila</button>
                )}
                {(c.status === 'COLETADO' || c.status === 'EM_REVISAO') && !descartando && (
                  <button className={btn} style={btnSec} disabled={ocupado} onClick={() => setDescartando(true)}>Descartar (não é cliente ativo)</button>
                )}
                {c.status === 'DESCARTADO' && (
                  <button className={btn} style={btnSec} disabled={ocupado} onClick={() => rodar(() => svc.mudarStatus(id, 'COLETADO'), 'Caso de volta à fila')}>Voltar para a fila</button>
                )}
                {c.status === 'EM_REVISAO' && (
                  <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Validar o caso (conciliação com o contrato do PopHub) chega na F2.</span>
                )}
              </div>
            )}
            {descartando && (
              <div className="flex flex-wrap items-center gap-[8px] rounded-[10px] p-[10px]" style={{ background: CASO_LEGADO_STATUS_COLORS.DESCARTADO.bg }}>
                <input className={`${inputCls} min-w-[280px] flex-1`} style={inputStyle} placeholder="Por que descartar? (obrigatório)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <button className={btn} style={{ background: CASO_LEGADO_STATUS_COLORS.DESCARTADO.fg, color: '#fff' }} disabled={ocupado || !motivo.trim()}
                  onClick={() => rodar(() => svc.mudarStatus(id, 'DESCARTADO', motivo), 'Caso descartado')}>Confirmar descarte</button>
                <button className={btn} style={btnSec} onClick={() => setDescartando(false)}>Cancelar</button>
              </div>
            )}
          </div>

          {/* Cobranças */}
          <div>
            <div className="mb-[6px] flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-muted)' }}>
                Cobranças no Asaas ({c.cobrancas.length}) — seguro, taxa e acordos estão na descrição
              </div>
              <label className="flex items-center gap-[6px] text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={soAbertas} onChange={(e) => setSoAbertas(e.target.checked)} /> só abertas e vencidas
              </label>
            </div>
            <div className="max-h-[360px] overflow-auto rounded-[10px]" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full min-w-[760px] border-collapse">
                <thead className="sticky top-0" style={{ background: 'var(--surface)' }}>
                  <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                    <th className={th}>Venc.</th>
                    <th className={`${th} text-right`}>Valor</th>
                    <th className={th}>Situação</th>
                    <th className={th}>Pago em</th>
                    <th className={th}>Tipo</th>
                    <th className={th}>Descrição</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {cobrancas.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', opacity: p.deletada ? 0.5 : 1 }}>
                      <td className={`${td} tabular-nums whitespace-nowrap`}>{dataBR(p.vencimento)}</td>
                      <td className={`${td} text-right tabular-nums font-semibold`}>{formatCurrency(p.valor)}</td>
                      <td className={td}><StatusBadge label={p.classe} colors={COBRANCA_LEGADA_COLORS} /><span className="ml-[6px] text-[10.5px]" style={{ color: 'var(--text-muted)' }}>{p.status}</span></td>
                      <td className={`${td} tabular-nums whitespace-nowrap`}>{dataBR(p.pagoEm)}</td>
                      <td className={td} style={{ color: 'var(--text-secondary)' }}>{p.tipo ?? '—'}{p.assinaturaId ? '' : ' · avulsa'}</td>
                      <td className={td} style={{ color: 'var(--text-body)' }}>{p.descricao ?? <span style={{ color: 'var(--text-muted)' }}>sem descrição</span>}</td>
                      <td className={td}>{p.invoiceUrl && <a href={p.invoiceUrl} target="_blank" rel="noreferrer" className="text-[11px] underline" style={{ color: 'var(--accent)' }}>abrir</a>}</td>
                    </tr>
                  ))}
                  {cobrancas.length === 0 && (
                    <tr><td className={td} colSpan={7} style={{ color: 'var(--text-muted)' }}>Nenhuma cobrança{soAbertas ? ' aberta ou vencida' : ''}.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
