import { instanteBR, dataBR } from '../lib/datas';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import {
  operacoesService,
  type Acordo,
  type AcordoDetalhe,
  type AprovacaoResumo,
  type Novacao,
  type NovacaoDetalhe,
} from '../services/operacoes.service';
import { StatusBadge } from '../components/StatusBadge';
import { Trilha } from '../components/Trilha';
import { Metrica } from '../components/Metrica';
import { Secao } from '../components/Secao';
import { Chips } from '../components/Chips';
import { Botao } from '../components/Botao';
import {
  CoberturaAcordo, SelecaoAcordo, EntradaAcordo, CalculoAcordo, CotasAcordo, LegadoAcordo, PERIODICIDADE_LABEL, fmtDataHora,
} from '../components/renegociacao/AcordoBlocos';
import { OrigensNovacao, DecomposicaoNovacao, ContratosNovacao, RecebimentoNovacao } from '../components/renegociacao/NovacaoBlocos';
import { ACORDO_STATUS_COLORS, NOVACAO_STATUS_COLORS, TOM_DOSSIE_FG } from '../config/statusColors';
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

const fmtDia = dataBR;
const card = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;

// Acompanhamento de acordos e novações. A CRIAÇÃO nasce da ficha do titular
// (Renegociar atraso / Novação) — aqui é esteira: status, entrada, efetivação
// e, desde 21/10, o DETALHE de cada operação (o que cobriu, o que gerou, a
// trilha), na mesma clareza da Central de Aprovações.
// Layout v2 (doc 03 §11, 30/10): abas em Chips, seções em <Secao>, botões em
// <Botao>. Cada operação continua um cartão expansível (estrutura própria: o
// detalhe abre embaixo do próprio cartão, como um dossiê) — só com tokens.
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
  const contagens = acordos.data && novacoes.data;

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
        <div className="rounded-[12px] px-[16px] py-[12px] text-[12.5px]" style={{ background: 'var(--info-bg)', color: 'var(--text-primary)' }}>
          💡 A renegociação nasce da <b>ficha do titular</b> (botão "Renegociar atraso") — ela cobre as
          parcelas em atraso de todos os contratos da conta e passa pela Central de Aprovações.{' '}
          <button type="button" onClick={() => navigate('/carteira')} className="font-semibold underline">Abrir a carteira →</button>
        </div>
      )}
      {podeNovar && (
        <div className="rounded-[12px] px-[16px] py-[12px] text-[12.5px]" style={{ background: 'var(--info-bg)', color: 'var(--text-primary)' }}>
          💡 A novação também nasce da <b>ficha do titular</b> (botão "Novação (prévia do saldo)"):
          o sistema decompõe o saldo da conta por produto — parte do veículo × demais produtos — e a
          proposta dos dois contratos será montada a partir daí.{' '}
          <button type="button" onClick={() => navigate('/carteira')} className="font-semibold underline">Abrir a carteira →</button>
        </div>
      )}

      {/* Abas (mesmo padrão da Central): em andamento × histórico */}
      <div className="flex flex-wrap items-center gap-[10px]">
        <Chips
          todos={null}
          valor={aba}
          onChange={(v) => setAba((v as 'andamento' | 'historico') ?? 'andamento')}
          itens={[
            { chave: 'andamento', rotulo: 'Em andamento', contagem: contagens ? nAndamento : undefined },
            { chave: 'historico', rotulo: 'Histórico', contagem: contagens ? nHistorico : undefined },
          ]}
        />
        {filtroTitular && (
          <span className="inline-flex min-h-[30px] items-center gap-[8px] rounded-full px-[11px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>
            Só de <b>{nomeTitularFiltro ?? 'um titular'}</b>
            <button type="button" onClick={() => { params.delete('titular'); setParams(params, { replace: true }); }} className="font-semibold" style={{ color: 'var(--text-primary)' }} title="Ver todos">×</button>
          </span>
        )}
        <span className="basis-full text-[11.5px] lg:ml-auto lg:basis-auto lg:text-right" style={{ color: 'var(--text-muted)' }}>
          {aba === 'andamento' ? 'Aguardando aprovação, entrada, assinatura ou recebimento, e acordos ativos.' : 'Acordos cumpridos, novados, cancelados ou expirados e novações concluídas, canceladas ou expiradas.'}
        </span>
      </div>

      {carregando && <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>}

      {/* Acordos */}
      {!carregando && (
        <Secao titulo="Acordos de pagamento" tag={String(acordosLista.length)}>
          <div className="flex flex-col gap-[10px]">
            {acordosLista.length === 0 ? (
              <div className="rounded-card py-[22px] text-center text-[12.5px]" style={{ ...card, color: 'var(--text-muted)' }}>
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
                      <Botao variante="primaria" tamanho="sm" onClick={() => efetivar(a.id)} disabled={ocupado} carregando={ocupado}>
                        Simular entrada (dev)
                      </Botao>
                    ) : null
                  }
                />
              ))
            )}
          </div>
        </Secao>
      )}

      {/* Novações (F2 — conta-cêntrica: 2 contratos assinados juntos) */}
      {!carregando && (
        <Secao titulo="Novações" tag={String(novacoesLista.length)}>
          <div className="flex flex-col gap-[10px]">
            {novacoesLista.length === 0 ? (
              <div className="rounded-card py-[22px] text-center text-[12.5px]" style={{ ...card, color: 'var(--text-muted)' }}>
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
                      <Botao variante="primaria" tamanho="sm" onClick={() => simularRecebimento(nv.id)} disabled={ocupado} carregando={ocupado}>
                        Simular recebimento (dev)
                      </Botao>
                    ) : null
                  }
                />
              ))
            )}
          </div>
        </Secao>
      )}
    </div>
  );
}

