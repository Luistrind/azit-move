import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { VezAprovacao } from '@azit/types';
import {
  aprovacaoService,
  type AprovacaoDossie,
  type BlocoDossie,
  type ContextoContaDossie,
  type DecisaoInput,
} from '../services/aprovacao.service';
import { operacoesService, type AcordoDetalhe, type NovacaoDetalhe } from '../services/operacoes.service';
import { analiseService, type DossieAnalise } from '../services/analise.service';
import { StatusBadge } from '../components/StatusBadge';
import { Trilha } from '../components/Trilha';
import { Campo, Metrica } from '../components/Metrica';
import { Secao } from '../components/Secao';
import { Tabela, type Coluna } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { toast } from '../components/Toast';
import { AceiteWhatsapp, CalculoAcordo, CoberturaAcordo, PERIODICIDADE_LABEL, SelecaoAcordo } from '../components/renegociacao/AcordoBlocos';
import { ContratosNovacao, DecomposicaoNovacao } from '../components/renegociacao/NovacaoBlocos';
import { mensagemErro } from '../lib/permissoes';
import { esperaDesde, horaBR, instanteBR, mesAnoBR, dataBR } from '../lib/datas';
import { motivosDe, notaAoAprovar, tituloHumano, trilhaDaSolicitacao } from '../lib/aprovacao';
import {
  ANALISE_SITUACAO_FG,
  APROVACAO_STATUS_COLORS,
  APROVACAO_STATUS_LABEL,
  TOM_DOSSIE_FG,
  VEZ_APROVACAO_COLORS,
  VEZ_APROVACAO_LABEL,
} from '../config/statusColors';

const ESPERA_ALERTA_HORAS = 48;
const card = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const ACORDO_STATUS_TEXTO: Record<string, string> = {
  rascunho: 'em aprovação', aguardando_entrada: 'aguardando entrada', ativo: 'em andamento', cumprido: 'cumprido', novado: 'absorvido por novação', cancelado: 'cancelado', expirado: 'expirado',
};
const NOVACAO_STATUS_TEXTO: Record<string, string> = {
  rascunho: 'em aprovação', aguardando_assinatura: 'aguardando assinatura', aguardando_recebimento: 'aguardando recebimento', ativo: 'ativada', cancelado: 'cancelada/recusada', expirado: 'expirada',
};
const SIT_CRITERIO: Record<string, string> = { alcada: 'Conforme', complemento: 'Pede complemento', cocad: 'Vai ao Comitê' };

