import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { originacaoService, PropostaResumo } from '../services/originacao.service';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { Tabela, type Coluna } from '../components/Tabela';
import { Chips } from '../components/Chips';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';
import { Campo } from '../components/Metrica';
import { PROPOSTA_STATUS_COLORS } from '../config/statusColors';
import { mensagemErro } from '../lib/permissoes';
import { ROTULO_SITUACAO_PROPOSTA as LABEL_STATUS } from '../lib/rotulos';
// Uma coluna por status do funil (Doc 3 §8-A.3).
const KANBAN_COLS = ['pendente', 'em_analise', 'aprovada', 'em_formalizacao', 'convertida', 'reprovada', 'cancelada'];
// Arrasto livre só entre Pendente e Em Análise.
const ARRASTAVEIS = ['pendente', 'em_analise'];

export function PropostasPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [vista, setVista] = useState<'lista' | 'kanban'>('lista');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('');
  const [modalP, setModalP] = useState<PropostaResumo | null>(null);
  const [dragId, setDragId] = useState<{ id: string; status: string } | null>(null);

  const propostas = useQuery({ queryKey: ['propostas'], queryFn: () => originacaoService.listarPropostas() });

  const porBusca = (propostas.data ?? []).filter((p) => !busca || p.titular.toLowerCase().includes(busca.toLowerCase()));
  const filtradas = porBusca.filter((p) => !filtro || p.status === filtro);

  async function moverPara(coluna: string) {
    if (!dragId) return;
    if (!ARRASTAVEIS.includes(dragId.status) || !ARRASTAVEIS.includes(coluna) || coluna === dragId.status) return;
    const alvo = dragId; setDragId(null);
    try {
      await originacaoService.patchStatus(alvo.id, coluna);
      await queryClient.invalidateQueries({ queryKey: ['propostas'] });
    } catch (e) { alert(mensagemErro(e)); }
  }

  const colunas: Coluna<PropostaResumo>[] = [
    { chave: 'cliente', titulo: 'Cliente', celular: 'titulo', render: (p) => p.titular },
    { chave: 'ativo', titulo: 'Ativo', celular: 'subtitulo', render: (p) => p.ativo },
    { chave: 'parcelas', titulo: 'Parcelas', alinhar: 'center', celular: 'destaque', classe: 'tabular-nums', render: (p) => `${p.numeroParcelas}× ${formatCurrency(p.valorParcela)}` },
    { chave: 'status', titulo: 'Status', render: (p) => <StatusBadge label={LABEL_STATUS[p.status] ?? p.status} colors={PROPOSTA_STATUS_COLORS} /> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Controles: busca + chips de status + alternância lista/kanban */}
      <div className="flex flex-wrap items-center gap-[8px]">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente"
          aria-label="Buscar cliente"
          className="min-h-[30px] min-w-[180px] flex-1 rounded-full border px-[12px] text-[12.5px] sm:max-w-[240px]"
          style={{ background: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
        />
        <Chips
          itens={KANBAN_COLS.map((s) => ({ chave: s, rotulo: LABEL_STATUS[s] ?? s, contagem: porBusca.filter((p) => p.status === s).length }))}
          valor={filtro || null}
          onChange={(k) => setFiltro(k ?? '')}
          todos="Todos"
        />
        <div className="ml-auto">
          <Chips
            itens={[{ chave: 'lista', rotulo: 'Lista' }, { chave: 'kanban', rotulo: 'Kanban' }]}
            valor={vista}
            onChange={(k) => setVista((k as 'lista' | 'kanban') ?? 'lista')}
            todos={null}
            tamanho="sm"
          />
        </div>
      </div>

      {vista === 'lista' ? (
        <Tabela
          colunas={colunas}
          linhas={filtradas}
          chave={(p) => p.id}
          onClick={(p) => setModalP(p)}
          carregando={propostas.isLoading}
          vazio="Nenhuma proposta."
          acoes={(p) => (
            <Botao variante="fantasma" tamanho="sm" onClick={() => navigate(`/propostas/${p.id}`)}>Abrir proposta →</Botao>
          )}
        />
      ) : (
        // Kanban: estrutura própria (arrasto entre colunas). No celular as colunas
        // empilham; no desktop correm lado a lado.
        <div className="flex flex-col gap-[12px] md:flex-row md:overflow-x-auto md:pb-[8px]">
          {KANBAN_COLS.map((col) => {
            const itens = filtradas.filter((p) => p.status === col);
            const podeSoltar = !!dragId && ARRASTAVEIS.includes(dragId.status) && ARRASTAVEIS.includes(col);
            return (
              <div key={col} className="flex w-full flex-none flex-col md:w-[220px]"
                onDragOver={(e) => { if (podeSoltar) e.preventDefault(); }} onDrop={() => moverPara(col)}>
                <Secao titulo={LABEL_STATUS[col] ?? col} tag={String(itens.length)}>
                  <div className="flex min-h-[60px] flex-col gap-[8px] rounded-[10px] p-[8px]"
                    style={{ background: podeSoltar ? 'var(--surface-input)' : 'transparent', border: '1px dashed var(--border-light)' }}>
                    {itens.map((p) => (
                      <div key={p.id} draggable={ARRASTAVEIS.includes(p.status)} onDragStart={() => setDragId({ id: p.id, status: p.status })}
                        onClick={() => setModalP(p)} className="cursor-pointer rounded-[8px] p-[10px] text-[12px]"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{p.titular}</div>
                        <div style={{ color: 'var(--text-muted)' }}>{p.ativo}</div>
                        <div className="mt-[4px] tabular-nums" style={{ color: 'var(--text-body)' }}>{p.numeroParcelas}× {formatCurrency(p.valorParcela)} · {p.prazoSemanas}sem</div>
                      </div>
                    ))}
                  </div>
                </Secao>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!modalP} onClose={() => setModalP(null)} title="Detalhes da proposta">
        {modalP && (
          <div className="flex flex-col gap-[12px] text-[12.5px]">
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
              <span className="font-display text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>{modalP.titular}</span>
              <StatusBadge label={LABEL_STATUS[modalP.status] ?? modalP.status} colors={PROPOSTA_STATUS_COLORS} />
            </div>
            <div style={{ color: 'var(--text-body)' }}>{modalP.ativo}</div>
            <div className="grid grid-cols-2 gap-[8px]">
              <Campo label="Entrada" valor={formatCurrency(modalP.valorEntrada)} />
              <Campo label="Modalidade" valor={modalP.modalidade} />
              <Campo label="Parcelas" valor={`${modalP.numeroParcelas}× ${formatCurrency(modalP.valorParcela)}`} />
              <Campo label="Prazo" valor={`${modalP.prazoSemanas} semanas`} />
            </div>
            <Botao variante="primaria" className="mt-[4px] w-full" onClick={() => { const pid = modalP.id; setModalP(null); navigate(`/propostas/${pid}`); }}>
              Abrir proposta →
            </Botao>
          </div>
        )}
      </Modal>
    </div>
  );
}
