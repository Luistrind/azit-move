import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@azit/utils';
import { produtoService, ProdutoBody, type Produto } from '../services/produto.service';
import { usePodeRole, ROLE_OPERACAO, mensagemErro } from '../lib/permissoes';
import { reaisParaCentavos } from '../lib/valor';
import { Tabela, type Coluna } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { Bloco } from '../components/Bloco';

// Itens avulsos de contrato (proteção, rastreador, taxas). Layout v2 (doc 03
// §11): grade em <Tabela>, formulário em <Bloco>, botões do kit.

const inputCls = 'h-[34px] w-full rounded-[10px] px-[10px] text-[12.5px]';
const inStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' };
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

  function editar(p: Produto) {
    setEditId(p.id);
    setForm({
      nome: p.nome, natureza: p.natureza, credorPadrao: p.credorPadrao,
      valorPadrao: p.valorPadrao ? (p.valorPadrao / 100).toString() : '',
      periodicidade: p.periodicidade ?? 'semanal', apartado: p.apartado, ancora: p.ancora,
    });
    setAberto(true);
  }

  const colunas: Coluna<Produto>[] = [
    { chave: 'nome', titulo: 'Produto', celular: 'titulo', render: (p) => p.nome },
    { chave: 'tipo', titulo: 'Tipo', celular: 'subtitulo', render: (p) => (p.ancora ? 'Âncora' : p.apartado ? 'Apartado' : 'Cesta') },
    { chave: 'natureza', titulo: 'Natureza', celular: 'campo', render: (p) => `${NAT[p.natureza]}${p.periodicidade ? ` · ${p.periodicidade}` : ''}` },
    { chave: 'credor', titulo: 'Credor', celular: 'campo', render: (p) => CRED[p.credorPadrao] },
    { chave: 'valor', titulo: 'Valor padrão', alinhar: 'right', classe: 'tabular-nums', celular: 'destaque', render: (p) => (p.valorPadrao != null ? formatCurrency(p.valorPadrao) : '—') },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p className="m-0 max-w-[720px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          <b>Itens avulsos de contrato</b> (proteção, rastreador, taxas) — entram no carrinho da proposta; seguro é <b>apartado</b> (contrato próprio).
          Produto comercial (venda, Reembolso Parcelado, proteção veicular) é gerido no <b>Catálogo de produtos</b>.
        </p>
        {podeEditar && <Botao variante="primaria" onClick={novo}>+ Novo item</Botao>}
      </div>

      {aberto && podeEditar && (
        <Bloco titulo={editId ? 'Editar produto' : 'Novo produto'}>
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-[4px] sm:col-span-2"><Lbl>Nome</Lbl>
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
            <label className="flex min-h-[34px] items-center gap-[6px] self-end text-[12px]" style={{ color: 'var(--text-body)' }}>
              <input type="checkbox" checked={form.apartado} onChange={(e) => setForm({ ...form, apartado: e.target.checked })} /> Apartado (contrato próprio)
            </label>
            <label className="flex min-h-[34px] items-center gap-[6px] self-end text-[12px]" style={{ color: 'var(--text-body)' }}>
              <input type="checkbox" checked={form.ancora} onChange={(e) => setForm({ ...form, ancora: e.target.checked })} /> Âncora do contrato
            </label>
          </div>
          <div className="flex flex-wrap gap-[8px]">
            <Botao variante="primaria" onClick={salvar} carregando={ocupado} disabled={!form.nome.trim()}>{editId ? 'Salvar' : 'Cadastrar'}</Botao>
            <Botao variante="fantasma" onClick={() => setAberto(false)}>Cancelar</Botao>
          </div>
        </Bloco>
      )}

      <Tabela
        colunas={colunas}
        linhas={produtos.data ?? []}
        chave={(p) => p.id}
        carregando={produtos.isLoading}
        vazio="Nenhum produto."
        onClick={podeEditar ? (p) => editar(p) : undefined}
      />
    </div>
  );
}
