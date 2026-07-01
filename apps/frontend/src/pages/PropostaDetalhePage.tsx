import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { originacaoService } from '../services/originacao.service';
import { produtoService } from '../services/produto.service';
import { StatusBadge } from '../components/StatusBadge';
import { Stepper } from '../components/Stepper';
import { PROPOSTA_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, ROLE_PARECER, mensagemErro } from '../lib/permissoes';

const LABEL_STATUS: Record<string, string> = {
  pendente: 'Pendente', em_analise: 'Em análise', aprovada: 'Aprovada',
  reprovada: 'Reprovada', em_formalizacao: 'Em formalização', convertida: 'Convertida', cancelada: 'Cancelada',
};
const PAPEL_LABEL: Record<string, string> = {
  comprador_principal: 'Comprador principal', comprador_secundario: 'Comprador secundário', garantidor: 'Garantidor',
};
const DOC_LABEL: Record<string, string> = {
  cnh: 'CNH', comprovante_endereco: 'Comp. endereço', comprovante_renda: 'Comp. renda', relatorio_brick: 'Relatório Brick',
};
const STEPS = [
  { key: 'proposta', label: 'Proposta' },
  { key: 'principal', label: 'Principal' },
  { key: 'analise', label: 'Análise' },
  { key: 'revisao', label: 'Revisão' },
  { key: 'conclusao', label: 'Conclusão' },
];

const card = { background: 'var(--surface)', border: '1px solid var(--border)' };
const inputCls = 'h-[34px] rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' };
const btn = (bg: string) => ({ background: bg, color: '#fff' });
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{children}</span>
);

