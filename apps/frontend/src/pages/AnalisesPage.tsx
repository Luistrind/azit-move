import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { analiseService } from '../services/analise.service';
import { rotuloStatus } from '../lib/rotulos';

// Fila de análises de cadastro (proposta UX: área Análise de Cadastro).
// Resolve o gap apontado no teste: não havia como voltar a uma análise pelo menu.

const FINAIS = ['LIBERADO_PARA_FORMALIZACAO', 'NAO_APROVADO', 'PROPOSTA_ENCERRADA'];

export function AnalisesPage() {
  const [mostrarFinalizadas, setMostrarFinalizadas] = useState(false);
  const analises = useQuery({ queryKey: ['analises'], queryFn: () => analiseService.listar() });

  const lista = (analises.data ?? []).filter((a) =>
    mostrarFinalizadas ? true : !FINAIS.includes(a.status),
  );

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div className="flex flex-wrap items-end justify-between gap-[10px]">
        <div>
          <h1 className="font-display text-[20px] font-bold">Análises de cadastro</h1>
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Todas as análises em andamento. Clique para abrir o dossiê.
          </p>
        </div>
        <label className="flex items-center gap-[6px] text-[12.5px]">
          <input
            type="checkbox"
            checked={mostrarFinalizadas}
            onChange={(e) => setMostrarFinalizadas(e.target.checked)}
          />
          Mostrar finalizadas
        </label>
      </div>

      <div className="overflow-x-auto rounded-[14px] p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {analises.isLoading ? (
          <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : lista.length === 0 ? (
          <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Nenhuma análise {mostrarFinalizadas ? 'registrada' : 'em andamento'}. A análise é criada a
            partir da proposta, na etapa de análise de cadastro.
          </div>
        ) : (
          <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                <th className="pb-[10px] font-semibold">Titular</th>
                <th className="pb-[10px] font-semibold">Situação</th>
                <th className="pb-[10px] font-semibold">Comprometimento de renda</th>
                <th className="pb-[10px] font-semibold">Última movimentação</th>
                <th className="pb-[10px]" />
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--border-light)' }}>
                  <td className="py-[10px] font-semibold">{a.titular}</td>
                  <td className="py-[10px]">
                    <span
                      className="rounded-full px-[8px] py-[2px] text-[11px] font-bold"
                      style={
                        FINAIS.includes(a.status)
                          ? a.status === 'LIBERADO_PARA_FORMALIZACAO'
                            ? { background: '#e5f5ec', color: '#1c7c4c' }
                            : { background: '#fdecec', color: '#a12622' }
                          : { background: '#eef4ff', color: '#1c4587' }
                      }
                    >
                      {rotuloStatus(a.status)}
                    </span>
                  </td>
                  <td className="py-[10px]">
                    {a.comprometimento != null ? `${a.comprometimento.toFixed(0)}%` : '—'}
                  </td>
                  <td className="py-[10px]">
                    {new Date(a.atualizadaEm).toLocaleDateString('pt-BR')}{' '}
                    {new Date(a.atualizadaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="py-[10px] text-right">
                    <Link
                      to={`/analises/${a.id}`}
                      className="rounded-[7px] px-[10px] py-[6px] text-[11.5px] font-semibold"
                      style={{ background: 'var(--navy)', color: '#fff' }}
                    >
                      Abrir análise
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
