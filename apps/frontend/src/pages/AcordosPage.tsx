import { instanteBR, horaBR } from '../lib/datas';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import {
  operacoesService,
  type Acordo,
  type AcordoDetalhe,
  type AprovacaoResumo,
  type ContratoNovacao,
  type Novacao,
  type NovacaoDetalhe,
} from '../services/operacoes.service';
import { StatusBadge } from '../components/StatusBadge';
import { Trilha } from '../components/Trilha';
import { Metrica, Campo } from '../components/Metrica';
import { BlocoDecomposicao } from '../components/NovacaoDecomposicao';
import {
  ACORDO_STATUS_COLORS,
  NOVACAO_STATUS_COLORS,
  PARCELA_STATUS_COLORS,
  FATURA_SITUACAO_COLORS,
  FATURA_SITUACAO_LABEL,
  CONTRATO_STATUS_COLORS,
} from '../config/statusColors';
import { ROTULO_STATUS_CONTRATO } from '../lib/rotulos';
import { usePodeRole, ROLE_RENEGOCIACAO, ROLE_NOVACAO, mensagemErro } from '../lib/permissoes';
import { toast } from '../components/Toast';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';

const LABEL_STATUS: Record<string, string> = {
  rascunho: 'Aguardando aprovação',
  aguardando_entrada: 'Aguardando entrada',
  ativo: 'Ativo',
  cumprido: 'Cumprido',
  novado: 'Novado', // saldo absorvido por uma novação (F2, 14/09)
  cancelado: 'Cancelado',
  expirado: 'Expirado',
};

// Novação ≠ Acordo (Regra 5): rótulos próprios. F2 (14/09): fluxo completo.
const LABEL_STATUS_NOVACAO: Record<string, string> = {
  rascunho: 'Aguardando aprovação',
  aguardando_assinatura: 'Aguardando assinatura',
  aguardando_recebimento: 'Aguardando recebimento',
  ativo: 'Ativa',
  cancelado: 'Cancelada',
  expirado: 'Expirada',
};

// Em andamento × histórico (feedback Luís 21/10 — mesma divisão da Central de
// Aprovações). Novação ATIVA é operação concluída: os contratos novos é que
// seguem vivos — por isso ela fica no histórico.
const ACORDO_EM_ANDAMENTO = new Set(['rascunho', 'aguardando_entrada', 'ativo']);
const NOVACAO_EM_ANDAMENTO = new Set(['rascunho', 'aguardando_assinatura', 'aguardando_recebimento']);