// Etiqueta de tipo da operação (Acordo / Novação) — mesma do dossiê da Central.
function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[6px] px-[8px] py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em]" style={{ background: 'var(--surface-input)', color: 'var(--text-label)' }}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Card do ACORDO — título humano, contexto no card, detalhe sob demanda.
function CardAcordo({ a, aberto, onAlternar, onTitular, onContrato, acaoDev }: {
  a: Acordo; aberto: boolean; onAlternar: () => void; onTitular: () => void; onContrato: (id: string) => void; acaoDev: React.ReactNode;
}) {
  const periodicidade = PERIODICIDADE_LABEL[a.periodicidade] ?? a.periodicidade;
  return (
    <div className="rounded-card p-[16px]" style={card}>
      <div className="flex flex-wrap items-start gap-[12px]">
        <div className="min-w-0 flex-1 basis-[240px]">
          <div className="flex flex-wrap items-center gap-[8px]">
            <Etiqueta>Acordo</Etiqueta>
            {a.origem === 'legado' && (
              <span className="rounded-[6px] px-[8px] py-[3px] text-[10.5px] font-semibold" style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }} title="Acordo que já existia no Asaas e foi importado pela migração do legado">importado do legado</span>
            )}
            <StatusBadge label={LABEL_STATUS[a.status] ?? a.status} colors={ACORDO_STATUS_COLORS} />
          </div>
          <div className="mt-[6px] text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
            Acordo de {a.numeroParcelasNovas} parcelas de {formatCurrency(a.valorParcelaNova)} ({periodicidade})
            {a.valorEntrada > 0 ? <span className="font-semibold" style={{ color: 'var(--text-body)' }}> · entrada {formatCurrency(a.valorEntrada)}</span> : <span className="font-semibold" style={{ color: 'var(--text-muted)' }}> · sem entrada</span>}
          </div>
          <div className="mt-[3px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <button type="button" onClick={onTitular} className="font-semibold" style={{ color: 'var(--text-primary)' }}>{a.titular}</button>
            {a.contratos.map((c) => (
              <span key={c.id}>
                {' · '}
                <button type="button" onClick={() => onContrato(c.id)} className="font-semibold" style={{ color: 'var(--text-primary)' }} title={c.descricao}>{c.numero}</button>
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
        <div className="text-left sm:text-right">
          <div className="font-display text-[16px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(a.valorTotalRenegociado)}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>renegociado na data-base</div>
        </div>
      </div>
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px] pt-[10px]" style={{ borderTop: '1px solid var(--border-light)' }}>
        <Botao variante="secundaria" tamanho="sm" onClick={onAlternar} aria-expanded={aberto}>
          {aberto ? '▴ Ocultar detalhe' : '▾ Ver detalhe'}
        </Botao>
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
  if (det.isError || !det.data) return <div className="mt-[12px] text-[12px]" style={{ color: TOM_DOSSIE_FG.alerta }}>Não foi possível carregar o detalhe: {det.error ? mensagemErro(det.error) : 'tente de novo'}</div>;
  const d: AcordoDetalhe = det.data;
  const r = d.resumoCotas;

  // Os blocos são os MESMOS do dossiê da Central de Aprovações (21/10).
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
      <CoberturaAcordo d={d} onContrato={onContrato} />
      <SelecaoAcordo d={d} />
      <EntradaAcordo d={d} />
      <CalculoAcordo d={d} />
      <CotasAcordo d={d} onContrato={onContrato} />
      <LegadoAcordo d={d} />
      {!d.legado && d.observacao && <Secao titulo="Observação"><div className="text-[12px]" style={{ color: 'var(--text-body)' }}>{d.observacao}</div></Secao>}
      <Secao titulo="Trilha">
        <Trilha eventos={d.trilha} />
        {d.aprovacao && <LinhaAprovacao ap={d.aprovacao} />}
        {d.novacaoId && (
          <button type="button" onClick={() => navigate(`/acordos?novacao=${d.novacaoId}`)} className="mt-[6px] text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>Ver a novação que absorveu este acordo →</button>
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
    <div className="rounded-card p-[16px]" style={card}>
      <div className="flex flex-wrap items-start gap-[12px]">
        <div className="min-w-0 flex-1 basis-[240px]">
          <div className="flex flex-wrap items-center gap-[8px]">
            <Etiqueta>Novação</Etiqueta>
            {nv.contratoUnico && <span className="rounded-[6px] px-[8px] py-[3px] text-[10.5px] font-semibold" style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }} title="Um só contrato de Compra Parcelada com o valor global (adaptação 13/10)">contrato único</span>}
            <StatusBadge label={LABEL_STATUS_NOVACAO[nv.status] ?? nv.status} colors={NOVACAO_STATUS_COLORS} />
          </div>
          <div className="mt-[6px] text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
            Novação de {formatCurrency(total)} em parcela única de {formatCurrency(nv.valorParcela)}{nv.frequencia ? ` (${PERIODICIDADE_LABEL[nv.frequencia] ?? nv.frequencia})` : ''}
          </div>
          <div className="mt-[3px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <button type="button" onClick={onTitular} className="font-semibold" style={{ color: 'var(--text-primary)' }}>{nv.titular}</button>
            {nv.veiculo ? ` · ${nv.veiculo.descricao}${nv.veiculo.placa ? ` (${nv.veiculo.placa})` : ''}` : ''}
            {nv.contratosOrigem.length > 0 ? ` · substitui ${nv.contratosOrigem.join(', ')}` : ''}
          </div>
          <div className="mt-[2px] flex flex-wrap items-center gap-x-[10px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <span>proposta por {nv.criadaPor} em {fmtDataHora(nv.criadaEm)}{nv.dataAtivacao ? ` · ativada em ${fmtDataHora(nv.dataAtivacao)}` : ''}</span>
            {nv.contratoVeiculo && <button type="button" onClick={() => onContrato(nv.contratoVeiculo!.id)} className="font-semibold" style={{ color: 'var(--text-primary)' }}>{nv.contratoVeiculo.numero} · veículo</button>}
            {nv.contratoTermo && <button type="button" onClick={() => onContrato(nv.contratoTermo!.id)} className="font-semibold" style={{ color: 'var(--text-primary)' }}>{nv.contratoTermo.numero} · termo</button>}
            {!nv.contratoVeiculo && !nv.contratoTermo && <span>contratos nascem na aprovação</span>}
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="font-display text-[16px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(total)}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>veículo {formatCurrency(nv.saldoVeiculo)} · termo {formatCurrency(nv.saldoDemais)}</div>
          <div className="mt-[4px] text-[12px]"><PrimeiraParcelaNovacao nv={nv} podeEditar={podeEditar} onAlterada={onAlterada} /></div>
        </div>
      </div>
      <div className="mt-[12px] flex flex-wrap items-center gap-[8px] pt-[10px]" style={{ borderTop: '1px solid var(--border-light)' }}>
        <Botao variante="secundaria" tamanho="sm" onClick={onAlternar} aria-expanded={aberto}>
          {aberto ? '▴ Ocultar detalhe' : '▾ Ver detalhe'}
        </Botao>
        <div className="flex-1" />
        {acaoDev}
      </div>
      {aberto && <DetalheNovacao id={nv.id} onContrato={onContrato} />}
    </div>
  );
}

