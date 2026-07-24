import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { analiseService, DossieAnalise, ParticipanteAnalise } from '../services/analise.service';
import { reaisParaCentavos } from '../lib/valor';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';

const inputCls = 'w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-[10px] py-[7px] text-[13px]';
const btn = 'rounded-[8px] px-[12px] py-[7px] text-[12px] font-bold';
const btnP = `${btn} bg-[var(--navy)] text-white disabled:opacity-40`;
const btnS = `${btn} border border-[var(--border)]`;
const card = 'rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-[16px]';

const SIT_COR: Record<string, string> = { alcada: '#1c7a3d', complemento: '#b07000', cocad: '#b03030' };
const PAPEL: Record<string, string> = { COMPRADOR_PRINCIPAL: 'Comprador principal', COMPRADOR_SECUNDARIO: '2º comprador', GARANTIDOR: 'Garantidor' };

function moeda(c: number | null | undefined) {
  return c === null || c === undefined ? '—' : formatCurrency(c);
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

  return (
    <div className="flex flex-col gap-[16px] p-[8px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <div>
          <h1 className="font-display text-[20px] font-bold">Análise de Cadastro</h1>
          <div className="text-[12px] opacity-70">
            Política v{d.politicaVersao} · <Link className="underline" to={`/propostas/${d.propostaId}`}>proposta</Link> ·
            {' '}Parcela mensal equivalente: <b>{moeda(d.parcelaMensalEquivalente)}</b> ·
            {' '}Comprometimento: <b>{d.comprometimento !== null ? `${(d.comprometimento * 100).toFixed(1)}%` : '—'}</b> ·
            {' '}Alçada mínima: <b>{d.alcadaMinima}</b>
          </div>
        </div>
        <span className="rounded-[8px] border border-[var(--border)] px-[10px] py-[6px] text-[12px] font-bold">{d.status.replaceAll('_', ' ')}</span>
      </div>

      {/* Participantes */}
      {d.participantes.map((p) => (
        <Participante key={p.titularId} d={d} p={p} ocupado={ocupado} acao={acao} final={final} />
      ))}

      {/* Consultas (Fase 1: registro manual) */}
      {!final && <ConsultaForm d={d} ocupado={ocupado} acao={acao} />}
      {d.consultas.length > 0 && (
        <div className={card}>
          <div className="mb-[8px] font-display text-[13px] font-bold">Consultas registradas</div>
          {d.consultas.map((c) => (
            <div key={c.id} className="border-t border-[var(--border)] py-[6px] text-[12px]">
              <b>{c.tipo}</b> · {c.fornecedor} {c.protocolo && `· ${c.protocolo}`} · {new Date(c.dataConsulta).toLocaleDateString('pt-BR')} ·
              {c.situacao === 'FALHA' ? <span style={{ color: '#b03030' }}> FALHA ({c.motivoFalha}) · tentativa {c.tentativas}</span> : c.valida ? ' válida' : ' VENCIDA'}
              {c.resultado && ` · ${JSON.stringify(c.resultado)}`}
            </div>
          ))}
        </div>
      )}

      {/* Critérios do motor */}
      <div className={card}>
        <div className="mb-[8px] font-display text-[13px] font-bold">
          Critérios da política {d.aprovacaoDiretaPermitida ? '— TODOS CONFORMES (alçada do analista)' : ''}
        </div>
        {d.criterios.length === 0 && <div className="text-[12px] opacity-70">Nenhum apontamento — proposta dentro da política.</div>}
        {d.criterios.map((c, i) => (
          <div key={i} className="border-t border-[var(--border)] py-[6px] text-[12px]">
            <b style={{ color: SIT_COR[c.situacao] }}>{c.situacao.toUpperCase()}</b> {c.codigo && `· ${c.codigo}`} · {c.descricao}
            {c.valorObservado && ` (${c.valorObservado})`}
          </div>
        ))}
      </div>

      {/* Pendências e ressalvas */}
      {(d.pendencias.length > 0 || d.ressalvas.length > 0) && (
        <div className={card}>
          {d.pendencias.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-t border-[var(--border)] py-[6px] text-[12px]">
              <span>Pendência <b>{p.codigo}</b> · {p.descricao} · {p.situacao}</span>
              {p.situacao === 'ABERTA' && (
                <button className={btnS} disabled={ocupado} onClick={() => acao(() => analiseService.cumprirPendencia(d.id, p.id), 'Pendência cumprida — retorno à etapa de origem.')}>Cumprir</button>
              )}
            </div>
          ))}
          {d.ressalvas.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-t border-[var(--border)] py-[6px] text-[12px]">
              <span>Ressalva <b>{r.tipo}</b> · {r.condicao} · {r.situacao}</span>
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
          <div key={i} className="text-[11px] opacity-80">{new Date(t.createdAt).toLocaleString('pt-BR')} · {t.de ?? '—'} → <b>{t.para}</b>{t.motivo && ` · ${t.motivo}`}</div>
        ))}
      </div>
    </div>
  );
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
          {p.nome} · {PAPEL[p.papel] ?? p.papel} {condutor && <span style={{ color: '#1c7a3d' }}>· CONDUTOR PRINCIPAL</span>}
        </div>
        {!final && (
          <div className="flex flex-wrap gap-[6px]">
            {!p.autorizacaoRegistrada && (
              <button className={btnP} disabled={ocupado} onClick={() => acao(() => analiseService.registrarAutorizacao(d.id, p.titularId), 'Autorização registrada (WhatsApp).')}>
                Registrar autorização (WhatsApp)
              </button>
            )}
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
          {[
            ['identidadeValidada', 'Identidade validada', p.identidadeValidada],
            ['cnhValida', 'CNH válida', p.cnhValida],
            ['documentoAlternativo', 'RG (doc. alternativo)', p.documentoAlternativo],
            ['atividadeComprovada', 'Atividade comprovada', p.atividadeComprovada],
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

function ConsultaForm({ d, ocupado, acao }: { d: DossieAnalise; ocupado: boolean; acao: (fn: () => Promise<DossieAnalise>, ok?: string) => Promise<void> }) {
  const [f, setF] = useState({ titularId: d.participantes[0]?.titularId ?? '', tipo: 'camada1', fornecedor: 'BigDataCorp', protocolo: '', situacao: 'concluida', motivoFalha: '', score: '', rf: '', rnf: '', protesto: false });
  return (
    <div className={card}>
      <div className="mb-[8px] font-display text-[13px] font-bold">Registrar consulta (Fase 1 — manual)</div>
      <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-4">
        <select className={inputCls} value={f.titularId} onChange={(e) => setF({ ...f, titularId: e.target.value })}>
          {d.participantes.map((p) => <option key={p.titularId} value={p.titularId}>{p.nome}</option>)}
        </select>
        <select className={inputCls} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value, fornecedor: e.target.value === 'camada1' ? 'BigDataCorp' : e.target.value === 'score_quod' ? 'Quod' : 'Boa Vista' })}>
          <option value="camada1">Camada 1</option><option value="score_quod">Score Quod</option><option value="restritivos">Restritivos</option>
        </select>
        <input className={inputCls} placeholder="Protocolo" value={f.protocolo} onChange={(e) => setF({ ...f, protocolo: e.target.value })} />
        <select className={inputCls} value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value })}>
          <option value="concluida">Concluída</option><option value="falha">Falha/indisponível</option>
        </select>
        {f.situacao === 'falha' && <input className={inputCls} placeholder="Motivo da falha *" value={f.motivoFalha} onChange={(e) => setF({ ...f, motivoFalha: e.target.value })} />}
        {f.situacao === 'concluida' && f.tipo === 'score_quod' && (
          <input className={inputCls} placeholder="Score (ex.: 630)" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} />
        )}
        {f.situacao === 'concluida' && f.tipo === 'restritivos' && (
          <>
            <input className={inputCls} placeholder="Restritivos financeiros (R$)" value={f.rf} onChange={(e) => setF({ ...f, rf: e.target.value })} />
            <input className={inputCls} placeholder="Não financeiros (R$)" value={f.rnf} onChange={(e) => setF({ ...f, rnf: e.target.value })} />
            <label className="flex items-center gap-[4px] text-[12px]"><input type="checkbox" checked={f.protesto} onChange={(e) => setF({ ...f, protesto: e.target.checked })} /> Protesto/cheque/execução</label>
          </>
        )}
      </div>
      <button className={`${btnP} mt-[8px]`} disabled={ocupado} onClick={() => acao(() =>
        analiseService.registrarConsulta(d.id, {
          titularId: f.titularId, tipo: f.tipo, fornecedor: f.fornecedor, protocolo: f.protocolo || undefined,
          situacao: f.situacao, motivoFalha: f.motivoFalha || undefined,
          resultado: f.situacao === 'concluida' ? {
            ...(f.score ? { score: Number(f.score) } : {}),
            ...(f.rf ? { restritivosFinanceiros: reaisParaCentavos(f.rf) } : {}),
            ...(f.rnf ? { restritivosNaoFinanceiros: reaisParaCentavos(f.rnf) } : {}),
            protestoChequeExecucao: f.protesto,
          } : undefined,
        }), 'Consulta registrada.')}>Registrar</button>
    </div>
  );
}

