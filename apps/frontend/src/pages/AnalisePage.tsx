import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { analiseService, DossieAnalise, ParticipanteAnalise } from '../services/analise.service';
import { originacaoService } from '../services/originacao.service';
import { reaisParaCentavos } from '../lib/valor';
import { rotuloStatus } from '../lib/rotulos';
import { Modal } from '../components/Modal';
import { BotaoVerRetorno } from '../components/RetornoBiro';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';

// UX-3 — Análise de cadastro GUIADA (proposta UX §4.2): stepper de etapas,
// próximo passo sempre visível, modais no lugar de prompts, status por extenso.

const inputCls = 'w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-[10px] py-[7px] text-[13px]';
const btn = 'rounded-[8px] px-[12px] py-[7px] text-[12px] font-bold';
const btnP = `${btn} bg-[var(--navy)] text-white disabled:opacity-40`;
const btnS = `${btn} border border-[var(--border)]`;
const card = 'rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-[16px]';

const SIT_COR: Record<string, string> = { alcada: '#1c7a3d', complemento: '#b07000', cocad: '#b03030' };
const SIT_ROTULO: Record<string, string> = { alcada: 'Conforme', complemento: 'Pede complemento', cocad: 'Vai ao Comitê' };
const ROTULO_DOC: Record<string, string> = {
  cnh: 'CNH',
  rg: 'RG',
  extrato_bancario: 'Extrato bancário',
  extrato_aplicativo: 'Extrato do aplicativo',
  mei_cnpj: 'MEI / CNPJ',
  comprovante_atividade: 'Comprovante de atividade',
  comprovante_endereco: 'Comprovante de endereço',
  comprovante_renda: 'Comprovante de renda',
  relatorio_brick: 'Relatório BRIC',
  anexo_analise: 'Documento complementar',
};
const PAPEL: Record<string, string> = { COMPRADOR_PRINCIPAL: 'Comprador principal', COMPRADOR_SECUNDARIO: '2º comprador', GARANTIDOR: 'Garantidor' };

// Etapas macro do stepper e a qual etapa cada status pertence.
const ETAPAS = ['Cadastro e documentos', 'Consultas', 'Parecer', 'Decisão', 'Liberação'] as const;
const ETAPA_DO_STATUS: Record<string, number> = {
  ATENDIMENTO_INICIADO: 0, SIMULACAO_REALIZADA: 0, CADASTRO_EM_PREENCHIMENTO: 0,
  DOCUMENTOS_ENVIADOS: 1, CONSULTA_INICIAL_REALIZADA: 1, EM_TRIAGEM_INICIAL: 1,
  EM_ANALISE_COMPLEMENTAR: 1, SCORE_CONSULTADO: 1, PENDENTE_DE_COMPLEMENTO: 1,
  RESTRICOES_CONSULTADAS: 2,
  PARECER_EMITIDO: 3, AGUARDANDO_COCAD: 3, PENDENTE_COMPLEMENTO_COCAD: 3,
  APROVADO_COM_RESSALVAS: 3, RESSALVA_EM_TRATAMENTO: 3,
  APROVADO_ALCADA_ANALISTA: 4, APROVADO_COCAD: 4,
  LIBERADO_PARA_FORMALIZACAO: 5, NAO_APROVADO: 5, PROPOSTA_ENCERRADA: 5,
};

function moeda(c: number | null | undefined) {
  return c === null || c === undefined ? '—' : formatCurrency(c);
}

// O coração do modo guiado: o que fazer AGORA, dado o estado do dossiê.
function proximoPasso(d: DossieAnalise): string {
  // Decisão 08/08: autorização de consulta é VERBAL — sem instrumento no sistema.
  switch (d.status) {
    case 'CADASTRO_EM_PREENCHIMENTO':
      return 'Anexe os documentos obrigatórios na proposta e confirme o envio no botão abaixo.';
    case 'DOCUMENTOS_ENVIADOS':
      return 'Registre a consulta inicial (Camada 1) de cada comprador — a do comprador principal chega sozinha quando a proposta vem do atendimento.';
    case 'CONSULTA_INICIAL_REALIZADA':
    case 'EM_TRIAGEM_INICIAL':
    case 'EM_ANALISE_COMPLEMENTAR':
      return 'Informe as rendas (a apurada entra no comprometimento), valide identidade e CNH, e registre o Score.';
    case 'SCORE_CONSULTADO':
      return 'Registre a consulta de restritivos para fechar as verificações.';
    case 'RESTRICOES_CONSULTADAS':
      return 'Verificações completas — confira os critérios da política e emita o parecer.';
    case 'PARECER_EMITIDO': {
      // Decisão 2026-08-15: critérios COC RECOMENDAM o Comitê — quem decide é o analista.
      if (d.aprovacaoDiretaPermitida) return 'Todos os critérios conformes — você pode aprovar na alçada do analista.';
      if (d.criterios.some((c) => c.situacao === 'complemento'))
        return 'Há itens de complemento pendentes (dados incompletos) — resolva-os antes de decidir.';
      return 'Há critérios que recomendam o Comitê — decida: submeter ao COCAD ou aprovar na sua alçada com justificativa.';
    }
    case 'AGUARDANDO_COCAD':
      return 'Aguardando o Comitê de Cadastro — a decisão acontece na Central de Aprovações.';
    case 'PENDENTE_DE_COMPLEMENTO':
    case 'PENDENTE_COMPLEMENTO_COCAD':
      return 'Cumpra as pendências abertas abaixo para a análise retomar de onde parou.';
    case 'APROVADO_COM_RESSALVAS':
    case 'RESSALVA_EM_TRATAMENTO':
      return 'Aprovada com ressalvas — trate e valide cada ressalva abaixo.';
    case 'APROVADO_ALCADA_ANALISTA':
    case 'APROVADO_COCAD':
      return 'Aprovada — confira o pacote mínimo e libere para formalização.';
    case 'LIBERADO_PARA_FORMALIZACAO':
      return 'Liberada para formalização — siga o fluxo na proposta.';
    case 'NAO_APROVADO':
      return 'Não aprovada. O cliente pode voltar com nova proposta no futuro.';
    case 'PROPOSTA_ENCERRADA':
      return 'Encerrada operacionalmente (desistência não é reprovação).';
    default:
      return 'Siga as seções abaixo na ordem.';
  }
}

