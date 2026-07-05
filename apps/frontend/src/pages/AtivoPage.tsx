import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { ativoService, CriarAtivoBody } from '../services/ativo.service';
import { simuladorService } from '../services/simulador.service';
import { StatusBadge } from '../components/StatusBadge';
import { ATIVO_STATUS_COLORS } from '../config/statusColors';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';
import { reaisParaCentavos } from '../lib/valor';

const STATUS_LABEL: Record<string, string> = {
  disponivel: 'Disponível', em_contrato: 'Em contrato', quitado: 'Quitado', recuperado: 'Recuperado', sinistrado: 'Sinistrado',
};
const COMBUSTIVEIS = ['flex', 'gasolina', 'eletrico', 'diesel', 'hibrido'];
const ORIGENS = ['locadora', 'particular', 'concessionaria'];
const CAPITAIS: Record<string, string> = {
  capital_proprio: 'Capital próprio', emprestimo: 'Empréstimo', investidor_ativo: 'Investidor de ativo', fundo: 'Fundo',
};

const inputCls = 'h-[34px] rounded-[8px] px-[10px] text-[12.5px]';
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' };
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{children}</span>
);

type FormState = Record<string, string>;
const EMPTY: FormState = {
  marca: '', modelo: '', anoFabricacao: '', anoModelo: '', cor: '', placa: '', chassi: '', renavam: '',
  combustivel: 'flex', origem: '', quilometragemEntrada: '', valorAquisicao: '', valorVenda: '', pacoteOfertaId: '', ofertaFixaId: '',
  capTipo: 'capital_proprio', capValor: '', capTaxa: '',
};

const reais = (v: string) => reaisParaCentavos(v);
const num = (v: string) => (v === '' ? undefined : Number(v));
const str = (v: string) => (v.trim() === '' ? undefined : v.trim());