function Decisao({ d, ocupado, acao }: { d: DossieAnalise; ocupado: boolean; acao: (fn: () => Promise<DossieAnalise>, ok?: string) => Promise<void> }) {
  const [parecer, setParecer] = useState('');
  const emParecer = d.status === 'PARECER_EMITIDO';
  return (
    <div className={card}>
      <div className="mb-[8px] font-display text-[13px] font-bold">Decisão</div>
      {!emParecer && !['AGUARDANDO_COCAD', 'RESSALVA_EM_TRATAMENTO'].includes(d.status) && (
        <div className="flex flex-col gap-[8px]">
          <textarea className={inputCls} rows={3} placeholder="Parecer do analista (os números vêm do sistema — descreva a conclusão)" value={parecer} onChange={(e) => setParecer(e.target.value)} />
          <div className="flex flex-wrap gap-[8px]">
            <button className={btnP} disabled={ocupado || parecer.length < 10} onClick={() => acao(() =>
              analiseService.emitirParecer(d.id, {
                tipo: d.aprovacaoDiretaPermitida ? 'aprovacao' : 'cocad',
                texto: parecer,
                codigos: d.aprovacaoDiretaPermitida ? ['APR-01'] : d.criterios.filter((c) => c.codigo).map((c) => c.codigo as string),
              }), 'Parecer emitido.')}>Emitir parecer</button>
            <button className={btnS} disabled={ocupado} onClick={() => { const m = window.prompt('Motivo do encerramento: desistencia | ausencia_retorno | expiracao', 'desistencia'); if (m) void acao(() => analiseService.encerrar(d.id, m), 'Análise encerrada.'); }}>Encerrar (operacional)</button>
          </div>
        </div>
      )}
      {emParecer && (
        <div className="flex flex-wrap gap-[8px]">
          <button className={btnP} disabled={ocupado || !d.aprovacaoDiretaPermitida} title={d.aprovacaoDiretaPermitida ? '' : 'Critérios fora da alçada'} onClick={() => acao(() => analiseService.aprovar(d.id), 'Aprovada na alçada do analista.')}>Aprovar (alçada do analista)</button>
          <button className={btnS} disabled={ocupado} onClick={() => acao(() => analiseService.submeterCocad(d.id, 'Ver parecer'), 'Submetida ao COCAD — decisão na Central de Aprovações.')}>Submeter ao COCAD</button>
          <button className={btnS} disabled={ocupado} onClick={() => { const c = window.prompt('Código NAP (ex.: NAP-06):', 'NAP-06'); const j = c && window.prompt('Justificativa (decisão humana fundamentada):'); if (c && j) void acao(() => analiseService.naoAprovar(d.id, c, j), 'Não aprovada (decisão humana).'); }}>Não aprovar</button>
        </div>
      )}
      {d.status === 'AGUARDANDO_COCAD' && (
        <div className="flex flex-wrap items-center gap-[8px] text-[12px]">
          <span>No COCAD — aprovar/não aprovar acontece na <Link className="underline" to="/aprovacoes">Central de Aprovações</Link>. Alternativas:</span>
          <button className={btnS} disabled={ocupado} onClick={() => { const t = window.prompt('Tipo: AUMENTO_ENTRADA | REDUCAO_PROPOSTA | GARANTIDOR | DOCUMENTO_ADICIONAL | AJUSTE_CONDICAO', 'AUMENTO_ENTRADA'); const c = t && window.prompt('Condição objetiva:'); if (t && c) void acao(() => analiseService.aprovarComRessalvas(d.id, [{ tipo: t, condicao: c }]), 'Aprovada com ressalvas.'); }}>Aprovar com ressalvas</button>
          <button className={btnS} disabled={ocupado} onClick={() => { const desc = window.prompt('Complemento solicitado pelo COCAD (específico):'); if (desc) void acao(() => analiseService.criarPendencia(d.id, { codigo: 'COM-10', descricao: desc }), 'Complemento solicitado.'); }}>Solicitar complemento</button>
        </div>
      )}
      {['APROVADO_ALCADA_ANALISTA', 'APROVADO_COCAD'].includes(d.status) && (
        <button className={btnP} disabled={ocupado} onClick={() => acao(() => analiseService.liberar(d.id), 'Liberada para formalização.')}>Liberar para formalização</button>
      )}
      {!emParecer && ['CADASTRO_EM_PREENCHIMENTO', 'DOCUMENTOS_ENVIADOS', 'CONSULTA_INICIAL_REALIZADA', 'EM_TRIAGEM_INICIAL', 'EM_ANALISE_COMPLEMENTAR', 'SCORE_CONSULTADO', 'RESTRICOES_CONSULTADAS'].includes(d.status) && (
        <div className="mt-[8px] text-[11px] opacity-70">Avanço de etapa: as consultas concluídas movem o status automaticamente; use o parecer ao final.</div>
      )}
    </div>
  );
}
