import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { produtoService, ProdutoBody } from '../services/produto.service';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';
import { reaisParaCentavos } from '../lib/valor';

const inputCls = 'h-[34px] rounded-[8px] px-[10px] text-[12.5px]';
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' };
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>{children}</span>
);
const NAT: Record<string, string> = { parcelado: 'Parcelado', recorrente: 'Recorrente' };
const CRED: Record<string, string> = { azit: 'Azit', investidor: 'Investidor', terceiro: 'Terceiro' };

const EMPTY = { nome: '', natureza: 'recorrente', credorPadrao: 'azit', valorPadrao: '', periodicidade: 'semanal', apartado: false, ancora: false };

export function ProdutosPage() {
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeEditar = pode(ROLE_OPERACAO);
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);

  const produtos = useQuery({ queryKey: ['produtos'], queryFn: () => produtoService.listar() });

  function novo() { setEditId(null); setForm(EMPTY); setAberto(true); }

  async function salvar() {
    if (!form.nome.trim()) return;
    const body: ProdutoBody = {
      nome: form.nome.trim(),
      natureza: form.natureza as 'parcelado' | 'recorrente',
      credorPadrao: form.credorPadrao as 'azit' | 'investidor' | 'terceiro',
      apartado: form.apartado,
      ancora: form.ancora,
      valorPadrao: form.valorPadrao ? reaisParaCentavos(form.valorPadrao) : undefined,
      periodicidade: form.natureza === 'recorrente' ? (form.periodicidade as 'semanal' | 'quinzenal' | 'mensal') : undefined,
    };
    setOcupado(true);
    try {
      if (editId) await produtoService.atualizar(editId, body);
      else await produtoService.criar(body);
      setAberto(false);
      await queryClient.invalidateQueries({ queryKey: ['produtos'] });
    } catch (e) { alert(mensagemErro(e)); } finally { setOcupado(false); }
  }

  function editar(p: NonNullable<typeof produtos.data>[number]) {
    setEditId(p.id);
    setForm({
      nome: p.nome, natureza: p.natureza, credorPadrao: p.credorPadrao,
      valorPadrao: p.valorPadrao ? (p.valorPadrao / 100).toString() : '',
      periodicidade: p.periodicidade ?? 'semanal', apartado: p.apartado, ancora: p.ancora,
    });
    setAberto(true);
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-center justify-between">
        <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Catálogo de produtos/serviços. Seguro é <b>apartado</b> (contrato próprio).</div>
        {podeEditar && (
          <button onClick={novo} className="h-[34px] rounded-[8px] px-[16px] text-[12.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>+ Novo produto</button>
        )}
      </div>

      {aberto && podeEditar && (
        <div className="rounded-card p-[18px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="mb-[12px] font-display text-[14px] font-bold">{editId ? 'Editar produto' : 'Novo produto'}</div>
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-[4px] col-span-2"><Lbl>Nome</Lbl>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className={inputCls} style={inStyle} /></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Natureza</Lbl>
              <select value={form.natureza} onChange={(e) => setForm({ ...form, natureza: e.target.value })} className={inputCls} style={inStyle}>
                <option value="recorrente">Recorrente</option><option value="parcelado">Parcelado</option>
              </select></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Credor padrão</Lbl>
              <select value={form.credorPadrao} onChange={(e) => setForm({ ...form, credorPadrao: e.target.value })} className={inputCls} style={inStyle}>
                <option value="azit">Azit</option><option value="investidor">Investidor</option><option value="terceiro">Terceiro</option>
              </select></label>
            <label className="flex flex-col gap-[4px]"><Lbl>Valor padrão (R$)</Lbl>
              <input value={form.valorPadrao} onChange={(e) => setForm({ ...form, valorPadrao: e.target.value })} className={inputCls} style={inStyle} /></label>
            {form.natureza === 'recorrente' && (
              <label className="flex flex-col gap-[4px]"><Lbl>Periodicidade</Lbl>
                <select value={form.periodicidade} onChange={(e) => setForm({ ...form, periodicidade: e.target.value })} className={inputCls} style={inStyle}>
                  <option value="semanal">Semanal</option><option value="quinzenal">Quinzenal</option><option value="mensal">Mensal</option>
                </select></label>
            )}
            <label className="flex items-center gap-[6px] pt-[18px] text-[12px]" style={{ color: 'var(--text-body)' }}>
              <input type="checkbox" checked={form.apartado} onChange={(e) => setForm({ ...form, apartado: e.target.checked })} /> Apartado (contrato próprio)
            </label>
            <label className="flex items-center gap-[6px] pt-[18px] text-[12px]" style={{ color: 'var(--text-body)' }}>
              <input type="checkbox" checked={form.ancora} onChange={(e) => setForm({ ...form, ancora: e.target.checked })} /> Âncora do contrato
            </label>
          </div>
          <div className="mt-[14px] flex gap-[8px]">
            <button onClick={salvar} disabled={ocupado || !form.nome.trim()} className="h-[34px] rounded-[8px] px-[16px] text-[12.5px] font-semibold" style={{ background: 'var(--accent)', color: '#fff', opacity: ocupado ? 0.6 : 1 }}>{editId ? 'Salvar' : 'Cadastrar'}</button>
            <button onClick={() => setAberto(false)} className="h-[34px] rounded-[8px] px-[12px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="rounded-card overflow-x-auto" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
          <thead>
            <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-[18px] py-[12px] text-left font-semibold">Produto</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Natureza</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Credor</th>
              <th className="px-[18px] py-[12px] text-right font-semibold">Valor padrão</th>
              <th className="px-[18px] py-[12px] text-left font-semibold">Tipo</th>
            </tr>
          </thead>
          <tbody>
            {produtos.data?.length === 0 && <tr><td colSpan={5} className="px-[18px] py-[24px] text-center" style={{ color: 'var(--text-muted)' }}>Nenhum produto.</td></tr>}
            {produtos.data?.map((p) => (
              <tr key={p.id} className={podeEditar ? 'cursor-pointer hover:bg-[var(--surface-input)]' : ''} onClick={() => podeEditar && editar(p)} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td className="px-[18px] py-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{p.nome}</td>
                <td className="px-[18px] py-[12px]" style={{ color: 'var(--text-body)' }}>{NAT[p.natureza]}{p.periodicidade ? ` · ${p.periodicidade}` : ''}</td>
                <td className="px-[18px] py-[12px]" style={{ color: 'var(--text-body)' }}>{CRED[p.credorPadrao]}</td>
                <td className="px-[18px] py-[12px] text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{p.valorPadrao != null ? formatCurrency(p.valorPadrao) : '—'}</td>
                <td className="px-[18px] py-[12px] text-[11px]" style={{ color: 'var(--text-muted)' }}>{p.ancora ? 'Âncora' : p.apartado ? 'Apartado' : 'Cesta'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
