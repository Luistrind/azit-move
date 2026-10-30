import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { financeiroService, type ConfiguracaoFinanceiro } from '../services/financeiro.service';
import { capitalService } from '../services/capital.service';
import { toast } from '../components/Toast';
import { Bloco } from '../components/Bloco';
import { Botao } from '../components/Botao';
import { Tabela, type Coluna } from '../components/Tabela';
import { mensagemErro } from '../lib/permissoes';

// Configuração do Financeiro Administrativo (FA-CP-00): entidades legais e
// contas, naturezas financeiras e centros de custo organizacionais.
// Veículo/investidor/produto NUNCA viram centro de custo (anti-padrão).
// Layout v2 (doc 03 §11): cada seção é um <Bloco>; listas em <Tabela>;
// formulários empilham no celular e abrem em colunas no desktop.

const inputCls = 'h-[34px] w-full rounded-[10px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const lblCls = 'flex min-w-0 flex-col gap-[4px] text-[11px] font-semibold';
const lblStyle = { color: 'var(--text-label)' } as const;
const checkCls = 'flex min-h-[34px] items-center gap-[6px] text-[11.5px]';

type Entidade = ConfiguracaoFinanceiro['entidades'][number];
type Natureza = ConfiguracaoFinanceiro['naturezas'][number];

