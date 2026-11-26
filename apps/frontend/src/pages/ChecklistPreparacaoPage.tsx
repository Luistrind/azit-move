import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ativoService, type ItemModeloChecklist } from '../services/ativo.service';
import { toast } from '../components/Toast';
import { mensagemErro, usePodeRole } from '../lib/permissoes';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';

// Configuração › Checklist de preparação (doc 02 §25.8): os itens que todo carro
// recebe ao entrar em preparação (cadastro novo, "Liberar para venda" de um
// Recuperado, "Enviar para preparação"). Nada chumbado — padrão provisório
// troca de óleo e filtro, rastreador, VIP. Mudar aqui não altera preparações já
// abertas (cada uma guarda a própria cópia). Escrita só ADMIN.

const card = 'rounded-card p-[16px]';
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputCls = 'h-[32px] min-w-0 flex-1 rounded-[10px] px-[10px] text-[12.5px]';
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

export function ChecklistPreparacaoPage() {
  const qc = useQueryClient();
  const pode = usePodeRole();
  const podeEditar = pode(['ADMIN']);
  const q = useQuery({ queryKey: ['checklist-preparacao-modelo'], queryFn: () => ativoService.modeloChecklist() });
  const [itens, setItens] = useState<ItemModeloChecklist[]>([]);
  const [novo, setNovo] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (q.data) setItens(q.data);
  }, [q.data]);

  const original = JSON.stringify(q.data ?? []);
  const mudou = JSON.stringify(itens) !== original;
  const valido = itens.length > 0 && itens.every((i) => i.descricao.trim().length > 0);

  const mover = (de: number, para: number) => {
    if (para < 0 || para >= itens.length) return;
    const copia = [...itens];
    const [x] = copia.splice(de, 1);
    copia.splice(para, 0, x);
    setItens(copia);
  };

  async function salvar() {
    setSalvando(true);
    try {
      const salvo = await ativoService.salvarModeloChecklist(itens.map((i) => ({ id: i.id, descricao: i.descricao.trim() })));
      qc.setQueryData(['checklist-preparacao-modelo'], salvo);
      toast.sucesso('Checklist salvo. Vale para as próximas preparações.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  function incluir() {
    const d = novo.trim();
    if (!d) return;
    setItens([...itens, { descricao: d }]);
    setNovo('');
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Checklist de preparação</h1>
        <p className="max-w-[70ch] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          O que todo carro precisa antes de ir para venda. O carro novo cadastrado no estoque e o recuperado liberado para venda entram em
          <b> Em preparação</b> com uma cópia desta lista; ele só fica Disponível quando cada item estiver feito ou marcado como "não se aplica".
          Mudar a lista vale para as próximas preparações — as já abertas não mudam.
        </p>
      </div>

      <div className={card} style={cardStyle}>
        <Secao titulo="Itens do checklist">
          {q.isLoading ? (
            <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
          ) : q.isError ? (
            <div className="text-[12.5px]" style={{ color: 'var(--danger-fg)' }}>{mensagemErro(q.error)}</div>
          ) : (
            <div className="flex flex-col gap-[8px]">
              {itens.map((i, n) => (
                <div key={i.id ?? `novo-${n}`} className="flex flex-wrap items-center gap-[8px]">
                  <span className="w-[22px] text-right text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{n + 1}.</span>
                  {podeEditar ? (
                    <>
                      <input
                        value={i.descricao}
                        maxLength={120}
                        onChange={(e) => setItens(itens.map((x, k) => (k === n ? { ...x, descricao: e.target.value } : x)))}
                        aria-label={`Item ${n + 1}`}
                        className={inputCls}
                        style={inputStyle}
                      />
                      <Botao variante="fantasma" tamanho="sm" disabled={n === 0} onClick={() => mover(n, n - 1)} aria-label="Subir">↑</Botao>
                      <Botao variante="fantasma" tamanho="sm" disabled={n === itens.length - 1} onClick={() => mover(n, n + 1)} aria-label="Descer">↓</Botao>
                      <Botao variante="fantasma" tamanho="sm" disabled={itens.length === 1} onClick={() => setItens(itens.filter((_, k) => k !== n))}>Remover</Botao>
                    </>
                  ) : (
                    <span className="text-[12.5px]" style={{ color: 'var(--text-primary)' }}>{i.descricao}</span>
                  )}
                </div>
              ))}
              {podeEditar && (
                <>
                  <div className="mt-[4px] flex flex-wrap items-center gap-[8px]">
                    <span className="w-[22px]" />
                    <input
                      value={novo}
                      maxLength={120}
                      onChange={(e) => setNovo(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') incluir(); }}
                      placeholder="Novo item (ex.: lavagem e higienização)"
                      className={inputCls}
                      style={inputStyle}
                    />
                    <Botao variante="secundaria" tamanho="sm" disabled={!novo.trim()} onClick={incluir}>+ Incluir</Botao>
                  </div>
                  <div className="mt-[8px] flex flex-wrap items-center justify-end gap-[8px]">
                    {mudou && <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>alterações não salvas</span>}
                    <Botao variante="secundaria" tamanho="sm" disabled={!mudou} onClick={() => setItens(q.data ?? [])}>Descartar</Botao>
                    <Botao variante="primaria" tamanho="sm" carregando={salvando} disabled={!mudou || !valido} onClick={() => void salvar()}>Salvar checklist</Botao>
                  </div>
                </>
              )}
              {!podeEditar && <p className="mt-[4px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>Só o administrador altera esta lista.</p>}
            </div>
          )}
        </Secao>
      </div>
    </div>
  );
}
