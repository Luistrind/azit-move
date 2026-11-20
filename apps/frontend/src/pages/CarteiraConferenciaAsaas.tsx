import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate, CLASSIFICACOES_CONFERENCIA_ASAAS, type ClassificacaoConferenciaAsaas } from '@azit/utils';
import { conferenciaAsaasService, type ItemRodadaConferencia, type LinhaConferenciaAsaas, type RodadaConferenciaAsaas } from '../services/conferencia-asaas.service';
import { Modal } from '../components/Modal';
import { ModalConfirmacao } from '../components/ModalConfirmacao';
import { Tabela, type Coluna } from '../components/Tabela';
import { StatusBadge } from '../components/StatusBadge';
import { Botao } from '../components/Botao';
import { toast } from '../components/Toast';
import { mensagemErro, AREAS_ROTA_FICHA_TITULAR } from '../lib/permissoes';
import { horaBR } from '../lib/datas';
import {
  COBRANCA_ASAAS_STATUS_LABEL,
  CONFERENCIA_ASAAS_COLORS,
  CONFERENCIA_ASAAS_LABEL,
  CONFERENCIA_BAIXA_COLORS,
  CONFERENCIA_BAIXA_LABEL,
  FATURA_SITUACAO_COLORS,
  FATURA_SITUACAO_LABEL,
} from '../config/statusColors';
import { LinkArea } from '../components/LinkArea';

// Conferência Asaas × sistema (doc 02 §27.9, 12/11/2026) — bloco da Carteira,
// aberto pela lista de vencidas. Composição de componentes GENÉRICOS (Modal,
// Tabela, StatusBadge, Botao, ModalConfirmacao); nenhum número ou classificação
// é calculado aqui — tudo vem do backend. Linhas `ok` ficam recolhidas; a única
// ação é "Reconciliar", só em `paga_no_asaas`, com confirmação, e ela ENFILEIRA
// a conciliação (202) — a fatura baixa quando o worker processar.

// Badge com rótulo em português e cor pela CHAVE (StatusBadge indexa pelo label).
const coresPorRotulo = (cores: Record<string, { bg: string; fg: string }>, rotulos: Record<string, string>) =>
  Object.fromEntries(Object.entries(cores).map(([k, c]) => [rotulos[k] ?? k, c]));
const CORES_CLASSIFICACAO = coresPorRotulo(CONFERENCIA_ASAAS_COLORS, CONFERENCIA_ASAAS_LABEL);
const CORES_SITUACAO = coresPorRotulo(FATURA_SITUACAO_COLORS, FATURA_SITUACAO_LABEL);