// Fração → "48%" (exibição).
const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(0)}%`);
const quando = (iso: string) => `${instanteBR(iso)} às ${horaBR(iso)}`;

// DOSSIÊ da solicitação (protótipo de 14/10, implementado em 21/10): o que está
// sendo aprovado, com o mesmo detalhe que a tela de Renegociações mostra (os
// blocos são os mesmos componentes), o contexto da conta e o painel de decisão.
// Layout v2 (doc 03 §11, 30/10): header da entidade em navy com Metrica escura,
// trechos em <Secao>, tabelas na <Tabela> responsiva, ações em <Botao>.
export function AprovacaoDossiePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['aprovacao-dossie', id], queryFn: () => aprovacaoService.obter(id), enabled: !!id });
  const a = q.data;
  const tipo = a?.tipoOperacao;
  const ref = a?.detalhe?.referenciaId ?? '';
  const acordo = useQuery({ queryKey: ['acordo-detalhe', ref], queryFn: () => operacoesService.acordo(ref), enabled: tipo === 'acordo' && !!ref });
  const novacao = useQuery({ queryKey: ['novacao-detalhe', ref], queryFn: () => operacoesService.novacao(ref), enabled: tipo === 'novacao' && !!ref });
  const analiseId = a?.contextoAnalise?.analiseId ?? '';
  const analise = useQuery({ queryKey: ['analise', analiseId], queryFn: () => analiseService.dossie(analiseId), enabled: tipo === 'analise_cadastro' && !!analiseId });

  if (q.isLoading) return <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando o dossiê…</div>;
  if (q.isError || !a) {
    return (
      <div className="flex flex-col gap-[10px]">
        <Voltar />
        <div className="text-[13px]" style={{ color: TOM_DOSSIE_FG.alerta }}>Não foi possível abrir a solicitação: {q.error ? mensagemErro(q.error) : 'tente de novo'}</div>
      </div>
    );
  }
  const onContrato = (cid: string) => navigate(`/contratos/${cid}`);
  const conta = a.detalhe?.conta ?? null;
  const cab = cabecalho(a, acordo.data, novacao.data);
  const espera = a.status === 'PENDENTE' ? esperaDesde(a.solicitadoEm) : null;
  const vezLabel = a.minha.vez ? VEZ_APROVACAO_LABEL[a.minha.vez] : null;

  return (
    <div className="flex flex-col gap-[14px]">
      <Voltar />
      {/* Header da entidade (navy): tipo, de quem é a vez, título humano, quem
          pediu e há quanto tempo, valor em destaque. */}
      <div className="rounded-card p-[18px]" style={{ background: 'var(--navy)', color: '#fff' }}>
        <div className="flex flex-wrap items-start gap-[16px]">
          <div className="min-w-0 flex-1 basis-[260px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <span className="rounded-[6px] px-[8px] py-[2px] text-[10.5px] font-bold uppercase tracking-[.04em]" style={{ background: 'var(--surface-input)', color: 'var(--text-label)' }}>{a.tipoOperacaoNome}</span>
              {a.status === 'PENDENTE' && vezLabel ? (
                <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-bold" style={{ background: VEZ_APROVACAO_COLORS[vezLabel]?.bg, color: VEZ_APROVACAO_COLORS[vezLabel]?.fg }}>
                  {[vezLabel, `${a.aprovacoesFeitas} de ${a.aprovacoesNecessarias}`, ...a.decisoes.filter((d) => d.decisao === 'APROVADA').map((d) => `${d.usuario.split(' ')[0]} já aprovou`)].join(' · ')}
                </span>
              ) : (
                <StatusBadge label={APROVACAO_STATUS_LABEL[a.status] ?? a.status} colors={APROVACAO_STATUS_COLORS} />
              )}
            </div>
            <h2 className="mb-[4px] mt-[8px] font-display text-[18px] font-bold" style={{ color: '#fff' }}>{cab.titulo}</h2>
            <div className="text-[12.5px]" style={{ color: 'var(--navy-text-meta)' }}>
              Pedido por <b style={{ color: 'var(--navy-text-body)' }}>{a.solicitante}</b> em {quando(a.solicitadoEm)}
              {espera && (
                <> · espera há <b style={{ color: espera.horas >= ESPERA_ALERTA_HORAS ? 'var(--accent)' : 'var(--navy-text-body)' }}>{espera.texto}</b></>
              )}
              {cab.contexto.map((c) => <span key={c}> · {c}</span>)}
            </div>
          </div>
          <div className="min-w-0 sm:max-w-[360px] sm:text-right">
            <Metrica tom="escuro" destaque label="Valor" valor={formatCurrency(cab.valor ?? a.valor)} detalhe={cab.composicao} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-[14px] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col overflow-hidden rounded-card" style={card}>
          {motivosDe(a).length > 0 && (
            <Trecho titulo="Por que subiu para aprovação">
              <ul className="flex flex-col gap-[3px] text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                {motivosDe(a).map((m) => <li key={m} className="flex gap-[6px]"><span style={{ color: TOM_DOSSIE_FG.atencao }}>⚠</span><span>{m}</span></li>)}
              </ul>
            </Trecho>
          )}

          {tipo === 'acordo' && (acordo.data ? <DossieAcordo a={a} d={acordo.data} conta={conta} onContrato={onContrato} /> : <Carregando q={acordo} />)}
          {tipo === 'novacao' && (novacao.data ? <DossieNovacao a={a} d={novacao.data} conta={conta} onContrato={onContrato} /> : <Carregando q={novacao} />)}
          {tipo === 'analise_cadastro' && <DossieAnaliseCadastro a={a} d={analise.data ?? null} />}
          {tipo !== 'acordo' && tipo !== 'novacao' && tipo !== 'analise_cadastro' && <DossieGenerico a={a} />}

          <Trecho titulo="Trilha da solicitação">
            <Trilha eventos={trilhaDaSolicitacao(a)} />
            {a.status === 'PENDENTE' && (
              <div className="mt-[6px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {a.complementoAberto
                  ? `Aguardando ${a.solicitante} responder o complemento (pedido há ${esperaDesde(a.complementoAberto.pedidoEm).texto}).`
                  : `Aguardando ${a.aprovacoesFaltando} aprovação(ões) · segregação: quem solicitou não decide.`}
              </div>
            )}
          </Trecho>
        </div>

        <PainelDecisao a={a} />
      </div>
    </div>
  );
}

function Voltar() {
  return (
    <Link to="/aprovacoes" className="inline-flex h-[30px] items-center self-start rounded-[10px] px-[11px] text-[12px] font-semibold" style={{ background: 'var(--surface-input)', color: 'var(--text-body)', border: '1px solid var(--border)' }}>
      ← Aprovações
    </Link>
  );
}

// Trecho do dossiê (uma <Secao> separada por fio dentro do cartão único); sem
// título quando o componente reaproveitado já traz o seu.
function Trecho({ titulo, acao, children }: { titulo?: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-t border-[var(--border)] px-[18px] py-[16px] first:border-t-0">
      {titulo ? <Secao titulo={titulo} acao={acao}>{children}</Secao> : children}
    </div>
  );
}

function Carregando({ q }: { q: { isError: boolean; error: unknown } }) {
  return (
    <div className="px-[18px] py-[16px] text-[12px]" style={{ color: q.isError ? TOM_DOSSIE_FG.alerta : 'var(--text-muted)' }}>
      {q.isError ? `Não foi possível carregar o detalhe da operação: ${mensagemErro(q.error)}` : 'Carregando o detalhe da operação…'}
    </div>
  );
}

function Observacao({ autor, em, texto, vazio }: { autor: string | null; em: string | null; texto: string | null; vazio: string }) {
  return (
    <Trecho titulo={`Observação${autor ? ` — ${autor}` : ''}${em ? ` · ${instanteBR(em)}` : ''}`}>
      {texto ? (
        <div className="whitespace-pre-wrap rounded-[10px] px-[12px] py-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>{texto}</div>
      ) : (
        <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{vazio}</div>
      )}
    </Trecho>
  );
}

// Link-botão de leitura dentro de um trecho (acento, sem fundo).
function LinkTexto({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="mt-[10px] inline-block text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>{children}</Link>
  );
}

// --- Cabeçalho por tipo ----------------------------------------------------------

function cabecalho(a: AprovacaoDossie, ac?: AcordoDetalhe, nv?: NovacaoDetalhe): { titulo: string; contexto: string[]; valor: number | null; composicao: string } {
  const nome = a.contraparte?.nome ?? a.titular?.nome ?? '';
  const conta = a.detalhe?.conta ?? null;
  const contexto: string[] = [];
  const bloqueado = conta?.contratos.find((c) => c.veiculoBloqueadoEm);
  if (bloqueado?.veiculoBloqueadoEm) contexto.push(`veículo bloqueado desde ${instanteBR(bloqueado.veiculoBloqueadoEm).slice(0, 5)}`);
  if (a.aprovacoesNecessarias > 1) contexto.push(`${a.aprovacoesNecessarias} aprovações (${a.tipoOperacaoNome})`);

  if (a.tipoOperacao === 'acordo' && ac) {
    if (conta?.ordemAcordo) contexto.push(`${conta.ordemAcordo}º acordo da conta`);
    if (conta?.acordosEmAberto) contexto.push(`${conta.acordosEmAberto} outro(s) acordo(s) em aberto`);
    const p = ac.plano;
    return {
      titulo: `${ac.totaisCobertura.quantidadeFaturas} fatura(s) em atraso — ${ac.titular.nome}`,
      contexto,
      valor: p.valorTotalRenegociado,
      composicao: `dívida renegociada · ${p.valorEntrada > 0 ? `entrada ${formatCurrency(p.valorEntrada)} + ` : 'sem entrada · '}${p.numeroParcelasNovas} × ${formatCurrency(p.valorParcelaNova)} (${PERIODICIDADE_LABEL[p.periodicidade] ?? p.periodicidade})`,
    };
  }
  if (a.tipoOperacao === 'novacao' && nv) {
    const sim = nv.simulacao;
    const freq = nv.termos?.frequencia ? PERIODICIDADE_LABEL[nv.termos.frequencia] ?? nv.termos.frequencia : '';
    const total = sim ? sim.contrato1.totalParcelas + sim.contrato2.totalParcelas : null;
    const oQue = sim?.troca ? 'Troca de veículo' : 'Novação da conta';
    return {
      titulo: `${oQue}${sim?.acrescimo ? ' com acréscimo ao saldo' : ''} — ${nv.titular.nome}`,
      contexto,
      valor: nv.saldoVeiculo + nv.saldoDemais,
      composicao: `saldo reorganizado · ${total ? `${total} parcelas de ` : 'parcela única de '}${formatCurrency(nv.valorParcela)}${freq ? ` · ${freq}` : ''}${nv.contratoUnico ? ' · contrato único' : ''}`,
    };
  }
  if (a.tipoOperacao === 'analise_cadastro' && a.contextoAnalise) {
    const c = a.contextoAnalise;
    return {
      titulo: `Proposta ${c.ativo} — ${nome}`,
      contexto,
      valor: c.valorParcela,
      composicao: `parcela${c.frequencia ? ` ${c.frequencia}` : ''} da proposta · decisão do Comitê de Cadastro`,
    };
  }
  return { titulo: `${tituloHumano(a.resumo)}${nome && !tituloHumano(a.resumo).includes(nome) ? ` — ${nome}` : ''}`, contexto, valor: null, composicao: a.tipoOperacaoNome };
}

// --- Acordo -------------------------------------------------------------------------

function DossieAcordo({ a, d, conta, onContrato }: { a: AprovacaoDossie; d: AcordoDetalhe; conta: ContextoContaDossie | null; onContrato: (id: string) => void }) {
  const periodicidade = PERIODICIDADE_LABEL[d.plano.periodicidade] ?? d.plano.periodicidade;
  const bloqueado = conta?.contratos.some((c) => c.veiculoBloqueadoEm);
  const comp = conta?.comprometimento;
  return (
    <>
      <Observacao autor={d.criadoPor} em={d.criadoEm} texto={d.legado ? null : d.observacao} vazio="Quem propôs não escreveu observação (o campo entrou na revisão da renegociação em 21/10)." />
      <Trecho>
        <div className="flex flex-col gap-[12px]">
          <CoberturaAcordo d={d} onContrato={onContrato} compacto />
          <SelecaoAcordo d={d} />
        </div>
      </Trecho>
      <Trecho titulo="Condições propostas">
        <div className="grid grid-cols-1 gap-[10px] text-[12.5px] sm:grid-cols-2 xl:grid-cols-4">
          <Campo label="Entrada" valor={d.entrada.valor > 0 ? `${formatCurrency(d.entrada.valor)} · até ${instanteBR(d.entrada.dataLimite)}` : 'sem entrada'} />
          <Campo label="Parcelas novas" valor={`${d.plano.numeroParcelasNovas} × ${formatCurrency(d.plano.valorParcelaNova)} (somadas à fatura ${periodicidade})`} />
          <Campo label={`Fatura ${periodicidade} durante o acordo`}>
            {comp?.valorComOperacao != null ? (
              <div>
                <b className="tabular-nums">{formatCurrency(comp.valorComOperacao)}</b>
                {conta?.proximaFatura && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>próxima fatura #{conta.proximaFatura.numero} ({dataBR(conta.proximaFatura.dataVencimento)}) {formatCurrency(conta.proximaFatura.valorTotal)}{d.status === 'rascunho' || d.status === 'aguardando_entrada' ? ' + cota' : ''}</div>}
              </div>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>sem fatura futura em aberto na conta</span>
            )}
          </Campo>
          <Campo label="Desbloqueio do veículo" valor={bloqueado ? 'Manual, depois da entrada confirmada (Regra 6)' : 'Veículo não está bloqueado'} />
        </div>
        <div className="mt-[14px]"><CalculoAcordo d={d} /></div>
      </Trecho>
      <Trecho titulo={`"De acordo" do cliente · WhatsApp${d.aceiteWhatsapp ? ` · ${quando(d.aceiteWhatsapp.confirmadoPeloOperadorEm)}` : ''}`}>
        <AceiteWhatsapp d={d} destaque />
      </Trecho>
      <HistoricoRecuperacao a={a} conta={conta} rotuloComprometimento="Comprometimento com o acordo" />
      <Trecho titulo="Na tela de Renegociações">
        <LinkTexto to={`/acordos?acordo=${d.id}`}>Ver o acordo completo (cotas, entrada, trilha da operação) →</LinkTexto>
      </Trecho>
    </>
  );
}

// --- Novação ------------------------------------------------------------------------

// Linha da comparação "hoje × depois da novação".
type LinhaMudanca = { chave: string; rotulo: string; hoje: React.ReactNode; depois: React.ReactNode };

function DossieNovacao({ a, d, conta, onContrato }: { a: AprovacaoDossie; d: NovacaoDetalhe; conta: ContextoContaDossie | null; onContrato: (id: string) => void }) {
  const sim = d.simulacao;
  const freq = d.termos?.frequencia ? PERIODICIDADE_LABEL[d.termos.frequencia] ?? d.termos.frequencia : '';
  const contratos = conta?.contratos ?? [];
  const comVeiculo = contratos.find((c) => c.placa);
  const restantes = contratos.reduce((s, c) => s + Math.max(0, c.numeroParcelas - c.parcelasPagas), 0);
  const ultimo = contratos.map((c) => c.ultimoVencimento).filter((x): x is string => !!x).sort().pop() ?? null;
  const atual = conta?.proximaFatura?.valorTotal ?? null;

  const mudancas: LinhaMudanca[] = [
    {
      chave: 'contratos',
      rotulo: 'Contratos',
      hoje: contratos.length ? contratos.map((c) => `${c.numero} · ${c.descricao}${c.placa ? ` (${c.placa})` : ''}`).join('; ') : '—',
      depois: d.contratoUnico ? 'Contrato único de Compra Parcelada' : 'Contrato do veículo + Termo de Regularização (assinados juntos)',
    },
    {
      chave: 'veiculo',
      rotulo: 'Veículo',
      hoje: comVeiculo ? `${comVeiculo.descricao}${comVeiculo.placa ? ` (${comVeiculo.placa})` : ''}` : '—',
      depois: sim?.troca ? `${sim.troca.entraDescricao} (troca — ajuste ${formatCurrency(sim.troca.ajuste)})` : 'o mesmo',
    },
    {
      chave: 'fatura',
      rotulo: `Fatura ${freq || 'do período'}`,
      hoje: <span className="tabular-nums">{atual !== null ? `${formatCurrency(atual)} (próxima, #${conta?.proximaFatura?.numero})` : '—'}</span>,
      depois: (
        <span className="font-bold tabular-nums">
          {formatCurrency(d.valorParcela)}
          {atual !== null && <span style={{ color: d.valorParcela > atual ? TOM_DOSSIE_FG.alerta : TOM_DOSSIE_FG.ok }}> ({d.valorParcela >= atual ? '+' : '−'} {formatCurrency(Math.abs(d.valorParcela - atual))})</span>}
        </span>
      ),
    },
    {
      chave: 'parcelas',
      rotulo: 'Parcelas',
      hoje: contratos.length ? `${restantes} restante(s)${ultimo ? ` · última em ${dataBR(ultimo)}` : ''}` : '—',
      depois: sim ? `${sim.contrato1.totalParcelas + sim.contrato2.totalParcelas} · 1ª em ${dataBR(d.termos?.dataPrimeiraParcela ?? sim.dataPrimeiraParcela)}` : '—',
    },
  ];
  const colunas: Coluna<LinhaMudanca>[] = [
    { chave: 'rotulo', titulo: '', render: (l) => l.rotulo, celular: 'titulo' },
    { chave: 'hoje', titulo: 'Hoje', render: (l) => l.hoje, celular: 'campo' },
    { chave: 'depois', titulo: 'Depois da novação', render: (l) => l.depois, celular: 'campo' },
  ];

  return (
    <>
      <Observacao autor={d.criadaPor} em={d.criadaEm} texto={d.observacao} vazio="Quem propôs não escreveu observação." />
      <Trecho titulo="O que muda">
        <Tabela colunas={colunas} linhas={mudancas} chave={(l) => l.chave} larguraMinima={520} />
      </Trecho>
      <Trecho>
        <DecomposicaoNovacao d={d} titulo={`Composição do saldo novado — data-base${d.dataBase ? ` ${quando(d.dataBase)}` : ''} (memória interna: o instrumento do cliente mostra o valor consolidado)`} />
      </Trecho>
      <HistoricoRecuperacao a={a} conta={conta} rotuloComprometimento="Comprometimento com a nova parcela" />
      {(d.contratoVeiculo || d.contratoTermo) && (
        <Trecho>
          <ContratosNovacao d={d} onContrato={onContrato} />
        </Trecho>
      )}
      <Trecho titulo="Na tela de Renegociações">
        <LinkTexto to={`/acordos?novacao=${d.id}`}>Ver a novação completa (origens, contratos, assinatura, trilha) →</LinkTexto>
      </Trecho>
    </>
  );
}