export function AnalisePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { data: d, refetch } = useQuery({ queryKey: ['analise', id], queryFn: () => analiseService.dossie(id) });
  const [ocupado, setOcupado] = useState(false);

  async function acao(fn: () => Promise<DossieAnalise>, ok?: string) {
    setOcupado(true);
    try {
      await fn();
      await refetch();
      await qc.invalidateQueries({ queryKey: ['aprovacoes'] });
      if (ok) toast.sucesso(ok);
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  if (!d) return <div className="p-[24px] text-[13px]">Carregando análise…</div>;

  const final = ['LIBERADO_PARA_FORMALIZACAO', 'NAO_APROVADO', 'PROPOSTA_ENCERRADA'].includes(d.status);
  const etapaAtual = ETAPA_DO_STATUS[d.status] ?? 0;

  return (
    <div className="flex flex-col gap-[16px] p-[8px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div>
          <h1 className="font-display text-[20px] font-bold">Análise de Cadastro</h1>
          <div className="text-[12px] opacity-70">
            Política v{d.politicaVersao} · <Link className="underline" to={`/propostas/${d.propostaId}`}>abrir proposta</Link> ·
            {' '}Parcela mensal equivalente: <b>{moeda(d.parcelaMensalEquivalente)}</b> ·
            {' '}Comprometimento de renda: <b>{d.comprometimento !== null ? `${(d.comprometimento * 100).toFixed(1)}%` : '—'}</b>
          </div>
        </div>
        <span className="rounded-[8px] border border-[var(--border)] px-[10px] py-[6px] text-[12px] font-bold">
          {rotuloStatus(d.status)}
        </span>
      </div>

      {/* Stepper de etapas */}
      <div className="flex flex-wrap items-center gap-[6px]">
        {ETAPAS.map((etapa, i) => (
          <div key={etapa} className="flex items-center gap-[6px]">
            <div
              className="flex items-center gap-[6px] rounded-full px-[12px] py-[6px] text-[12px] font-semibold"
              style={
                i < etapaAtual
                  ? { background: '#e5f5ec', color: '#1c7c4c' }
                  : i === etapaAtual && !final
                    ? { background: 'var(--navy)', color: '#fff' }
                    : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }
              }
            >
              {i < etapaAtual ? '✓' : i + 1} {etapa}
            </div>
            {i < ETAPAS.length - 1 && <span style={{ color: 'var(--border)' }}>—</span>}
          </div>
        ))}
      </div>

      {/* Próximo passo — sempre visível */}
      <div
        className="flex flex-wrap items-center justify-between gap-[10px] rounded-[12px] p-[14px]"
        style={
          d.status === 'NAO_APROVADO' || d.status === 'PROPOSTA_ENCERRADA'
            ? { background: '#fdecec', border: '1px solid #f2c4c2' }
            : { background: '#eef4ff', border: '1px solid #c9dbf5' }
        }
      >
        <div className="text-[13px]">
          <b>{final ? 'Situação: ' : 'Próximo passo: '}</b>
          {proximoPasso(d)}
        </div>
        <ProximaAcao d={d} ocupado={ocupado} acao={acao} />
      </div>

      {/* Participantes */}
      {d.participantes.map((p) => (
        <Participante key={p.titularId} d={d} p={p} ocupado={ocupado} acao={acao} final={final} />
      ))}

      {/* Documentos anexados na proposta (decisão 08/08 Q4): CNH + complementares,
          que podem ou não ser comprovante de renda — o analista decide. */}
      <div className={card}>
        <div className="mb-[8px] font-display text-[13px] font-bold">Documentos da proposta</div>
        {d.documentosProposta.length === 0 ? (
          <div className="text-[12px] opacity-70">Nenhum documento anexado na proposta.</div>
        ) : (
          d.documentosProposta.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between border-t border-[var(--border)] py-[6px] text-[12px]">
              <span>
                <b>{ROTULO_DOC[doc.tipo] ?? doc.tipo.replace(/_/g, ' ')}</b> · {doc.nome}
                <span className="opacity-60"> · {new Date(doc.anexadoEm).toLocaleDateString('pt-BR')}</span>
              </span>
              <button
                className="font-semibold"
                style={{ color: 'var(--navy)' }}
                onClick={() => void originacaoService.baixarDocumento(doc.id, doc.nome)}
              >
                Baixar
              </button>
            </div>
          ))
        )}
      </div>

      {/* Consultas (Fase 1: registro manual) */}
      {/* Transcrição manual de consulta REMOVIDA da tela (feedback 28/08 — não é
          usada; o fluxo oficial é o birô pelos botões do quadro de consultas).
          O endpoint continua existindo como plano B de emergência via API. */}
      {d.consultas.length > 0 && (
        <div className={card}>
          <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[8px]">
            <span className="font-display text-[13px] font-bold">Consultas registradas</span>
            {!final && (
              <span className="flex flex-wrap gap-[6px]">
                <button
                  className={btnS}
                  disabled={ocupado}
                  onClick={() => {
                    if (!window.confirm('Repetir a consulta da Camada 1 no birô agora? Consome consultas da franquia (3 datasets).')) return;
                    void acao(() => analiseService.repetirCamada1(d.id), 'Consulta da Camada 1 repetida no birô.');
                  }}
                >
                  Repetir Camada 1 no birô
                </button>
                <button
                  className={btnS}
                  disabled={ocupado}
                  onClick={() => {
                    if (!window.confirm('Consultar o SCORE Quod via Marketplace da BigDataCorp?\n\nEsta chamada é PAGA (~R$ 2,41) e fica FORA da franquia gratuita.')) return;
                    void acao(() => analiseService.consultarBiro(d.id, 'score_quod'), 'Score Quod consultado no birô.');
                  }}
                >
                  Consultar Score Quod (pago)
                </button>
                <button
                  className={btnS}
                  disabled={ocupado}
                  onClick={() => {
                    if (!window.confirm('Consultar os RESTRITIVOS Quod via Marketplace da BigDataCorp?\n\nEsta chamada é PAGA (~R$ 2,41) e fica FORA da franquia gratuita.')) return;
                    void acao(() => analiseService.consultarBiro(d.id, 'restritivos'), 'Restritivos Quod consultados no birô.');
                  }}
                >
                  Consultar Restritivos Quod (pago)
                </button>
              </span>
            )}
          </div>
          {d.consultas.map((c) => {
            const r = (c.resultado ?? {}) as Record<string, unknown>;
            const motivos = Array.isArray(r.motivos) ? (r.motivos as string[]) : [];
            const alertas = Array.isArray(r.alertas) ? (r.alertas as string[]) : [];
            // Registro antigo sem os dados que a política consome: não conta.
            const semDados =
              c.situacao === 'CONCLUIDA' &&
              ((c.tipo === 'SCORE_QUOD' && typeof r.score !== 'number') ||
                (c.tipo === 'RESTRITIVOS' && (typeof r.restritivosFinanceiros !== 'number' || typeof r.restritivosNaoFinanceiros !== 'number')));
            return (
              <div key={c.id} className="border-t border-[var(--border)] py-[6px] text-[12px]">
                <b>{c.tipo === 'CAMADA1' ? 'Camada 1' : c.tipo === 'SCORE_QUOD' ? 'Score' : 'Restritivos'}</b> · {c.fornecedor} {c.protocolo && `· ${c.protocolo}`} · {new Date(c.dataConsulta).toLocaleDateString('pt-BR')} ·
                {c.situacao === 'FALHA' ? <span style={{ color: '#b03030' }}> falhou ({c.motivoFalha}) · tentativa {c.tentativas}</span> : c.valida ? ' válida' : <span style={{ color: '#b07000' }}> vencida (mais de 30 dias)</span>}
                {c.resultado && ` · ${resumoResultado(c.resultado)}`}
                {semDados && (
                  <span className="ml-[6px] rounded-full px-[8px] py-[1px] text-[11px] font-bold" style={{ background: '#fdecec', color: '#a12622' }}>
                    sem valores — não conta para a política, registre de novo
                  </span>
                )}
                <BotaoVerRetorno
                  titulo={`Retorno do birô — ${c.tipo === 'CAMADA1' ? 'Camada 1' : c.tipo === 'SCORE_QUOD' ? 'Score Quod' : 'Restritivos Quod'} · ${new Date(c.dataConsulta).toLocaleDateString('pt-BR')}`}
                  resultado={c.resultado}
                />
                {typeof r.statusApi === 'string' && r.statusApi && (
                  <div className="mt-[3px] rounded-[8px] px-[8px] py-[4px] text-[11.5px]" style={{ background: '#eef2f7', color: '#3d4a5c' }}>
                    <b>Mensagem da API do birô:</b> {r.statusApi}
                  </div>
                )}
                {/* Camada 1 (decisão 08/08 Q3): motivos internos e alertas SEMPRE visíveis ao analista */}
                {motivos.length > 0 && (
                  <div className="mt-[3px] rounded-[8px] px-[8px] py-[4px]" style={{ background: '#fdecec', color: '#a12622' }}>
                    <b>Eliminatórios (internos — não mostrados ao operador/cliente):</b> {motivos.join(' · ')}
                  </div>
                )}
                {alertas.length > 0 && (
                  <div className="mt-[3px] rounded-[8px] px-[8px] py-[4px]" style={{ background: '#fff3d6', color: '#8a5a00' }}>
                    <b>Alertas:</b> {alertas.join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Critérios do motor */}
      <div className={card}>
        <div className="mb-[8px] font-display text-[13px] font-bold">
          Critérios da política {d.aprovacaoDiretaPermitida ? '— todos conformes (alçada do analista)' : ''}
        </div>
        {d.criterios.length === 0 && <div className="text-[12px] opacity-70">Nenhum apontamento — proposta dentro da política.</div>}
        {d.criterios.map((c, i) => (
          <div key={i} className="border-t border-[var(--border)] py-[6px] text-[12px]">
            <b style={{ color: SIT_COR[c.situacao] }}>{SIT_ROTULO[c.situacao] ?? c.situacao}</b> {c.codigo && `· ${c.codigo}`} · {c.descricao}
            {c.valorObservado && ` (${c.valorObservado})`}
          </div>
        ))}
      </div>

      {/* Pendências e ressalvas */}
      {(d.pendencias.length > 0 || d.ressalvas.length > 0) && (
        <div className={card}>
          <div className="mb-[8px] font-display text-[13px] font-bold">Pendências e ressalvas</div>
          {d.pendencias.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-t border-[var(--border)] py-[6px] text-[12px]">
              <span>Pendência <b>{p.codigo}</b> · {p.descricao} · {p.situacao === 'ABERTA' ? 'aberta' : 'cumprida'}</span>
              {p.situacao === 'ABERTA' && (
                <button className={btnS} disabled={ocupado} onClick={() => acao(() => analiseService.cumprirPendencia(d.id, p.id), 'Pendência cumprida — a análise retomou da etapa de origem.')}>Marcar como cumprida</button>
              )}
            </div>
          ))}
          {d.ressalvas.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-t border-[var(--border)] py-[6px] text-[12px]">
              <span>Ressalva <b>{r.tipo.replaceAll('_', ' ').toLowerCase()}</b> · {r.condicao} · {r.situacao.toLowerCase()}</span>
              {['PENDENTE', 'CUMPRIDA'].includes(r.situacao) && (
                <button className={btnS} disabled={ocupado} onClick={() => acao(() => analiseService.validarRessalva(d.id, r.id), 'Ressalva validada.')}>Validar</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pacote mínimo */}
      <div className={card}>
        <div className="mb-[8px] font-display text-[13px] font-bold">Pacote mínimo para formalização</div>
        {d.pacoteMinimo.map((x, i) => (
          <div key={i} className="text-[12px]">
            <span style={{ color: x.ok ? '#1c7a3d' : '#b03030' }}>{x.ok ? '✓' : '✗'}</span> {x.item}
          </div>
        ))}
      </div>

      {/* Ações de decisão */}
      {!final && <Decisao d={d} ocupado={ocupado} acao={acao} />}

      {/* Trilha */}
      <div className={card}>
        <div className="mb-[8px] font-display text-[13px] font-bold">Trilha de estados</div>
        {d.transicoes.map((t, i) => (
          <div key={i} className="text-[11px] opacity-80">
            {new Date(t.createdAt).toLocaleString('pt-BR')} · {t.de ? rotuloStatus(t.de) : 'início'} → <b>{rotuloStatus(t.para)}</b>{t.motivo && ` · ${t.motivo}`}
          </div>
        ))}
      </div>
    </div>
  );
}

function resumoResultado(r: Record<string, unknown>): string {
  const partes: string[] = [];
  // Camada 1 automática (dados do birô — decisão 08/08 Q2/Q4)
  if (r.situacaoCpf) partes.push(`CPF ${String(r.situacaoCpf).toLowerCase()}`);
  if (typeof r.idade === 'number') partes.push(`${r.idade} anos`);
  if (r.indicacaoObito === true) partes.push('INDICAÇÃO DE ÓBITO');
  if (r.nomeOficial) partes.push(`nome oficial: ${r.nomeOficial}`);
  if (r.faixaRendaPresumida) partes.push(`renda presumida: ${r.faixaRendaPresumida}`);
  if (r.faixaPatrimonio) partes.push(`patrimônio: ${r.faixaPatrimonio}`);
  if (typeof r.processosTotal === 'number') {
    partes.push(
      r.processosTotal === 0
        ? 'sem processos judiciais'
        : `${r.processosTotal} processo(s)${typeof r.processosComoReu === 'number' && r.processosComoReu > 0 ? ` (${r.processosComoReu} como réu)` : ''}`,
    );
  }
  if (r.simulado === true) partes.push('consulta SIMULADA');
  if (r.score !== undefined) partes.push(`score ${r.score}`);
  if (r.restritivosFinanceiros !== undefined) partes.push(`restritivos financeiros ${formatCurrency(r.restritivosFinanceiros as number)}`);
  if (r.restritivosNaoFinanceiros !== undefined) partes.push(`não financeiros ${formatCurrency(r.restritivosNaoFinanceiros as number)}`);
  if (r.protestoChequeExecucao) partes.push('protesto/cheque/execução');
  if (r.resumo) partes.push(String(r.resumo));
  return partes.join(' · ');
}

// Botão da ação principal do momento, ao lado do texto de próximo passo.
function ProximaAcao({ d, ocupado, acao }: { d: DossieAnalise; ocupado: boolean; acao: (fn: () => Promise<DossieAnalise>, ok?: string) => Promise<void> }) {
  if (d.status === 'CADASTRO_EM_PREENCHIMENTO') {
    return (
      <button className={btnP} disabled={ocupado} onClick={() => acao(() => analiseService.transicionar(d.id, 'DOCUMENTOS_ENVIADOS'), 'Documentos confirmados — siga para as consultas.')}>
        Confirmar documentos enviados
      </button>
    );
  }
  if (d.status === 'AGUARDANDO_COCAD') {
    return <Link to="/aprovacoes" className={btnP}>Abrir Central de Aprovações</Link>;
  }
  if (['APROVADO_ALCADA_ANALISTA', 'APROVADO_COCAD'].includes(d.status)) {
    return (
      <button className={btnP} disabled={ocupado} onClick={() => acao(() => analiseService.liberar(d.id), 'Liberada para formalização.')}>
        Liberar para formalização
      </button>
    );
  }
  if (d.status === 'LIBERADO_PARA_FORMALIZACAO') {
    return <Link to={`/propostas/${d.propostaId}`} className={btnP}>Ir para a proposta</Link>;
  }
  return null;
}

function Participante({ d, p, ocupado, acao, final }: { d: DossieAnalise; p: ParticipanteAnalise; ocupado: boolean; acao: (fn: () => Promise<DossieAnalise>, ok?: string) => Promise<void>; final: boolean }) {
  const [rd, setRd] = useState(p.rendaDeclarada ? (p.rendaDeclarada / 100).toLocaleString('pt-BR') : '');
  const [rp, setRp] = useState(p.rendaPresumida ? (p.rendaPresumida / 100).toLocaleString('pt-BR') : '');
  const [ra, setRa] = useState(p.rendaApurada !== null ? (p.rendaApurada / 100).toLocaleString('pt-BR') : '');
  const [just, setJust] = useState('');
  const condutor = d.condutorPrincipalTitularId === p.titularId;

  function flag(campo: string, valor: boolean) {
    void acao(() => analiseService.atualizarParticipante(d.id, p.titularId, { [campo]: valor }));
  }

  return (
    <div className={card}>
      <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[6px]">
        <div className="font-display text-[13px] font-bold">
          {p.nome} · {PAPEL[p.papel] ?? p.papel} {condutor && <span style={{ color: '#1c7a3d' }}>· condutor principal</span>}
        </div>
        {!final && (
          <div className="flex flex-wrap gap-[6px]">
            {/* Decisão 08/08: autorização de consulta é verbal — botão removido. */}
            {!condutor && p.papel !== 'GARANTIDOR' && (
              <button className={btnS} disabled={ocupado || !p.cnhValida} title={p.cnhValida ? '' : 'Exige CNH válida'} onClick={() => acao(() => analiseService.definirCondutor(d.id, p.titularId), 'Condutor principal definido.')}>
                Definir condutor
              </button>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-3">
        {[
          ['Renda declarada (R$)', rd, setRd, 'rendaDeclarada', undefined],
          ['Renda presumida (R$)', rp, setRp, 'rendaPresumida', undefined],
          ['Renda APURADA (R$)', ra, setRa, 'rendaApurada', p.rendaApurada],
        ].map(([rotulo, valor, setValor, campo, atual]) => (
          <label key={campo as string} className="flex flex-col gap-[4px] text-[11px] font-bold">
            {rotulo as string}
            <input className={inputCls} value={valor as string} disabled={final} onChange={(e) => (setValor as (v: string) => void)(e.target.value)} />
            {campo === 'rendaApurada' && (atual as number | null) !== null && (
              <input className={inputCls} placeholder="Justificativa da alteração (obrigatória)" value={just} onChange={(e) => setJust(e.target.value)} />
            )}
          </label>
        ))}
      </div>
      {!final && (
        <div className="mt-[8px] flex flex-wrap items-center gap-[10px] text-[12px]">
          <button className={btnP} disabled={ocupado} onClick={() => acao(() =>
            analiseService.atualizarParticipante(d.id, p.titularId, {
              rendaDeclarada: rd ? reaisParaCentavos(rd) : null,
              rendaPresumida: rp ? reaisParaCentavos(rp) : null,
              rendaApurada: ra ? reaisParaCentavos(ra) : null,
              ...(just ? { justificativaRendaApurada: just } : {}),
            }), 'Rendas salvas.')}>Salvar rendas</button>
          {/* Decisão 08/08: só checks do que COLETAMOS — CNH (arquivo na proposta),
              identidade (conferida contra o nome oficial da Camada 1), renda
              parcial e processos (julgamento do alerta do birô). "Atividade
              comprovada" e "RG alternativo" saíram: não coletamos esses docs. */}
          {[
            ['identidadeValidada', 'Identidade validada (confira o nome oficial na consulta Camada 1)', p.identidadeValidada],
            ['cnhValida', 'CNH válida (arquivo em Documentos da proposta)', p.cnhValida],
            ['rendaParcialmenteComprovada', 'Renda parcial', p.rendaParcialmenteComprovada],
            ['processosRelevantes', 'Processos relevantes', p.processosRelevantes],
          ].map(([campo, rotulo, marcado]) => (
            <label key={campo as string} className="flex items-center gap-[4px]">
              <input type="checkbox" checked={marcado as boolean} disabled={ocupado} onChange={(e) => flag(campo as string, e.target.checked)} />
              {rotulo as string}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decisão — todas as escolhas em MODAIS com contexto (princípio P6, nunca prompt)
// ---------------------------------------------------------------------------

const MOTIVOS_ENCERRAMENTO = [
  { v: 'desistencia', l: 'Desistência do cliente' },
  { v: 'ausencia_retorno', l: 'Cliente não retornou' },
  { v: 'expiracao', l: 'Prazo da análise expirou' },
];
const CODIGOS_NAP = ['NAP-01', 'NAP-02', 'NAP-03', 'NAP-04', 'NAP-05', 'NAP-06'];
const TIPOS_RESSALVA = [
  { v: 'AUMENTO_ENTRADA', l: 'Aumento de entrada' },
  { v: 'REDUCAO_PROPOSTA', l: 'Redução da proposta' },
  { v: 'GARANTIDOR', l: 'Inclusão de garantidor' },
  { v: 'DOCUMENTO_ADICIONAL', l: 'Documento adicional' },
  { v: 'AJUSTE_CONDICAO', l: 'Ajuste de condição' },
];

type AcaoFn = (fn: () => Promise<DossieAnalise>, ok?: string) => Promise<void>;

function Decisao({ d, ocupado, acao }: { d: DossieAnalise; ocupado: boolean; acao: AcaoFn }) {
  const [parecer, setParecer] = useState('');
  const [modal, setModal] = useState<null | 'encerrar' | 'nao_aprovar' | 'ressalvas' | 'complemento' | 'aprovar_justificando'>(null);
  const emParecer = d.status === 'PARECER_EMITIDO';
  // Decisão 2026-08-15 §14.2: depois que a decisão saiu das mãos do analista,
  // o campo de parecer some — reemitir regredia análise já aprovada pelo COCAD.
  const decidida = ['AGUARDANDO_COCAD', 'PENDENTE_COMPLEMENTO_COCAD', 'APROVADO_COM_RESSALVAS', 'RESSALVA_EM_TRATAMENTO', 'APROVADO_ALCADA_ANALISTA', 'APROVADO_COCAD'].includes(d.status);
  const temComplemento = d.criterios.some((c) => c.situacao === 'complemento');
  const codigosCocad = d.criterios.filter((c) => c.situacao === 'cocad' && c.codigo).map((c) => c.codigo as string);

  return (
    <div className={card}>
      <div className="mb-[8px] font-display text-[13px] font-bold">Decisão</div>

      {!emParecer && !decidida && (
        <div className="flex flex-col gap-[8px]">
          <textarea className={inputCls} rows={3} placeholder="Parecer do analista (os números vêm do sistema — descreva a conclusão)" value={parecer} onChange={(e) => setParecer(e.target.value)} />
          <div className="flex flex-wrap gap-[8px]">
            <button className={btnP} disabled={ocupado || parecer.length < 10} onClick={() => acao(() =>
              analiseService.emitirParecer(d.id, {
                tipo: d.aprovacaoDiretaPermitida ? 'aprovacao' : 'cocad',
                texto: parecer,
                codigos: d.aprovacaoDiretaPermitida ? ['APR-01'] : d.criterios.filter((c) => c.codigo).map((c) => c.codigo as string),
              }), 'Parecer emitido.')}>Emitir parecer</button>
            <button className={btnS} disabled={ocupado} onClick={() => setModal('encerrar')}>Encerrar (operacional)</button>
          </div>
        </div>
      )}

      {emParecer && (
        <div className="flex flex-col gap-[8px]">
          {codigosCocad.length > 0 && !temComplemento && (
            <div className="rounded-[8px] px-[10px] py-[6px] text-[12px]" style={{ background: '#fff3d6', color: '#8a5a00' }}>
              Critérios {codigosCocad.join(', ')} <b>recomendam</b> o Comitê — a decisão de encaminhar é sua: submeta ao COCAD ou aprove na sua alçada com justificativa (fica na trilha e na auditoria).
            </div>
          )}
          <div className="flex flex-wrap gap-[8px]">
            <button
              className={btnP}
              disabled={ocupado || temComplemento}
              title={temComplemento ? 'Itens de complemento pendentes (dados incompletos)' : codigosCocad.length ? 'Aprovar contra a recomendação exige justificativa' : ''}
              onClick={() => (codigosCocad.length ? setModal('aprovar_justificando') : void acao(() => analiseService.aprovar(d.id), 'Aprovada na alçada do analista.'))}
            >
              Aprovar (alçada do analista)
            </button>
            <button className={btnS} disabled={ocupado} onClick={() => acao(() => analiseService.submeterCocad(d.id, 'Ver parecer'), 'Submetida ao Comitê — decisão na Central de Aprovações.')}>Submeter ao Comitê de Cadastro</button>
            <button className={btnS} disabled={ocupado} onClick={() => setModal('nao_aprovar')}>Não aprovar</button>
            <button className={btnS} disabled={ocupado} onClick={() => setModal('encerrar')}>Encerrar (operacional)</button>
          </div>
        </div>
      )}

      {d.status === 'AGUARDANDO_COCAD' && (
        <div className="flex flex-wrap items-center gap-[8px] text-[12px]">
          <span>No Comitê — aprovar/não aprovar acontece na <Link className="underline" to="/aprovacoes">Central de Aprovações</Link>. Alternativas:</span>
          <button className={btnS} disabled={ocupado} onClick={() => setModal('ressalvas')}>Aprovar com ressalvas</button>
          <button className={btnS} disabled={ocupado} onClick={() => setModal('complemento')}>Solicitar complemento</button>
        </div>
      )}

      {['APROVADO_ALCADA_ANALISTA', 'APROVADO_COCAD'].includes(d.status) && (
        <button className={btnP} disabled={ocupado} onClick={() => acao(() => analiseService.liberar(d.id), 'Liberada para formalização.')}>Liberar para formalização</button>
      )}

      <ModalAprovarJustificando aberto={modal === 'aprovar_justificando'} codigos={codigosCocad} fechar={() => setModal(null)} ocupado={ocupado} confirmar={(justificativa) => { setModal(null); void acao(() => analiseService.aprovar(d.id, justificativa), 'Aprovada na alçada do analista (contra recomendação — registrado na trilha).'); }} />
      <ModalEncerrar aberto={modal === 'encerrar'} fechar={() => setModal(null)} ocupado={ocupado} confirmar={(motivo) => { setModal(null); void acao(() => analiseService.encerrar(d.id, motivo), 'Análise encerrada.'); }} />
      <ModalNaoAprovar aberto={modal === 'nao_aprovar'} fechar={() => setModal(null)} ocupado={ocupado} confirmar={(codigo, justificativa) => { setModal(null); void acao(() => analiseService.naoAprovar(d.id, codigo, justificativa), 'Não aprovada (decisão humana registrada).'); }} />
      <ModalRessalvas aberto={modal === 'ressalvas'} fechar={() => setModal(null)} ocupado={ocupado} confirmar={(tipo, condicao) => { setModal(null); void acao(() => analiseService.aprovarComRessalvas(d.id, [{ tipo, condicao }]), 'Aprovada com ressalvas.'); }} />
      <ModalComplemento aberto={modal === 'complemento'} fechar={() => setModal(null)} ocupado={ocupado} confirmar={(descricao) => { setModal(null); void acao(() => analiseService.criarPendencia(d.id, { codigo: 'COM-10', descricao }), 'Complemento solicitado.'); }} />
    </div>
  );
}

// Decisão 2026-08-15: aprovar com critérios COC presentes é decisão do analista,
// com justificativa obrigatória — o modal deixa claro o que está sendo assumido.
function ModalAprovarJustificando({ aberto, codigos, fechar, ocupado, confirmar }: { aberto: boolean; codigos: string[]; fechar: () => void; ocupado: boolean; confirmar: (justificativa: string) => void }) {
  const [justificativa, setJustificativa] = useState('');
  return (
    <Modal open={aberto} onClose={fechar} title="Aprovar na alçada — contra a recomendação">
      <div className="flex flex-col gap-[10px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Os critérios <b>{codigos.join(', ')}</b> recomendam o Comitê de Cadastro. Você pode aprovar
          na sua alçada mesmo assim — a justificativa fica registrada na trilha da análise e na auditoria.
        </div>
        <label className="text-[12px] font-semibold">Justificativa (obrigatória)</label>
        <textarea className={inputCls} rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="ex.: renda apurada consistente com extratos; comprometimento mitigado por entrada reforçada" />
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} disabled={ocupado || justificativa.trim().length < 10} onClick={() => confirmar(justificativa.trim())}>Aprovar com justificativa</button>
        </div>
      </div>
    </Modal>
  );
}

function ModalEncerrar({ aberto, fechar, ocupado, confirmar }: { aberto: boolean; fechar: () => void; ocupado: boolean; confirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('desistencia');
  return (
    <Modal open={aberto} onClose={fechar} title="Encerrar análise (operacional)">
      <div className="flex flex-col gap-[10px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Isso vai encerrar a análise <b>sem reprovar o cliente</b> — desistência não é não aprovação e não impede uma nova proposta no futuro.
        </div>
        <label className="text-[12px] font-semibold">Motivo do encerramento</label>
        <select className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)}>
          {MOTIVOS_ENCERRAMENTO.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
        </select>
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} disabled={ocupado} onClick={() => confirmar(motivo)}>Encerrar análise</button>
        </div>
      </div>
    </Modal>
  );
}

function ModalNaoAprovar({ aberto, fechar, ocupado, confirmar }: { aberto: boolean; fechar: () => void; ocupado: boolean; confirmar: (codigo: string, justificativa: string) => void }) {
  const [codigo, setCodigo] = useState('NAP-06');
  const [justificativa, setJustificativa] = useState('');
  return (
    <Modal open={aberto} onClose={fechar} title="Não aprovar a análise">
      <div className="flex flex-col gap-[10px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          Decisão humana fundamentada (a política não reprova automaticamente). Isso vai encerrar a análise como <b>não aprovada</b>.
        </div>
        <label className="text-[12px] font-semibold">Código da não aprovação</label>
        <select className={inputCls} value={codigo} onChange={(e) => setCodigo(e.target.value)}>
          {CODIGOS_NAP.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="text-[12px] font-semibold">Justificativa</label>
        <textarea className={inputCls} rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Fundamente a decisão — fica registrado na trilha e na auditoria." />
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} disabled={ocupado || justificativa.trim().length < 10} onClick={() => confirmar(codigo, justificativa.trim())}>Não aprovar</button>
        </div>
      </div>
    </Modal>
  );
}

function ModalRessalvas({ aberto, fechar, ocupado, confirmar }: { aberto: boolean; fechar: () => void; ocupado: boolean; confirmar: (tipo: string, condicao: string) => void }) {
  const [tipo, setTipo] = useState('AUMENTO_ENTRADA');
  const [condicao, setCondicao] = useState('');
  return (
    <Modal open={aberto} onClose={fechar} title="Aprovar com ressalvas">
      <div className="flex flex-col gap-[10px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          A aprovação só vale depois que a ressalva for cumprida e validada.
        </div>
        <label className="text-[12px] font-semibold">Tipo de ressalva</label>
        <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS_RESSALVA.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
        <label className="text-[12px] font-semibold">Condição objetiva</label>
        <input className={inputCls} value={condicao} onChange={(e) => setCondicao(e.target.value)} placeholder="ex.: entrada mínima de R$ 6.000,00" />
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} disabled={ocupado || condicao.trim().length < 3} onClick={() => confirmar(tipo, condicao.trim())}>Aprovar com ressalva</button>
        </div>
      </div>
    </Modal>
  );
}

function ModalComplemento({ aberto, fechar, ocupado, confirmar }: { aberto: boolean; fechar: () => void; ocupado: boolean; confirmar: (descricao: string) => void }) {
  const [descricao, setDescricao] = useState('');
  return (
    <Modal open={aberto} onClose={fechar} title="Solicitar complemento (Comitê)">
      <div className="flex flex-col gap-[10px]">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          A análise volta para complemento e retoma automaticamente quando a pendência for cumprida.
        </div>
        <label className="text-[12px] font-semibold">O que precisa ser complementado (específico)</label>
        <textarea className={inputCls} rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex.: extrato do aplicativo dos últimos 90 dias do comprador principal" />
        <div className="flex justify-end gap-[8px]">
          <button className={btnS} onClick={fechar}>Cancelar</button>
          <button className={btnP} disabled={ocupado || descricao.trim().length < 5} onClick={() => confirmar(descricao.trim())}>Solicitar</button>
        </div>
      </div>
    </Modal>
  );
}
