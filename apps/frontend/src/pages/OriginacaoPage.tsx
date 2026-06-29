import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { originacaoService, SimulacaoResultado } from '../services/originacao.service';
import { StatusBadge } from '../components/StatusBadge';
import { PROPOSTA_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';

const LABEL_STATUS: Record<string, string> = {
  pendente: 'Pendente',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  reprovada: 'Reprovada',
  em_formalizacao: 'Em formalização',
  convertida: 'Convertida',
  cancelada: 'Cancelada',
};

const inputCls = 'h-[36px] rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' };
const labelCls = 'text-[11px] font-semibold';
const labelStyle = { color: 'var(--text-label)' };

export function OriginacaoPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pode = usePodeRole();
  const podeOriginar = pode(ROLE_OPERACAO);
  const [ocupado, setOcupado] = useState(false);

  // Wizard
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1);
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [leadInfo, setLeadInfo] = useState<string>('');
  const [leadId, setLeadId] = useState<string | undefined>();

  const [ativoId, setAtivoId] = useState('');
  const [entrada, setEntrada] = useState('15000');
  const [prazo, setPrazo] = useState('48');
  const [sim, setSim] = useState<SimulacaoResultado | null>(null);
  const [ofertaSel, setOfertaSel] = useState('');

  const [whatsapp, setWhatsapp] = useState('');

  const ativos = useQuery({ queryKey: ['ativos', 'disponiveis'], queryFn: () => originacaoService.ativosDisponiveis() });
  const propostas = useQuery({ queryKey: ['propostas'], queryFn: () => originacaoService.listarPropostas() });

  async function refetch() {
    await queryClient.invalidateQueries({ queryKey: ['propostas'] });
    await queryClient.invalidateQueries({ queryKey: ['ativos'] });
  }

  function resetWizard() {
    setEtapa(1); setNome(''); setCpf(''); setLeadInfo(''); setLeadId(undefined);
    setAtivoId(''); setEntrada('15000'); setPrazo('48'); setSim(null); setOfertaSel(''); setWhatsapp('');
  }

  async function iniciarLead() {
    if (!nome || !cpf) return;
    setOcupado(true);
    try {
      const r = await originacaoService.criarLead({ nome, cpf });
      if (r.tipo === 'titular') {
        setLeadInfo(`CPF já cadastrado: ${r.titular?.nome}. Seguindo como titular existente.`);
        setLeadId(undefined);
      } else {
        setLeadInfo('Novo lead criado.');
        setLeadId(r.lead?.id);
      }
      setEtapa(2);
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function simular() {
    if (!ativoId) return;
    setOcupado(true);
    try {
      const r = await originacaoService.simular({
        ativoId,
        valorEntrada: Math.round(Number(entrada || 0) * 100),
        prazoSemanas: Math.max(1, Number(prazo || 1)),
        leadId,
      });
      setSim(r);
      setOfertaSel(r.ofertas[0]?.id ?? '');
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function irParaProposta() {
    if (!sim || !ofertaSel) return;
    setOcupado(true);
    try {
      await originacaoService.selecionarOferta(sim.id, ofertaSel);
      setEtapa(3);
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function criarProposta() {
    if (!sim) return;
    setOcupado(true);
    try {
      const comprador = { nome, cpfCnpj: cpf, whatsapp: whatsapp || '11999999999', tipoPessoa: 'pf' as const };
      const prop = await originacaoService.criarProposta({ simulacaoId: sim.id, comprador });
      await refetch();
      resetWizard();
      navigate(`/originacao/propostas/${prop.id}`);
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Wizard de novo atendimento */}
      {podeOriginar && (
        <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="mb-[12px] flex items-center gap-[10px]">
            <span className="font-display text-[14px] font-bold">Novo atendimento</span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {['1. Identificação', '2. Simulação', '3. Proposta'][etapa - 1]}
            </span>
          </div>

          {etapa === 1 && (
            <div className="flex flex-wrap items-end gap-[14px]">
              <label className="flex flex-col gap-[4px]">
                <span className={labelCls} style={labelStyle}>Nome</span>
                <input value={nome} onChange={(e) => setNome(e.target.value)} className={`${inputCls} w-[220px]`} style={inputStyle} />
              </label>
              <label className="flex flex-col gap-[4px]">
                <span className={labelCls} style={labelStyle}>CPF</span>
                <input value={cpf} onChange={(e) => setCpf(e.target.value)} className={`${inputCls} w-[160px]`} style={inputStyle} />
              </label>
              <button onClick={iniciarLead} disabled={ocupado || !nome || !cpf}
                className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
                style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado || !nome || !cpf ? 0.6 : 1 }}>
                Iniciar
              </button>
            </div>
          )}

          {etapa === 2 && (
            <div className="flex flex-col gap-[12px]">
              {leadInfo && <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>{leadInfo}</div>}
              <div className="flex flex-wrap items-end gap-[14px]">
                <label className="flex flex-col gap-[4px]">
                  <span className={labelCls} style={labelStyle}>Ativo disponível</span>
                  <select value={ativoId} onChange={(e) => setAtivoId(e.target.value)} className={`${inputCls} w-[260px]`} style={inputStyle}>
                    <option value="">Selecione…</option>
                    {ativos.data?.map((a) => (
                      <option key={a.id} value={a.id}>{a.descricao}{a.valorVenda ? ` · ${formatCurrency(a.valorVenda)}` : ''}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-[4px]">
                  <span className={labelCls} style={labelStyle}>Entrada (R$)</span>
                  <input value={entrada} onChange={(e) => setEntrada(e.target.value)} className={`${inputCls} w-[110px]`} style={inputStyle} />
                </label>
                <label className="flex flex-col gap-[4px]">
                  <span className={labelCls} style={labelStyle}>Prazo (semanas)</span>
                  <input value={prazo} onChange={(e) => setPrazo(e.target.value)} className={`${inputCls} w-[110px]`} style={inputStyle} />
                </label>
                <button onClick={simular} disabled={ocupado || !ativoId}
                  className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
                  style={{ background: 'var(--navy)', color: '#fff', opacity: ocupado || !ativoId ? 0.6 : 1 }}>
                  Calcular ofertas
                </button>
              </div>

              {sim && (
                <div className="flex flex-col gap-[8px]">
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Ofertas (precificação provisória) — escolha uma:
                  </div>
                  {sim.ofertas.map((of) => (
                    <label key={of.id} className="flex items-center gap-[10px] rounded-[8px] p-[10px] cursor-pointer"
                      style={{ border: `1px solid ${ofertaSel === of.id ? 'var(--accent)' : 'var(--border)'}` }}>
                      <input type="radio" name="oferta" checked={ofertaSel === of.id} onChange={() => setOfertaSel(of.id)} />
                      <span className="text-[12.5px]">
                        <b>{of.origemCalculo === 'valor_venda_ativo' ? 'Valor de venda' : 'Pacote'}</b> ·
                        {' '}{of.numeroParcelas}× <b>{formatCurrency(of.valorParcela)}</b> ·
                        {' '}financiado {formatCurrency(of.valorFinanciado)} · total {formatCurrency(of.totalAPagar)}
                      </span>
                    </label>
                  ))}
                  <div>
                    <button onClick={irParaProposta} disabled={ocupado || !ofertaSel}
                      className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
                      style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado || !ofertaSel ? 0.6 : 1 }}>
                      Avançar para proposta
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {etapa === 3 && (
            <div className="flex flex-wrap items-end gap-[14px]">
              <div className="text-[12px]" style={{ color: 'var(--text-body)' }}>
                Comprador: <b>{nome}</b> (CPF {cpf}). Confirme o WhatsApp para criar a proposta:
              </div>
              <label className="flex flex-col gap-[4px]">
                <span className={labelCls} style={labelStyle}>WhatsApp</span>
                <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={`${inputCls} w-[160px]`} style={inputStyle} placeholder="11999999999" />
              </label>
              <button onClick={criarProposta} disabled={ocupado}
                className="h-[36px] rounded-[8px] px-[16px] text-[12.5px] font-semibold"
                style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>
                Criar proposta
              </button>
              <button onClick={resetWizard} className="h-[36px] rounded-[8px] px-[12px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}

      {/* Lista de propostas */}
      <div className="rounded-card overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="px-[18px] pt-[14px] font-display text-[13px] font-bold">Propostas</div>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[12px] text-left font-semibold">Cliente</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Ativo</th>
              <th className="px-[18px] py-[12px] text-center font-semibold">Parcelas</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {propostas.data?.length === 0 && (
              <tr><td colSpan={4} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhuma proposta ainda.</td></tr>
            )}
            {propostas.data?.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-[var(--surface-input)]"
                onClick={() => navigate(`/originacao/propostas/${p.id}`)}
                style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="px-[18px] py-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{p.titular}</td>
                <td className="px-[18px] py-[12px]" style={{ color: 'var(--text-body)' }}>{p.ativo}</td>
                <td className="px-[18px] py-[12px] text-center tabular-nums" style={{ color: 'var(--text-body)' }}>{p.numeroParcelas}× {formatCurrency(p.valorParcela)}</td>
                <td className="px-[18px] py-[12px]"><StatusBadge label={LABEL_STATUS[p.status] ?? p.status} colors={PROPOSTA_STATUS_COLORS} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
