import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { analiseService } from '../services/analise.service';
import { contratoService } from '../services/contrato.service';
import { originacaoService } from '../services/originacao.service';
import { produtoService } from '../services/produto.service';
import { StatusBadge } from '../components/StatusBadge';
import { Stepper } from '../components/Stepper';
import { Secao } from '../components/Secao';
import { Botao } from '../components/Botao';
import { Modal } from '../components/Modal';
import { Metrica, Campo } from '../components/Metrica';
import { PROPOSTA_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, ROLE_PARECER, mensagemErro } from '../lib/permissoes';
import { proximaSegundaISO, somarDiasISO } from '../lib/datas';
import { BlocoAssinaturaDigital } from '../components/BlocoAssinaturaDigital';
import { toast } from '../components/Toast';
import { ROTULO_SITUACAO_PROPOSTA as LABEL_STATUS } from '../lib/rotulos';
import { FERRAMENTAS_TESTE } from '../lib/ambiente';
const PAPEL_LABEL: Record<string, string> = {
  comprador_principal: 'Comprador principal', comprador_secundario: 'Comprador secundário', garantidor: 'Garantidor',
};
// Limite por arquivo (22/09): 20 MB — em base64 vira ~27 MB; o servidor aceita 30.
const LIMITE_ARQUIVO = 20 * 1024 * 1024;
const DOC_LABEL: Record<string, string> = {
  cnh: 'CNH', comprovante_endereco: 'Comp. endereço', comprovante_renda: 'Comp. renda', relatorio_brick: 'Relatório Brick', anexo_analise: 'Anexo da análise',
};
// Parecer da análise (referência de tela do Luís, 07/07).
const MOTIVOS_REPROVACAO = ['Renda insuficiente', 'Score de crédito baixo', 'Histórico de crédito negativo', 'Restrição cadastral', 'Documentação inconsistente', 'Outro motivo'];
const MOTIVOS_RESSALVA = ['Idade incompatível', 'Renda insuficiente', 'Score de crédito baixo', 'Histórico de crédito negativo', 'Documentação pendente', 'Restrição cadastral', 'Tempo de emprego insuficiente', 'Outro motivo'];
const PARECER_CARDS = [
  { v: 'aprovado', titulo: 'Aprovado', sub: 'Todos os critérios atendidos', icone: '✓', cor: 'var(--ok-fg)', bg: 'var(--ok-bg)' },
  { v: 'aprovado_com_ressalvas', titulo: 'Aprovado com Ressalvas', sub: 'Requer garantidor ou condições', icone: '⚠', cor: 'var(--warn-fg)', bg: 'var(--warn-bg)' },
  { v: 'reprovado', titulo: 'Reprovado', sub: 'Não atende aos critérios', icone: '✕', cor: 'var(--danger-fg)', bg: 'var(--danger-bg)' },
] as const;
const STEPS = [
  { key: 'proposta', label: 'Proposta' },
  { key: 'principal', label: 'Principal' },
  { key: 'analise', label: 'Análise' },
  { key: 'revisao', label: 'Revisão' },
  { key: 'conclusao', label: 'Conclusão' },
];

// Layout v2 (doc 03 §11): cartões com tokens, títulos pela <Secao>, botões pelo
// <Botao>. Os <label> que embrulham <input type="file"> não podem ser <Botao>
// (precisam ser label) — seguem o desenho da variante secundária, só tokens.
const card = { background: 'var(--surface)', border: '1px solid var(--border)' };
const inputCls = 'h-[34px] rounded-[10px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' };
const labelBotaoCls = 'inline-flex h-[30px] cursor-pointer items-center rounded-[10px] px-[11px] text-[12px] font-semibold';
const labelBotaoStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' };
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{children}</span>
);
// Pílula neutra (natureza do item, papel do vínculo).
const pilula = { background: 'var(--surface-input)', color: 'var(--text-body)' };

