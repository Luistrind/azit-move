import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { capitalService, NOME_CLASSIFICACAO } from '../services/capital.service';
import { titularService } from '../services/titular.service';
import { mensagemErro } from '../lib/permissoes';

// Pessoas (doc 02 §15): visões filtradas do cadastro único por classificação manual.
// Cliente continua derivado (contrato ativo) — aqui só as classificações manuais.

const ABAS = ['INVESTIDOR', 'FORNECEDOR', 'PARCEIRO'] as const;
const PLURAL: Record<string, string> = {
  INVESTIDOR: 'Investidores',
  FORNECEDOR: 'Fornecedores',
  PARCEIRO: 'Parceiros',
};
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)' } as const;

export function PessoasPage() {
  const queryClient = useQueryClient();
  const [aba, setAba] = useState<string>('INVESTIDOR');
  const [busca, setBusca] = useState('');
  const [buscando, setBuscando] = useState(false);

  const pessoas = useQuery({
    queryKey: ['pessoas', aba],
    queryFn: () => capitalService.pessoas(aba),
  });
  const candidatos = useQuery({
    queryKey: ['titulares-busca', busca],
    queryFn: () => titularService.listar({ nome: busca }),
    enabled: buscando && busca.trim().length >= 3,
  });

  async function recarregar() {
    await queryClient.invalidateQueries({ queryKey: ['pessoas'] });
  }

  async function classificar(titularId: string) {
    try {
      await capitalService.classificar(titularId, aba);
      setBusca('');
      setBuscando(false);
      await recarregar();
    } catch (e) {
      window.alert(mensagemErro(e));
    }
  }

  async function remover(titularId: string) {
    if (!window.confirm(`Remover a classificação de ${NOME_CLASSIFICACAO[aba].toLowerCase()} deste titular?`)) return;
    try {
      await capitalService.desclassificar(titularId, aba);
      await recarregar();
    } catch (e) {
      window.alert(mensagemErro(e));
    }
  }

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="font-display text-[20px] font-bold">Pessoas</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Visões do cadastro único por papel de relacionamento. A mesma pessoa pode ser cliente,
          investidor e fornecedor ao mesmo tempo — o cadastro é um só.
        </p>
      </div>

      <div className="flex flex-wrap gap-[8px]">
        {ABAS.map((c) => (
          <button
            key={c}
            onClick={() => setAba(c)}
            className="h-[32px] rounded-[8px] px-[14px] text-[12.5px] font-semibold"
            style={
              aba === c
                ? { background: 'var(--navy)', color: '#fff' }
                : { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }
            }
          >
            {PLURAL[c]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-[10px] rounded-[14px] p-[16px]" style={cardStyle}>
        {!buscando ? (
          <div>
            <button
              onClick={() => setBuscando(true)}
              className="h-[32px] rounded-[8px] px-[14px] text-[12.5px] font-semibold"
              style={{ background: 'var(--navy)', color: '#fff' }}
            >
              + Classificar titular como {NOME_CLASSIFICACAO[aba].toLowerCase()}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-[8px]">
            <div className="flex items-end gap-[8px]">
              <div>
                <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                  Buscar titular pelo nome (mínimo 3 letras)
                </div>
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="h-[32px] w-[280px] rounded-[8px] px-[10px] text-[12.5px]"
                  style={inputStyle}
                />
              </div>
              <button
                onClick={() => { setBuscando(false); setBusca(''); }}
                className="h-[32px] rounded-[8px] px-[12px] text-[12px] font-semibold"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                Cancelar
              </button>
            </div>
            {busca.trim().length >= 3 && (
              <div className="flex flex-col gap-[4px]">
                {(candidatos.data?.data ?? []).slice(0, 8).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => classificar(t.id)}
                    className="flex items-center justify-between rounded-[8px] px-[10px] py-[7px] text-left text-[12.5px]"
                    style={inputStyle}
                  >
                    <span className="font-semibold">{t.nome}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{t.cpfCnpj}</span>
                  </button>
                ))}
                {candidatos.data && candidatos.data.data.length === 0 && (
                  <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    Nenhum titular encontrado com esse nome.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-[14px] p-[16px]" style={cardStyle}>
        {pessoas.isLoading ? (
          <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
        ) : (pessoas.data ?? []).length === 0 ? (
          <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Nenhum titular classificado como {NOME_CLASSIFICACAO[aba].toLowerCase()} ainda.
          </div>
        ) : (
          <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                <th className="pb-[10px] font-semibold">Nome</th>
                <th className="pb-[10px] font-semibold">CPF / CNPJ</th>
                <th className="pb-[10px] font-semibold">WhatsApp</th>
                {aba === 'INVESTIDOR' && <th className="pb-[10px] font-semibold">Estruturas em que investe</th>}
                <th className="pb-[10px]" />
              </tr>
            </thead>
            <tbody>
              {(pessoas.data ?? []).map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border-light)' }}>
                  <td className="py-[10px] font-semibold">
                    <Link to={`/titulares/${p.id}`} className="hover:underline">{p.nome}</Link>
                  </td>
                  <td className="py-[10px]">{p.cpfCnpj}</td>
                  <td className="py-[10px]">{p.whatsapp}</td>
                  {aba === 'INVESTIDOR' && (
                    <td className="py-[10px]">
                      {p.estruturas.length === 0
                        ? '—'
                        : p.estruturas.map((e) => e.nome).join(', ')}
                    </td>
                  )}
                  <td className="py-[10px] text-right">
                    <button
                      onClick={() => remover(p.id)}
                      className="rounded-[7px] px-[10px] py-[6px] text-[11.5px] font-semibold"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: '#a12622' }}
                    >
                      Remover classificação
                    </button>
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
