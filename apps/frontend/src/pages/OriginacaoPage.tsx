import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { originacaoService, SimulacaoResultado } from '../services/originacao.service';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';
import { reaisParaCentavos } from '../lib/valor';

const inputCls = 'h-[36px] rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' };
const labelCls = 'text-[11px] font-semibold';
const labelStyle = { color: 'var(--text-label)' };

// Novo atendimento (Doc 2 §8.1 / §8-A.1-2): Lead → Simulação → Proposta. Os
// documentos e o parecer ficam na ANÁLISE da proposta (tela separada).
export function OriginacaoPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pode = usePodeRole();
  const podeOriginar = pode(ROLE_OPERACAO);
  const [ocupado, setOcupado] = useState(false);

  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [leadInfo, setLeadInfo] = useState('');
  const [leadId, setLeadId] = useState<string | undefined>();

  const [ativoId, setAtivoId] = useState('');
  const [entrada, setEntrada] = useState('15000');
  const [prazo, setPrazo] = useState('48');
  const [sim, setSim] = useState<SimulacaoResultado | null>(null);
  const [ofertaSel, setOfertaSel] = useState('');
  const [entParcelada, setEntParcelada] = useState(false);

  // Cadastro pleno do comprador principal + 2º comprador opcional.
  const [cad, setCad] = useState({ whatsapp: '', email: '', rg: '', estadoCivil: '', profissao: '', endereco: '', bairro: '', cidade: '', estado: '', cep: '' });
  const [comSeg, setComSeg] = useState(false);
  const [seg, setSeg] = useState({ nome: '', cpf: '', whatsapp: '' });

  const ativos = useQuery({ queryKey: ['ativos', 'disponiveis'], queryFn: () => originacaoService.ativosDisponiveis() });

  function resetWizard() {
    setEtapa(1); setNome(''); setCpf(''); setLeadInfo(''); setLeadId(undefined);
    setAtivoId(''); setEntrada('15000'); setPrazo('48'); setSim(null); setOfertaSel(''); setEntParcelada(false);
    setCad({ whatsapp: '', email: '', rg: '', estadoCivil: '', profissao: '', endereco: '', bairro: '', cidade: '', estado: '', cep: '' });
    setComSeg(false); setSeg({ nome: '', cpf: '', whatsapp: '' });
  }

  async function iniciarLead() {
    if (!nome || !cpf) return;
    setOcupado(true);
    try {
      const r = await originacaoService.criarLead({ nome, cpf });
      setLeadInfo(r.tipo === 'titular' ? `CPF já cadastrado: ${r.titular?.nome}. Seguindo como titular existente.` : 'Novo lead criado.');
      setLeadId(r.tipo === 'titular' ? undefined : r.lead?.id);
      setEtapa(2);
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function simular() {
    if (!ativoId) return;
    setOcupado(true);
    try {
      const r = await originacaoService.simular({
        ativoId, valorEntrada: reaisParaCentavos(entrada), prazoSemanas: Math.max(1, Number(prazo || 1)), leadId, entradaParcelada: entParcelada,
      });
      setSim(r);
      setOfertaSel(r.ofertas[0]?.id ?? '');
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function irParaProposta() {
    if (!sim || !ofertaSel) return;
    setOcupado(true);
    try { await originacaoService.selecionarOferta(sim.id, ofertaSel); setEtapa(3); }
    catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
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
      // Vai direto para a análise da proposta (documentos + parecer ficam lá).
      navigate(`/propostas/${prop.id}`);
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  if (!podeOriginar) {
    return <div className="rounded-card p-[18px] text-[13px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Sem permissão para originar.</div>;
  }

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
              <input value={cpf} onChange={(e) => setCpf(e.target.value)} className={`${inputCls} w-[160px]`} style={inputStyle} /></label>
            <button onClick={iniciarLead} disabled={ocupado || !nome || !cpf}
              className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
              style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado || !nome || !cpf ? 0.6 : 1 }}>Iniciar</button>
          </div>
        )}

        {etapa === 2 && (
          <div className="flex flex-col gap-[12px]">
            {leadInfo && <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>{leadInfo}</div>}
            <div className="flex flex-wrap items-end gap-[14px]">
              <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Ativo disponível</span>
                <select value={ativoId} onChange={(e) => setAtivoId(e.target.value)} className={`${inputCls} w-[260px]`} style={inputStyle}>
                  <option value="">Selecione…</option>
                  {ativos.data?.map((a) => <option key={a.id} value={a.id}>{a.descricao}{a.valorVenda ? ` · ${formatCurrency(a.valorVenda)}` : ''}</option>)}
                </select></label>
              <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Entrada (R$)</span>
                <input value={entrada} onChange={(e) => setEntrada(e.target.value)} className={`${inputCls} w-[110px]`} style={inputStyle} /></label>
              <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>Prazo (semanas)</span>
                <input value={prazo} onChange={(e) => setPrazo(e.target.value)} className={`${inputCls} w-[110px]`} style={inputStyle} /></label>
              <label className="flex items-center gap-[6px] pb-[8px] text-[12px]" style={{ color: 'var(--text-body)' }}>
                <input type="checkbox" checked={entParcelada} onChange={(e) => setEntParcelada(e.target.checked)} /> Entrada parcelada (60% à vista)
              </label>
              <button onClick={simular} disabled={ocupado || !ativoId}
                className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
                style={{ background: 'var(--navy)', color: '#fff', opacity: ocupado || !ativoId ? 0.6 : 1 }}>Calcular ofertas</button>
            </div>

            {sim && (
              <div className="flex flex-col gap-[8px]">
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Ofertas (precificação provisória) — escolha uma:</div>
                {sim.ofertas.map((of) => (
                  <label key={of.id} className="flex cursor-pointer items-center gap-[10px] rounded-[8px] p-[10px]"
                    style={{ border: `1px solid ${ofertaSel === of.id ? 'var(--accent)' : 'var(--border)'}` }}>
                    <input type="radio" name="oferta" checked={ofertaSel === of.id} onChange={() => setOfertaSel(of.id)} />
                    <span className="text-[12.5px]">
                      <b>{of.origemCalculo === 'valor_venda_ativo' ? 'Valor de venda' : 'Pacote'}</b> · {of.numeroParcelas}× <b>{formatCurrency(of.valorParcela)}</b> · financiado {formatCurrency(of.valorFinanciado)} · total {formatCurrency(of.totalAPagar)}
                    </span>
                  </label>
                ))}
                <div>
                  <button onClick={irParaProposta} disabled={ocupado || !ofertaSel}
                    className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
                    style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado || !ofertaSel ? 0.6 : 1 }}>Avançar para proposta</button>
                </div>
              </div>
            )}
          </div>
        )}

        {etapa === 3 && (
          <div className="flex flex-col gap-[16px]">
            <div>
              <div className="mb-[8px] text-[12px] font-semibold" style={{ color: 'var(--text-body)' }}>Comprador principal — cadastro completo</div>
              <div className="grid grid-cols-4 gap-[12px]">
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
                <label className="flex flex-col gap-[4px]"><span className={labelCls} style={labelStyle}>CEP</span>
                  <input value={cad.cep} onChange={(e) => setCad({ ...cad, cep: e.target.value })} className={inputCls} style={inputStyle} /></label>
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
                <div className="mt-[10px] grid grid-cols-3 gap-[12px]">
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
