import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { migracaoLegadoService as svc, type CasoLegado } from '../services/migracao-legado.service';
import { Bloco } from '../components/Bloco';
import { Botao } from '../components/Botao';
import { Chips } from '../components/Chips';
import { Metrica } from '../components/Metrica';
import { StatusBadge } from '../components/StatusBadge';
import { Tabela, type Coluna } from '../components/Tabela';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole } from '../lib/permissoes';
import { CASO_LEGADO_STATUS_COLORS, SITUACAO_LEGADO_COLORS } from '../config/statusColors';

// Migração do legado — F1 (doc 02 §26): a bancada. Lê o Asaas, monta um caso
// por cliente e ordena pela triagem do Luís (em dia primeiro; complicados por
// último). O operador vai ao PopHub nessa ordem. Nada aqui vira contrato.
// Layout v2 (doc 03 §11): indicadores em <Metrica tom="kpi"> clicáveis (todo
// dado é link — filtram a fila), filtros em <Chips>, fila em <Tabela>.

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

const inputStyle = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

// A fila é numerada (ordem da triagem): a linha carrega a posição.
type LinhaFila = { c: CasoLegado; i: number };

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
  // Indicador clicável filtra a fila; clicar de novo limpa o filtro.
  const filtrarSituacao = (v: string) => setFiltros({ ...filtros, situacao: filtros.situacao === v ? '' : v });
  const filtrarStatus = (v: string) => setFiltros({ ...filtros, status: filtros.status === v ? '' : v });

  const colunas: Coluna<LinhaFila>[] = [
    { chave: 'ordem', titulo: '#', celular: 'omitir', classe: 'tabular-nums', render: ({ i }) => <span style={{ color: 'var(--text-muted)' }}>{i}</span> },
    {
      chave: 'cliente',
      titulo: 'Cliente',
      celular: 'titulo',
      render: ({ c }) => <span style={{ color: c.status === 'DESCARTADO' ? 'var(--text-muted)' : 'var(--text-primary)' }}>{c.nome}</span>,
    },
    { chave: 'cpf', titulo: 'CPF/CNPJ · Asaas', celular: 'subtitulo', classe: 'tabular-nums', render: ({ c }) => `${cpfBR(c.cpfCnpj)} · ${c.asaasCustomerId}` },
    {
      chave: 'situacao',
      titulo: 'Situação',
      render: ({ c }) => (
        <span className="whitespace-normal">
          <StatusBadge label={c.situacaoRotulo} colors={{ [c.situacaoRotulo]: SITUACAO_LEGADO_COLORS[c.situacao] }} />
          {c.recente && <div className="mt-[3px] text-[10.5px] font-semibold" style={{ color: CASO_LEGADO_STATUS_COLORS.VALIDADO.fg }}>recente · sem parcela paga</div>}
        </span>
      ),
    },
    {
      chave: 'parcela',
      titulo: 'Parcela',
      celular: 'destaque',
      render: ({ c }) => (
        <span className="whitespace-normal">
          <div className="font-display font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{c.valorParcelaPadrao == null ? '—' : formatCurrency(c.valorParcelaPadrao)}</div>
          <div className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>{c.modeloRotulo ?? (c.valorParcelaPadrao == null ? '' : 'valor próprio do contrato')}</div>
        </span>
      ),
    },
    {
      chave: 'assinatura',
      titulo: 'Assinatura',
      render: ({ c }) => (
        <span className="whitespace-normal" style={{ color: c.assinaturaAtiva ? 'var(--text-body)' : 'var(--text-muted)' }}>
          {c.assinaturaValor == null ? '—' : `${formatCurrency(c.assinaturaValor)} ${CICLO[c.assinaturaCiclo ?? ''] ?? c.assinaturaCiclo ?? ''}`}
          <div className="text-[11px]">{c.assinaturaAtiva ? 'ativa' : c.assinaturaValor == null ? '' : 'inativa'}</div>
        </span>
      ),
    },
    { chave: 'pagas', titulo: 'Pagas', alinhar: 'right', classe: 'tabular-nums', render: ({ c }) => c.cobrancasPagas },
    { chave: 'abertas', titulo: 'Abertas', alinhar: 'right', classe: 'tabular-nums', render: ({ c }) => c.cobrancasPendentes },
    {
      chave: 'vencidas',
      titulo: 'Vencidas',
      alinhar: 'right',
      classe: 'tabular-nums',
      render: ({ c }) => <span style={{ color: c.cobrancasVencidas ? SITUACAO_LEGADO_COLORS.COM_VENCIDA.fg : undefined, fontWeight: c.cobrancasVencidas ? 700 : 400 }}>{c.cobrancasVencidas}</span>,
    },
    { chave: 'historico', titulo: 'Histórico', classe: 'tabular-nums', render: ({ c }) => `${dataBR(c.primeiraCobrancaEm)} → ${dataBR(c.ultimaCobrancaEm)}` },
    { chave: 'status', titulo: 'Status', render: ({ c }) => <StatusBadge label={c.statusRotulo} colors={{ [c.statusRotulo]: CASO_LEGADO_STATUS_COLORS[c.status] }} /> },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Coleta */}
      <Bloco
        titulo="Leitura do Asaas"
        tag={<>Fonte: <b>{AMBIENTE_ROTULO[r?.ambiente ?? ''] ?? r?.ambiente ?? '…'}</b></>}
        leitura={
          r?.coleta ? (
            r.coleta.emAndamento ? (
              <>Em andamento desde {dataHoraBR(r.coleta.iniciadaEm)} — <b>{r.coleta.clientesLidos}</b> clientes e <b>{r.coleta.cobrancasLidas}</b> cobranças lidas até agora.</>
            ) : r.coleta.erro ? (
              <>Última leitura em {dataHoraBR(r.coleta.iniciadaEm)} <b style={{ color: CASO_LEGADO_STATUS_COLORS.DESCARTADO.fg }}>falhou</b> após {r.coleta.clientesLidos} clientes: {r.coleta.erro}</>
            ) : (
              <>Última leitura concluída em {dataHoraBR(r.coleta.concluidaEm)}: <b>{r.coleta.clientesLidos}</b> clientes, <b>{r.coleta.cobrancasLidas}</b> cobranças ({r.coleta.casosNovos} casos novos, {r.coleta.casosAtualizados} atualizados).</>
            )
          ) : (
            <>Nenhuma leitura feita ainda — clique para montar a fila de casos.</>
          )
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-[12px]">
          <div className="min-w-0 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            Reler atualiza a triagem e as cobranças de cada caso; o que você já decidiu (status, observação) não é sobrescrito.
          </div>
          {podeOperar && (
            <Botao variante="primaria" tamanho="sm" onClick={() => void coletar()} disabled={emAndamento}>
              {emAndamento ? 'Lendo…' : r?.coleta ? 'Reler o Asaas' : 'Ler o Asaas'}
            </Botao>
          )}
        </div>
        <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-3 lg:grid-cols-6">
          <Metrica tom="kpi" label="Em dia (tratar primeiro)" valor={porSit.SEM_VENCIDA ?? 0} onClick={() => filtrarSituacao('SEM_VENCIDA')} ativo={filtros.situacao === 'SEM_VENCIDA'} />
          <Metrica tom="kpi" label="Com vencida" valor={porSit.COM_VENCIDA ?? 0} alerta={(porSit.COM_VENCIDA ?? 0) > 0} onClick={() => filtrarSituacao('COM_VENCIDA')} ativo={filtros.situacao === 'COM_VENCIDA'} />
          <Metrica tom="kpi" label="Sem movimento" valor={porSit.SEM_MOVIMENTO ?? 0} onClick={() => filtrarSituacao('SEM_MOVIMENTO')} ativo={filtros.situacao === 'SEM_MOVIMENTO'} />
          <Metrica tom="kpi" label="Em revisão" valor={porStatus.EM_REVISAO ?? 0} onClick={() => filtrarStatus('EM_REVISAO')} ativo={filtros.status === 'EM_REVISAO'} />
          <Metrica tom="kpi" label="Validados" valor={porStatus.VALIDADO ?? 0} onClick={() => filtrarStatus('VALIDADO')} ativo={filtros.status === 'VALIDADO'} />
          <Metrica tom="kpi" label="Migrados" valor={porStatus.MIGRADO ?? 0} onClick={() => filtrarStatus('MIGRADO')} ativo={filtros.status === 'MIGRADO'} />
        </div>
      </Bloco>

      {/* Filtros */}
      <div className="flex flex-col gap-[8px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <input
            type="search"
            className="min-h-[30px] w-full rounded-full px-[12px] text-[12.5px] sm:w-[280px]"
            style={inputStyle}
            placeholder="Buscar nome, CPF/CNPJ ou id do Asaas"
            aria-label="Buscar caso"
            value={filtros.busca}
            onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
          />
          <span className="ml-auto text-[12px]" style={{ color: 'var(--text-muted)' }}>{casos.length} caso(s) · ordem: em dia primeiro, depois menos vencidas</span>
        </div>
        <Chips
          tamanho="sm"
          todos="Todas as situações"
          itens={(r?.opcoes.situacao ?? []).map((o) => ({ chave: o.valor, rotulo: o.rotulo, contagem: porSit[o.valor] ?? 0 }))}
          valor={filtros.situacao || null}
          onChange={(k) => setFiltros({ ...filtros, situacao: k ?? '' })}
        />
        <Chips
          tamanho="sm"
          todos="Todos os status"
          itens={(r?.opcoes.status ?? []).map((o) => ({ chave: o.valor, rotulo: o.rotulo, contagem: porStatus[o.valor] ?? 0 }))}
          valor={filtros.status || null}
          onChange={(k) => setFiltros({ ...filtros, status: k ?? '' })}
        />
      </div>

      {/* Fila */}
      <Tabela
        colunas={colunas}
        linhas={casos.map((c, i) => ({ c, i: i + 1 }))}
        chave={({ c }) => c.id}
        carregando={lista.isLoading}
        larguraMinima={980}
        onClick={({ c }) => navigate(`/migracao-legado/${c.id}`)}
        vazio={r?.coleta ? 'Nenhum caso com esses filtros.' : 'Nenhum caso ainda — faça a primeira leitura do Asaas.'}
      />
    </div>
  );
}