export function PropostaDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const podeParecer = pode(ROLE_PARECER);
  const [ocupado, setOcupado] = useState(false);
  const [documento, setDocumento] = useState('');
  const [step, setStep] = useState(1);
  const initRef = useRef(false);

  // forms
  const [garNome, setGarNome] = useState(''); const [garCpf, setGarCpf] = useState(''); const [garZap, setGarZap] = useState('');
  const [showSeg, setShowSeg] = useState(false);
  const [segNome, setSegNome] = useState(''); const [segCpf, setSegCpf] = useState(''); const [segZap, setSegZap] = useState('');
  const [resultado, setResultado] = useState('aprovado'); const [exigeGar, setExigeGar] = useState(false); const [motivo, setMotivo] = useState('');
  const [produtoSel, setProdutoSel] = useState('');
  const catalogo = useQuery({ queryKey: ['produtos'], queryFn: () => produtoService.listar() });

  const q = useQuery({ queryKey: ['proposta', id], queryFn: () => originacaoService.detalheProposta(id), enabled: !!id });
  const p = q.data;
  const contratoId = q.data?.contratoGeradoId ?? undefined;
  const pacote = useQuery({ queryKey: ['pacote-status', id], queryFn: () => originacaoService.statusPacote(id), enabled: !!contratoId });

  async function run(fn: () => Promise<unknown>) {
    setOcupado(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['proposta', id] });
      await queryClient.invalidateQueries({ queryKey: ['propostas'] });
      await queryClient.invalidateQueries({ queryKey: ['pacote-status'] });
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function anexarArquivo(titularId: string, tipo: string, file: File) {
    const conteudo = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    await run(() => originacaoService.anexarDocumento(id, titularId, tipo, { nome: file.name, conteudo }));
  }

  const hasGarantidor = !!p?.papeis.some((v) => v.papel === 'garantidor');
  const hasSecundario = !!p?.papeis.some((v) => v.papel === 'comprador_secundario');
  const precisaGarantidor = !!p?.parecer?.exigeGarantidor && !hasGarantidor && p?.status !== 'convertida';
  const aprovada = !!p && ['aprovada', 'em_formalizacao', 'convertida'].includes(p.status);
  const podeFormalizar = aprovada && !p?.contratoGeradoId && !precisaGarantidor;

  let maxReachable = 1;
  if (p?.documentosCompletos) maxReachable = 2;
  if (p?.parecer) maxReachable = 3;
  if (aprovada && !precisaGarantidor) maxReachable = 4;

  // Ao carregar, posiciona no passo mais avançado alcançável (uma vez).
  useEffect(() => {
    if (p && !initRef.current) { initRef.current = true; setStep(maxReachable); }
  }, [p, maxReachable]);

  if (q.isLoading || !p) return <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>;

  const papeisComDocs = p.papeis.filter((v) => v.papel === 'comprador_principal' || v.papel === 'comprador_secundario');

  return (
    <div className="flex flex-col gap-[16px]">
      <button onClick={() => navigate('/propostas')} className="self-start text-[12.5px]" style={{ color: 'var(--text-muted)' }}>← Voltar para Propostas</button>

      {/* Cabeçalho + Stepper */}
      <div className="rounded-card p-[18px]" style={card}>
        <div className="mb-[14px] flex items-center justify-between">
          <div>
            <div className="font-display text-[18px] font-bold">{p.titular.nome}</div>
            <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>{p.ativo.descricao} · CPF {p.titular.cpfCnpj}</div>
          </div>
          <StatusBadge label={LABEL_STATUS[p.status] ?? p.status} colors={PROPOSTA_STATUS_COLORS} />
        </div>
        <Stepper steps={STEPS} current={step} maxReachable={maxReachable} onSelect={setStep} />
      </div>

      {/* Passo 1 — Proposta (oferta read-only) */}
      {step === 0 && (
        <div className="rounded-card p-[18px]" style={card}>
          <div className="mb-[10px] font-display text-[13px] font-bold">Condições da proposta</div>
          <div className="grid grid-cols-4 gap-[14px] text-[12.5px]">
            <div><Lbl>Modalidade</Lbl><div>{p.modalidade}</div></div>
            <div><Lbl>Entrada</Lbl><div>{formatCurrency(p.valorEntrada)}</div></div>
            <div><Lbl>Parcelas</Lbl><div>{p.numeroParcelas}× {formatCurrency(p.valorParcela)}</div></div>
            <div><Lbl>Prazo</Lbl><div>{p.prazoSemanas} semanas</div></div>
          </div>
        </div>
      )}

      {/* Passo 2 — Principal (produtos + cadastro + documentos + papéis) */}
      {step === 1 && (
        <div className="flex flex-col gap-[16px]">
          {/* Produtos do contrato (carrinho) */}
          <div className="rounded-card p-[18px]" style={card}>
            <div className="mb-[10px] font-display text-[13px] font-bold">Produtos do contrato</div>
            <div className="flex flex-col gap-[6px]">
              {/* âncora — sempre o financiamento do veículo */}
              <div className="flex items-center gap-[10px] text-[12.5px]">
                <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>Âncora</span>
                <span>Financiamento veicular — {p.numeroParcelas}× {formatCurrency(p.valorParcela)}</span>
              </div>
              {p.itens.map((it) => (
                <div key={it.id} className="flex items-center gap-[10px] text-[12.5px]">
                  <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: it.apartado ? '#f3eafb' : 'var(--surface-input)', color: it.apartado ? '#9a3bd1' : 'var(--text-body)' }}>{it.apartado ? 'Apartado' : it.natureza}</span>
                  <span>{it.nome} — {formatCurrency(it.valor)}{it.periodicidade ? `/${it.periodicidade}` : ''}</span>
                  {podeOperar && p.status !== 'convertida' && (
                    <button disabled={ocupado} onClick={() => run(() => originacaoService.removerProduto(id, it.id))} className="text-[11px]" style={{ color: '#e0413c' }}>remover</button>
                  )}
                </div>
              ))}
            </div>
            {podeOperar && p.status !== 'convertida' && (
              <div className="mt-[12px] flex flex-wrap items-end gap-[10px]">
                <select value={produtoSel} onChange={(e) => setProdutoSel(e.target.value)} className={`${inputCls} w-[260px]`} style={inputStyle}>
                  <option value="">Adicionar produto…</option>
                  {catalogo.data?.filter((pr) => !pr.ancora && pr.ativo).map((pr) => (
                    <option key={pr.id} value={pr.id}>{pr.nome}{pr.valorPadrao ? ` · ${formatCurrency(pr.valorPadrao)}` : ''}{pr.apartado ? ' (apartado)' : ''}</option>
                  ))}
                </select>
                <button disabled={ocupado || !produtoSel}
                  onClick={() => run(async () => { await originacaoService.adicionarProduto(id, produtoSel); setProdutoSel(''); })}
                  className="h-[34px] rounded-[8px] px-[12px] text-[12px] font-semibold" style={btn('var(--navy)')}>Adicionar ao contrato</button>
              </div>
            )}
            <div className="mt-[8px] text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Produtos <b>apartados</b> (ex: seguro) viram contrato próprio na formalização; os demais entram no contrato do veículo.
            </div>
          </div>

          {/* Documentos por papel */}
          <div className="rounded-card p-[18px]" style={card}>
            <div className="mb-[10px] font-display text-[13px] font-bold">Documentos obrigatórios</div>
            {papeisComDocs.map((v) => (
              <div key={v.id} className="mb-[12px]">
                <div className="mb-[6px] text-[12px] font-semibold">{PAPEL_LABEL[v.papel]} · {v.titular.nome}</div>
                <div className="flex flex-wrap gap-[8px]">
                  {p.documentosObrigatorios.map((tipo) => {
                    const doc = p.documentos.find((d) => d.titularId === v.titular.id && d.tipo === tipo);
                    const ok = !!doc;
                    return (
                      <div key={tipo} className="flex items-center gap-[6px] rounded-[8px] px-[10px] py-[6px] text-[12px]"
                        style={{ background: ok ? '#eafaf1' : 'var(--surface-input)', border: `1px solid ${ok ? '#1f9d5b33' : 'var(--border)'}` }}>
                        <span style={{ color: ok ? '#1f9d5b' : 'var(--text-muted)' }}>{ok ? '✓' : '○'}</span>
                        <span>{DOC_LABEL[tipo] ?? tipo}</span>
                        {ok ? (
                          <button onClick={() => originacaoService.baixarDocumento(doc!.id, doc!.arquivoRef)}
                            className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ color: 'var(--accent)' }}
                            title={doc!.arquivoRef}>baixar</button>
                        ) : podeOperar && p.status !== 'convertida' ? (
                          <label className="cursor-pointer rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={btn('var(--navy)')}>
                            Anexar
                            <input type="file" className="hidden" disabled={ocupado}
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) anexarArquivo(v.titular.id, tipo, f); }} />
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {p.documentosCompletos
              ? <div className="text-[12px]" style={{ color: '#1f9d5b' }}>✓ Documentos obrigatórios completos — pode avançar para a análise.</div>
              : <div className="text-[12px]" style={{ color: '#c98a0a' }}>Anexe todos os documentos obrigatórios para liberar a análise.</div>}
          </div>

          {/* Papéis: 2º comprador e garantidor (este só quando a análise exige) */}
          <div className="rounded-card p-[18px]" style={card}>
            <div className="mb-[10px] font-display text-[13px] font-bold">Papéis</div>
            <div className="flex flex-col gap-[6px]">
              {p.papeis.map((v) => (
                <div key={v.id} className="flex items-center gap-[10px] text-[12.5px]">
                  <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>{PAPEL_LABEL[v.papel] ?? v.papel}</span>
                  <span>{v.titular.nome} · CPF {v.titular.cpfCnpj}</span>
                </div>
              ))}
            </div>

            {/* 2º comprador opcional */}
            {podeOperar && !hasSecundario && p.status !== 'convertida' && (
              <div className="mt-[12px]">
                {!showSeg ? (
                  <button onClick={() => setShowSeg(true)} className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>+ Incluir 2º comprador</button>
                ) : (
                  <div className="flex flex-wrap items-end gap-[10px]">
                    <input value={segNome} onChange={(e) => setSegNome(e.target.value)} placeholder="Nome 2º comprador" className={`${inputCls} w-[180px]`} style={inputStyle} />
                    <input value={segCpf} onChange={(e) => setSegCpf(e.target.value)} placeholder="CPF" className={`${inputCls} w-[140px]`} style={inputStyle} />
                    <input value={segZap} onChange={(e) => setSegZap(e.target.value)} placeholder="WhatsApp" className={`${inputCls} w-[140px]`} style={inputStyle} />
                    <button disabled={ocupado || !segNome || !segCpf}
                      onClick={() => run(async () => { await originacaoService.adicionarVinculo(id, 'comprador_secundario', { nome: segNome, cpfCnpj: segCpf, whatsapp: segZap || '11999999999', tipoPessoa: 'pf' }); setShowSeg(false); setSegNome(''); setSegCpf(''); setSegZap(''); })}
                      className="h-[34px] rounded-[8px] px-[12px] text-[12px] font-semibold" style={btn('var(--navy)')}>Adicionar</button>
                  </div>
                )}
              </div>
            )}

            {/* Garantidor — só quando a análise exige */}
            {precisaGarantidor && (
              <div className="mt-[12px] rounded-[8px] p-[12px]" style={{ background: '#fef6e9' }}>
                <div className="mb-[8px] text-[12px] font-semibold" style={{ color: '#8a5a0a' }}>A análise exige garantidor. Adicione para poder formalizar.</div>
                {podeOperar && (
                  <div className="flex flex-wrap items-end gap-[10px]">
                    <input value={garNome} onChange={(e) => setGarNome(e.target.value)} placeholder="Nome garantidor" className={`${inputCls} w-[180px]`} style={inputStyle} />
                    <input value={garCpf} onChange={(e) => setGarCpf(e.target.value)} placeholder="CPF" className={`${inputCls} w-[140px]`} style={inputStyle} />
                    <input value={garZap} onChange={(e) => setGarZap(e.target.value)} placeholder="WhatsApp" className={`${inputCls} w-[140px]`} style={inputStyle} />
                    <button disabled={ocupado || !garNome || !garCpf}
                      onClick={() => run(async () => { await originacaoService.adicionarVinculo(id, 'garantidor', { nome: garNome, cpfCnpj: garCpf, whatsapp: garZap || '11999999999', tipoPessoa: 'pf' }); setGarNome(''); setGarCpf(''); setGarZap(''); })}
                      className="h-[34px] rounded-[8px] px-[12px] text-[12px] font-semibold" style={btn('var(--navy)')}>+ Garantidor</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Passo 3 — Análise (parecer) */}
      {step === 2 && (
        <div className="rounded-card p-[18px]" style={card}>
          <div className="mb-[10px] font-display text-[13px] font-bold">Análise de crédito — parecer</div>
          {p.parecer ? (
            <div className="text-[12.5px]">Parecer: <b>{p.parecer.resultado}</b>{p.parecer.exigeGarantidor ? ' · exige garantidor' : ''}{p.parecer.motivoReprovacao ? ` · ${p.parecer.motivoReprovacao}` : ''}</div>
          ) : podeParecer && ['pendente', 'em_analise'].includes(p.status) ? (
            <div className="flex flex-wrap items-end gap-[10px]">
              <select value={resultado} onChange={(e) => setResultado(e.target.value)} className={`${inputCls} w-[200px]`} style={inputStyle}>
                <option value="aprovado">Aprovado</option>
                <option value="aprovado_com_ressalvas">Aprovado com ressalvas</option>
                <option value="reprovado">Reprovado</option>
              </select>
              <label className="flex items-center gap-[6px] text-[12px]"><input type="checkbox" checked={exigeGar} onChange={(e) => setExigeGar(e.target.checked)} /> exige garantidor</label>
              {resultado === 'reprovado' && <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" className={`${inputCls} w-[200px]`} style={inputStyle} />}
              <button disabled={ocupado}
                onClick={() => run(() => originacaoService.registrarParecer(id, { resultado, exigeGarantidor: exigeGar, motivoReprovacao: motivo || undefined }))}
                className="h-[34px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={btn('var(--accent)')}>Registrar parecer</button>
            </div>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Sem parecer (sem permissão ou estado inválido).</div>
          )}
        </div>
      )}

      {/* Passo 4 — Revisão */}
      {step === 3 && (
        <div className="rounded-card p-[18px]" style={card}>
          <div className="mb-[10px] font-display text-[13px] font-bold">Revisão</div>
          <div className="grid grid-cols-2 gap-[14px] text-[12.5px]">
            <div><Lbl>Ativo</Lbl><div>{p.ativo.descricao}</div></div>
            <div><Lbl>Condições</Lbl><div>{formatCurrency(p.valorEntrada)} + {p.numeroParcelas}× {formatCurrency(p.valorParcela)}</div></div>
            <div className="col-span-2"><Lbl>Papéis</Lbl><div>{p.papeis.map((v) => `${PAPEL_LABEL[v.papel]}: ${v.titular.nome}`).join(' · ')}</div></div>
            <div className="col-span-2"><Lbl>Parecer</Lbl><div>{p.parecer ? `${p.parecer.resultado}${p.parecer.exigeGarantidor ? ' (exige garantidor)' : ''}` : '—'}</div></div>
          </div>
          {precisaGarantidor && <div className="mt-[10px] text-[12px]" style={{ color: '#c98a0a' }}>Pendente: adicione o garantidor exigido (passo Principal) para concluir.</div>}
        </div>
      )}

      {/* Passo 5 — Conclusão: formalizar → assinaturas → cobrança da entrada → ativo */}
      {step === 4 && (
        <div className="rounded-card p-[18px]" style={card}>
          <div className="mb-[10px] font-display text-[13px] font-bold">Conclusão</div>

          {/* a) Formalizar (gera o contrato em Aguardando assinatura, SEM cronograma) */}
          {podeFormalizar && (
            <button disabled={ocupado} onClick={() => run(async () => { const r = await originacaoService.formalizar(id); setDocumento(r.documento); })}
              className="h-[34px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={btn('var(--accent)')}>Formalizar (gerar contrato)</button>
          )}

          {/* b) Pacote de contratos formalizado → assinar CADA contrato → cobrança → ativação */}
          {p.contratoGeradoId && pacote.data && (
            <div className="flex flex-col gap-[14px]">
              {/* Lista de contratos do pacote — assina cada um (titular + Azit) */}
              {!pacote.data.cronogramaGerado && (
                <div className="rounded-[8px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
                  <div className="mb-[8px] text-[12px] font-semibold">Assinatura do pacote de contratos (mock)</div>
                  <div className="flex flex-col gap-[10px]">
                    {pacote.data.contratos.map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center gap-[10px] border-b pb-[8px]" style={{ borderColor: 'var(--border-light)' }}>
                        <span className="min-w-[220px] text-[12px] font-semibold">{c.descricao}{c.ancora ? '' : ' · contrato apartado'} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({c.numero})</span></span>
                        <button disabled={ocupado || c.assinadoTitular || c.status !== 'aguardando_assinatura'} onClick={() => run(() => originacaoService.assinar(c.id, 'titular'))}
                          className="h-[30px] rounded-[8px] px-[10px] text-[11.5px] font-semibold" style={c.assinadoTitular ? { background: '#eafaf1', color: '#1f9d5b' } : btn('var(--navy)')}>
                          {c.assinadoTitular ? '✓ Titular' : 'Titular assina'}
                        </button>
                        <button disabled={ocupado || c.assinadoAzit || c.status !== 'aguardando_assinatura'} onClick={() => run(() => originacaoService.assinar(c.id, 'azit'))}
                          className="h-[30px] rounded-[8px] px-[10px] text-[11.5px] font-semibold" style={c.assinadoAzit ? { background: '#eafaf1', color: '#1f9d5b' } : btn('var(--navy)')}>
                          {c.assinadoAzit ? '✓ Azit' : 'Azit assina'}
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Todos assinados → cobrar a entrada (no contrato âncora) */}
                  {pacote.data.todasAssinaturas && pacote.data.ancoraId && (
                    pacote.data.contratos.find((c) => c.ancora)?.status === 'aguardando_assinatura' ? (
                      <button disabled={ocupado} onClick={() => run(() => originacaoService.ativar(pacote.data!.ancoraId!))}
                        className="mt-[12px] h-[34px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={btn('var(--accent)')}>
                        Gerar cobrança da entrada ({formatCurrency(pacote.data.entradaAVista)}{pacote.data.entradaParcelada ? ' — 60% à vista' : ''})
                      </button>
                    ) : (
                      <div className="mt-[12px] rounded-[8px] p-[10px] text-[12px] font-semibold" style={{ background: '#fef6e9', color: '#8a5a0a' }}>
                        Cobrança da entrada emitida ({formatCurrency(pacote.data.entradaAVista)}). O cronograma do pacote nasce quando a entrada for paga.
                        {import.meta.env.DEV && (
                          <button disabled={ocupado} onClick={() => run(() => originacaoService.simularPagamentoAtivacao(pacote.data!.ancoraId!))}
                            className="ml-[10px] h-[30px] rounded-[8px] px-[12px] text-[11.5px] font-semibold" style={btn('var(--accent)')}>Simular pagamento (dev)</button>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Pacote ativo → cronograma gerado */}
              {pacote.data.cronogramaGerado && (
                <div className="flex items-center gap-[10px]">
                  <span className="text-[12px] font-semibold" style={{ color: '#1f9d5b' }}>✓ Pacote ativo — {pacote.data.contratos.length} contrato(s), entrada paga e cronogramas gerados.</span>
                  <button onClick={() => navigate(`/contratos/${p.contratoGeradoId}`)}
                    className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={btn('var(--navy)')}>Abrir contrato</button>
                </div>
              )}
            </div>
          )}

          {documento && (
            <pre className="mt-[14px] whitespace-pre-wrap text-[11.5px]" style={{ color: 'var(--text-body)' }}>{documento}</pre>
          )}
        </div>
      )}
    </div>
  );
}
