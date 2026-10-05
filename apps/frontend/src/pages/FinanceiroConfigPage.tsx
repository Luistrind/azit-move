import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { financeiroService } from '../services/financeiro.service';
import { capitalService } from '../services/capital.service';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';

// Configuração do Financeiro Administrativo (FA-CP-00): entidades legais e
// contas, naturezas financeiras e centros de custo organizacionais.
// Veículo/investidor/produto NUNCA viram centro de custo (anti-padrão).

const card = 'rounded-[14px] p-[16px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[32px] rounded-[8px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;
const btnP = 'rounded-[8px] bg-[var(--navy)] px-[12px] py-[7px] text-[12px] font-bold text-white disabled:opacity-40';
const btnS = 'rounded-[8px] border border-[var(--border)] px-[12px] py-[7px] text-[12px] font-bold disabled:opacity-40';

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

  return (
    <div className="flex flex-col gap-[14px] p-[24px]">
      <div>
        <h1 className="font-display text-[20px] font-bold">Configuração do financeiro</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Fundação do contas a pagar: entidades legais (CNPJs), contas bancárias, naturezas financeiras e
          centros de custo por área. As alçadas de aprovação ficam em Configuração → Alçadas.
        </p>
      </div>

      {!c ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
      ) : (
        <>
          <div className={card} style={cardStyle}>
            <div className="mb-[8px] font-display text-[13px] font-bold">Entidades legais e contas bancárias</div>
            {c.entidades.map((e) => (
              <div key={e.id} className="border-t py-[8px] text-[12.5px]" style={{ borderColor: 'var(--border-light)' }}>
                <b>{e.razaoSocial}</b>{e.cnpj ? ` · CNPJ ${e.cnpj}` : ' · CNPJ a preencher'}{e.unidadeNegocio ? ` · unidade: ${e.unidadeNegocio}` : ''}{e.estruturaNome ? ` · estrutura: ${e.estruturaNome}` : ''}
                <div style={{ color: 'var(--text-muted)' }}>
                  {e.contas.length === 0 ? 'Sem conta bancária cadastrada — necessária para formar lote.' : e.contas.map((ct) => `${ct.banco}${ct.agencia ? ` ag ${ct.agencia}` : ''}${ct.conta ? ` c/c ${ct.conta}` : ''}`).join(' · ')}
                </div>
              </div>
            ))}
            <div className="mt-[8px] flex flex-wrap items-end gap-[8px]">
              <label className="text-[11px] font-semibold">Razão social
                <input className={`${inputCls} block w-[200px]`} style={inputStyle} value={novaEntidade.razaoSocial} onChange={(e) => setNovaEntidade({ ...novaEntidade, razaoSocial: e.target.value })} /></label>
              <label className="text-[11px] font-semibold">CNPJ
                <input className={`${inputCls} block w-[150px]`} style={inputStyle} value={novaEntidade.cnpj} onChange={(e) => setNovaEntidade({ ...novaEntidade, cnpj: e.target.value })} /></label>
              <label className="text-[11px] font-semibold">Unidade de negócio
                <input className={`${inputCls} block w-[160px]`} style={inputStyle} value={novaEntidade.unidadeNegocio} onChange={(e) => setNovaEntidade({ ...novaEntidade, unidadeNegocio: e.target.value })} /></label>
              <label className="text-[11px] font-semibold">Estrutura jurídica (Capital)
                <select className={`${inputCls} block w-[180px]`} style={inputStyle} value={novaEntidade.estruturaId} onChange={(e) => setNovaEntidade({ ...novaEntidade, estruturaId: e.target.value })}>
                  <option value="">Sem vínculo</option>
                  {estruturas.data?.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select></label>
              <button className={btnP} disabled={ocupado || novaEntidade.razaoSocial.trim().length < 2}
                onClick={() => rodar(() => financeiroService.criarEntidade({ razaoSocial: novaEntidade.razaoSocial.trim(), cnpj: novaEntidade.cnpj || undefined, unidadeNegocio: novaEntidade.unidadeNegocio || undefined, estruturaId: novaEntidade.estruturaId || undefined }), 'Entidade criada.')}>
                + Entidade
              </button>
            </div>
            <div className="mt-[8px] flex flex-wrap items-end gap-[8px]">
              <label className="text-[11px] font-semibold">Conta para a entidade
                <select className={`${inputCls} block w-[200px]`} style={inputStyle} value={novaConta.entidadeId} onChange={(e) => setNovaConta({ ...novaConta, entidadeId: e.target.value })}>
                  <option value="">Selecione…</option>
                  {c.entidades.map((e) => <option key={e.id} value={e.id}>{e.razaoSocial}</option>)}
                </select></label>
              <label className="text-[11px] font-semibold">Banco
                <input className={`${inputCls} block w-[130px]`} style={inputStyle} value={novaConta.banco} onChange={(e) => setNovaConta({ ...novaConta, banco: e.target.value })} placeholder="ex.: Cora" /></label>
              <label className="text-[11px] font-semibold">Agência
                <input className={`${inputCls} block w-[90px]`} style={inputStyle} value={novaConta.agencia} onChange={(e) => setNovaConta({ ...novaConta, agencia: e.target.value })} /></label>
              <label className="text-[11px] font-semibold">Conta
                <input className={`${inputCls} block w-[120px]`} style={inputStyle} value={novaConta.conta} onChange={(e) => setNovaConta({ ...novaConta, conta: e.target.value })} /></label>
              <button className={btnP} disabled={ocupado || !novaConta.entidadeId || novaConta.banco.trim().length < 2}
                onClick={() => rodar(() => financeiroService.criarConta(novaConta.entidadeId, { banco: novaConta.banco.trim(), agencia: novaConta.agencia || undefined, conta: novaConta.conta || undefined }), 'Conta bancária criada.')}>
                + Conta
              </button>
            </div>
          </div>

          <div className={card} style={cardStyle}>
            <div className="mb-[4px] font-display text-[13px] font-bold">Plano de categorias (grupo → categoria, igual ao relatório do Manda)</div>
            <div className="mb-[8px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              O título a pagar aponta para a categoria; o grupo é o corte do quadro "Por categoria". Receita fica no plano e não aparece no título. Categoria inativa some do título novo, os antigos continuam apontando para ela. Não substitui o plano contábil do BPO.
            </div>
            {c.grupos.map((g) => {
              const cats = c.naturezas.filter((n) => n.grupoId === g.id);
              return (
                <div key={g.id} className="mb-[8px] rounded-[10px] p-[8px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)', opacity: g.ativo ? 1 : 0.6 }}>
                  <div className="flex flex-wrap items-center justify-between gap-[6px]">
                    <div className="font-bold">{g.codigo}. {g.nome}{!g.ativo && ' (inativo)'}</div>
                    <button className={btnS} disabled={ocupado} onClick={() => rodar(() => financeiroService.editarGrupo(g.id, { ativo: !g.ativo }), g.ativo ? 'Grupo inativado.' : 'Grupo reativado.')}>{g.ativo ? 'Inativar' : 'Reativar'}</button>
                  </div>
                  {cats.length > 0 && (
                    <table className="mt-[6px] w-full min-w-[560px] border-collapse text-[12.5px]">
                      <thead><tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                        <th className="pb-[4px] font-semibold">Código</th><th className="pb-[4px] font-semibold">Nome</th><th className="pb-[4px] font-semibold">Tipo</th>
                        <th className="pb-[4px] font-semibold">Exige veículo</th><th className="pb-[4px] font-semibold">Exige cotação</th>
                        <th className="pb-[4px] font-semibold">Diretoria</th><th className="pb-[4px] font-semibold">Justificativa</th><th className="pb-[4px] font-semibold"></th>
                      </tr></thead>
                      <tbody>
                        {cats.map((n) => (
                          <tr key={n.id} style={{ borderTop: '1px solid var(--border-light)', opacity: n.ativo ? 1 : 0.55 }}>
                            <td className="py-[5px] tabular-nums">{n.codigo}</td>
                            <td className="py-[5px] font-semibold">
                              {editando?.id === n.id ? (
                                <span className="flex gap-[4px]">
                                  <input className={`${inputCls} w-[240px]`} style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} value={editando.nome} onChange={(e) => setEditando({ id: n.id, nome: e.target.value })} />
                                  <button className={btnP} disabled={ocupado || editando.nome.trim().length < 2} onClick={() => rodar(async () => { await financeiroService.editarNatureza(n.id, { nome: editando.nome }); setEditando(null); }, 'Categoria renomeada.')}>Salvar</button>
                                  <button className={btnS} onClick={() => setEditando(null)}>Cancelar</button>
                                </span>
                              ) : n.nome}
                            </td>
                            <td className="py-[5px]">{n.saida ? 'Saída' : 'Receita'}</td>
                            <td className="py-[5px]"><input type="checkbox" checked={n.exigeAtivo} disabled={ocupado} onChange={(e) => rodar(() => financeiroService.editarNatureza(n.id, { exigeAtivo: e.target.checked }), 'Categoria atualizada.')} /></td>
                            <td className="py-[5px]"><input type="checkbox" checked={n.exigeCotacao} disabled={ocupado} onChange={(e) => rodar(() => financeiroService.editarNatureza(n.id, { exigeCotacao: e.target.checked }), 'Categoria atualizada.')} /></td>
                            <td className="py-[5px]"><input type="checkbox" checked={n.especial} disabled={ocupado} onChange={(e) => rodar(() => financeiroService.editarNatureza(n.id, { especial: e.target.checked }), 'Categoria atualizada.')} title="Aprovação da Diretoria sempre, independente do valor" /></td>
                            <td className="py-[5px]"><input type="checkbox" checked={n.exigeJustificativa} disabled={ocupado} onChange={(e) => rodar(() => financeiroService.editarNatureza(n.id, { exigeJustificativa: e.target.checked }), 'Categoria atualizada.')} /></td>
                            <td className="py-[5px] text-right whitespace-nowrap">
                              {editando?.id !== n.id && <button className="mr-[6px] text-[11.5px] underline" onClick={() => setEditando({ id: n.id, nome: n.nome })}>Renomear</button>}
                              <button className="text-[11.5px] underline" disabled={ocupado} onClick={() => rodar(() => financeiroService.editarNatureza(n.id, { ativo: !n.ativo }), n.ativo ? 'Categoria inativada.' : 'Categoria reativada.')}>{n.ativo ? 'Inativar' : 'Reativar'}</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
            {c.naturezas.some((n) => !n.grupoId) && (
              <div className="mb-[8px] text-[12px]" style={{ color: '#8a5a00' }}>
                Sem grupo: {c.naturezas.filter((n) => !n.grupoId).map((n) => `${n.codigo} ${n.nome}`).join(', ')} — defina o grupo ao criar; categorias sem grupo não aparecem no título.
              </div>
            )}
            <div className="mt-[8px] flex flex-wrap items-end gap-[8px]">
              <label className="text-[11px] font-semibold">Grupo
                <select className={`${inputCls} block w-[220px]`} style={inputStyle} value={novaNatureza.grupoId} onChange={(e) => setNovaNatureza({ ...novaNatureza, grupoId: e.target.value })}>
                  <option value="">Selecione…</option>
                  {c.grupos.filter((g) => g.ativo).map((g) => <option key={g.id} value={g.id}>{g.codigo}. {g.nome}</option>)}
                </select></label>
              <label className="text-[11px] font-semibold">Código
                <input className={`${inputCls} block w-[80px]`} style={inputStyle} value={novaNatureza.codigo} placeholder="3.04" onChange={(e) => setNovaNatureza({ ...novaNatureza, codigo: e.target.value })} /></label>
              <label className="text-[11px] font-semibold">Nome
                <input className={`${inputCls} block w-[240px]`} style={inputStyle} value={novaNatureza.nome} onChange={(e) => setNovaNatureza({ ...novaNatureza, nome: e.target.value })} /></label>
              <label className="flex items-center gap-[4px] text-[11.5px]"><input type="checkbox" checked={!novaNatureza.saida} onChange={(e) => setNovaNatureza({ ...novaNatureza, saida: !e.target.checked })} />Receita (não entra em título)</label>
              <label className="flex items-center gap-[4px] text-[11.5px]"><input type="checkbox" checked={novaNatureza.exigeAtivo} onChange={(e) => setNovaNatureza({ ...novaNatureza, exigeAtivo: e.target.checked })} />Exige veículo</label>
              <label className="flex items-center gap-[4px] text-[11.5px]"><input type="checkbox" checked={novaNatureza.especial} onChange={(e) => setNovaNatureza({ ...novaNatureza, especial: e.target.checked })} />Diretoria sempre</label>
              <button className={btnP} disabled={ocupado || !novaNatureza.grupoId || !novaNatureza.codigo.trim() || novaNatureza.nome.trim().length < 2}
                onClick={() => rodar(async () => { await financeiroService.criarNatureza({ ...novaNatureza, codigo: novaNatureza.codigo.trim() }); setNovaNatureza({ codigo: '', nome: '', grupoId: '', saida: true, exigeAtivo: false, especial: false }); }, 'Categoria criada.')}>+ Categoria</button>
            </div>
            <div className="mt-[8px] flex flex-wrap items-end gap-[8px]" style={{ borderTop: '1px solid var(--border-light)', paddingTop: '8px' }}>
              <label className="text-[11px] font-semibold">Novo grupo — código
                <input className={`${inputCls} block w-[80px]`} style={inputStyle} value={novoGrupo.codigo} placeholder="08" onChange={(e) => setNovoGrupo({ ...novoGrupo, codigo: e.target.value })} /></label>
              <label className="text-[11px] font-semibold">Nome
                <input className={`${inputCls} block w-[240px]`} style={inputStyle} value={novoGrupo.nome} onChange={(e) => setNovoGrupo({ ...novoGrupo, nome: e.target.value })} /></label>
              <button className={btnP} disabled={ocupado || !novoGrupo.codigo.trim() || novoGrupo.nome.trim().length < 2}
                onClick={() => rodar(async () => { await financeiroService.criarGrupo({ codigo: novoGrupo.codigo.trim(), nome: novoGrupo.nome.trim() }); setNovoGrupo({ codigo: '', nome: '' }); }, 'Grupo criado.')}>+ Grupo</button>
            </div>
          </div>

          <div className={card} style={cardStyle}>
            <div className="mb-[8px] font-display text-[13px] font-bold">Centros de custo (opcional no título — áreas responsáveis; veículo, investidor e produto são dimensões, não centros)</div>
            <div className="flex flex-wrap gap-[6px]">
              {c.centros.map((cc) => (
                <span key={cc.id} className="rounded-full px-[10px] py-[4px] text-[12px] font-semibold" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}>
                  {cc.codigo} — {cc.nome}
                </span>
              ))}
            </div>
            <div className="mt-[8px] flex flex-wrap items-end gap-[8px]">
              <label className="text-[11px] font-semibold">Código
                <input className={`${inputCls} block w-[80px]`} style={inputStyle} value={novoCentro.codigo} onChange={(e) => setNovoCentro({ ...novoCentro, codigo: e.target.value.toUpperCase() })} /></label>
              <label className="text-[11px] font-semibold">Nome
                <input className={`${inputCls} block w-[240px]`} style={inputStyle} value={novoCentro.nome} onChange={(e) => setNovoCentro({ ...novoCentro, nome: e.target.value })} /></label>
              <button className={btnP} disabled={ocupado || !novoCentro.codigo || novoCentro.nome.trim().length < 2}
                onClick={() => rodar(() => financeiroService.criarCentro(novoCentro), 'Centro de custo criado.')}>+ Centro</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