// --- Histórico de recuperação / contexto da conta ---------------------------------

function HistoricoRecuperacao({ a, conta, rotuloComprometimento }: { a: AprovacaoDossie; conta: ContextoContaDossie | null; rotuloComprometimento: string }) {
  if (!conta) return null;
  const comp = conta.comprometimento;
  const acima = comp?.comOperacao != null && comp.limitePolitica != null && comp.comOperacao > comp.limitePolitica;
  const porStatus = conta.acordos.reduce<Record<string, number>>((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {});
  return (
    <Trecho titulo="Histórico de recuperação do titular">
      <div className="grid grid-cols-1 gap-[12px] text-[12.5px] sm:grid-cols-2">
        <Campo label="Acordos anteriores">
          {conta.acordos.length === 0 ? (
            'Nenhum'
          ) : (
            <div>
              <b>{conta.acordos.length} · {Object.entries(porStatus).map(([s, n]) => `${n} ${ACORDO_STATUS_TEXTO[s] ?? s}`).join(', ')}</b>
              <ul className="mt-[2px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                {conta.acordos.map((x) => (
                  <li key={x.id}>
                    <Link to={`/acordos?acordo=${x.id}`} style={{ color: 'var(--text-primary)' }}>{mesAnoBR(x.criadoEm)} · {x.plano}</Link> · {ACORDO_STATUS_TEXTO[x.status] ?? x.status}{x.cotas ? ` · ${x.cotasPagas} de ${x.cotas} cotas pagas` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Campo>
        <Campo label={rotuloComprometimento}>
          {comp?.comOperacao != null ? (
            <div>
              <b className="tabular-nums" style={{ color: acima ? TOM_DOSSIE_FG.alerta : undefined }}>{pct(comp.comOperacao)} da renda</b>
              <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                {conta.renda ? `renda apurada ${formatCurrency(conta.renda.apurada)}/mês (análise de ${mesAnoBR(conta.renda.analiseEm)})` : ''}
                {comp.atual != null ? ` · hoje ${pct(comp.atual)}` : ''}
                {comp.limitePolitica != null ? ` · política até ${pct(comp.limitePolitica)}` : ''}
              </div>
            </div>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>sem renda apurada em análise de cadastro — não dá para calcular</span>
          )}
        </Campo>
        <Campo label="Parcelas pagas no contrato">
          {conta.contratos.length === 0 ? 'Nenhum contrato ativo' : (
            <ul>
              {conta.contratos.map((c) => (
                <li key={c.id}>
                  <b className="tabular-nums">{c.parcelasPagas} de {c.numeroParcelas}</b>{' '}
                  <Link to={`/contratos/${c.id}`} className="text-[11.5px]" style={{ color: 'var(--text-primary)' }}>{c.numero}{c.placa ? ` (${c.placa})` : ''}</Link>
                  {c.recuperacaoIniciadaEm && <span className="text-[11.5px]" style={{ color: TOM_DOSSIE_FG.alerta }}> · retomada iniciada</span>}
                </li>
              ))}
            </ul>
          )}
        </Campo>
        <Campo label="Novação oferecida">
          {conta.novacoes.length === 0 ? 'Não' : conta.novacoes.map((n) => `${NOVACAO_STATUS_TEXTO[n.status] ?? n.status} (${mesAnoBR(n.criadaEm)})`).join('; ')}
        </Campo>
        {a.contexto && (
          <Campo label="Em atraso hoje">
            <span style={{ color: a.contexto.valorEmAtraso > 0 ? TOM_DOSSIE_FG.alerta : undefined }}>{formatCurrency(a.contexto.valorEmAtraso)} · {a.contexto.faturasVencidas} fatura(s) vencida(s)</span>
          </Campo>
        )}
        <Campo label="Cliente desde" valor={mesAnoBR(conta.clienteDesde)} />
      </div>
      {a.titular && <LinkTexto to={`/titulares/${a.titular.id}`}>Abrir ficha do titular →</LinkTexto>}
    </Trecho>
  );
}

// --- Análise de cadastro (COCAD) --------------------------------------------------

function DossieAnaliseCadastro({ a, d }: { a: AprovacaoDossie; d: DossieAnalise | null }) {
  const c = a.contextoAnalise;
  if (!c) return null;
  const abertas = d?.pendencias.filter((p) => p.situacao === 'ABERTA') ?? [];
  return (
    <>
      <Trecho titulo="Proposta e veículo">
        <div className="grid grid-cols-1 gap-[10px] text-[12.5px] sm:grid-cols-2 xl:grid-cols-3">
          <Campo label="Veículo" valor={c.ativo} />
          <Campo label="Ano / quilometragem na entrada" valor={[c.veiculo?.ano, c.veiculo?.quilometragem != null ? `${c.veiculo.quilometragem.toLocaleString('pt-BR')} km` : 'km não informada'].filter(Boolean).join(' · ')} />
          <Campo label="Contratos anteriores do carro" valor={c.veiculo ? (c.veiculo.contratosAnteriores === 0 ? '1º contrato do veículo' : `${c.veiculo.contratosAnteriores}`) : '—'} />
          <Campo label={`Parcela${c.frequencia ? ` (${c.frequencia})` : ''}`} valor={formatCurrency(c.valorParcela)} />
          <Campo label="Renda declarada / apurada" valor={`${c.rendaDeclarada !== null ? formatCurrency(c.rendaDeclarada) : '—'} / ${c.rendaApurada !== null ? formatCurrency(c.rendaApurada) : '—'}`} />
          <Campo label="Comprometimento">
            <span style={{ color: d?.comprometimento != null && d.criterios.some((x) => x.chave === 'comprometimento') ? TOM_DOSSIE_FG.alerta : undefined }}>{d ? pct(d.comprometimento) : '…'}</span>
          </Campo>
        </div>
      </Trecho>
      <Trecho titulo={`Parecer${c.parecer ? ` — ${c.parecer.emitidoPor} · ${quando(c.parecer.emitidoEm)}` : ''}`}>
        {c.parecer ? (
          <div className="whitespace-pre-wrap rounded-[10px] px-[12px] py-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>{c.parecer.texto}</div>
        ) : (
          <div className="text-[12px]" style={{ color: TOM_DOSSIE_FG.atencao }}>Sem parecer emitido para esta análise.</div>
        )}
      </Trecho>
      <Trecho titulo="Critérios da política">
        {!d ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Carregando os critérios…</div>
        ) : d.criterios.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum apontamento — proposta dentro da política.</div>
        ) : (
          <ul className="flex flex-col gap-[4px] text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
            {d.criterios.map((x, i) => (
              <li key={i}><b style={{ color: ANALISE_SITUACAO_FG[x.situacao] }}>{SIT_CRITERIO[x.situacao] ?? x.situacao}</b> · {x.descricao}{x.valorObservado ? ` (${x.valorObservado})` : ''}</li>
            ))}
          </ul>
        )}
        {abertas.length > 0 && (
          <div className="mt-[8px] text-[12px]" style={{ color: TOM_DOSSIE_FG.atencao }}>
            {abertas.length} pendência(s) aberta(s): {abertas.map((p) => p.descricao).join(' · ')}
          </div>
        )}
        <LinkTexto to={`/analises/${c.analiseId}`}>Abrir o dossiê completo da análise (consultas, documentos, relatório) →</LinkTexto>
      </Trecho>
    </>
  );
}

// --- Demais tipos (contas a pagar, crédito, reajuste, condição comercial) --------

function DossieGenerico({ a }: { a: AprovacaoDossie }) {
  const det = a.detalhe;
  return (
    <>
      {det?.observacao && <Observacao autor={det.observacao.autor} em={det.observacao.em} texto={det.observacao.texto} vazio="" />}
      {det?.blocos.map((b) => <BlocoGenerico key={b.titulo} b={b} />)}
      {det?.conta ? (
        <HistoricoRecuperacao a={a} conta={det.conta} rotuloComprometimento="Comprometimento da próxima fatura" />
      ) : a.contexto ? (
        <Trecho titulo="Contexto do titular">
          <div className="grid grid-cols-2 gap-[10px] text-[12.5px] sm:grid-cols-4">
            <Campo label="Contratos ativos" valor={String(a.contexto.contratosAtivos)} />
            <Campo label="Saldo devedor" valor={formatCurrency(a.contexto.saldoDevedor)} />
            <Campo label="Em atraso"><span style={{ color: a.contexto.valorEmAtraso > 0 ? TOM_DOSSIE_FG.alerta : undefined }}>{formatCurrency(a.contexto.valorEmAtraso)}</span></Campo>
            <Campo label="Faturas vencidas" valor={String(a.contexto.faturasVencidas)} />
          </div>
        </Trecho>
      ) : null}
      {!det?.blocos.length && !det?.conta && !a.contexto && (
        <Trecho titulo="Pedido"><div className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>{tituloHumano(a.resumo)}</div></Trecho>
      )}
    </>
  );
}

// Bloco genérico do backend: campos rótulo/valor e/ou tabela (configurado por props).
// A tabela vem como colunas + linhas de células; vira <Tabela> com a 1ª coluna
// como título do cartão no celular. Linha de destaque (total) sai em negrito.
type LinhaGenerica = { indice: number; celulas: string[]; destaque?: boolean };

function BlocoGenerico({ b }: { b: BlocoDossie }) {
  const tabela = b.tabela;
  const colunas: Coluna<LinhaGenerica>[] = tabela
    ? tabela.colunas.map((titulo, i) => ({
        chave: String(i),
        titulo,
        alinhar: tabela.direita?.includes(i) ? 'right' : 'left',
        celular: i === 0 ? 'titulo' : 'campo',
        classe: tabela.direita?.includes(i) ? 'tabular-nums' : undefined,
        render: (l) => (l.destaque ? <b>{l.celulas[i]}</b> : l.celulas[i]),
      }))
    : [];
  const linhas: LinhaGenerica[] = tabela ? tabela.linhas.map((l, indice) => ({ indice, celulas: l.celulas, destaque: l.destaque })) : [];
  return (
    <Trecho titulo={b.titulo}>
      {b.campos && b.campos.length > 0 && (
        <div className="grid grid-cols-1 gap-[10px] text-[12.5px] sm:grid-cols-2 xl:grid-cols-3">
          {b.campos.map((c) => (
            <Campo key={c.rotulo} label={c.rotulo}><span style={{ color: c.tom ? TOM_DOSSIE_FG[c.tom] : undefined }}>{c.valor}</span></Campo>
          ))}
        </div>
      )}
      {tabela && (
        <div className={b.campos?.length ? 'mt-[12px]' : ''}>
          <Tabela colunas={colunas} linhas={linhas} chave={(l) => String(l.indice)} larguraMinima={480} />
        </div>
      )}
      {b.nota && <div className="mt-[8px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{b.nota}</div>}
    </Trecho>
  );
}

// --- Painel "Sua decisão" ----------------------------------------------------------

function PainelDecisao({ a }: { a: AprovacaoDossie }) {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const vez = a.minha.vez;

  async function recarregar() {
    await Promise.all(
      [['aprovacao-dossie', a.id], ['aprovacoes-pendentes'], ['aprovacoes-historico'], ['aprovacoes-contagem'], ['acordo-detalhe'], ['novacao-detalhe'], ['acordos'], ['novacoes'], ['analise']]
        .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  }

  async function agir(fn: () => Promise<string>) {
    setOcupado(true);
    try {
      const msg = await fn();
      setTexto('');
      await recarregar();
      toast.sucesso(msg);
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const decidir = (decisao: DecisaoInput) =>
    agir(async () => {
      const r = await aprovacaoService.decidir(a.id, decisao, texto.trim() || undefined);
      if (decisao === 'aprovar') return r.efetivada ? (r.mensagem ?? 'Aprovada e efetivada.') : 'Aprovação registrada — aguarda as demais.';
      if (decisao === 'recomendar') return 'Recomendação registrada — segue para quem tem alçada.';
      return 'Solicitação reprovada.';
    });
  const pedirComplemento = () =>
    agir(async () => {
      await aprovacaoService.pedirComplemento(a.id, texto.trim());
      return `Complemento pedido — ${a.solicitante} recebeu o alerta.`;
    });
  const responder = () =>
    agir(async () => {
      await aprovacaoService.responderComplemento(a.id, texto.trim());
      return 'Resposta enviada — a solicitação voltou para a fila de decisão.';
    });

  const area = (placeholder: string) => (
    <textarea
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      rows={4}
      placeholder={placeholder}
      className="w-full rounded-[10px] p-[9px] text-[12.5px]"
      style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
    />
  );
  const semTexto = texto.trim().length < 5;
  const aviso = (t: React.ReactNode) => <div className="rounded-[10px] px-[12px] py-[10px] text-[12.5px]" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>{t}</div>;

  let corpo: React.ReactNode;
  if (a.status !== 'PENDENTE') {
    const ultima = a.decisoes[a.decisoes.length - 1];
    corpo = aviso(<>Solicitação <b>{(APROVACAO_STATUS_LABEL[a.status] ?? a.status).toLowerCase()}</b>{ultima ? <> — última decisão de {ultima.usuario} em {quando(ultima.em)}</> : null}.</>);
  } else if (vez === VezAprovacao.VOCE_SOLICITOU) {
    corpo = aviso('Você solicitou. Pela segregação, quem decide é outra pessoa.');
  } else if (vez === VezAprovacao.VOCE_DECIDIU) {
    corpo = aviso(`Você já registrou sua decisão. Aguardando ${a.aprovacoesFaltando} aprovação(ões).`);
  } else if (vez === VezAprovacao.RESPONDER_COMPLEMENTO && a.complementoAberto) {
    corpo = (
      <div className="flex flex-col gap-[8px]">
        {aviso(<><b>{a.complementoAberto.pedidoPor}</b> pediu complemento em {quando(a.complementoAberto.pedidoEm)}:<div className="mt-[4px] whitespace-pre-wrap">“{a.complementoAberto.pergunta}”</div></>)}
        <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Aprovar e recomendar ficam parados até a sua resposta.</div>
        {area('Sua resposta para quem perguntou')}
        <Botao variante="primaria" className="w-full" disabled={ocupado || texto.trim().length < 2} carregando={ocupado} onClick={() => void responder()}>Enviar resposta</Botao>
      </div>
    );
  } else if (vez === VezAprovacao.AGUARDANDO_COMPLEMENTO && a.complementoAberto) {
    corpo = (
      <div className="flex flex-col gap-[8px]">
        {aviso(<><b>{a.complementoAberto.pedidoPor}</b> pediu complemento a {a.solicitante}:<div className="mt-[4px] whitespace-pre-wrap">“{a.complementoAberto.pergunta}”</div></>)}
        <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          Pedido há {esperaDesde(a.complementoAberto.pedidoEm).texto}. Aprovar e recomendar voltam depois da resposta; reprovar continua possível, com parecer.
        </div>
        {a.minha.podeAprovar && (
          <>
            {area('Parecer (obrigatório para reprovar)')}
            <Botao variante="perigo" className="w-full" disabled={ocupado || semTexto} carregando={ocupado} onClick={() => void decidir('reprovar')}>Reprovar</Botao>
          </>
        )}
      </div>
    );
  } else {
    const podeAprovar = vez === VezAprovacao.DECIDIR;
    corpo = (
      <div className="flex flex-col gap-[8px]">
        {area('Parecer (obrigatório para reprovar ou pedir complemento)')}
        {podeAprovar ? (
          <Botao variante="primaria" className="w-full" disabled={ocupado} carregando={ocupado} onClick={() => void decidir('aprovar')}>Aprovar</Botao>
        ) : (
          <Botao variante="primaria" className="w-full" disabled={ocupado} carregando={ocupado} onClick={() => void decidir('recomendar')}>Recomendar ↑ (acima da minha alçada)</Botao>
        )}
        <Botao variante="secundaria" className="w-full" disabled={ocupado || semTexto} onClick={() => void pedirComplemento()} title="Escreva a pergunta no campo acima">
          Pedir complemento a {a.solicitante.split(' ')[0]}
        </Botao>
        {podeAprovar && (
          <Botao variante="perigo" className="w-full" disabled={ocupado || semTexto} onClick={() => void decidir('reprovar')} title="Escreva o motivo no campo acima">Reprovar</Botao>
        )}
        <div className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
          {podeAprovar
            ? notaAoAprovar(a)
            : `Sua alçada não cobre ${formatCurrency(a.valor)}: a recomendação fica na trilha e a solicitação segue para quem pode aprovar.`}
          {' '}Pedir complemento alerta quem solicitou com a sua pergunta e segura a decisão até a resposta — não é voto.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card p-[18px] lg:sticky lg:top-[16px]" style={card}>
      <Secao titulo="Sua decisão">{corpo}</Secao>
    </div>
  );
}