export function FinanceiroConfigPage() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['fin-config'], queryFn: () => financeiroService.configuracao() });
  const [novaEntidade, setNovaEntidade] = useState({ razaoSocial: '', cnpj: '', unidadeNegocio: '', estruturaId: '' });
  // Estruturas jurídicas (Capital): vínculo opcional da entidade — homologação
  // 04/08: cada produto (PV, RP) vira estrutura própria com conta separada.
  const estruturas = useQuery({ queryKey: ['estruturas'], queryFn: () => capitalService.estruturas() });
  const [novaConta, setNovaConta] = useState({ entidadeId: '', banco: '', agencia: '', conta: '' });
  const [novaNatureza, setNovaNatureza] = useState({ codigo: '', nome: '', grupoId: '', saida: true, exigeAtivo: false, especial: false });
  const [novoGrupo, setNovoGrupo] = useState({ codigo: '', nome: '' });
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [novoCentro, setNovoCentro] = useState({ codigo: '', nome: '' });
  const [ocupado, setOcupado] = useState(false);

  async function rodar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try { await fn(); await qc.invalidateQueries({ queryKey: ['fin-config'] }); toast.sucesso(ok); }
    catch (e) { toast.erro(mensagemErro(e)); } finally { setOcupado(false); }
  }

  const c = config.data;

  const colunasEntidade: Coluna<Entidade>[] = [
    { chave: 'razao', titulo: 'Razão social', celular: 'titulo', render: (e) => e.razaoSocial },
    { chave: 'cnpj', titulo: 'CNPJ', celular: 'subtitulo', classe: 'tabular-nums', render: (e) => e.cnpj || 'a preencher' },
    { chave: 'unidade', titulo: 'Unidade de negócio', celular: 'campo', render: (e) => e.unidadeNegocio || '—' },
    { chave: 'estrutura', titulo: 'Estrutura jurídica', celular: 'campo', render: (e) => e.estruturaNome || '—' },
    {
      chave: 'contas',
      titulo: 'Contas bancárias',
      celular: 'campo',
      render: (e) =>
        e.contas.length === 0
          ? <span style={{ color: 'var(--warn-ink)' }}>Sem conta — necessária para formar lote</span>
          : e.contas.map((ct) => `${ct.banco}${ct.agencia ? ` ag ${ct.agencia}` : ''}${ct.conta ? ` c/c ${ct.conta}` : ''}`).join(' · '),
    },
  ];

  const marcador = (n: Natureza, campo: 'exigeAtivo' | 'exigeCotacao' | 'especial' | 'exigeJustificativa', title?: string) => (
    <input type="checkbox" checked={n[campo]} disabled={ocupado} title={title} onChange={(e) => rodar(() => financeiroService.editarNatureza(n.id, { [campo]: e.target.checked }), 'Categoria atualizada.')} />
  );
  const colunasCategoria: Coluna<Natureza>[] = [
    { chave: 'codigo', titulo: 'Código', celular: 'subtitulo', classe: 'tabular-nums', render: (n) => n.codigo },
    { chave: 'nome', titulo: 'Nome', celular: 'titulo', render: (n) => <span style={{ opacity: n.ativo ? 1 : 0.55 }}>{n.nome}{!n.ativo && ' (inativa)'}</span> },
    { chave: 'tipo', titulo: 'Tipo', celular: 'campo', render: (n) => (n.saida ? 'Saída' : 'Receita') },
    { chave: 'exigeAtivo', titulo: 'Exige veículo', celular: 'campo', alinhar: 'center', render: (n) => marcador(n, 'exigeAtivo') },
    { chave: 'exigeCotacao', titulo: 'Exige cotação', celular: 'campo', alinhar: 'center', render: (n) => marcador(n, 'exigeCotacao') },
    { chave: 'especial', titulo: 'Diretoria', celular: 'campo', alinhar: 'center', render: (n) => marcador(n, 'especial', 'Aprovação da Diretoria sempre, independente do valor') },
    { chave: 'justificativa', titulo: 'Justificativa', celular: 'campo', alinhar: 'center', render: (n) => marcador(n, 'exigeJustificativa') },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="m-0 max-w-[720px] text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Fundação do contas a pagar: entidades legais (CNPJs), contas bancárias, naturezas financeiras e
        centros de custo por área. As alçadas de aprovação ficam em Configuração → Alçadas.
      </p>

      {!c ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
      ) : (
        <>
          <Bloco titulo="Entidades legais e contas bancárias" tag={`${c.entidades.length} ${c.entidades.length === 1 ? 'entidade' : 'entidades'}`}>
            <Tabela colunas={colunasEntidade} linhas={c.entidades} chave={(e) => e.id} vazio="Nenhuma entidade cadastrada." larguraMinima={720} />

            <div className="grid grid-cols-1 items-end gap-[8px] sm:grid-cols-2 lg:grid-cols-5">
              <label className={lblCls} style={lblStyle}>Razão social
                <input className={inputCls} style={inputStyle} value={novaEntidade.razaoSocial} onChange={(e) => setNovaEntidade({ ...novaEntidade, razaoSocial: e.target.value })} /></label>
              <label className={lblCls} style={lblStyle}>CNPJ
                <input className={inputCls} style={inputStyle} value={novaEntidade.cnpj} onChange={(e) => setNovaEntidade({ ...novaEntidade, cnpj: e.target.value })} /></label>
              <label className={lblCls} style={lblStyle}>Unidade de negócio
                <input className={inputCls} style={inputStyle} value={novaEntidade.unidadeNegocio} onChange={(e) => setNovaEntidade({ ...novaEntidade, unidadeNegocio: e.target.value })} /></label>
              <label className={lblCls} style={lblStyle}>Estrutura jurídica (Capital)
                <select className={inputCls} style={inputStyle} value={novaEntidade.estruturaId} onChange={(e) => setNovaEntidade({ ...novaEntidade, estruturaId: e.target.value })}>
                  <option value="">Sem vínculo</option>
                  {estruturas.data?.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select></label>
              <Botao variante="primaria" disabled={ocupado || novaEntidade.razaoSocial.trim().length < 2}
                onClick={() => rodar(() => financeiroService.criarEntidade({ razaoSocial: novaEntidade.razaoSocial.trim(), cnpj: novaEntidade.cnpj || undefined, unidadeNegocio: novaEntidade.unidadeNegocio || undefined, estruturaId: novaEntidade.estruturaId || undefined }), 'Entidade criada.')}>
                + Entidade
              </Botao>
            </div>
            <div className="grid grid-cols-1 items-end gap-[8px] sm:grid-cols-2 lg:grid-cols-5">
              <label className={lblCls} style={lblStyle}>Conta para a entidade
                <select className={inputCls} style={inputStyle} value={novaConta.entidadeId} onChange={(e) => setNovaConta({ ...novaConta, entidadeId: e.target.value })}>
                  <option value="">Selecione…</option>
                  {c.entidades.map((e) => <option key={e.id} value={e.id}>{e.razaoSocial}</option>)}
                </select></label>
              <label className={lblCls} style={lblStyle}>Banco
                <input className={inputCls} style={inputStyle} value={novaConta.banco} onChange={(e) => setNovaConta({ ...novaConta, banco: e.target.value })} placeholder="ex.: Cora" /></label>
              <label className={lblCls} style={lblStyle}>Agência
                <input className={inputCls} style={inputStyle} value={novaConta.agencia} onChange={(e) => setNovaConta({ ...novaConta, agencia: e.target.value })} /></label>
              <label className={lblCls} style={lblStyle}>Conta
                <input className={inputCls} style={inputStyle} value={novaConta.conta} onChange={(e) => setNovaConta({ ...novaConta, conta: e.target.value })} /></label>
              <Botao variante="primaria" disabled={ocupado || !novaConta.entidadeId || novaConta.banco.trim().length < 2}
                onClick={() => rodar(() => financeiroService.criarConta(novaConta.entidadeId, { banco: novaConta.banco.trim(), agencia: novaConta.agencia || undefined, conta: novaConta.conta || undefined }), 'Conta bancária criada.')}>
                + Conta
              </Botao>
            </div>
          </Bloco>

          <Bloco
            titulo="Plano de categorias"
            tag="grupo → categoria, igual ao relatório do Manda"
            leitura={<>O título a pagar aponta para a categoria; o grupo é o corte do quadro "Por categoria". Receita fica no plano e não aparece no título. Categoria inativa some do título novo, os antigos continuam apontando para ela. Não substitui o plano contábil do BPO.</>}
          >
            {c.grupos.map((g) => {
              const cats = c.naturezas.filter((n) => n.grupoId === g.id);
              return (
                <div key={g.id} className="flex flex-col gap-[8px] rounded-[12px] p-[10px]" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', opacity: g.ativo ? 1 : 0.6 }}>
                  <div className="flex flex-wrap items-center justify-between gap-[6px]">
                    <div className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>{g.codigo}. {g.nome}{!g.ativo && ' (inativo)'}</div>
                    <Botao tamanho="sm" disabled={ocupado} onClick={() => rodar(() => financeiroService.editarGrupo(g.id, { ativo: !g.ativo }), g.ativo ? 'Grupo inativado.' : 'Grupo reativado.')}>{g.ativo ? 'Inativar' : 'Reativar'}</Botao>
                  </div>
                  {/* Renomear: o formulário abre acima da grade (a célula da grade não
                      comporta input + botões no celular). */}
                  {editando && cats.some((n) => n.id === editando.id) && (
                    <div className="flex flex-wrap items-end gap-[6px] rounded-[10px] p-[8px]" style={{ background: 'var(--surface)', border: '1px dashed var(--border)' }}>
                      <label className={`${lblCls} flex-1 min-w-[180px]`} style={lblStyle}>Novo nome da categoria
                        <input className={inputCls} style={inputStyle} value={editando.nome} onChange={(e) => setEditando({ id: editando.id, nome: e.target.value })} /></label>
                      <Botao variante="primaria" disabled={ocupado || editando.nome.trim().length < 2} onClick={() => rodar(async () => { await financeiroService.editarNatureza(editando.id, { nome: editando.nome }); setEditando(null); }, 'Categoria renomeada.')}>Salvar</Botao>
                      <Botao onClick={() => setEditando(null)}>Cancelar</Botao>
                    </div>
                  )}
                  {cats.length > 0 && (
                    <Tabela
                      colunas={colunasCategoria}
                      linhas={cats}
                      chave={(n) => n.id}
                      larguraMinima={640}
                      acoes={(n) => (
                        <>
                          {editando?.id !== n.id && <Botao tamanho="sm" variante="fantasma" onClick={() => setEditando({ id: n.id, nome: n.nome })}>Renomear</Botao>}
                          <Botao tamanho="sm" variante="fantasma" disabled={ocupado} onClick={() => rodar(() => financeiroService.editarNatureza(n.id, { ativo: !n.ativo }), n.ativo ? 'Categoria inativada.' : 'Categoria reativada.')}>{n.ativo ? 'Inativar' : 'Reativar'}</Botao>
                        </>
                      )}
                    />
                  )}
                </div>
              );
            })}
            {c.naturezas.some((n) => !n.grupoId) && (
              <div className="text-[12px]" style={{ color: 'var(--warn-ink)' }}>
                Sem grupo: {c.naturezas.filter((n) => !n.grupoId).map((n) => `${n.codigo} ${n.nome}`).join(', ')} — defina o grupo ao criar; categorias sem grupo não aparecem no título.
              </div>
            )}
            <div className="grid grid-cols-1 items-end gap-[8px] sm:grid-cols-2 lg:grid-cols-4">
              <label className={lblCls} style={lblStyle}>Grupo
                <select className={inputCls} style={inputStyle} value={novaNatureza.grupoId} onChange={(e) => setNovaNatureza({ ...novaNatureza, grupoId: e.target.value })}>
                  <option value="">Selecione…</option>
                  {c.grupos.filter((g) => g.ativo).map((g) => <option key={g.id} value={g.id}>{g.codigo}. {g.nome}</option>)}
                </select></label>
              <label className={lblCls} style={lblStyle}>Código
                <input className={inputCls} style={inputStyle} value={novaNatureza.codigo} placeholder="3.04" onChange={(e) => setNovaNatureza({ ...novaNatureza, codigo: e.target.value })} /></label>
              <label className={`${lblCls} sm:col-span-2`} style={lblStyle}>Nome
                <input className={inputCls} style={inputStyle} value={novaNatureza.nome} onChange={(e) => setNovaNatureza({ ...novaNatureza, nome: e.target.value })} /></label>
              <label className={checkCls} style={{ color: 'var(--text-body)' }}><input type="checkbox" checked={!novaNatureza.saida} onChange={(e) => setNovaNatureza({ ...novaNatureza, saida: !e.target.checked })} />Receita (não entra em título)</label>
              <label className={checkCls} style={{ color: 'var(--text-body)' }}><input type="checkbox" checked={novaNatureza.exigeAtivo} onChange={(e) => setNovaNatureza({ ...novaNatureza, exigeAtivo: e.target.checked })} />Exige veículo</label>
              <label className={checkCls} style={{ color: 'var(--text-body)' }}><input type="checkbox" checked={novaNatureza.especial} onChange={(e) => setNovaNatureza({ ...novaNatureza, especial: e.target.checked })} />Diretoria sempre</label>
              <Botao variante="primaria" disabled={ocupado || !novaNatureza.grupoId || !novaNatureza.codigo.trim() || novaNatureza.nome.trim().length < 2}
                onClick={() => rodar(async () => { await financeiroService.criarNatureza({ ...novaNatureza, codigo: novaNatureza.codigo.trim() }); setNovaNatureza({ codigo: '', nome: '', grupoId: '', saida: true, exigeAtivo: false, especial: false }); }, 'Categoria criada.')}>+ Categoria</Botao>
            </div>
            <div className="grid grid-cols-1 items-end gap-[8px] pt-[8px] sm:grid-cols-2 lg:grid-cols-4" style={{ borderTop: '1px solid var(--border-light)' }}>
              <label className={lblCls} style={lblStyle}>Novo grupo — código
                <input className={inputCls} style={inputStyle} value={novoGrupo.codigo} placeholder="08" onChange={(e) => setNovoGrupo({ ...novoGrupo, codigo: e.target.value })} /></label>
              <label className={`${lblCls} lg:col-span-2`} style={lblStyle}>Nome
                <input className={inputCls} style={inputStyle} value={novoGrupo.nome} onChange={(e) => setNovoGrupo({ ...novoGrupo, nome: e.target.value })} /></label>
              <Botao variante="primaria" disabled={ocupado || !novoGrupo.codigo.trim() || novoGrupo.nome.trim().length < 2}
                onClick={() => rodar(async () => { await financeiroService.criarGrupo({ codigo: novoGrupo.codigo.trim(), nome: novoGrupo.nome.trim() }); setNovoGrupo({ codigo: '', nome: '' }); }, 'Grupo criado.')}>+ Grupo</Botao>
            </div>
          </Bloco>

          <Bloco
            titulo="Centros de custo"
            tag="opcional no título — áreas responsáveis"
            leitura="Veículo, investidor e produto são dimensões, não centros de custo."
          >
            <div className="flex flex-wrap gap-[6px]">
              {c.centros.length === 0 && <span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Nenhum centro de custo cadastrado.</span>}
              {c.centros.map((cc) => (
                <span key={cc.id} className="rounded-full px-[10px] py-[4px] text-[12px] font-semibold" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {cc.codigo} — {cc.nome}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-1 items-end gap-[8px] sm:grid-cols-2 lg:grid-cols-4">
              <label className={lblCls} style={lblStyle}>Código
                <input className={inputCls} style={inputStyle} value={novoCentro.codigo} onChange={(e) => setNovoCentro({ ...novoCentro, codigo: e.target.value.toUpperCase() })} /></label>
              <label className={`${lblCls} lg:col-span-2`} style={lblStyle}>Nome
                <input className={inputCls} style={inputStyle} value={novoCentro.nome} onChange={(e) => setNovoCentro({ ...novoCentro, nome: e.target.value })} /></label>
              <Botao variante="primaria" disabled={ocupado || !novoCentro.codigo || novoCentro.nome.trim().length < 2}
                onClick={() => rodar(() => financeiroService.criarCentro(novoCentro), 'Centro de custo criado.')}>+ Centro</Botao>
            </div>
          </Bloco>
        </>
      )}
    </div>
  );
}
