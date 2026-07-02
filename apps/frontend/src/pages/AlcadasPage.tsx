import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reaisParaCentavos } from '../lib/valor';
import { alcadaService, MatrizAlcada } from '../services/alcada.service';
import { usePodeRole, mensagemErro } from '../lib/permissoes';

const ROLE_ADMIN_ALCADA = ['ADMIN', 'DIRETOR'];

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
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="font-display text-[20px] font-bold">Alçadas de aprovação</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Limite que cada papel pode aprovar, por tipo de operação. Marque <b>∞</b> para ilimitado. Valores em R$.
        </p>
      </div>

      {!podeEditar && (
        <div className="rounded-[10px] p-[10px] text-[12px]" style={{ background: '#fff7e6', color: '#8a5a00' }}>
          Você tem acesso somente leitura. Edição restrita a ADMIN/DIRETOR.
        </div>
      )}

      <div className="overflow-x-auto rounded-[14px] p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {matriz.isLoading || !m ? (
          <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="pb-[10px] text-left font-semibold">Operação</th>
                {m.papeis.map((p) => (
                  <th key={p} className="pb-[10px] text-center font-semibold">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.operacoes.map((op) => (
                <tr key={op.chave} style={{ borderTop: '1px solid var(--border-light)' }}>
                  <td className="py-[10px] font-semibold">
                    {op.nome}
                    <div className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>{op.chave}</div>
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
                            className="h-[28px] w-[86px] rounded-[7px] px-[8px] text-right text-[12px] disabled:opacity-50"
                            style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
                          />
                          <label className="flex items-center gap-[4px] text-[10px]" style={{ color: 'var(--text-muted)' }}>
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
        )}
      </div>

      {podeEditar && (
        <div className="flex items-end gap-[10px] rounded-[14px] p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div>
            <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Chave</div>
            <input value={novaChave} onChange={(e) => setNovaChave(e.target.value)} placeholder="ex: renegociacao_especial" className="h-[32px] w-[200px] rounded-[8px] px-[10px] text-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
          </div>
          <div>
            <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Nome</div>
            <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Renegociação especial" className="h-[32px] w-[240px] rounded-[8px] px-[10px] text-[12px]" style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }} />
          </div>
          <button onClick={adicionarOperacao} className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold" style={{ background: 'var(--navy)', color: '#fff' }}>
            + Novo tipo de operação
          </button>
        </div>
      )}
    </div>
  );
}
