import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { originacaoService, SimulacaoResultado, OfertaSimulada } from '../services/originacao.service';
import { simuladorService } from '../services/simulador.service';
import { mensagemErro } from '../lib/permissoes';
import { reaisParaCentavos } from '../lib/valor';
import { buscarCep } from '../lib/cep';
import { toast } from '../components/Toast';

const FREQ_LABEL: Record<string, string> = { mensal: 'por mês', quinzenal: 'por quinzena', semanal: 'por semana' };
const TIPO_LABEL: Record<string, string> = { oferta_fixa: 'Oferta especial', padrao: 'Oferta padrão', personalizada: 'Personalizada' };
const CANAIS: { v: string; l: string }[] = [
  { v: 'operador_interno', l: 'Operador interno' },
  { v: 'olx', l: 'OLX' },
  { v: 'whatsapp', l: 'WhatsApp' },
  { v: 'instagram', l: 'Instagram/Meta' },
  { v: 'indicacao', l: 'Indicação' },
  { v: 'landing_page', l: 'Landing page' },
  { v: 'outro', l: 'Outro' },
];

const inputCls = 'h-[36px] rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' };
const labelCls = 'text-[11px] font-semibold';
const labelStyle = { color: 'var(--text-label)' };

// Novo atendimento (Doc 2 §8.1 / §8-A.1-2): Lead → Simulação → Proposta. Os
// documentos e o parecer ficam na ANÁLISE da proposta (tela separada).
export function OriginacaoPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [ocupado, setOcupado] = useState(false);

  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [canal, setCanal] = useState('operador_interno');
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [leadInfo, setLeadInfo] = useState('');
  const [leadId, setLeadId] = useState<string | undefined>();

  // Simulação V3 (telas 1–4 da planilha): ativo OU valor manual → ofertas
  // (fixa + padrão) → "Simular outras opções" → resultado/seleção.
  const [ativoId, setAtivoId] = useState('');
  const [valorManual, setValorManual] = useState('');
  const [sim, setSim] = useState<SimulacaoResultado | null>(null);
  const [ofertaSel, setOfertaSel] = useState('');
  const [mostraPersonalizada, setMostraPersonalizada] = useState(false);
  const [pEntrada, setPEntrada] = useState('');
  const [pPrazo, setPPrazo] = useState('48');
  const [pFreq, setPFreq] = useState<'mensal' | 'quinzenal' | 'semanal'>('semanal');
  const [entParcelada, setEntParcelada] = useState(false);
  const parametros = useQuery({ queryKey: ['simulador-parametros'], queryFn: () => simuladorService.parametros() });

  // Cadastro pleno do comprador principal + 2º comprador opcional.
  const [cad, setCad] = useState({ whatsapp: '', email: '', rg: '', estadoCivil: '', profissao: '', endereco: '', bairro: '', cidade: '', estado: '', cep: '' });
  const [comSeg, setComSeg] = useState(false);
  const [seg, setSeg] = useState({ nome: '', cpf: '', whatsapp: '' });

  const ativos = useQuery({ queryKey: ['ativos', 'disponiveis'], queryFn: () => originacaoService.ativosDisponiveis() });

  function resetWizard() {
    setEtapa(1); setNome(''); setCpf(''); setTelefone(''); setCanal('operador_interno'); setLeadInfo(''); setLeadId(undefined);
    setAtivoId(''); setValorManual(''); setSim(null); setOfertaSel('');
    setMostraPersonalizada(false); setPEntrada(''); setPPrazo('48'); setPFreq('semanal'); setEntParcelada(false);
    setCad({ whatsapp: '', email: '', rg: '', estadoCivil: '', profissao: '', endereco: '', bairro: '', cidade: '', estado: '', cep: '' });
    setComSeg(false); setSeg({ nome: '', cpf: '', whatsapp: '' });
  }

  // Retoma uma simulação a partir da listagem (?simulacao=<id>): carrega as ofertas
  // já calculadas e o cliente, e salta para a etapa de ofertas/conversão.
  useEffect(() => {
    const id = params.get('simulacao');
    if (!id) return;
    (async () => {
      try {
        const s = await originacaoService.detalheSimulacao(id);
        if (s.propostaId) { navigate(`/propostas/${s.propostaId}`, { replace: true }); return; }
        setSim(s);
        setOfertaSel(s.ofertas.find((o) => o.selecionada)?.id ?? s.ofertas.find((o) => o.tipo === 'oferta_fixa')?.id ?? s.ofertas[0]?.id ?? '');
        if (s.cliente) { setNome(s.cliente.nome); setCpf(s.cliente.cpf); if (s.cliente.telefone) setTelefone(s.cliente.telefone); }
        setLeadId(s.leadId ?? undefined);
        setEtapa(2);
      } catch (e) { toast.erro(mensagemErro(e)); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function iniciarLead() {
    if (!nome || !cpf || telefone.trim().length < 8) return;
    setOcupado(true);
    try {
      const r = await originacaoService.criarLead({ nome, cpf, telefone: telefone.trim(), canalOrigem: canal });
      setLeadInfo(r.tipo === 'titular' ? `CPF já cadastrado: ${r.titular?.nome}. Seguindo como titular existente.` : 'Novo lead criado.');
      setLeadId(r.tipo === 'titular' ? undefined : r.lead?.id);
      setEtapa(2);
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  // CEP → preenche endereço/bairro/cidade/UF (ViaCEP).
  async function onBlurCep() {
    const cep = cad.cep.replace(/\D/g, '');
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const end = await buscarCep(cep);
      if (end) setCad((c) => ({ ...c, endereco: end.endereco || c.endereco, bairro: end.bairro || c.bairro, cidade: end.cidade || c.cidade, estado: end.estado || c.estado }));
      else toast.erro('CEP não encontrado.');
    } finally { setBuscandoCep(false); }
  }

  // Tela 1→2: cria a simulação (backend calcula ofertas fixa + padrão).
  async function simular() {
    const manual = reaisParaCentavos(valorManual);
    if (!ativoId && manual <= 0) return;
    setOcupado(true);
    try {
      const r = await originacaoService.simular({
        ativoId: ativoId || undefined,
        valorAvista: manual > 0 ? manual : undefined,
        leadId,
      });
      setSim(r);
      setOfertaSel(r.ofertas.find((o) => o.tipo === 'oferta_fixa')?.id ?? r.ofertas[0]?.id ?? '');
      if (r.avisoDivergencia) toast.info(r.avisoDivergencia);
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  // Tela 3: cenário personalizado ("Simular outras opções").
  async function simularOutra() {
    if (!sim) return;
    setOcupado(true);
    try {
      const r = await originacaoService.simularOpcao(sim.id, {
        valorEntrada: reaisParaCentavos(pEntrada),
        prazoMeses: Math.max(1, Number(pPrazo || 1)),
        frequencia: pFreq,
        entradaParcelada: entParcelada,
      });
      setSim(r);
      const nova = r.ofertas[r.ofertas.length - 1];
      if (nova) setOfertaSel(nova.id);
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function apresentar() {
    if (!sim) return;
    try {
      await originacaoService.apresentarSimulacao(sim.id);
      toast.sucesso('Condição marcada como apresentada ao cliente.');
    } catch (e) { toast.erro(mensagemErro(e)); }
  }

  async function irParaProposta() {
    if (!sim || !ofertaSel) return;
    setOcupado(true);
    try { await originacaoService.selecionarOferta(sim.id, ofertaSel); setEtapa(3); }
    catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function criarProposta() {
    if (!sim) return;
    setOcupado(true);
    try {
      const comprador: Record<string, string> = { nome, cpfCnpj: cpf, tipoPessoa: 'pf', whatsapp: cad.whatsapp || '11999999999' };
      for (const [k, v] of Object.entries(cad)) if (k !== 'whatsapp' && v.trim()) comprador[k] = v.trim();
      const prop = await originacaoService.criarProposta({ simulacaoId: sim.id, comprador: comprador as never });
      if (comSeg && seg.nome.trim() && seg.cpf.trim()) {
        await originacaoService.adicionarVinculo(prop.id, 'comprador_secundario', { nome: seg.nome.trim(), cpfCnpj: seg.cpf.trim(), whatsapp: seg.whatsapp.trim() || '11999999999', tipoPessoa: 'pf' });
      }
      await queryClient.invalidateQueries({ queryKey: ['propostas'] });
      await queryClient.invalidateQueries({ queryKey: ['simulacoes'] });
      resetWizard();
      toast.sucesso('Proposta criada — siga para a análise.');
      // Vai direto para a análise da proposta (documentos + parecer ficam lá).
      navigate(`/propostas/${prop.id}`);
    } catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  // Conversão exige um veículo (proposta = venda de um ativo). Simulação por valor
  // manual é só cálculo — orienta a refazer com um veículo selecionado.
  const semAtivo = !!sim && !sim.ativo;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="mb-[12px] flex items-center gap-[10px]">
          <span className="font-display text-[14px] font-bold">Novo atendimento</span>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {['1. Identificação', '2. Simulação', '3. Proposta'][etapa - 1]}
          </span>
        </div>

        {etapa === 1 && (
          <div className="flex flex-wrap items-end gap-[14px]">
            <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Nome</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)} className={`${inputCls} w-[220px]`} style={inputStyle} /></label>
            <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>CPF</span>
              <input value={cpf} onChange={(e) => setCpf(e.target.value)} className={`${inputCls} w-[150px]`} style={inputStyle} /></label>
            <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Telefone</span>
              <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(31) 99999-9999" className={`${inputCls} w-[150px]`} style={inputStyle} /></label>
            <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Canal de origem</span>
              <select value={canal} onChange={(e) => setCanal(e.target.value)} className={`${inputCls} w-[170px]`} style={inputStyle}>
                {CANAIS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select></label>
            <button onClick={iniciarLead} disabled={ocupado || !nome || !cpf || telefone.trim().length < 8}
              className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
              style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado || !nome || !cpf || telefone.trim().length < 8 ? 0.6 : 1 }}>Iniciar</button>
          </div>
        )}

        {etapa === 2 && (
          <div className="flex flex-col gap-[12px]">
            {leadInfo && <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>{leadInfo}</div>}

            {/* Tela 1 — veículo/ativo OU valor à vista manual */}
            {!sim && (
              <div className="flex flex-wrap items-end gap-[14px]">
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Veículo/Ativo</span>
                  <select value={ativoId} onChange={(e) => setAtivoId(e.target.value)} className={`${inputCls} w-[280px]`} style={inputStyle}>
                    <option value="">Selecionar…</option>
                    {ativos.data?.map((a) => <option key={a.id} value={a.id}>{a.descricao}{a.valorVenda ? ` · ${formatCurrency(a.valorVenda)}` : ''}</option>)}
                  </select></label>
                <span className="pb-[9px] text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>OU</span>
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Valor à vista (R$, manual)</span>
                  <input value={valorManual} onChange={(e) => setValorManual(e.target.value)} placeholder="50.000,00" className={`${inputCls} w-[140px]`} style={inputStyle} disabled={!!ativoId} /></label>
                <button onClick={simular} disabled={ocupado || (!ativoId && reaisParaCentavos(valorManual) <= 0)}
                  className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
                  style={{ background: 'var(--navy)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>Ver ofertas</button>
              </div>
            )}

            {/* Tela 2 — ofertas (fixa em destaque + padrão) */}
            {sim && (
              <div className="flex flex-col gap-[10px]">
                <div className="flex items-center gap-[8px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>
                  <b>{sim.ativo?.descricao ?? 'Valor manual'}</b> · à vista {formatCurrency(sim.valorAvista)}
                  {sim.validaAte && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>· válida até {new Date(sim.validaAte).toLocaleDateString('pt-BR')}</span>}
                  <button onClick={() => { setSim(null); setOfertaSel(''); setMostraPersonalizada(false); }} className="text-[11px] font-semibold" style={{ color: 'var(--navy)' }}>trocar</button>
                </div>

                <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-3">
                  {sim.ofertas.map((of: OfertaSimulada) => (
                    <label key={of.id} className="flex cursor-pointer flex-col gap-[4px] rounded-[12px] p-[12px]"
                      style={{
                        border: `2px solid ${ofertaSel === of.id ? 'var(--accent)' : of.tipo === 'oferta_fixa' ? 'var(--navy)' : 'var(--border)'}`,
                        background: of.tipo === 'oferta_fixa' ? 'var(--surface-input)' : 'var(--surface)',
                      }}>
                      <span className="flex items-center justify-between">
                        <span className="text-[10.5px] font-bold uppercase tracking-[0.04em]" style={{ color: of.tipo === 'oferta_fixa' ? 'var(--navy)' : 'var(--text-label)' }}>
                          {TIPO_LABEL[of.tipo] ?? of.tipo}
                        </span>
                        <input type="radio" name="oferta" checked={ofertaSel === of.id} onChange={() => setOfertaSel(of.id)} />
                      </span>
                      <span className="text-[12.5px] font-bold">Contrato de {of.prazoMeses ?? '—'} meses</span>
                      <span className="font-display text-[17px] font-bold" style={{ color: 'var(--accent)' }}>
                        {formatCurrency(of.valorParcela)} <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{FREQ_LABEL[of.frequencia]}</span>
                      </span>
                      <span className="text-[11.5px]" style={{ color: 'var(--text-body)' }}>Entrada {formatCurrency(of.valorEntrada)} · {of.numeroParcelas} parcelas</span>
                    </label>
                  ))}
                </div>

                {/* Tela 3 — simular outras opções */}
                {!mostraPersonalizada ? (
                  <button onClick={() => setMostraPersonalizada(true)} className="self-start text-[12px] font-semibold" style={{ color: 'var(--navy)' }}>
                    + Simular outras opções
                  </button>
                ) : (
                  <div className="flex flex-wrap items-end gap-[12px] rounded-[10px] p-[12px]" style={{ background: 'var(--surface-input)' }}>
                    <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Entrada (R$)</span>
                      <input value={pEntrada} onChange={(e) => setPEntrada(e.target.value)} placeholder={parametros.data ? (parametros.data.entradaMinima / 100).toLocaleString('pt-BR') : ''} className={`${inputCls} w-[120px]`} style={inputStyle} /></label>
                    <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Prazo (meses)</span>
                      <select value={pPrazo} onChange={(e) => setPPrazo(e.target.value)} className={`${inputCls} w-[100px]`} style={inputStyle}>
                        {(parametros.data?.prazosPadronizados ?? [6, 12, 24, 36, 48]).map((m) => <option key={m} value={m}>{m}</option>)}
                      </select></label>
                    <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Frequência</span>
                      <select value={pFreq} onChange={(e) => setPFreq(e.target.value as typeof pFreq)} className={`${inputCls} w-[120px]`} style={inputStyle}>
                        <option value="semanal">Semanal</option>
                        <option value="quinzenal">Quinzenal</option>
                        <option value="mensal">Mensal</option>
                      </select></label>
                    <label className="flex items-center gap-[6px] pb-[8px] text-[12px]" style={{ color: 'var(--text-body)' }}>
                      <input type="checkbox" checked={entParcelada} onChange={(e) => setEntParcelada(e.target.checked)} /> Entrada parcelada (60% à vista)
                    </label>
                    <button onClick={simularOutra} disabled={ocupado || reaisParaCentavos(pEntrada) <= 0}
                      className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
                      style={{ background: 'var(--navy)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>Simular</button>
                  </div>
                )}

                {semAtivo && (
                  <div className="rounded-[10px] p-[10px] text-[12px]" style={{ background: '#fff7e6', color: '#8a5a00' }}>
                    Simulação por valor manual — para <b>gerar proposta</b>, refaça selecionando um <b>veículo/ativo</b> ("trocar" acima).
                  </div>
                )}

                {/* Tela 4 — ações sobre a condição escolhida */}
                <div className="flex items-center gap-[8px]">
                  <button onClick={irParaProposta} disabled={ocupado || !ofertaSel || semAtivo}
                    className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: '#fff' }}>Avançar para proposta</button>
                  <button onClick={apresentar} disabled={ocupado}
                    className="h-[36px] rounded-[8px] px-[14px] text-[12px] font-semibold"
                    style={{ background: 'var(--surface-input)', color: 'var(--text-body)' }}>Apresentar ao cliente</button>
                </div>
              </div>
            )}
          </div>
        )}

        {etapa === 3 && (
          <div className="flex flex-col gap-[16px]">
            <div>
              <div className="mb-[8px] text-[12px] font-semibold" style={{ color: 'var(--text-body)' }}>Comprador principal — cadastro completo</div>
              <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Nome</span>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} style={inputStyle} /></label>
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>CPF</span>
                  <input value={cpf} disabled className={inputCls} style={{ ...inputStyle, opacity: 0.7 }} /></label>
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>WhatsApp</span>
                  <input value={cad.whatsapp} onChange={(e) => setCad({ ...cad, whatsapp: e.target.value })} className={inputCls} style={inputStyle} placeholder="11999999999" /></label>
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>E-mail</span>
                  <input value={cad.email} onChange={(e) => setCad({ ...cad, email: e.target.value })} className={inputCls} style={inputStyle} /></label>
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>RG</span>
                  <input value={cad.rg} onChange={(e) => setCad({ ...cad, rg: e.target.value })} className={inputCls} style={inputStyle} /></label>
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Estado civil</span>
                  <input value={cad.estadoCivil} onChange={(e) => setCad({ ...cad, estadoCivil: e.target.value })} className={inputCls} style={inputStyle} /></label>
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Profissão</span>
                  <input value={cad.profissao} onChange={(e) => setCad({ ...cad, profissao: e.target.value })} className={inputCls} style={inputStyle} /></label>
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>CEP {buscandoCep && <span style={{ color: 'var(--text-muted)' }}>· buscando…</span>}</span>
                  <input value={cad.cep} onChange={(e) => setCad({ ...cad, cep: e.target.value })} onBlur={onBlurCep} placeholder="00000-000" className={inputCls} style={inputStyle} /></label>
                <label className="flex flex-col gap-[4px] col-span-2"><span className={labelCls} style={labelStyle}>Endereço</span>
                  <input value={cad.endereco} onChange={(e) => setCad({ ...cad, endereco: e.target.value })} className={inputCls} style={inputStyle} /></label>
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Bairro</span>
                  <input value={cad.bairro} onChange={(e) => setCad({ ...cad, bairro: e.target.value })} className={inputCls} style={inputStyle} /></label>
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Cidade/UF</span>
                  <div className="flex gap-[6px]">
                    <input value={cad.cidade} onChange={(e) => setCad({ ...cad, cidade: e.target.value })} className={`${inputCls} flex-1`} style={inputStyle} />
                    <input value={cad.estado} onChange={(e) => setCad({ ...cad, estado: e.target.value })} className={`${inputCls} w-[52px]`} style={inputStyle} placeholder="UF" />
                  </div></label>
              </div>
            </div>

            <div className="border-t pt-[14px]" style={{ borderColor: 'var(--border)' }}>
              <label className="flex items-center gap-[8px] text-[12px] font-semibold" style={{ color: 'var(--text-body)' }}>
                <input type="checkbox" checked={comSeg} onChange={(e) => setComSeg(e.target.checked)} /> Incluir 2º comprador (opcional)
              </label>
              {comSeg && (
                <div className="mt-[10px] grid grid-cols-1 gap-[12px] sm:grid-cols-3">
                  <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Nome</span>
                    <input value={seg.nome} onChange={(e) => setSeg({ ...seg, nome: e.target.value })} className={inputCls} style={inputStyle} /></label>
                  <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>CPF</span>
                    <input value={seg.cpf} onChange={(e) => setSeg({ ...seg, cpf: e.target.value })} className={inputCls} style={inputStyle} /></label>
                  <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>WhatsApp</span>
                    <input value={seg.whatsapp} onChange={(e) => setSeg({ ...seg, whatsapp: e.target.value })} className={inputCls} style={inputStyle} /></label>
                </div>
              )}
            </div>

            <div className="flex items-center gap-[8px]">
              <button onClick={criarProposta} disabled={ocupado}
                className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
                style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>Converter em proposta</button>
              <button onClick={resetWizard} className="h-[36px] rounded-[8px] px-[12px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Documentos e parecer são feitos na análise da proposta.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