const PERIODICIDADE_LABEL: Record<string, string> = { semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'mensal' };
const ENTRADA_SITUACAO: Record<string, { label: string; cor: string }> = {
  sem_entrada: { label: 'Sem entrada', cor: 'var(--text-muted)' },
  paga: { label: 'Paga', cor: '#1f9d5b' },
  aguardando: { label: 'Aguardando pagamento', cor: '#c98a0a' },
  aguardando_aprovacao: { label: 'Aguardando aprovação', cor: 'var(--text-muted)' },
  expirada: { label: 'Venceu sem pagamento', cor: '#e0413c' },
  nao_paga: { label: 'Não paga', cor: '#e0413c' },
};
const RECEBIMENTO_SITUACAO: Record<string, { label: string; cor: string }> = {
  sem_recebimento: { label: 'Sem recebimento inicial', cor: 'var(--text-muted)' },
  pago: { label: 'Pago', cor: '#1f9d5b' },
  aguardando: { label: 'Aguardando pagamento', cor: '#c98a0a' },
  expirado: { label: 'Venceu sem pagamento', cor: '#e0413c' },
  pendente: { label: 'Ainda não cobrado', cor: 'var(--text-muted)' },
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

// 'YYYY-MM-DD' → dd/mm/aaaa (data-calendário, sem fuso).
const fmtDia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
// Instante ISO → dd/mm/aa hh:mm no relógio do operador.
const fmtDataHora = (iso: string | null | undefined) =>
  iso ? instanteBR(iso) + ' ' + horaBR(iso) : '—';

const card = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const th = 'py-[7px] pr-[10px] text-left font-semibold';
const thR = 'py-[7px] pl-[10px] text-right font-semibold';

// Acompanhamento de acordos e novações. A CRIAÇÃO nasce da ficha do titular
// (Renegociar atraso / Novação) — aqui é esteira: status, entrada, efetivação
// e, desde 21/10, o DETALHE de cada operação (o que cobriu, o que gerou, a
// trilha), na mesma clareza da Central de Aprovações.
export function AcordosPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const pode = usePodeRole();
  const podeRenegociar = pode(ROLE_RENEGOCIACAO);
  const podeNovar = pode(ROLE_NOVACAO);
  const [ocupado, setOcupado] = useState(false);
  const [aba, setAba] = useState<'andamento' | 'historico'>('andamento');
  // Detalhe aberto: 'acordo:<id>' | 'novacao:<id>' — um por vez, como um dossiê.
  const [aberto, setAberto] = useState<string | null>(null);

  const acordos = useQuery({ queryKey: ['acordos'], queryFn: () => operacoesService.acordos() });
  const novacoes = useQuery({ queryKey: ['novacoes'], queryFn: () => operacoesService.novacoes() });

  // Links de fora (ficha do titular, página do contrato, sino): ?titular=, ?acordo=, ?novacao=.
  const filtroTitular = params.get('titular');
  const abrirAcordo = params.get('acordo');
  const abrirNovacao = params.get('novacao');
  useEffect(() => {
    if (abrirAcordo && acordos.data) {
      const a = acordos.data.find((x) => x.id === abrirAcordo);
      if (a) { setAba(ACORDO_EM_ANDAMENTO.has(a.status) ? 'andamento' : 'historico'); setAberto(`acordo:${a.id}`); }
    } else if (abrirNovacao && novacoes.data) {
      const n = novacoes.data.find((x) => x.id === abrirNovacao);
      if (n) { setAba(NOVACAO_EM_ANDAMENTO.has(n.status) ? 'andamento' : 'historico'); setAberto(`novacao:${n.id}`); }
    }
  }, [abrirAcordo, abrirNovacao, acordos.data, novacoes.data]);

  const nomeTitularFiltro = useMemo(() => {
    if (!filtroTitular) return null;
    return acordos.data?.find((a) => a.titularId === filtroTitular)?.titular ?? novacoes.data?.find((n) => n.titularId === filtroTitular)?.titular ?? null;
  }, [filtroTitular, acordos.data, novacoes.data]);

  // Listas do titular filtrado (ou todas), separadas em andamento × histórico.
  const acordosDoFiltro = useMemo(() => (acordos.data ?? []).filter((a) => !filtroTitular || a.titularId === filtroTitular), [acordos.data, filtroTitular]);
  const novacoesDoFiltro = useMemo(() => (novacoes.data ?? []).filter((n) => !filtroTitular || n.titularId === filtroTitular), [novacoes.data, filtroTitular]);
  const acordosLista = useMemo(() => acordosDoFiltro.filter((a) => ACORDO_EM_ANDAMENTO.has(a.status) === (aba === 'andamento')), [acordosDoFiltro, aba]);
  const novacoesLista = useMemo(() => novacoesDoFiltro.filter((n) => NOVACAO_EM_ANDAMENTO.has(n.status) === (aba === 'andamento')), [novacoesDoFiltro, aba]);
  const nAndamento = acordosDoFiltro.filter((a) => ACORDO_EM_ANDAMENTO.has(a.status)).length + novacoesDoFiltro.filter((n) => NOVACAO_EM_ANDAMENTO.has(n.status)).length;
  const nHistorico = acordosDoFiltro.length + novacoesDoFiltro.length - nAndamento;

  async function refetch() {
    await new Promise((r) => setTimeout(r, 700));
    await queryClient.invalidateQueries({ queryKey: ['acordos'] });
    await queryClient.invalidateQueries({ queryKey: ['novacoes'] });
    await queryClient.invalidateQueries({ queryKey: ['acordo-detalhe'] });
    await queryClient.invalidateQueries({ queryKey: ['novacao-detalhe'] });
    await queryClient.invalidateQueries({ queryKey: ['contratos'] });
    await queryClient.invalidateQueries({ queryKey: ['aprovacoes-contagem'] });
  }

  async function simularRecebimento(novacaoId: string) {
    setOcupado(true);
    try {
      await operacoesService.simularRecebimentoNovacao(novacaoId);
      await refetch();
      toast.sucesso('Recebimento simulado — a ativação atômica roda no worker.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function efetivar(acordoId: string) {
    setOcupado(true);
    try {
      await operacoesService.simularEntrada(acordoId);
      await refetch();
      toast.sucesso('Entrada simulada — acordo efetivado.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  function alternar(chave: string) {
    setAberto((atual) => (atual === chave ? null : chave));
  }

  const carregando = acordos.isLoading || novacoes.isLoading;

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Auditoria 15/09 (Bloco D): os banners descreviam o caminho SEM link —
          o operador lia "ficha do titular" e tinha que achar sozinho. */}
      {podeRenegociar && (
        <div className="rounded-[12px] px-[16px] py-[12px] text-[12.5px]" style={{ background: '#eaf1fb', color: 'var(--navy)' }}>
          💡 A renegociação nasce da <b>ficha do titular</b> (botão "Renegociar atraso") — ela cobre as
          parcelas em atraso de todos os contratos da conta e passa pela Central de Aprovações.{' '}
          <button onClick={() => navigate('/carteira')} className="font-semibold underline">Abrir a carteira →</button>
        </div>
      )}
      {podeNovar && (
        <div className="rounded-[12px] px-[16px] py-[12px] text-[12.5px]" style={{ background: '#eaf1fb', color: 'var(--navy)' }}>
          💡 A novação também nasce da <b>ficha do titular</b> (botão "Novação (prévia do saldo)"):
          o sistema decompõe o saldo da conta por produto — parte do veículo × demais produtos — e a
          proposta dos dois contratos será montada a partir daí.{' '}
          <button onClick={() => navigate('/carteira')} className="font-semibold underline">Abrir a carteira →</button>
        </div>
      )}

      {/* Abas (mesmo padrão da Central): em andamento × histórico */}
      <div className="flex flex-wrap items-center gap-[10px]">
        {(['andamento', 'historico'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className="h-[32px] rounded-[9px] px-[14px] text-[12.5px] font-semibold"
            style={aba === t ? { background: 'var(--navy)', color: '#fff' } : { background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)' }}
          >
            {t === 'andamento' ? `Em andamento${acordos.data && novacoes.data ? ` (${nAndamento})` : ''}` : `Histórico${acordos.data && novacoes.data ? ` (${nHistorico})` : ''}`}
          </button>
        ))}
        {filtroTitular && (
          <span className="inline-flex items-center gap-[8px] rounded-[9px] px-[10px] py-[6px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>
            Só de <b>{nomeTitularFiltro ?? 'um titular'}</b>
            <button onClick={() => { params.delete('titular'); setParams(params, { replace: true }); }} className="font-semibold" style={{ color: 'var(--navy)' }} title="Ver todos">×</button>
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          {aba === 'andamento' ? 'Aguardando aprovação, entrada, assinatura ou recebimento, e acordos ativos.' : 'Acordos cumpridos, novados, cancelados ou expirados e novações concluídas, canceladas ou expiradas.'}
        </span>
      </div>

      {carregando && <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>}

      {/* Acordos */}
      {!carregando && (
        <section className="flex flex-col gap-[10px]">
          <div className="font-display text-[13px] font-bold">Acordos de pagamento ({acordosLista.length})</div>
          {acordosLista.length === 0 ? (
            <div className="rounded-[14px] py-[22px] text-center text-[12.5px]" style={{ ...card, color: 'var(--text-muted)' }}>
              {aba === 'andamento' ? 'Nenhum acordo em andamento.' : 'Nenhum acordo no histórico.'}
            </div>
          ) : (
            acordosLista.map((a) => (
              <CardAcordo
                key={a.id}
                a={a}
                aberto={aberto === `acordo:${a.id}`}
                onAlternar={() => alternar(`acordo:${a.id}`)}
                onTitular={() => navigate(`/titulares/${a.titularId}`)}
                onContrato={(id) => navigate(`/contratos/${id}`)}
                acaoDev={
                  (a.status === 'aguardando_entrada' || a.status === 'rascunho') && podeRenegociar && FERRAMENTAS_TESTE ? (
                    <button onClick={() => efetivar(a.id)} disabled={ocupado} className="rounded-[7px] px-[12px] py-[5px] text-[11.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>
                      Simular entrada (dev)
                    </button>
                  ) : null
                }
              />
            ))
          )}
        </section>
      )}

      {/* Novações (F2 — conta-cêntrica: 2 contratos assinados juntos) */}
      {!carregando && (
        <section className="flex flex-col gap-[10px]">
          <div className="font-display text-[13px] font-bold">Novações ({novacoesLista.length})</div>
          {novacoesLista.length === 0 ? (
            <div className="rounded-[14px] py-[22px] text-center text-[12.5px]" style={{ ...card, color: 'var(--text-muted)' }}>
              {aba === 'andamento' ? 'Nenhuma novação em andamento — ela nasce da ficha do titular.' : 'Nenhuma novação no histórico.'}
            </div>
          ) : (
            novacoesLista.map((nv) => (
              <CardNovacao
                key={nv.id}
                nv={nv}
                aberto={aberto === `novacao:${nv.id}`}
                onAlternar={() => alternar(`novacao:${nv.id}`)}
                onTitular={() => navigate(`/titulares/${nv.titularId}`)}
                onContrato={(id) => navigate(`/contratos/${id}`)}
                podeEditar={podeNovar}
                onAlterada={refetch}
                acaoDev={
                  nv.status === 'aguardando_recebimento' && podeNovar && FERRAMENTAS_TESTE ? (
                    <button onClick={() => simularRecebimento(nv.id)} disabled={ocupado} className="rounded-[7px] px-[12px] py-[5px] text-[11.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>
                      Simular recebimento (dev)
                    </button>
                  ) : null
                }
              />
            ))
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card do ACORDO — título humano, contexto no card, detalhe sob demanda.
function CardAcordo({ a, aberto, onAlternar, onTitular, onContrato, acaoDev }: {
  a: Acordo; aberto: boolean; onAlternar: () => void; onTitular: () => void; onContrato: (id: string) => void; acaoDev: React.ReactNode;
}) {
  const periodicidade = PERIODICIDADE_LABEL[a.periodicidade] ?? a.periodicidade;
  return (
    <div className="rounded-[14px] p-[16px]" style={card}>
      <div className="flex flex-wrap items-start gap-[12px]">
        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-center gap-[8px]">
            <span className="rounded-[6px] px-[8px] py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em]" style={{ background: 'var(--surface-input)', color: 'var(--text-label)' }}>Acordo</span>
            {a.origem === 'legado' && (
              <span className="rounded-[6px] px-[8px] py-[3px] text-[10.5px] font-semibold" style={{ background: '#eef4ff', color: '#2456c7' }} title="Acordo que já existia no Asaas e foi importado pela migração do legado">importado do legado</span>
            )}
            <StatusBadge label={LABEL_STATUS[a.status] ?? a.status} colors={ACORDO_STATUS_COLORS} />
          </div>
          <div className="mt-[6px] text-[14px] font-bold">
            Acordo de {a.numeroParcelasNovas} parcelas de {formatCurrency(a.valorParcelaNova)} ({periodicidade})
            {a.valorEntrada > 0 ? <span className="font-semibold" style={{ color: 'var(--text-body)' }}> · entrada {formatCurrency(a.valorEntrada)}</span> : <span className="font-semibold" style={{ color: 'var(--text-muted)' }}> · sem entrada</span>}
          </div>
          <div className="mt-[3px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <button onClick={onTitular} className="font-semibold" style={{ color: 'var(--navy)' }}>{a.titular}</button>
            {a.contratos.map((c) => (
              <span key={c.id}>
                {' · '}
                <button onClick={() => onContrato(c.id)} className="font-semibold" style={{ color: 'var(--navy)' }} title={c.descricao}>{c.numero}</button>
                {c.placa ? ` (${c.placa})` : c.descricao === 'Reembolso Parcelado' ? ' (reembolso)' : ''}
              </span>
            ))}
            {a.contratos.length === 0 && ' · contratos definidos na efetivação'}
          </div>
          <div className="mt-[2px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {a.origem === 'legado' ? `firmado no legado em ${instanteBR(a.dataCriacao)} · importado por ${a.criadoPor}` : `proposto por ${a.criadoPor} em ${fmtDataHora(a.dataCriacao)}`}
            {a.dataEfetivacao && a.origem !== 'legado' ? ` · efetivado em ${fmtDataHora(a.dataEfetivacao)}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[16px] font-bold tabular-nums">{formatCurrency(a.valorTotalRenegociado)}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>renegociado na data-base</div>
        </div>
      </div>
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px] border-t pt-[10px]" style={{ borderColor: 'var(--border-light)' }}>
        <button onClick={onAlternar} className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold" style={{ background: aberto ? 'var(--navy)' : 'var(--surface-input)', color: aberto ? '#fff' : 'var(--text-primary)' }}>
          {aberto ? '▴ Ocultar detalhe' : '▾ Ver detalhe — parcelas cobertas, entrada, cotas e trilha'}
        </button>
        <div className="flex-1" />
        {acaoDev}
      </div>
      {aberto && <DetalheAcordo id={a.id} onContrato={onContrato} />}
    </div>
  );
}

function DetalheAcordo({ id, onContrato }: { id: string; onContrato: (id: string) => void }) {
  const navigate = useNavigate();
  const det = useQuery({ queryKey: ['acordo-detalhe', id], queryFn: () => operacoesService.acordo(id) });
  if (det.isLoading) return <div className="mt-[12px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando o detalhe…</div>;
  if (det.isError || !det.data) return <div className="mt-[12px] text-[12px]" style={{ color: '#c0392b' }}>Não foi possível carregar o detalhe: {det.error ? mensagemErro(det.error) : 'tente de novo'}</div>;
  const d: AcordoDetalhe = det.data;
  const r = d.resumoCotas;
  const entradaSit = ENTRADA_SITUACAO[d.entrada.situacao] ?? { label: d.entrada.situacao, cor: 'var(--text-muted)' };
  const periodicidade = PERIODICIDADE_LABEL[d.plano.periodicidade] ?? d.plano.periodicidade;

  return (
    <div className="mt-[14px] flex flex-col gap-[16px]">
      {/* Resumo em números */}
      <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-3 lg:grid-cols-6">
        <Metrica label="Renegociado" valor={formatCurrency(d.plano.valorTotalRenegociado)} />
        <Metrica label="Entrada" valor={d.plano.valorEntrada > 0 ? formatCurrency(d.plano.valorEntrada) : '—'} />
        <Metrica label="Plano" valor={`${d.plano.numeroParcelasNovas} × ${formatCurrency(d.plano.valorParcelaNova)}`} />
        <Metrica label="Pago nas cotas" valor={formatCurrency(r.valorPago)} />
        <Metrica label="A pagar" valor={formatCurrency(r.valorAPagar)} />
        <Metrica label="Vencido" valor={formatCurrency(r.valorVencido)} alerta={r.valorVencido > 0} />
      </div>

      {/* O que o acordo cobriu */}
      <Secao titulo={`${d.coberturaPrevista ? 'O que o acordo vai cobrir (seleção aprovada na proposta)' : 'O que o acordo cobriu'} — ${d.totaisCobertura.quantidadeParcelas} parcela(s) em ${d.totaisCobertura.quantidadeFaturas} fatura(s)`}>
        {d.faturasCobertas.length === 0 && d.cobertasSemFatura.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {d.status === 'rascunho' || d.status === 'aguardando_entrada'
              ? 'Proposta sem faturas selecionadas no snapshot — as parcelas recebem o vínculo do acordo na efetivação (pagamento da entrada).'
              : 'Nenhuma parcela vinculada a este acordo.'}
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {d.coberturaPrevista && (
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                As parcelas abaixo recebem o vínculo do acordo na efetivação (pagamento da entrada); até lá seguem com a situação própria e a cobrança original.
              </div>
            )}
            {d.faturasCobertas.map((f) => (
              <div key={f.id} className="rounded-[10px] p-[10px]" style={{ background: 'var(--surface-input)' }}>
                <div className="flex flex-wrap items-center gap-[8px] text-[12px]">
                  <span className="font-bold">Fatura #{f.numero}</span>
                  <span style={{ color: 'var(--text-muted)' }}>venceu em {fmtDia(f.dataVencimento)} · {f.diasAtrasoNaDataBase} dia(s) de atraso na data-base</span>
                  <StatusBadge label={FATURA_SITUACAO_LABEL[f.status] ?? f.status} colors={FATURA_SITUACAO_COLORS} />
                  <span className="ml-auto font-semibold tabular-nums">total {formatCurrency(f.valorTotal)}</span>
                </div>
                <table className="mt-[6px] w-full text-[12px]">
                  <tbody>
                    {f.parcelas.map((p) => (
                      <tr key={p.parcelaId} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="py-[5px] pr-[8px] font-semibold">Parcela {p.display}</td>
                        <td className="py-[5px] pr-[8px]" style={{ color: 'var(--text-body)' }}>
                          <button onClick={() => onContrato(p.contratoId)} className="font-semibold" style={{ color: 'var(--navy)' }}>{p.contratoNumero}</button> · {p.produto}
                        </td>
                        <td className="py-[5px] pr-[8px] tabular-nums" style={{ color: 'var(--text-muted)' }}>venc. {fmtDia(p.dataVencimento)} · {p.diasAtrasoNaDataBase} dia(s){p.encargoMoraNaDataBase > 0 ? ` · mora ${formatCurrency(p.encargoMoraNaDataBase)}` : ''}</td>
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
            {d.cobertasSemFatura.length > 0 && (
              <div className="rounded-[10px] p-[10px] text-[12px]" style={{ background: 'var(--surface-input)' }}>
                <div className="font-bold">Parcelas cobertas sem fatura</div>
                {d.cobertasSemFatura.map((p) => (
                  <div key={p.parcelaId} className="flex justify-between py-[3px]">
                    <span>Parcela {p.display} · {p.contratoNumero} · venc. {fmtDia(p.dataVencimento)} · {p.diasAtrasoNaDataBase} dia(s)</span>
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
        )}
      </Secao>

      {/* Seleção aprovada: exclusões com justificativa e vincendas incluídas (snapshot) */}
      {(d.exclusoes.length > 0 || d.vincendasIncluidas.length > 0) && (
        <Secao titulo="Seleção aprovada na proposta">
          {d.exclusoes.length > 0 && (
            <ul className="flex flex-col gap-[3px] text-[12px]">
              {d.exclusoes.map((e) => (
                <li key={e.faturaId} className="flex items-start gap-[6px]">
                  <span style={{ color: '#c98a0a' }}>⚠</span>
                  <span>
                    Fatura {e.numero !== null ? `#${e.numero}` : ''} {e.dataVencimento ? `de ${fmtDia(e.dataVencimento)}` : ''}{e.valorTotal !== null ? ` (${formatCurrency(e.valorTotal)})` : ''} <b>excluída</b> — {e.justificativa}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d.vincendasIncluidas.length > 0 && (
            <ul className="mt-[4px] flex flex-col gap-[3px] text-[12px]">
              {d.vincendasIncluidas.map((v) => (
                <li key={v.faturaId}>Fatura vincenda {v.numero !== null ? `#${v.numero}` : ''} {v.dataVencimento ? `de ${fmtDia(v.dataVencimento)}` : ''} <b>incluída</b> por opção do operador (entra pelo nominal, sem mora).</li>
              ))}
            </ul>
          )}
        </Secao>
      )}

      {/* Entrada */}
      <Secao titulo="Entrada">
        <div className="grid grid-cols-2 gap-[8px] text-[12px] sm:grid-cols-5">
          <Campo label="Valor" valor={d.entrada.valor > 0 ? formatCurrency(d.entrada.valor) : 'sem entrada'} />
          <Campo label="Situação"><span className="font-semibold" style={{ color: entradaSit.cor }}>{entradaSit.label}</span></Campo>
          <Campo label="Data-limite" valor={instanteBR(d.entrada.dataLimite)} />
          <Campo label="Paga em" valor={d.entrada.pagaEm ? fmtDataHora(d.entrada.pagaEm) : '—'} />
          <Campo label="Cobrança no Asaas" valor={d.entrada.cobrancaAsaasId ?? '—'} />
        </div>
        {d.aceiteWhatsapp && (
          <div className="mt-[6px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>De acordo do cliente pelo WhatsApp confirmado pelo operador em {fmtDataHora(d.aceiteWhatsapp.confirmadoPeloOperadorEm)}.</div>
        )}
        {d.temTermoAntigo && <div className="mt-[4px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Acordo anterior a 09/09: possui termo de confissão gravado no histórico.</div>}
      </Secao>

      {/* Cálculo do plano (motor do Catálogo ou placeholder) */}
      {d.calculo && (
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
      )}

      {/* Cotas novas */}
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
                      <td className="py-[6px] pr-[10px]"><button onClick={() => onContrato(c.contratoId)} className="font-semibold" style={{ color: 'var(--navy)' }}>{c.contratoNumero}</button></td>
                      <td className="py-[6px] pr-[10px] tabular-nums">{fmtDia(c.dataVencimento)}</td>
                      <td className="py-[6px] pl-[10px] text-right tabular-nums">{formatCurrency(c.valorNominal)}</td>
                      <td className="py-[6px] pl-[10px]" style={{ color: 'var(--text-body)' }}>{c.fatura ? `#${c.fatura.numero} · ${fmtDia(c.fatura.dataVencimento)}` : <span style={{ color: 'var(--text-muted)' }}>ainda sem fatura</span>}</td>
                      <td className="py-[6px] pr-[10px] tabular-nums">{c.dataPagamento ? `${fmtDia(c.dataPagamento)}${c.valorEncargo > 0 ? ` (+${formatCurrency(c.valorEncargo)} de juros)` : ''}` : '—'}</td>
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
              {r.valorVencido > 0 && <span style={{ color: '#e0413c' }}>Vencido: <b className="tabular-nums">{formatCurrency(r.valorVencido)}</b></span>}
            </div>
            <div className="mt-[4px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              Cota vencida é parcela vencida do contrato: conta como atraso na régua de cobrança e na carteira. As parcelas cobertas não contam enquanto o acordo estiver ativo.
            </div>
          </>
        )}
      </Secao>

      {/* Origem legado */}
      {d.legado && (
        <Secao titulo="Importado do legado (Asaas)">
          <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>
            Declarado na migração: parcelas {d.legado.parcelasCobertasDeclaradas.join(', ')} cobertas · cotas de {fmtDia(d.legado.primeiraCotaEm)} a {fmtDia(d.legado.ultimaCotaEm)}.{' '}
            <button onClick={() => navigate(`/migracao-legado/${d.legado!.casoId}`)} className="font-semibold" style={{ color: 'var(--navy)' }}>Abrir o caso de migração →</button>
          </div>
          {d.observacao && <div className="mt-[4px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{d.observacao}</div>}
        </Secao>
      )}
      {!d.legado && d.observacao && <Secao titulo="Observação"><div className="text-[12px]">{d.observacao}</div></Secao>}

      {/* Trilha */}
      <Secao titulo="Trilha">
        <Trilha eventos={d.trilha} />
        {d.aprovacao && <LinhaAprovacao ap={d.aprovacao} />}
        {d.novacaoId && (
          <button onClick={() => navigate(`/acordos?novacao=${d.novacaoId}`)} className="mt-[6px] text-[12px] font-semibold" style={{ color: 'var(--navy)' }}>Ver a novação que absorveu este acordo →</button>
        )}
      </Secao>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card da NOVAÇÃO.
function CardNovacao({ nv, aberto, onAlternar, onTitular, onContrato, podeEditar, onAlterada, acaoDev }: {
  nv: Novacao; aberto: boolean; onAlternar: () => void; onTitular: () => void; onContrato: (id: string) => void;
  podeEditar: boolean; onAlterada: () => Promise<void>; acaoDev: React.ReactNode;
}) {
  const total = nv.saldoVeiculo + nv.saldoDemais;
  return (
    <div className="rounded-[14px] p-[16px]" style={card}>
      <div className="flex flex-wrap items-start gap-[12px]">
        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-center gap-[8px]">
            <span className="rounded-[6px] px-[8px] py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em]" style={{ background: 'var(--surface-input)', color: 'var(--text-label)' }}>Novação</span>
            {nv.contratoUnico && <span className="rounded-[6px] px-[8px] py-[3px] text-[10.5px] font-semibold" style={{ background: '#eef4ff', color: '#2456c7' }} title="Um só contrato de Compra Parcelada com o valor global (adaptação 13/10)">contrato único</span>}
            <StatusBadge label={LABEL_STATUS_NOVACAO[nv.status] ?? nv.status} colors={NOVACAO_STATUS_COLORS} />
          </div>
          <div className="mt-[6px] text-[14px] font-bold">
            Novação de {formatCurrency(total)} em parcela única de {formatCurrency(nv.valorParcela)}{nv.frequencia ? ` (${PERIODICIDADE_LABEL[nv.frequencia] ?? nv.frequencia})` : ''}
          </div>
          <div className="mt-[3px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <button onClick={onTitular} className="font-semibold" style={{ color: 'var(--navy)' }}>{nv.titular}</button>
            {nv.veiculo ? ` · ${nv.veiculo.descricao}${nv.veiculo.placa ? ` (${nv.veiculo.placa})` : ''}` : ''}
            {nv.contratosOrigem.length > 0 ? ` · substitui ${nv.contratosOrigem.join(', ')}` : ''}
          </div>
          <div className="mt-[2px] flex flex-wrap items-center gap-x-[10px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <span>proposta por {nv.criadaPor} em {fmtDataHora(nv.criadaEm)}{nv.dataAtivacao ? ` · ativada em ${fmtDataHora(nv.dataAtivacao)}` : ''}</span>
            {nv.contratoVeiculo && <button onClick={() => onContrato(nv.contratoVeiculo!.id)} className="font-semibold" style={{ color: 'var(--navy)' }}>{nv.contratoVeiculo.numero} · veículo</button>}
            {nv.contratoTermo && <button onClick={() => onContrato(nv.contratoTermo!.id)} className="font-semibold" style={{ color: 'var(--navy)' }}>{nv.contratoTermo.numero} · termo</button>}
            {!nv.contratoVeiculo && !nv.contratoTermo && <span>contratos nascem na aprovação</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[16px] font-bold tabular-nums">{formatCurrency(total)}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>veículo {formatCurrency(nv.saldoVeiculo)} · termo {formatCurrency(nv.saldoDemais)}</div>
          <div className="mt-[4px] text-[12px]"><PrimeiraParcelaNovacao nv={nv} podeEditar={podeEditar} onAlterada={onAlterada} /></div>
        </div>
      </div>
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px] border-t pt-[10px]" style={{ borderColor: 'var(--border-light)' }}>
        <button onClick={onAlternar} className="h-[30px] rounded-[8px] px-[12px] text-[12px] font-semibold" style={{ background: aberto ? 'var(--navy)' : 'var(--surface-input)', color: aberto ? '#fff' : 'var(--text-primary)' }}>
          {aberto ? '▴ Ocultar detalhe' : '▾ Ver detalhe — origens, decomposição, contratos novos e trilha'}
        </button>
        <div className="flex-1" />
        {acaoDev}
      </div>
      {aberto && <DetalheNovacao id={nv.id} onContrato={onContrato} />}
    </div>
  );
}

function DetalheNovacao({ id, onContrato }: { id: string; onContrato: (id: string) => void }) {
  const navigate = useNavigate();
  const det = useQuery({ queryKey: ['novacao-detalhe', id], queryFn: () => operacoesService.novacao(id) });
  if (det.isLoading) return <div className="mt-[12px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando o detalhe…</div>;
  if (det.isError || !det.data) return <div className="mt-[12px] text-[12px]" style={{ color: '#c0392b' }}>Não foi possível carregar o detalhe: {det.error ? mensagemErro(det.error) : 'tente de novo'}</div>;
  const d: NovacaoDetalhe = det.data;
  const sim = d.simulacao;
  const recSit = RECEBIMENTO_SITUACAO[d.recebimentoInicial.situacao] ?? { label: d.recebimentoInicial.situacao, cor: 'var(--text-muted)' };
  const freq = d.termos?.frequencia ? PERIODICIDADE_LABEL[d.termos.frequencia] ?? d.termos.frequencia : null;

  return (
    <div className="mt-[14px] flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-3 lg:grid-cols-5">
        <Metrica label="Parte do veículo (C1)" valor={formatCurrency(d.saldoVeiculo)} />
        <Metrica label="Demais produtos (C2)" valor={formatCurrency(d.saldoDemais)} />
        <Metrica label="Total reorganizado" valor={formatCurrency(d.saldoVeiculo + d.saldoDemais)} />
        <Metrica label="Parcela única" valor={`${formatCurrency(d.valorParcela)}${freq ? ` · ${freq}` : ''}`} />
        <Metrica label="Recebimento inicial" valor={d.recebimentoInicial.valor > 0 ? formatCurrency(d.recebimentoInicial.valor) : '—'} />
      </div>

      {/* Origens liquidadas */}
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
                    <td className="py-[6px] pr-[10px]"><button onClick={() => onContrato(o.id)} className="font-semibold" style={{ color: 'var(--navy)' }}>{o.numero}</button></td>
                    <td className="py-[6px] pr-[10px]">{o.descricao}{o.placa ? ` · ${o.placa}` : ''}</td>
                    <td className="py-[6px] pl-[10px] text-right tabular-nums">{o.parcelasNovadas}</td>
                    <td className="py-[6px] pl-[10px] text-right tabular-nums">{formatCurrency(o.valorNominalNovado)}</td>
                    <td className="py-[6px] pl-[10px]">
                      {o.acordosNovados.length === 0 ? <span style={{ color: 'var(--text-muted)' }}>—</span> : o.acordosNovados.map((a) => (
                        <button key={a.id} onClick={() => navigate(`/acordos?acordo=${a.id}`)} className="mr-[8px] font-semibold" style={{ color: 'var(--navy)' }}>acordo {a.plano} →</button>
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

      {/* Decomposição + termos (snapshot) */}
      <Secao titulo={`Decomposição do saldo na data-base${d.dataBase ? ` (${fmtDataHora(d.dataBase)})` : ''}`}>
        {sim ? (
          <div className="flex flex-col gap-[12px]">
            <BlocoDecomposicao parteVeiculo={sim.decomposicao.parteVeiculo} demaisProdutos={sim.decomposicao.demaisProdutos} totalGeral={sim.decomposicao.totalGeral} rotuloTotal="Saldo total reorganizado" />
            <div className="grid grid-cols-2 gap-[8px] text-[12px] sm:grid-cols-4">
              <Campo label="Prazo" valor={d.termos?.prazoMeses ? `${d.termos.prazoMeses} meses` : d.termos?.numeroParcelasVeiculo ? `${d.termos.numeroParcelasVeiculo} parcelas` : '—'} />
              <Campo label="Frequência" valor={freq ?? '—'} />
              <Campo label="1ª parcela" valor={fmtDia(d.termos?.dataPrimeiraParcela)} />
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
                {sim.excecoes.map((e) => <li key={e} className="flex gap-[6px]"><span style={{ color: '#c98a0a' }}>⚠</span><span>{e}</span></li>)}
              </ul>
            )}
          </div>
        ) : (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Proposta sem snapshot de simulação.</div>
        )}
      </Secao>

      {/* Contratos novos */}
      <Secao titulo="Contratos gerados">
        {!d.contratoVeiculo && !d.contratoTermo ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Os contratos nascem na aprovação pela Central (CONAC), já com o instrumento enviado à assinatura.</div>
        ) : (
          <div className="grid grid-cols-1 gap-[10px] lg:grid-cols-2">
            {[d.contratoTermo, d.contratoVeiculo].filter((c): c is ContratoNovacao => !!c).map((c) => <CartaoContratoNovo key={c.id} c={c} unico={d.contratoUnico} onContrato={onContrato} />)}
          </div>
        )}
      </Secao>

      {/* Recebimento inicial */}
      <Secao titulo="Recebimento inicial">
        <div className="grid grid-cols-2 gap-[8px] text-[12px] sm:grid-cols-4">
          <Campo label="Valor" valor={d.recebimentoInicial.valor > 0 ? formatCurrency(d.recebimentoInicial.valor) : 'não há — a taxa inicial é diluída nas parcelas'} />
          <Campo label="Situação"><span className="font-semibold" style={{ color: recSit.cor }}>{recSit.label}</span></Campo>
          <Campo label="Pago em" valor={d.recebimentoInicial.pagoEm ? fmtDataHora(d.recebimentoInicial.pagoEm) : '—'} />
          <Campo label="Cobrança no Asaas" valor={d.recebimentoInicial.cobrancaAsaasId ?? '—'} />
        </div>
      </Secao>

      <Secao titulo="Trilha">
        <Trilha eventos={d.trilha} />
        {d.aprovacao && <LinhaAprovacao ap={d.aprovacao} />}
      </Secao>
    </div>
  );
}

function CartaoContratoNovo({ c, unico, onContrato }: { c: ContratoNovacao; unico: boolean; onContrato: (id: string) => void }) {
  const statusLabel = ROTULO_STATUS_CONTRATO[c.status.toUpperCase()] ?? c.status;
  return (
    <div className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="text-[11px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-label)' }}>{unico ? 'Contrato único' : c.papel === 'termo' ? 'Contrato 2 — Termo' : 'Contrato 1 — Veículo'}</span>
        <button onClick={() => onContrato(c.id)} className="text-[13px] font-bold" style={{ color: 'var(--navy)' }}>{c.numero} →</button>
        <StatusBadge label={statusLabel} colors={CONTRATO_STATUS_COLORS} />
      </div>
      <div className="mt-[4px] text-[12px]" style={{ color: 'var(--text-body)' }}>{c.descricao}{c.placa ? ` · ${c.placa}` : ''}</div>
      <div className="mt-[6px] grid grid-cols-2 gap-[6px] text-[12px]">
        <Campo label="Plano" valor={`${c.numeroParcelas} × ${formatCurrency(c.valorParcela)} (${PERIODICIDADE_LABEL[c.periodicidade] ?? c.periodicidade})`} />
        <Campo label="1ª parcela" valor={fmtDia(c.dataPrimeiraParcela)} />
        <Campo label="Cronograma" valor={c.cronogramaGerado ? `${c.cronograma.total} parcelas · ${c.cronograma.pagas} paga(s) · ${c.cronograma.vencidas} vencida(s) · ${c.cronograma.aVencer} a vencer${c.cronograma.proximoVencimento ? ` · próxima ${fmtDia(c.cronograma.proximoVencimento)}` : ''}` : 'ainda não gerado (nasce na ativação)'} />
        <Campo label="Assinatura digital">
          {c.assinatura ? (
            <div>
              <div className="font-semibold">{ASSINATURA_LABEL[c.assinatura.status] ?? c.assinatura.status}{c.assinatura.simulado ? ' (simulada)' : ''}</div>
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>enviado {fmtDataHora(c.assinatura.enviadoEm)}{c.assinatura.concluidoEm ? ` · concluído ${fmtDataHora(c.assinatura.concluidoEm)}` : ''}</div>
              <ul className="mt-[2px] text-[11.5px]">
                {c.assinatura.signatarios.map((s, i) => (
                  <li key={i} style={{ color: s.assinouEm ? '#1f9d5b' : 'var(--text-muted)' }}>
                    {s.assinouEm ? '✓' : '○'} {s.nome} ({PAPEL_SIGNATARIO[s.papel] ?? s.papel}){s.assinouEm ? ` — assinou ${fmtDataHora(s.assinouEm)}` : s.visualizouEm ? ` — visualizou ${fmtDataHora(s.visualizouEm)}` : ''}
                  </li>
                ))}
              </ul>
              {c.assinatura.motivoRecusa && <div className="text-[11.5px]" style={{ color: '#e0413c' }}>Recusa: {c.assinatura.motivoRecusa}</div>}
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

// Linha-resumo da Central (status + decisões já aparecem na trilha; aqui o
// aviso do que ainda está pendente).
function LinhaAprovacao({ ap }: { ap: AprovacaoResumo }) {
  if (ap.status !== 'PENDENTE') return null;
  return (
    <div className="mt-[6px] text-[12px]" style={{ color: '#c98a0a' }}>
      Aguardando decisão na Central de Aprovações ({ap.decisoes.filter((d) => d.decisao === 'APROVADA').length} aprovação(ões) registrada(s)).
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-[6px] text-[11px] font-bold uppercase tracking-[.04em]" style={{ color: 'var(--text-label)' }}>{titulo}</div>
      {children}
    </div>
  );
}

// 1ª parcela do contrato novo (doc 02 §7.7b, 15/10): visível sempre; editável
// enquanto a novação aguarda assinatura e ninguém assinou — a troca regenera o
// instrumento e reenvia à assinatura.
function PrimeiraParcelaNovacao({ nv, podeEditar, onAlterada }: { nv: Novacao; podeEditar: boolean; onAlterada: () => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [data, setData] = useState(nv.primeiraParcela ?? '');
  const [salvando, setSalvando] = useState(false);
  const freq = nv.frequencia ? ` · ${nv.frequencia}` : '';
  if (!editando) {
    return (
      <span className="flex flex-col items-end gap-[2px]">
        <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>1ª parcela {fmtDia(nv.primeiraParcela)}<span style={{ color: 'var(--text-muted)' }}>{freq}</span></span>
        {nv.podeAlterarPrimeiraParcela && podeEditar && (
          <button onClick={() => setEditando(true)} className="text-left text-[11.5px] font-semibold" style={{ color: 'var(--navy)' }}>alterar antes da assinatura</button>
        )}
      </span>
    );
  }
  async function salvar() {
    if (!data || salvando) return;
    setSalvando(true);
    try {
      const r = await operacoesService.alterarPrimeiraParcelaNovacao(nv.id, data);
      if (r.assinatura.reenviada) toast.sucesso(`1ª parcela em ${fmtDia(r.dataPrimeiraParcela)} — instrumento regenerado e reenviado para assinatura.`);
      else toast.erro(`1ª parcela alterada, mas o reenvio à assinatura falhou: ${r.assinatura.motivo ?? 'motivo não informado'}. Reenvie pela tela do contrato.`);
      setEditando(false);
      await onAlterada();
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <span className="flex flex-col items-end gap-[4px]">
      <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-[30px] w-[140px] rounded-[7px] px-[6px] text-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
      <span className="flex gap-[6px]">
        <button onClick={salvar} disabled={salvando || !data} className="rounded-[7px] px-[10px] py-[4px] text-[11.5px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>Salvar e reenviar</button>
        <button onClick={() => { setEditando(false); setData(nv.primeiraParcela ?? ''); }} className="text-[11.5px] font-semibold" style={{ color: 'var(--text-muted)' }}>cancelar</button>
      </span>
      {nv.frequencia === 'mensal' && <span className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>mensal: mesmo dia todo mês; mês sem o dia vence no último dia</span>}
    </span>
  );
}