export function AtivoPage() {
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeEditar = pode(ROLE_OPERACAO);
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [status, setStatus] = useState('disponivel');
  const [temOC, setTemOC] = useState(false); // ativo já tem origem de capital

  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');

  const ofertasFixas = useQuery({ queryKey: ['ofertas-fixas'], queryFn: () => simuladorService.ofertasFixas() });
  const ativos = useQuery({
    queryKey: ['ativos', filtroStatus, busca],
    queryFn: () => ativoService.listar({
      status: filtroStatus || undefined,
      placa: busca || undefined,
      chassi: busca || undefined,
    }),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function novo() { setEditId(null); setForm(EMPTY); setStatus('disponivel'); setTemOC(false); setAberto(true); }

  async function editar(id: string) {
    setOcupado(true);
    try {
      const [a, oc] = await Promise.all([ativoService.buscarPorId(id), ativoService.origemCapital(id)]);
      setForm({
        marca: a.marca ?? '', modelo: a.modelo ?? '', anoFabricacao: a.anoFabricacao?.toString() ?? '',
        anoModelo: a.anoModelo?.toString() ?? '', cor: a.cor ?? '', placa: a.placa ?? '', chassi: a.chassi ?? '',
        renavam: a.renavam ?? '', combustivel: a.combustivel ?? 'flex', origem: a.origem ?? '',
        quilometragemEntrada: a.quilometragemEntrada?.toString() ?? '',
        valorAquisicao: a.valorAquisicao ? (a.valorAquisicao / 100).toString() : '',
        valorVenda: a.valorVenda ? (a.valorVenda / 100).toString() : '',
        pacoteOfertaId: a.pacoteOfertaId ?? '',
        ofertaFixaId: a.ofertaFixaId ?? '',
        capTipo: oc?.tipo ?? 'capital_proprio',
        capValor: oc ? (oc.valorAportado / 100).toString() : '',
        capTaxa: oc?.taxaRetorno != null ? (oc.taxaRetorno * 100).toString() : '',
      });
      setTemOC(!!oc);
      setStatus(a.status);
      setEditId(id);
      setAberto(true);
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  async function salvar() {
    const descricao = `${form.marca} ${form.modelo} ${form.anoModelo}`.trim() || 'Veículo';
    const body: CriarAtivoBody = {
      descricao,
      marca: str(form.marca), modelo: str(form.modelo), anoFabricacao: num(form.anoFabricacao),
      anoModelo: num(form.anoModelo), cor: str(form.cor), placa: str(form.placa), chassi: str(form.chassi),
      renavam: str(form.renavam), combustivel: form.combustivel || undefined, origem: str(form.origem),
      quilometragemEntrada: num(form.quilometragemEntrada),
      valorAquisicao: form.valorAquisicao ? reais(form.valorAquisicao) : undefined,
      valorVenda: form.valorVenda ? reais(form.valorVenda) : undefined,
      pacoteOfertaId: str(form.pacoteOfertaId),
      ofertaFixaId: form.ofertaFixaId || null,
    };
    setOcupado(true);
    try {
      const oc = form.capValor
        ? {
            tipo: form.capTipo,
            valorAportado: reais(form.capValor),
            taxaRetorno: form.capTaxa ? Number(form.capTaxa) / 100 : undefined,
            dataAporte: new Date().toISOString().slice(0, 10),
          }
        : null;
      if (editId) {
        await ativoService.atualizar(editId, { ...body, status });
        if (oc) {
          // Cria a origem de capital se ainda não existe; senão atualiza valores.
          if (temOC) await ativoService.atualizarOrigemCapital(editId, { valorAportado: oc.valorAportado, taxaRetorno: oc.taxaRetorno });
          else await ativoService.definirOrigemCapital(editId, oc);
        }
      } else {
        const ativo = await ativoService.criar(body);
        if (oc) await ativoService.definirOrigemCapital(ativo.id, oc);
      }
      setAberto(false);
      await queryClient.invalidateQueries({ queryKey: ['ativos'] });
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Barra de ações */}
      <div className="flex flex-wrap items-center gap-[10px]">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar placa/chassi" className={`${inputCls} w-[200px]`} style={inStyle} />
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className={`${inputCls} w-[160px]`} style={inStyle}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex-1" />
        {podeEditar && (
          <button onClick={novo} className="h-[34px] rounded-[8px] px-[16px] text-[12.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>
            + Novo ativo
          </button>
        )}
      </div>

      {/* Formulário */}
      {aberto && podeEditar && (
        <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="mb-[12px] font-display text-[14px] font-bold">{editId ? 'Editar ativo' : 'Novo ativo'}</div>
          <div className="grid grid-cols-4 gap-[12px]">
            <label className="flex flex-col gap-[4px]"><Lbl>Marca</Lbl><input value={form.marca} onChange={set('marca')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Modelo</Lbl><input value={form.modelo} onChange={set('modelo')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Ano fab.</Lbl><input value={form.anoFabricacao} onChange={set('anoFabricacao')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Ano modelo</Lbl><input value={form.anoModelo} onChange={set('anoModelo')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Cor</Lbl><input value={form.cor} onChange={set('cor')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Placa</Lbl><input value={form.placa} onChange={set('placa')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Chassi</Lbl><input value={form.chassi} onChange={set('chassi')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>RENAVAM</Lbl><input value={form.renavam} onChange={set('renavam')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Combustível</Lbl>
              <select value={form.combustivel} onChange={set('combustivel')} className={inputCls} style={inStyle}>
                {COMBUSTIVEIS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-[4px]"><Lbl>Origem</Lbl>
              <select value={form.origem} onChange={set('origem')} className={inputCls} style={inStyle}>
                <option value="">—</option>
                {ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-[4px]"><Lbl>Km entrada</Lbl><input value={form.quilometragemEntrada} onChange={set('quilometragemEntrada')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Valor aquisição (R$)</Lbl><input value={form.valorAquisicao} onChange={set('valorAquisicao')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Valor de venda (R$)</Lbl><input value={form.valorVenda} onChange={set('valorVenda')} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Oferta fixa (opcional)</Lbl>
              <select value={form.ofertaFixaId} onChange={set('ofertaFixaId')} className={inputCls} style={inStyle}>
                <option value="">Sem oferta vinculada</option>
                {ofertasFixas.data?.filter((o) => o.ativa).map((o) => (
                  <option key={o.id} value={o.id}>{o.nome} · {formatCurrency(o.valorParcela)}/{o.frequencia}</option>
                ))}
              </select></label>
            {editId && (
              <label className="flex flex-col gap-[4px]"><Lbl>Status</Lbl>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} style={inStyle}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="mt-[14px] border-t pt-[14px]" style={{ borderColor: 'var(--border)' }}>
            <div className="mb-[8px] text-[12px] font-semibold" style={{ color: 'var(--text-body)' }}>
              Origem de capital {temOC ? '' : '(necessária para gerar os recebíveis na originação)'}
            </div>
            <div className="grid grid-cols-4 gap-[12px]">
              <label className="flex flex-col gap-[4px]"><Lbl>Tipo</Lbl>
                <select value={form.capTipo} onChange={set('capTipo')} disabled={temOC} className={inputCls} style={{ ...inStyle, opacity: temOC ? 0.6 : 1 }}>
                  {Object.entries(CAPITAIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-[4px]"><Lbl>Valor aportado (R$)</Lbl><input value={form.capValor} onChange={set('capValor')} className={inputCls} style={inStyle} /></label>
              <label className="flex flex-col gap-[4px]"><Lbl>Taxa retorno (% a.s.)</Lbl><input value={form.capTaxa} onChange={set('capTaxa')} className={inputCls} style={inStyle} /></label>
            </div>
            {temOC && <div className="mt-[6px] text-[11px]" style={{ color: 'var(--text-muted)' }}>O tipo não muda após criado; ajuste valor/taxa se necessário.</div>}
          </div>

          <div className="mt-[14px] flex gap-[8px]">
            <button onClick={salvar} disabled={ocupado} className="h-[34px] rounded-[8px] px-[16px] text-[12.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>
              {editId ? 'Salvar' : 'Cadastrar'}
            </button>
            <button onClick={() => setAberto(false)} className="h-[34px] rounded-[8px] px-[12px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Estoque */}
      <div className="rounded-card overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[12px] text-left font-semibold">Veículo</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Placa</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Chassi</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Valor de venda</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {ativos.data?.data.length === 0 && (
              <tr><td colSpan={5} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhum ativo.</td></tr>
            )}
            {ativos.data?.data.map((a) => (
              <tr key={a.id} className={podeEditar ? 'cursor-pointer hover:bg-[var(--surface-input)]' : ''}
                onClick={() => podeEditar && editar(a.id)} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="px-[18px] py-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{a.descricao}</td>
                <td className="px-[18px] py-[12px]" style={{ color: 'var(--text-body)' }}>{a.placa ?? '—'}</td>
                <td className="px-[18px] py-[12px]" style={{ color: 'var(--text-body)' }}>{a.chassi ?? '—'}</td>
                <td className="px-[18px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{a.valorVenda ? formatCurrency(a.valorVenda) : '—'}</td>
                <td className="px-[18px] py-[12px]"><StatusBadge label={STATUS_LABEL[a.status] ?? a.status} colors={ATIVO_STATUS_COLORS} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