export function PropostaDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeOperar = pode(ROLE_OPERACAO);
  const podeParecer = pode(ROLE_PARECER);
  const [ocupado, setOcupado] = useState(false);
  const [documento, setDocumento] = useState('');
  // Feedback 30/08: o contrato só aparecia no estado transitório pós-formalizar;
  // ao voltar à tela, sumia. Botão "Ver contrato" abre o documento do snapshot.
  const [docContrato, setDocContrato] = useState<{ numero: string; texto: string } | null>(null);

  async function verContrato(contratoId: string) {
    try {
      const d = await contratoService.documento(contratoId);
      setDocContrato({ numero: d.numero, texto: d.texto });
    } catch (e) { alert(mensagemErro(e)); }
  }
  const [step, setStep] = useState(1);
  const initRef = useRef(false);

  // forms
  const [garNome, setGarNome] = useState(''); const [garCpf, setGarCpf] = useState(''); const [garZap, setGarZap] = useState('');
  const [showSeg, setShowSeg] = useState(false);
  const [segNome, setSegNome] = useState(''); const [segCpf, setSegCpf] = useState(''); const [segZap, setSegZap] = useState('');
  const [resultado, setResultado] = useState(''); // '' até o analista escolher o card
  const [motivo, setMotivo] = useState('');
  const [ressalvas, setRessalvas] = useState<string[]>([]);
  const [observacao, setObservacao] = useState('');
  const [produtoSel, setProdutoSel] = useState('');
  // Parametrização do contrato (reunião 11/07): default = próxima segunda-feira.
  // Data LOCAL (A6, 04/09): toISOString virava o dia seguinte após as 21h.
  const [dataPrimeira, setDataPrimeira] = useState(() => proximaSegundaISO());
  // Doc 02 §20 passo 12: previsão de ativação (pagamento da entrada) — a
  // cobrança da entrada vence NESTA data. Default: amanhã.
  const [dataAtivacao, setDataAtivacao] = useState(() => somarDiasISO(1));
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
    if (file.size > LIMITE_ARQUIVO) { alert(`${file.name}: grande demais (${(file.size / 1024 / 1024).toFixed(1)} MB; limite 20 MB)`); return; }
    const conteudo = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    await run(() => originacaoService.anexarDocumento(id, titularId, tipo, { nome: file.name, conteudo }));
  }

  // Vários de uma vez (22/09): um arquivo que falha não interrompe os demais; no
  // fim, um único aviso diz quais não entraram e por quê.
  async function anexarVarios(titularId: string, tipo: string, files: File[]) {
    setOcupado(true);
    const falhas: string[] = [];
    try {
      for (const file of files) {
        if (file.size > LIMITE_ARQUIVO) { falhas.push(`${file.name}: grande demais (${(file.size / 1024 / 1024).toFixed(1)} MB; limite 20 MB)`); continue; }
        try {
          const conteudo = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.onerror = rej;
            r.readAsDataURL(file);
          });
          await originacaoService.anexarDocumento(id, titularId, tipo, { nome: file.name, conteudo });
        } catch (e) {
          falhas.push(`${file.name}: ${mensagemErro(e)}`);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['proposta', id] });
      if (falhas.length) alert(`${files.length - falhas.length} de ${files.length} anexado(s). Não entrou: ${falhas.join(' · ')}`);
    } finally { setOcupado(false); }
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
      <Botao variante="fantasma" tamanho="sm" className="self-start !px-0" onClick={() => navigate('/propostas')}>← Voltar para Propostas</Botao>

      {/* Cabeçalho + Stepper */}
      <div className="rounded-card p-[18px]" style={card}>
        <div className="mb-[14px] flex flex-wrap items-center justify-between gap-[8px]">
          <div className="min-w-0">
            <div className="truncate font-display text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>{p.titular.nome}</div>
            <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>{p.ativo.rotulo} · CPF {p.titular.cpfCnpj}</div>
          </div>
          <StatusBadge label={LABEL_STATUS[p.status] ?? p.status} colors={PROPOSTA_STATUS_COLORS} />
        </div>
        <Stepper steps={STEPS} current={step} maxReachable={maxReachable} onSelect={setStep} />
      </div>

      {/* Passo 1 — Proposta (oferta read-only) */}
      {step === 0 && (
        <div className="rounded-card p-[18px]" style={card}>
          <Secao titulo="Condições da proposta">
            <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-4">
              <Metrica tom="claro" label="Modalidade" valor={p.modalidade} />
              <Metrica tom="claro" label="Entrada" valor={formatCurrency(p.valorEntrada)} />
              <Metrica tom="claro" label="Parcelas" valor={`${p.numeroParcelas}× ${formatCurrency(p.valorParcela)}`} />
              <Metrica tom="claro" label="Prazo" valor={`${p.prazoSemanas} semanas`} />
            </div>
          </Secao>
        </div>
      )}

      {/* Fora das etapas: visível em qualquer passo do stepper. */}
      {/* Documentos complementares (pedido Luís 22/09): em QUALQUER etapa,
          mesmo depois de avançar, dá para anexar documento extra que
          enriqueça a análise. Só a proposta convertida congela a trilha. */}
      {(() => {
        const extras = p.documentos.filter((d) => !p.documentosObrigatorios.includes(d.tipo) && d.tipo !== 'anexo_analise');
        const podeAnexarExtra = (podeOperar || podeParecer) && p.status !== 'convertida';
        return (
          <div className="rounded-card p-[18px]" style={card}>
            <Secao
              titulo="Documentos complementares"
              tag="contracheque, extrato, contrato com locadora… — em qualquer etapa"
              acao={podeAnexarExtra ? (
                <label className={labelBotaoCls} style={{ ...labelBotaoStyle, opacity: ocupado ? 0.6 : 1 }}>
                  + Anexar extras (vários de uma vez)
                  <input type="file" multiple accept="image/*,.pdf" className="hidden" disabled={ocupado}
                    onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) void anexarVarios(p.titular.id, 'outro', fs); }} />
                </label>
              ) : undefined}
            >
              {extras.length === 0 ? (
                <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum documento complementar.</div>
              ) : (
                <div className="flex flex-wrap gap-[8px]">
                  {extras.map((d) => (
                    <div key={d.id} className="flex items-center gap-[6px] rounded-[8px] px-[10px] py-[6px] text-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                      <span title={DOC_LABEL[d.tipo] ?? d.tipo}>{d.arquivoRef}</span>
                      <button type="button" onClick={() => originacaoService.baixarDocumento(d.id, d.arquivoRef)} className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>baixar</button>
                      {podeAnexarExtra && (
                        <button type="button" onClick={() => { if (window.confirm('Remover este documento?')) void run(() => originacaoService.removerDocumento(p.id, d.id)); }} className="text-[11px] font-semibold" style={{ color: 'var(--danger-fg)' }}>remover</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Secao>
          </div>
        );
      })()}

      {/* Passo 2 — Principal (produtos + cadastro + documentos + papéis) */}
      {step === 1 && (
        <div className="flex flex-col gap-[16px]">
          {/* Produtos do contrato (carrinho) */}
          <div className="rounded-card p-[18px]" style={card}>
            {/* Doc 02 §17 (2026-08-16): aqui entram ITENS de contrato (proteção,
                rastreador, taxas) — produto comercial é papel do Catálogo. */}
            <Secao titulo="Itens do contrato">
              <div className="flex flex-col gap-[6px] text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                {/* âncora — sempre o financiamento do veículo */}
                <div className="flex flex-wrap items-center gap-[10px]">
                  <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={pilula}>Âncora</span>
                  <span>Venda parcelada do veículo — {p.numeroParcelas}× {formatCurrency(p.valorParcela)}</span>
                </div>
                {p.itens.map((it) => (
                  <div key={it.id} className="flex flex-wrap items-center gap-[10px]">
                    <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={it.apartado ? { background: 'var(--purple-bg)', color: 'var(--purple-fg)' } : pilula}>{it.apartado ? 'Apartado' : it.natureza}</span>
                    <span>{it.nome} — {formatCurrency(it.valor)}{it.periodicidade ? `/${it.periodicidade}` : ''}</span>
                    {podeOperar && p.status !== 'convertida' && (
                      <button type="button" disabled={ocupado} onClick={() => run(() => originacaoService.removerProduto(id, it.id))} className="text-[11px]" style={{ color: 'var(--danger-fg)' }}>remover</button>
                    )}
                  </div>
                ))}
              </div>
              {podeOperar && p.status !== 'convertida' && (
                <div className="mt-[12px] flex flex-wrap items-end gap-[10px]">
                  <select value={produtoSel} onChange={(e) => setProdutoSel(e.target.value)} className={`${inputCls} w-full sm:w-[260px]`} style={inputStyle}>
                    <option value="">Adicionar item ao contrato…</option>
                    {catalogo.data?.filter((pr) => !pr.ancora && pr.ativo).map((pr) => (
                      <option key={pr.id} value={pr.id}>{pr.nome}{pr.valorPadrao ? ` · ${formatCurrency(pr.valorPadrao)}` : ''}{pr.apartado ? ' (apartado)' : ''}</option>
                    ))}
                  </select>
                  <Botao variante="secundaria" disabled={ocupado || !produtoSel}
                    onClick={() => run(async () => { await originacaoService.adicionarProduto(id, produtoSel); setProdutoSel(''); })}>
                    Adicionar ao contrato
                  </Botao>
                </div>
              )}
              <div className="mt-[8px] text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Itens <b>apartados</b> (ex: seguro) viram contrato próprio na formalização; os demais entram no contrato do veículo. Produtos comerciais (venda, Reembolso Parcelado, proteção) são geridos no <b>Catálogo</b>.
              </div>
            </Secao>
          </div>

          {/* Documentos por papel */}
          <div className="rounded-card p-[18px]" style={card}>
            <Secao titulo="Documentos obrigatórios">
              {papeisComDocs.map((v) => (
                <div key={v.id} className="mb-[12px]">
                  <div className="mb-[6px] text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{PAPEL_LABEL[v.papel]} · {v.titular.nome}</div>
                  <div className="flex flex-wrap gap-[8px]">
                    {p.documentosObrigatorios.map((tipo) => {
                      const doc = p.documentos.find((d) => d.titularId === v.titular.id && d.tipo === tipo);
                      const ok = !!doc;
                      return (
                        <div key={tipo} className="flex items-center gap-[6px] rounded-[8px] px-[10px] py-[6px] text-[12px]"
                          style={{ background: ok ? 'var(--ok-bg)' : 'var(--surface-input)', border: `1px solid ${ok ? 'transparent' : 'var(--border)'}`, color: 'var(--text-primary)' }}>
                          <span style={{ color: ok ? 'var(--ok-fg)' : 'var(--text-muted)' }}>{ok ? '✓' : '○'}</span>
                          <span>{DOC_LABEL[tipo] ?? tipo}</span>
                          {ok ? (
                            <button type="button" onClick={() => originacaoService.baixarDocumento(doc!.id, doc!.arquivoRef)}
                              className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ color: 'var(--accent)' }}
                              title={doc!.arquivoRef}>baixar</button>
                          ) : podeOperar && p.status !== 'convertida' ? (
                            <label className="cursor-pointer rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>
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
                ? <div className="text-[12px]" style={{ color: 'var(--ok-fg)' }}>✓ Documentos obrigatórios completos — pode avançar para a análise.</div>
                : <div className="text-[12px]" style={{ color: 'var(--warn-fg)' }}>Anexe todos os documentos obrigatórios para liberar a análise.</div>}
            </Secao>
          </div>

          {/* Papéis: 2º comprador e garantidor (este só quando a análise exige) */}
          <div className="rounded-card p-[18px]" style={card}>
            <Secao titulo="Papéis">
              <div className="flex flex-col gap-[6px] text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                {p.papeis.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-[10px]">
                    <span className="rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={pilula}>{PAPEL_LABEL[v.papel] ?? v.papel}</span>
                    <span>{v.titular.nome} · CPF {v.titular.cpfCnpj}</span>
                  </div>
                ))}
              </div>

              {/* 2º comprador opcional */}
              {podeOperar && !hasSecundario && p.status !== 'convertida' && (
                <div className="mt-[12px]">
                  {!showSeg ? (
                    <Botao variante="fantasma" tamanho="sm" className="!px-0" onClick={() => setShowSeg(true)}>+ Incluir 2º comprador</Botao>
                  ) : (
                    <div className="grid grid-cols-1 items-end gap-[10px] sm:grid-cols-[1fr_140px_140px_auto]">
                      <input value={segNome} onChange={(e) => setSegNome(e.target.value)} placeholder="Nome 2º comprador" className={inputCls} style={inputStyle} />
                      <input value={segCpf} onChange={(e) => setSegCpf(e.target.value)} placeholder="CPF" className={inputCls} style={inputStyle} />
                      <input value={segZap} onChange={(e) => setSegZap(e.target.value)} placeholder="WhatsApp" className={inputCls} style={inputStyle} />
                      <Botao variante="secundaria" disabled={ocupado || !segNome || !segCpf}
                        onClick={() => run(async () => { await originacaoService.adicionarVinculo(id, 'comprador_secundario', { nome: segNome, cpfCnpj: segCpf, whatsapp: segZap || '11999999999', tipoPessoa: 'pf' }); setShowSeg(false); setSegNome(''); setSegCpf(''); setSegZap(''); })}>
                        Adicionar
                      </Botao>
                    </div>
                  )}
                </div>
              )}

              {/* Garantidor — só quando a análise exige */}
              {precisaGarantidor && (
                <div className="mt-[12px] rounded-[10px] p-[12px]" style={{ background: 'var(--warn-bg)' }}>
                  <div className="mb-[8px] text-[12px] font-semibold" style={{ color: 'var(--warn-ink)' }}>A análise exige garantidor. Adicione para poder formalizar.</div>
                  {podeOperar && (
                    <div className="grid grid-cols-1 items-end gap-[10px] sm:grid-cols-[1fr_140px_140px_auto]">
                      <input value={garNome} onChange={(e) => setGarNome(e.target.value)} placeholder="Nome garantidor" className={inputCls} style={inputStyle} />
                      <input value={garCpf} onChange={(e) => setGarCpf(e.target.value)} placeholder="CPF" className={inputCls} style={inputStyle} />
                      <input value={garZap} onChange={(e) => setGarZap(e.target.value)} placeholder="WhatsApp" className={inputCls} style={inputStyle} />
                      <Botao variante="secundaria" disabled={ocupado || !garNome || !garCpf}
                        onClick={() => run(async () => { await originacaoService.adicionarVinculo(id, 'garantidor', { nome: garNome, cpfCnpj: garCpf, whatsapp: garZap || '11999999999', tipoPessoa: 'pf' }); setGarNome(''); setGarCpf(''); setGarZap(''); })}>
                        + Garantidor
                      </Botao>
                    </div>
                  )}
                </div>
              )}
            </Secao>
          </div>

          {/* Avanço explícito para a próxima etapa (não só pelo stepper) */}
          <div className="flex justify-end">
            <Botao
              variante="primaria"
              disabled={!p.documentosCompletos}
              onClick={() => setStep(2)}
              title={p.documentosCompletos ? undefined : 'Anexe todos os documentos obrigatórios para liberar a análise'}
            >
              Próximo: Análise →
            </Botao>
          </div>
        </div>
      )}

      {/* Condição fora do parâmetro (decisão 03/08): banner + solicitação de alçada */}
      {p.foraParametro && (
        <div className="flex flex-wrap items-center justify-between gap-[8px] rounded-[12px] p-[14px]" style={{ background: 'var(--warn-bg)', border: '2px solid var(--warn-fg)' }}>
          <div>
            <div className="font-display text-[13px] font-bold" style={{ color: 'var(--warn-ink)' }}>Condição comercial fora do parâmetro</div>
            <div className="text-[12px]" style={{ color: 'var(--warn-ink)' }}>
              {p.aprovacaoForaParametro === 'aprovada'
                ? 'Aprovada pela alçada superior — a formalização está liberada.'
                : p.aprovacaoForaParametro === 'pendente'
                  ? 'Aguardando decisão na Central de Aprovações — a formalização fica travada até lá.'
                  : p.aprovacaoForaParametro === 'reprovada'
                    ? 'Reprovada pela alçada — ajuste a condição (nova simulação) ou solicite novamente.'
                    : 'Entrada ou prazo fora da faixa da variante. Solicite a aprovação de alçada — sem ela a formalização fica travada.'}
            </div>
          </div>
          {(!p.aprovacaoForaParametro || p.aprovacaoForaParametro === 'reprovada') && (
            <Botao variante="primaria" disabled={ocupado} onClick={() => run(() => originacaoService.solicitarAprovacaoForaParametro(id))}>
              Solicitar aprovação de alçada
            </Botao>
          )}
        </div>
      )}

      {/* Passo 3 — Análise: anexos de embasamento + observação analítica + parecer em cards.
          Auditoria 15/09 (Bloco D): o banner era renderizado em TODOS os passos,
          inclusive em proposta convertida/cancelada — agora só enquanto a análise
          faz sentido. */}
      {!['convertida', 'cancelada', 'reprovada'].includes(p.status) && (
      <div className="flex flex-wrap items-center justify-between gap-[8px] rounded-[12px] p-[14px]" style={{ background: 'var(--surface)', border: '2px solid var(--accent)' }}>
        <div>
          <div className="font-display text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>Análise de Cadastro — Política v1.0</div>
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Workspace oficial: participantes, rendas, autorização, consultas, COCAD e liberação.</div>
        </div>
        <Botao
          variante="primaria"
          onClick={() => { void (async () => { try { const a = await analiseService.iniciar(id); navigate(`/analises/${a.id}`); } catch (e) { toast.erro(mensagemErro(e)); } })(); }}
        >
          Abrir análise →
        </Botao>
      </div>
      )}

      {step === 2 && (() => {
        const anexos = p.documentos.filter((d) => d.tipo === 'anexo_analise');
        // Trilha única (doc 02 §14, 2026-08-15): com Análise de Cadastro aberta, o
        // parecer legado da proposta fica só leitura — a decisão acontece na análise.
        const podeEditar = !p.analiseCadastro && !p.parecer && podeParecer && ['pendente', 'em_analise'].includes(p.status);
        const prontoParaRegistrar =
          !!resultado &&
          (resultado !== 'reprovado' || !!motivo) &&
          (resultado !== 'aprovado_com_ressalvas' || ressalvas.length > 0);
        return (
        <div className="flex flex-col gap-[14px]">
          {/* Anexos de embasamento da análise */}
          <div className="rounded-card p-[18px]" style={card}>
            <Secao
              titulo="Documentos de embasamento"
              acao={podeParecer && ['pendente', 'em_analise'].includes(p.status) ? (
                <label className={labelBotaoCls} style={labelBotaoStyle}>
                  + Anexar (vários de uma vez)
                  <input type="file" multiple className="hidden"
                    onChange={(e) => {
                      const fs = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      // Sequencial: um erro não descarta os já anexados (14/09).
                      if (fs.length) void anexarVarios(p.titular.id, 'anexo_analise', fs);
                    }} />
                </label>
              ) : undefined}
            >
              {anexos.length === 0 ? (
                <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nenhum anexo — consultas, extratos e prints que embasam a decisão entram aqui.</div>
              ) : (
                <div className="flex flex-col gap-[4px]">
                  {anexos.map((d) => (
                    <div key={d.id} className="flex flex-wrap items-center justify-between gap-[6px] rounded-[8px] px-[10px] py-[6px] text-[12px]" style={{ background: 'var(--surface-input)', color: 'var(--text-primary)' }}>
                      <span className="min-w-0 truncate">{d.arquivoRef}</span>
                      <span className="flex items-center gap-[10px]">
                      <button type="button" onClick={() => originacaoService.baixarDocumento(d.id, d.arquivoRef)} className="font-semibold" style={{ color: 'var(--accent)' }}>baixar</button>
                      {podeParecer && ['pendente', 'em_analise'].includes(p.status) && (
                        <button
                          type="button"
                          onClick={() => { if (window.confirm('Remover este anexo?')) void run(() => originacaoService.removerDocumento(p.id, d.id)); }}
                          className="font-semibold" style={{ color: 'var(--danger-fg)' }}
                        >remover</button>
                      )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Secao>
          </div>

          {/* Parecer */}
          <div className="rounded-card p-[18px]" style={card}>
            <Secao titulo={`Parecer da Análise${podeEditar ? ' *' : ''}`}>

            {p.parecer ? (
              <div className="flex flex-col gap-[8px] text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                {(() => {
                  const c = PARECER_CARDS.find((x) => x.v === p.parecer!.resultado);
                  return (
                    <div className="flex flex-wrap items-center gap-[10px] rounded-[10px] p-[12px]" style={{ background: c?.bg, border: `2px solid ${c?.cor}` }}>
                      <span className="text-[16px]" style={{ color: c?.cor }}>{c?.icone}</span>
                      <b>{c?.titulo ?? p.parecer!.resultado}</b>
                      {p.parecer!.exigeGarantidor && <span className="text-[11.5px]" style={{ color: 'var(--warn-ink)' }}>· exige garantidor</span>}
                    </div>
                  );
                })()}
                {p.parecer.motivoReprovacao && <Campo label="Motivo da reprovação" valor={p.parecer.motivoReprovacao} />}
                {p.parecer.motivosRessalva.length > 0 && <Campo label="Motivos da ressalva" valor={p.parecer.motivosRessalva.join(' · ')} />}
                {p.parecer.observacao && <Campo label="Observação analítica"><span style={{ whiteSpace: 'pre-wrap' }}>{p.parecer.observacao}</span></Campo>}
              </div>
            ) : p.analiseCadastro ? (
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Esta proposta tem <b>Análise de Cadastro</b> — parecer, decisão do COCAD e liberação acontecem lá
                (banner "Abrir análise" acima). Ao liberar, a proposta é marcada como aprovada automaticamente.
              </div>
            ) : !podeEditar ? (
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Sem parecer (sem permissão ou estado inválido).</div>
            ) : (
              <div className="flex flex-col gap-[12px]">
                {/* Cards de decisão */}
                <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-3">
                  {PARECER_CARDS.map((c) => (
                    <button key={c.v} type="button" onClick={() => setResultado(c.v)}
                      className="flex min-h-[44px] flex-col items-start gap-[4px] rounded-[12px] p-[14px] text-left transition-colors"
                      style={{
                        border: `2px solid ${resultado === c.v ? c.cor : 'var(--border)'}`,
                        background: resultado === c.v ? c.bg : 'var(--surface)',
                      }}>
                      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[14px] font-bold" style={{ background: c.bg, color: c.cor }}>{c.icone}</span>
                      <span className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>{c.titulo}</span>
                      <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{c.sub}</span>
                    </button>
                  ))}
                </div>

                {/* Painel condicional: reprovação */}
                {resultado === 'reprovado' && (
                  <div className="flex flex-col gap-[8px] rounded-[10px] p-[14px]" style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-fg)' }}>
                    <Lbl>Motivo da Reprovação *</Lbl>
                    <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={`${inputCls} w-full max-w-[380px]`} style={inputStyle}>
                      <option value="">Selecione o motivo</option>
                      {MOTIVOS_REPROVACAO.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                )}

                {/* Painel condicional: ressalvas (todas exigem garantidor) */}
                {resultado === 'aprovado_com_ressalvas' && (
                  <div className="flex flex-col gap-[8px] rounded-[10px] p-[14px]" style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-fg)' }}>
                    <Lbl>Motivos da Ressalva *</Lbl>
                    <div className="text-[11.5px]" style={{ color: 'var(--warn-ink)' }}>Todos os motivos requerem garantidor.</div>
                    <div className="grid grid-cols-1 gap-[6px] sm:grid-cols-2">
                      {MOTIVOS_RESSALVA.map((m) => (
                        <label key={m} className="flex min-h-[30px] items-center gap-[8px] text-[12.5px]" style={{ color: 'var(--text-primary)' }}>
                          <input type="checkbox" checked={ressalvas.includes(m)}
                            onChange={(e) => setRessalvas(e.target.checked ? [...ressalvas, m] : ressalvas.filter((x) => x !== m))} />
                          {m}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Observação analítica */}
                <label className="flex flex-col gap-[4px]">
                  <Lbl>Observação analítica</Lbl>
                  <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3}
                    placeholder="Contexto, critérios avaliados, fontes consultadas…"
                    className="rounded-[10px] p-[10px] text-[12.5px]" style={inputStyle} />
                </label>

                {/* Ação — muda conforme a decisão (variante acompanha o parecer) */}
                <div className="flex justify-end">
                  <Botao
                    variante={resultado === 'reprovado' ? 'perigo' : 'primaria'}
                    disabled={ocupado || !prontoParaRegistrar}
                    onClick={() => run(() => originacaoService.registrarParecer(id, {
                      resultado,
                      motivoReprovacao: resultado === 'reprovado' ? motivo : undefined,
                      motivosRessalva: resultado === 'aprovado_com_ressalvas' ? ressalvas : undefined,
                      observacao: observacao.trim() || undefined,
                    }))}
                    className="!whitespace-normal !h-auto min-h-[36px] py-[8px] text-left">
                    {resultado === 'reprovado' ? '✕ Reprovar Proposta'
                      : resultado === 'aprovado_com_ressalvas' ? '⚠ Aprovar com Ressalvas — Próximo: Revisão'
                      : resultado === 'aprovado' ? '✓ Aprovar Proposta — Próximo: Revisão'
                      : 'Selecione o parecer'}
                  </Botao>
                </div>
              </div>
            )}
            </Secao>
          </div>
        </div>
        );
      })()}

      {/* Passo 4 — Revisão */}
      {step === 3 && (
        <div className="rounded-card p-[18px]" style={card}>
          <Secao titulo="Revisão">
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
              <Campo label="Ativo" valor={p.ativo.rotulo} />
              <Campo label="Condições" valor={`${formatCurrency(p.valorEntrada)} + ${p.numeroParcelas}× ${formatCurrency(p.valorParcela)}`} />
              <div className="sm:col-span-2"><Campo label="Papéis" valor={p.papeis.map((v) => `${PAPEL_LABEL[v.papel]}: ${v.titular.nome}`).join(' · ')} /></div>
              <div className="sm:col-span-2"><Campo label="Parecer" valor={p.parecer ? `${p.parecer.resultado}${p.parecer.exigeGarantidor ? ' (exige garantidor)' : ''}` : '—'} /></div>
            </div>
            {precisaGarantidor && <div className="mt-[10px] text-[12px]" style={{ color: 'var(--warn-fg)' }}>Pendente: adicione o garantidor exigido (passo Principal) para concluir.</div>}
          </Secao>
        </div>
      )}

      {/* Passo 5 — Conclusão: formalizar → assinaturas → cobrança da entrada → ativo */}
      {step === 4 && (
        <div className="rounded-card p-[18px]" style={card}>
          <Secao titulo="Conclusão">

          {/* a) Parametrização do contrato (reunião 11/07): o operador define a
              data da 1ª parcela (ex.: segunda-feira p/ motorista de app) e então
              formaliza. Nº de parcelas vem do fator de PRAZO do Catálogo (4,3452). */}
          {podeFormalizar && (
            <div className="flex flex-wrap items-end gap-[10px]">
              <label className="flex flex-col gap-[4px]"><Lbl>Previsão de ativação (pagamento da entrada)</Lbl>
                <input type="date" value={dataAtivacao} onChange={(e) => setDataAtivacao(e.target.value)} className={`${inputCls} w-[160px]`} style={inputStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>1ª parcela (vencimento)</Lbl>
                <input type="date" value={dataPrimeira} onChange={(e) => setDataPrimeira(e.target.value)} className={`${inputCls} w-[160px]`} style={inputStyle} /></label>
              <span className="basis-full text-[11.5px] sm:basis-auto sm:pb-[8px]" style={{ color: 'var(--text-muted)' }}>
                {p.numeroParcelas} parcelas de {formatCurrency(p.valorParcela)} · a assinatura é imediata; a cobrança da entrada vence na previsão de ativação
              </span>
              <Botao variante="primaria" disabled={ocupado} onClick={() => run(async () => { const r = await originacaoService.formalizar(id, dataPrimeira || undefined, dataAtivacao || undefined); setDocumento(r.documento); })}>
                Formalizar (gerar contrato)
              </Botao>
            </div>
          )}

          {/* b) Pacote de contratos formalizado → assinar CADA contrato → cobrança → ativação */}
          {p.contratoGeradoId && pacote.data && (
            <div className="flex flex-col gap-[14px]">
              {/* Assinatura DIGITAL ZapSign (doc 02 §21) — a assinatura do contrato
                  ÂNCORA vale para o pacote até o envelope da F2 (mock removido 18/08). */}
              {!pacote.data.cronogramaGerado && (
                <BlocoAssinaturaDigital contratoId={p.contratoGeradoId} ocupado={ocupado} run={run} />
              )}
              {!pacote.data.cronogramaGerado && (
                <div className="rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
                  <div className="mb-[8px] text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Contratos do pacote</div>
                  <div className="flex flex-col gap-[10px]">
                    {pacote.data.contratos.map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center gap-[10px] pb-[8px]" style={{ borderBottom: '1px solid var(--border-light)' }}>
                        <span className="min-w-0 basis-full text-[12px] font-semibold sm:basis-auto sm:min-w-[220px]" style={{ color: 'var(--text-primary)' }}>{c.descricao}{c.ancora ? '' : ' · contrato apartado'} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({c.numero})</span></span>
                        <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={c.assinadoTitular ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--surface-muted)', color: 'var(--text-body)' }}>
                          {c.assinadoTitular ? '✓ Cliente assinou' : 'Cliente pendente'}
                        </span>
                        <span className="rounded-full px-[10px] py-[2px] text-[11px] font-bold" style={c.assinadoAzit ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--surface-muted)', color: 'var(--text-body)' }}>
                          {c.assinadoAzit ? '✓ Azit assinou' : 'Azit pendente'}
                        </span>
                        <Botao variante="secundaria" tamanho="sm" onClick={() => void verContrato(c.id)}>Ver contrato</Botao>
                      </div>
                    ))}
                  </div>
                  {/* Formalização anterior cancelada (ex.: datas trocadas e reformalizada):
                      o contrato velho saiu do pacote — fica só a citação (27/10). */}
                  {(pacote.data.contratosCancelados ?? []).length > 0 && (
                    <div className="mt-[8px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                      {(pacote.data.contratosCancelados ?? []).length === 1 ? '1 contrato anterior cancelado' : `${(pacote.data.contratosCancelados ?? []).length} contratos anteriores cancelados`}
                      {' '}(nº {(pacote.data.contratosCancelados ?? []).map((c) => c.numero).join(', ')}) — fora do pacote; não conta para a assinatura nem para a entrada.
                    </div>
                  )}

                  {/* Todos assinados → cobrar a entrada (no contrato âncora) */}
                  {pacote.data.todasAssinaturas && pacote.data.ancoraId && (
                    pacote.data.contratos.find((c) => c.ancora)?.status === 'aguardando_assinatura' ? (
                      <Botao variante="primaria" className="mt-[12px] !h-auto min-h-[36px] !whitespace-normal py-[8px] text-left" disabled={ocupado} onClick={() => run(() => originacaoService.ativar(pacote.data!.ancoraId!))}>
                        {pacote.data.entradaAVista > 0
                          ? `Gerar cobrança da entrada (${formatCurrency(pacote.data.entradaAVista)}${pacote.data.entradaParcelada ? ' — 60% à vista' : ''})`
                          // Doc 02 §4-A.3 (2026-08-16): sem entrada (upgrade/RP), o clique ativa direto.
                          : 'Ativar contrato (sem entrada — dia zero imediato)'}
                      </Botao>
                    ) : (
                      <div className="mt-[12px] flex flex-wrap items-center gap-[10px] rounded-[10px] p-[10px] text-[12px] font-semibold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
                        <span>Cobrança da entrada emitida ({formatCurrency(pacote.data.entradaAVista)}). O cronograma do pacote nasce quando a entrada for paga.</span>
                        {FERRAMENTAS_TESTE && (
                          <Botao variante="secundaria" tamanho="sm" disabled={ocupado} onClick={() => run(() => originacaoService.simularPagamentoAtivacao(pacote.data!.ancoraId!))}>Simular pagamento (dev)</Botao>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Pacote ativo → cronograma gerado */}
              {pacote.data.cronogramaGerado && (
                <div className="flex flex-wrap items-center gap-[10px]">
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--ok-fg)' }}>✓ Pacote ativo — {pacote.data.contratos.length} contrato(s), entrada paga e cronogramas gerados.</span>
                  <Botao variante="primaria" tamanho="sm" onClick={() => navigate(`/contratos/${p.contratoGeradoId}`)}>Abrir contrato</Botao>
                </div>
              )}
            </div>
          )}

          {documento && (
            <pre className="mt-[14px] whitespace-pre-wrap text-[11.5px]" style={{ color: 'var(--text-body)' }}>{documento}</pre>
          )}
          </Secao>
        </div>
      )}

      {/* Documento do contrato (snapshot congelado) — feedback 30/08: sempre acessível. */}
      <Modal open={!!docContrato} onClose={() => setDocContrato(null)} title={docContrato ? `Contrato ${docContrato.numero}` : ''} largura={820}>
        {docContrato && (
          <pre className="whitespace-pre-wrap font-sans text-[12px] leading-[1.55]" style={{ color: 'var(--text-body)' }}>{docContrato.texto}</pre>
        )}
      </Modal>
    </div>
  );
}