function DetalheNovacao({ id, onContrato }: { id: string; onContrato: (id: string) => void }) {
  const det = useQuery({ queryKey: ['novacao-detalhe', id], queryFn: () => operacoesService.novacao(id) });
  if (det.isLoading) return <div className="mt-[12px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando o detalhe…</div>;
  if (det.isError || !det.data) return <div className="mt-[12px] text-[12px]" style={{ color: TOM_DOSSIE_FG.alerta }}>Não foi possível carregar o detalhe: {det.error ? mensagemErro(det.error) : 'tente de novo'}</div>;
  const d: NovacaoDetalhe = det.data;
  const freq = d.termos?.frequencia ? PERIODICIDADE_LABEL[d.termos.frequencia] ?? d.termos.frequencia : null;

  // Os blocos são os MESMOS do dossiê da Central de Aprovações (21/10).
  return (
    <div className="mt-[14px] flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-3 lg:grid-cols-5">
        <Metrica label="Parte do veículo (C1)" valor={formatCurrency(d.saldoVeiculo)} />
        <Metrica label="Demais produtos (C2)" valor={formatCurrency(d.saldoDemais)} />
        <Metrica label="Total reorganizado" valor={formatCurrency(d.saldoVeiculo + d.saldoDemais)} />
        <Metrica label="Parcela única" valor={`${formatCurrency(d.valorParcela)}${freq ? ` · ${freq}` : ''}`} />
        <Metrica label="Recebimento inicial" valor={d.recebimentoInicial.valor > 0 ? formatCurrency(d.recebimentoInicial.valor) : '—'} />
      </div>
      <OrigensNovacao d={d} onContrato={onContrato} />
      <DecomposicaoNovacao d={d} />
      <ContratosNovacao d={d} onContrato={onContrato} />
      <RecebimentoNovacao d={d} />
      <Secao titulo="Trilha">
        <Trilha eventos={d.trilha} />
        {d.aprovacao && <LinhaAprovacao ap={d.aprovacao} />}
      </Secao>
    </div>
  );
}

