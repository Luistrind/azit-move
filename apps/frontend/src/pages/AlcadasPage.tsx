import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reaisParaCentavos } from '../lib/valor';
import { alcadaService, MatrizAlcada } from '../services/alcada.service';
import { usePodeRole, mensagemErro } from '../lib/permissoes';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';

// Alçadas de aprovação: matriz papel × operação EDITÁVEL (limite por célula, "∞",
// nº de aprovações por operação). Layout v2 (doc 03 §11): a matriz mantém
// estrutura própria — cada célula é um controle, não um dado — com tokens e
// rolagem horizontal só dentro dela; o resto da tela usa o kit.

const ROLE_ADMIN_ALCADA = ['ADMIN', 'DIRETOR'];

const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const th = 'px-[6px] pb-[10px] font-display text-[10.5px] font-semibold uppercase tracking-[0.1em]';

function reaisFmt(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

export function AlcadasPage() {
  const queryClient = useQueryClient();
  const pode = usePodeRole();
  const podeEditar = pode(ROLE_ADMIN_ALCADA);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [novaChave, setNovaChave] = useState('');
  const [novoNome, setNovoNome] = useState('');

  const matriz = useQuery({ queryKey: ['alcadas-matriz'], queryFn: () => alcadaService.matriz() });

  async function recarregar() {
    await queryClient.invalidateQueries({ queryKey: ['alcadas-matriz'] });
  }

  function celula(m: MatrizAlcada, papel: string, op: string) {
    return m.celulas.find((c) => c.papel === papel && c.tipoOperacao === op);
  }

  async function salvar(papel: string, op: string, patch: { limiteMaximo?: number; ilimitado?: boolean }) {
    const chave = `${papel}:${op}`;
    setSalvando(chave);
    try {
      await alcadaService.salvar({ papel, tipoOperacao: op, ...patch });
      await recarregar();
    } catch (e) {
      window.alert(mensagemErro(e));
    } finally {
      setSalvando(null);
    }
  }

  async function adicionarOperacao() {
    if (!novaChave.trim() || !novoNome.trim()) return;
    try {
      await alcadaService.criarOperacao({ chave: novaChave, nome: novoNome });
      setNovaChave('');
      setNovoNome('');
      await recarregar();
    } catch (e) {
      window.alert(mensagemErro(e));
    }
  }

  const m = matriz.data;

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <h1 className="font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Alçadas de aprovação</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Limite que cada papel pode aprovar, por tipo de operação. Marque <b>∞</b> para ilimitado. Valores em R$.
        </p>
      </div>

      {!podeEditar && (
        <div className="rounded-[10px] p-[10px] text-[12px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
          Você tem acesso somente leitura. Edição restrita a ADMIN/DIRETOR.
        </div>
      )}

      <div className="rounded-card p-[16px]" style={cardStyle}>
        <Secao titulo="Matriz papel × operação" tag={m ? `${m.operacoes.length} operações · ${m.papeis.length} papéis` : undefined}>
          {matriz.isLoading || !m ? (
            <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
          ) : (
            // Rolagem horizontal SÓ dentro da matriz: cada célula tem campo + "∞".
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
                <thead>
                  <tr style={{ color: 'var(--text-label)' }}>
                    <th className={`${th} text-left`}>Operação</th>
                    <th className={`${th} text-center`} title="Nº de aprovações exigidas (princípio dos 4 olhos)">Aprovações</th>
                    {m.papeis.map((p) => (
                      <th key={p} className={`${th} text-center`}>{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.operacoes.map((op) => (
                    <tr key={op.chave} style={{ borderTop: '1px solid var(--border-light)' }}>
                      <td className="px-[6px] py-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {op.nome}
                        <div className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>{op.chave}</div>
                      </td>
                      <td className="px-[6px] py-[8px] text-center">
                        <select
                          disabled={!podeEditar}
                          value={op.aprovacoesNecessarias}
                          onChange={async (e) => {
                            try {
                              await alcadaService.salvarOperacao(op.chave, { aprovacoesNecessarias: Number(e.target.value) });
                              await recarregar();
                            } catch (err) {
                              window.alert(mensagemErro(err));
                            }
                          }}
                          className="h-[30px] rounded-[10px] px-[6px] text-[12px] disabled:opacity-50"
                          style={inputStyle}
                        >
                          {[1, 2, 3].map((n) => (
                            <option key={n} value={n}>{n}×</option>
                          ))}
                        </select>
                      </td>
                      {m.papeis.map((papel) => {
                        const c = celula(m, papel, op.chave);
                        const chave = `${papel}:${op.chave}`;
                        const ocupado = salvando === chave;
                        return (
                          <td key={papel} className="px-[6px] py-[8px] text-center">
                            <div className="flex flex-col items-center gap-[4px]">
                              <input
                                type="text"
                                disabled={!podeEditar || c?.ilimitado || ocupado}
                                defaultValue={c && !c.ilimitado ? reaisFmt(c.limiteMaximo) : ''}
                                placeholder={c?.ilimitado ? '∞' : '0,00'}
                                onBlur={(e) => {
                                  if (!podeEditar || c?.ilimitado) return;
                                  const cent = reaisParaCentavos(e.target.value);
                                  if (cent !== (c?.limiteMaximo ?? 0)) salvar(papel, op.chave, { limiteMaximo: cent, ilimitado: false });
                                }}
                                className="h-[30px] w-[92px] rounded-[10px] px-[8px] text-right text-[12px] tabular-nums disabled:opacity-50"
                                style={inputStyle}
                              />
                              <label className="flex min-h-[20px] items-center gap-[4px] text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                <input
                                  type="checkbox"
                                  disabled={!podeEditar || ocupado}
                                  checked={c?.ilimitado ?? false}
                                  onChange={(e) => salvar(papel, op.chave, { ilimitado: e.target.checked })}
                                />
                                ∞
                              </label>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Secao>
      </div>

      {podeEditar && (
        <div className="rounded-card p-[16px]" style={cardStyle}>
          <Secao titulo="Novo tipo de operação">
            <div className="flex flex-wrap items-end gap-[10px]">
              <div className="w-full sm:w-[200px]">
                <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Chave</div>
                <input value={novaChave} onChange={(e) => setNovaChave(e.target.value)} placeholder="ex: renegociacao_especial" className="h-[32px] w-full rounded-[10px] px-[10px] text-[12px]" style={inputStyle} />
              </div>
              <div className="w-full sm:w-[240px]">
                <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>Nome</div>
                <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Renegociação especial" className="h-[32px] w-full rounded-[10px] px-[10px] text-[12px]" style={inputStyle} />
              </div>
              <Botao variante="primaria" onClick={() => void adicionarOperacao()}>
                + Novo tipo de operação
              </Botao>
            </div>
          </Secao>
        </div>
      )}
    </div>
  );
}
