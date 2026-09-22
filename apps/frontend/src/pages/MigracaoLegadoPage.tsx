import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { migracaoLegadoService as svc } from '../services/migracao-legado.service';
import { Metrica } from '../components/Metrica';
import { StatusBadge } from '../components/StatusBadge';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole } from '../lib/permissoes';
import { CASO_LEGADO_STATUS_COLORS, SITUACAO_LEGADO_COLORS } from '../config/statusColors';

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
const inputCls = 'rounded-[8px] px-[10px] py-[7px] text-[13px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const th = 'px-[10px] py-[8px] text-left text-[10.5px] font-bold uppercase tracking-[.04em]';
const td = 'px-[10px] py-[8px] text-[12.5px] align-top';

export function MigracaoLegadoPage() {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_LEGADO);
  const [filtros, setFiltros] = useState({ status: '', situacao: '', busca: '' });
  const navigate = useNavigate();

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
              <tr key={c.id} onClick={() => navigate(`/migracao-legado/${c.id}`)} role="button" className="cursor-pointer hover:bg-[var(--surface-input)]"
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

    </div>
  );
}