// Linha-resumo da Central (status + decisões já aparecem na trilha; aqui o
// aviso do que ainda está pendente).
function LinhaAprovacao({ ap }: { ap: AprovacaoResumo }) {
  if (ap.status !== 'PENDENTE') return null;
  return (
    <div className="mt-[6px] text-[12px]" style={{ color: TOM_DOSSIE_FG.atencao }}>
      Aguardando decisão na Central de Aprovações ({ap.decisoes.filter((d) => d.decisao === 'APROVADA').length} aprovação(ões) registrada(s)).
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
      <span className="flex flex-col items-start gap-[2px] sm:items-end">
        <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>1ª parcela {fmtDia(nv.primeiraParcela)}<span style={{ color: 'var(--text-muted)' }}>{freq}</span></span>
        {nv.podeAlterarPrimeiraParcela && podeEditar && (
          <button type="button" onClick={() => setEditando(true)} className="text-left text-[11.5px] font-semibold" style={{ color: 'var(--accent)' }}>alterar antes da assinatura</button>
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
    <span className="flex flex-col items-start gap-[4px] sm:items-end">
      <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-[30px] w-[150px] rounded-[10px] px-[8px] text-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
      <span className="flex flex-wrap gap-[6px]">
        <Botao variante="primaria" tamanho="sm" onClick={salvar} disabled={salvando || !data} carregando={salvando}>Salvar e reenviar</Botao>
        <Botao variante="fantasma" tamanho="sm" onClick={() => { setEditando(false); setData(nv.primeiraParcela ?? ''); }}>cancelar</Botao>
      </span>
      {nv.frequencia === 'mensal' && <span className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>mensal: mesmo dia todo mês; mês sem o dia vence no último dia</span>}
    </span>
  );
}