export function ConferenciaAsaasModal({ open, onClose, de, ate, rotulo }: {
  open: boolean;
  onClose: () => void;
  de?: string; // YYYY-MM-DD — sem `de`: desde o início
  ate?: string; // YYYY-MM-DD — sem `ate`: até ontem (tudo que está vencido)
  rotulo: string; // período como a Carteira o chama
}) {
  const queryClient = useQueryClient();
  const [mostrarOk, setMostrarOk] = useState(false);
  const [reconciliando, setReconciliando] = useState<LinhaConferenciaAsaas | null>(null);
  const [enviando, setEnviando] = useState(false);

  const conferencia = useQuery({
    queryKey: ['conferencia-asaas', de ?? '', ate ?? ''],
    queryFn: () => conferenciaAsaasService.conferir(de, ate),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const dados = conferencia.data;

  const linhas = useMemo(() => {
    const todas = dados?.linhas ?? [];
    const ordem = new Map(CLASSIFICACOES_CONFERENCIA_ASAAS.map((c, i) => [c, i]));
    return [...todas]
      .filter((l) => mostrarOk || l.classificacao !== 'ok')
      .sort((a, b) => (ordem.get(a.classificacao) ?? 99) - (ordem.get(b.classificacao) ?? 99) || a.vencimentoAqui.localeCompare(b.vencimentoAqui));
  }, [dados, mostrarOk]);
  const totalOk = dados?.porClassificacao.ok ?? 0;
  const divergentes = (dados?.total ?? 0) - totalOk;

  const reconciliar = async () => {
    if (!reconciliando) return;
    setEnviando(true);
    try {
      const r = await conferenciaAsaasService.reconciliar(reconciliando.faturaId);
      toast.sucesso(`Conciliação enfileirada: fatura #${reconciliando.numero} de ${reconciliando.titular}, pagamento de ${formatDate(r.job.paymentDate)} (${formatCurrency(r.job.valor)}). A fatura baixa quando o worker processar.`);
      setReconciliando(null);
      // A baixa é assíncrona: dá tempo ao worker, depois relê a conferência e a Carteira.
      window.setTimeout(() => {
        void conferencia.refetch();
        void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('carteira-visao') });
      }, 1500);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  };

  const diferente = (aqui: string, la: string) => aqui !== la;
  const colunas: Coluna<LinhaConferenciaAsaas>[] = [
    {
      chave: 'cliente',
      titulo: 'Cliente',
      render: (l) => <LinkArea area={AREAS_ROTA_FICHA_TITULAR} to={`/titulares/${l.titularId}`} style={{ color: 'var(--text-primary)' }}>{l.titular}</LinkArea>,
    },
    {
      chave: 'fatura',
      titulo: 'Fatura',
      celular: 'subtitulo',
      render: (l) => <span className="tabular-nums">#{l.numero} · <span style={{ color: 'var(--text-muted)' }}>{l.asaasChargeId}</span></span>,
    },
    {
      chave: 'vencimento',
      titulo: 'Vencimento',
      classe: 'tabular-nums',
      render: (l) => (
        <>
          {formatDate(l.vencimentoAqui)}
          {l.asaas && diferente(l.vencimentoAqui, l.asaas.vencimento) ? (
            <span className="block text-[11px]" style={{ color: 'var(--warn-fg)' }}>Asaas: {formatDate(l.asaas.vencimento)}</span>
          ) : null}
        </>
      ),
    },
    {
      chave: 'valor',
      titulo: 'Valor',
      alinhar: 'right',
      celular: 'destaque',
      classe: 'tabular-nums',
      render: (l) => (
        <>
          {formatCurrency(l.valorAqui)}
          {l.asaas && l.asaas.valor !== l.valorAqui ? (
            <span className="block text-[11px]" style={{ color: 'var(--purple-fg)' }}>Asaas: {formatCurrency(l.asaas.valor)}</span>
          ) : null}
        </>
      ),
    },
    {
      chave: 'aqui',
      titulo: 'Aqui',
      render: (l) => <StatusBadge label={FATURA_SITUACAO_LABEL[l.situacaoAqui === 'vencida' ? 'vencida' : 'em_aberto']} colors={CORES_SITUACAO} />,
    },
    {
      chave: 'asaas',
      titulo: 'No Asaas',
      render: (l) =>
        l.asaas ? (
          <>
            {COBRANCA_ASAAS_STATUS_LABEL[l.asaas.status] ?? l.asaas.status}
            <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {l.asaas.status}
              {l.asaas.dataPagamento ? ` · pago em ${formatDate(l.asaas.dataPagamento)}` : ''}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>não encontrada (404)</span>
        ),
    },
    {
      chave: 'classificacao',
      titulo: 'Conferência',
      render: (l) => <StatusBadge label={CONFERENCIA_ASAAS_LABEL[l.classificacao] ?? l.classificacao} colors={CORES_CLASSIFICACAO} />,
    },
  ];

  const resumo = (c: ClassificacaoConferenciaAsaas) => {
    const n = dados?.porClassificacao[c] ?? 0;
    if (!n) return null;
    const cor = CONFERENCIA_ASAAS_COLORS[c];
    return (
      <span key={c} className="inline-flex items-center gap-[5px] rounded-full px-[9px] py-[2px] text-[11.5px] font-semibold" style={{ background: cor.bg, color: cor.fg }}>
        {n} {CONFERENCIA_ASAAS_LABEL[c].toLowerCase()}
      </span>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={`Conferir com o Asaas · ${rotulo}`} largura={1040}>
      <div className="flex flex-col gap-[12px]">
        <ConferenciaAutomaticaBloco open={open} />
        <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-body)' }}>
          <b style={{ color: 'var(--text-primary)' }}>Conferir agora · {rotulo}.</b> Faturas <b>em aberto aqui</b> (abertas ou fechadas, com cobrança emitida){de ? ` vencendo de ${formatDate(de)}` : ''}{ate ? ` até ${formatDate(ate)}` : ''}, lidas uma a uma no Asaas.
          Nada é alterado no Asaas. <b>Reconciliar</b> só aparece quando o Asaas registra o pagamento e aqui a fatura segue em aberto — e enfileira a mesma conciliação do webhook.
        </div>

        {conferencia.isLoading ? (
          <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Consultando o Asaas cobrança por cobrança… (até alguns segundos por dezena de faturas)</div>
        ) : conferencia.isError ? (
          <div className="text-[13px]" style={{ color: 'var(--danger-fg)' }}>{mensagemErro(conferencia.error)}</div>
        ) : dados ? (
          <>
            <div className="flex flex-wrap items-center gap-[6px] text-[12px]" style={{ color: 'var(--text-body)' }}>
              <b style={{ color: 'var(--text-primary)' }}>{dados.total} {dados.total === 1 ? 'fatura' : 'faturas'}</b>
              {dados.total ? <span>·</span> : null}
              {CLASSIFICACOES_CONFERENCIA_ASAAS.map(resumo)}
              {dados.falhas.length ? (
                <span className="rounded-full px-[9px] py-[2px] text-[11.5px] font-semibold" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
                  {dados.falhas.length} sem leitura
                </span>
              ) : null}
              <span className="ml-auto text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {dados.ambiente === 'producao' ? 'Asaas produção' : dados.ambiente === 'sandbox' ? 'Asaas sandbox' : 'Asaas simulado'} · lido {horaBR(dados.consultadoEm)}
              </span>
              <Botao tamanho="sm" variante="fantasma" onClick={() => void conferencia.refetch()} carregando={conferencia.isFetching}>Atualizar</Botao>
            </div>

            {dados.falhas.length ? (
              <div className="rounded-card px-[12px] py-[8px] text-[12px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
                Não deu para ler no Asaas: {dados.falhas.map((f) => f.asaasChargeId).join(', ')}. Tente "Atualizar"; se persistir, a cobrança pode estar fora do alcance desta chave.
              </div>
            ) : null}

            <Tabela<LinhaConferenciaAsaas>
              colunas={colunas}
              linhas={linhas}
              chave={(l) => l.faturaId}
              larguraMinima={860}
              vazio={divergentes === 0 && totalOk > 0 ? `Tudo bate: ${totalOk} ${totalOk === 1 ? 'fatura conferida' : 'faturas conferidas'} com o Asaas.` : 'Nenhuma fatura em aberto com cobrança neste período.'}
              acoes={(l) => (
                <>
                  {l.asaas?.invoiceUrl ? (
                    <a href={l.asaas.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex h-[30px] items-center px-[8px] text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                      ver no Asaas ↗
                    </a>
                  ) : null}
                  {l.classificacao === 'paga_no_asaas' ? (
                    <Botao tamanho="sm" variante="primaria" onClick={() => setReconciliando(l)}>Reconciliar</Botao>
                  ) : null}
                </>
              )}
            />

            {totalOk > 0 && divergentes > 0 ? (
              <button type="button" onClick={() => setMostrarOk((m) => !m)} className="self-start text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                {mostrarOk ? 'recolher as conferidas' : `mostrar as ${totalOk} conferidas (batem com o Asaas)`}
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <ModalConfirmacao
        open={!!reconciliando}
        titulo="Reconciliar com o Asaas"
        confirmar="Reconciliar"
        variante="primaria"
        carregando={enviando}
        onConfirmar={() => void reconciliar()}
        onCancelar={() => setReconciliando(null)}
      >
        {reconciliando ? (
          <>
            O Asaas registra a cobrança <b>{reconciliando.asaasChargeId}</b> como <b>{COBRANCA_ASAAS_STATUS_LABEL[reconciliando.asaas?.status ?? ''] ?? reconciliando.asaas?.status}</b>
            {reconciliando.asaas?.dataPagamento ? <> em <b>{formatDate(reconciliando.asaas.dataPagamento)}</b></> : null}
            {reconciliando.asaas ? <> no valor de <b>{formatCurrency(reconciliando.asaas.valor)}</b></> : null}.
            <br />
            A fatura <b>#{reconciliando.numero}</b> de <b>{reconciliando.titular}</b> (vencimento {formatDate(reconciliando.vencimentoAqui)}, {formatCurrency(reconciliando.valorAqui)}) será conciliada pelo mesmo processo do webhook, com essa data e esse valor. Nada muda no Asaas.
          </>
        ) : null}
      </ModalConfirmacao>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Conferência AUTOMÁTICA diária (doc 02 §27.9.1, 18/11/2026). O resultado da
// última rodada: quando rodou, quantas faturas leu, quais baixou (e se o worker
// da conciliação já baixou) e o que ficou para o operador olhar. Nada é calculado
// aqui — vem tudo do backend. "Rodar agora" enfileira a mesma rodada (202).
const CORES_BAIXA = coresPorRotulo(CONFERENCIA_BAIXA_COLORS, CONFERENCIA_BAIXA_LABEL);
const SITUACAO_DA_RODADA: Record<ItemRodadaConferencia['situacao'], string> = { vencida: 'vencida', vence_hoje: 'vence_hoje', a_vencer: 'em_aberto' };
const ROTULO_NAO_BAIXADA = 'Paga no Asaas, não baixada';
const CORES_NAO_BAIXADA = { [ROTULO_NAO_BAIXADA]: CONFERENCIA_ASAAS_COLORS.removida_no_asaas };
const ambienteAsaas = (a: string) => (a === 'producao' ? 'Asaas produção' : a === 'sandbox' ? 'Asaas sandbox' : 'Asaas simulado');

type LinhaParaOlhar = ItemRodadaConferencia & { motivo?: string };

function ConferenciaAutomaticaBloco({ open }: { open: boolean }) {
  const queryClient = useQueryClient();
  const [enviando, setEnviando] = useState(false);
  const painel = useQuery({
    queryKey: ['conferencia-asaas-automatica'],
    queryFn: () => conferenciaAsaasService.painelAutomatica(),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const p = painel.data;
  const u = p?.ultima ?? null;

  const rodarAgora = async () => {
    setEnviando(true);
    try {
      await conferenciaAsaasService.rodarAutomaticaAgora();
      toast.sucesso('Rodada enfileirada. O resultado aparece aqui assim que o Asaas for lido (alguns segundos por dezena de faturas).');
      for (const ms of [4000, 12000, 30000]) {
        window.setTimeout(() => {
          void painel.refetch();
          void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('carteira-visao') || q.queryKey[0] === 'conferencia-asaas' });
        }, ms);
      }
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  };

  const cliente = (l: ItemRodadaConferencia) => (
    <LinkArea area={AREAS_ROTA_FICHA_TITULAR} to={`/titulares/${l.titularId}`} style={{ color: 'var(--text-primary)' }}>{l.titular}</LinkArea>
  );
  const fatura = (l: ItemRodadaConferencia) => <span className="tabular-nums">#{l.numero} · vence {formatDate(l.vencimento)}</span>;
  const colunasBaixadas: Coluna<RodadaConferenciaAsaas['baixadas'][number]>[] = [
    { chave: 'cliente', titulo: 'Cliente', render: cliente },
    { chave: 'fatura', titulo: 'Fatura', celular: 'subtitulo', render: fatura },
    { chave: 'pago', titulo: 'Pago no Asaas', classe: 'tabular-nums', render: (l) => formatDate(l.pagoEm) },
    { chave: 'valor', titulo: 'Valor pago', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums', render: (l) => formatCurrency(l.valorPago) },
    { chave: 'agora', titulo: 'Aqui agora', render: (l) => <StatusBadge label={CONFERENCIA_BAIXA_LABEL[l.situacaoAgora] ?? l.situacaoAgora} colors={CORES_BAIXA} /> },
  ];
  const colunasOlhar: Coluna<LinhaParaOlhar>[] = [
    { chave: 'cliente', titulo: 'Cliente', render: cliente },
    { chave: 'fatura', titulo: 'Fatura', celular: 'subtitulo', render: fatura },
    { chave: 'aqui', titulo: 'Aqui', render: (l) => <StatusBadge label={FATURA_SITUACAO_LABEL[SITUACAO_DA_RODADA[l.situacao]]} colors={CORES_SITUACAO} /> },
    {
      chave: 'asaas',
      titulo: 'No Asaas',
      render: (l) =>
        l.statusAsaas ? (
          <>
            {COBRANCA_ASAAS_STATUS_LABEL[l.statusAsaas] ?? l.statusAsaas}
            {l.valorAsaas !== null && l.valorAsaas !== l.valorAqui ? (
              <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatCurrency(l.valorAsaas)} (aqui {formatCurrency(l.valorAqui)})</span>
            ) : null}
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>não encontrada (404)</span>
        ),
    },
    {
      chave: 'classificacao',
      titulo: 'Conferência',
      render: (l) =>
        l.motivo ? (
          <>
            <StatusBadge label={ROTULO_NAO_BAIXADA} colors={CORES_NAO_BAIXADA} />
            <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{l.motivo}</span>
          </>
        ) : (
          <StatusBadge label={CONFERENCIA_ASAAS_LABEL[l.classificacao] ?? l.classificacao} colors={CORES_CLASSIFICACAO} />
        ),
    },
  ];
  const paraOlhar: LinhaParaOlhar[] = u ? [...u.naoBaixadas, ...u.divergencias] : [];

  return (
    <div className="flex flex-col gap-[8px] rounded-card px-[12px] py-[10px]" style={{ background: 'var(--surface-muted)' }}>
      <div className="flex flex-wrap items-center gap-[8px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
        <b style={{ color: 'var(--text-primary)' }}>Conferência automática</b>
        <span>· todo dia às {p?.horario ?? '…'}, a carteira inteira (vencidas, que vencem hoje e a vencer)</span>
        <Botao tamanho="sm" variante="secundaria" className="ml-auto" onClick={() => void rodarAgora()} carregando={enviando}>Rodar agora</Botao>
      </div>

      {painel.isLoading ? (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando a última rodada…</div>
      ) : painel.isError ? (
        <div className="text-[12px]" style={{ color: 'var(--danger-fg)' }}>{mensagemErro(painel.error)}</div>
      ) : !u ? (
        <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>Ainda não rodou. A primeira rodada acontece às {p?.horario} — ou use <b>Rodar agora</b>.</div>
      ) : (
        <>
          <div className="text-[12px] leading-relaxed" style={{ color: 'var(--text-body)' }}>
            Última rodada em <b>{formatDate(u.dia)} às {horaBR(u.concluidaEm)}</b> ({u.origem === 'manual' ? 'pedida na tela' : 'agendada'}, {ambienteAsaas(u.ambiente)}): leu{' '}
            <b>{u.lidas.total} {u.lidas.total === 1 ? 'fatura em aberto' : 'faturas em aberto'}</b> com cobrança — {u.lidas.vencidas} vencidas, {u.lidas.venceHoje} que vencem no dia e {u.lidas.aVencer} a vencer.{' '}
            {u.baixadas.length ? (
              <><b>{u.baixadas.length}</b> {u.baixadas.length === 1 ? 'estava paga no Asaas e foi baixada' : 'estavam pagas no Asaas e foram baixadas'} pela mesma conciliação do webhook. </>
            ) : (
              'Nenhuma estava paga no Asaas e aberta aqui. '
            )}
            {paraOlhar.length ? (
              <><b>{paraOlhar.length}</b> {paraOlhar.length === 1 ? 'ficou' : 'ficaram'} para olhar{u.divergenciasNovas ? ` (${u.divergenciasNovas} ${u.divergenciasNovas === 1 ? 'nova' : 'novas'} desde a rodada anterior)` : ''} — essas o sistema não corrige sozinho.</>
            ) : (
              'Nada ficou para olhar.'
            )}
            {u.semLeitura.length ? (
              <> <span style={{ color: 'var(--danger-fg)' }}>Não deu para ler {u.semLeitura.length}: {u.semLeitura.map((s) => s.asaasChargeId).join(', ')}.</span></>
            ) : null}
          </div>
          {u.baixadas.length ? <Tabela colunas={colunasBaixadas} linhas={u.baixadas} chave={(l) => l.faturaId} larguraMinima={700} /> : null}
          {paraOlhar.length ? <Tabela colunas={colunasOlhar} linhas={paraOlhar} chave={(l) => `${l.faturaId}-${l.classificacao}-${l.motivo ? 'nb' : 'd'}`} larguraMinima={760} /> : null}
          {p && p.anteriores.length ? (
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Antes: {p.anteriores.map((a) => `${formatDate(a.dia)} leu ${a.lidas}, baixou ${a.baixadas}, ${a.divergencias} para olhar${a.semLeitura ? `, ${a.semLeitura} sem leitura` : ''}`).join(' · ')}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
