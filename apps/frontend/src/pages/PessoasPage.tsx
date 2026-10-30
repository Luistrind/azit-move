import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { capitalService, NOME_CLASSIFICACAO, type PessoaClassificada as Pessoa } from '../services/capital.service';
import { titularService } from '../services/titular.service';
import { mensagemErro } from '../lib/permissoes';
import { Chips } from '../components/Chips';
import { Tabela, type Coluna } from '../components/Tabela';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';

// Pessoas (doc 02 §15): visões filtradas do cadastro único por classificação manual.
// Cliente continua derivado (contrato ativo) — aqui só as classificações manuais.
// Layout v2 (doc 03 §11): abas em Chips, lista em Tabela responsiva, botões do kit.

const ABAS = ['INVESTIDOR', 'FORNECEDOR', 'PARCEIRO'] as const;
const PLURAL: Record<string, string> = {
  INVESTIDOR: 'Investidores',
  FORNECEDOR: 'Fornecedores',
  PARCEIRO: 'Parceiros',
};
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const inputStyle = { background: 'var(--surface-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

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

  // Colunas da lista — a de estruturas só existe para investidores.
  const colunas: Coluna<Pessoa>[] = [
    {
      chave: 'nome',
      titulo: 'Nome',
      celular: 'titulo',
      render: (p) => (
        <Link to={`/titulares/${p.id}`} className="hover:underline" style={{ color: 'var(--text-primary)' }}>
          {p.nome}
        </Link>
      ),
    },
    { chave: 'cpf', titulo: 'CPF / CNPJ', celular: 'subtitulo', classe: 'tabular-nums', render: (p) => p.cpfCnpj },
    { chave: 'whatsapp', titulo: 'WhatsApp', celular: 'campo', classe: 'tabular-nums', render: (p) => p.whatsapp },
    ...(aba === 'INVESTIDOR'
      ? [
          {
            chave: 'estruturas',
            titulo: 'Estruturas em que investe',
            celular: 'campo' as const,
            render: (p: Pessoa) => (p.estruturas.length === 0 ? '—' : p.estruturas.map((e) => e.nome).join(', ')),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <h1 className="font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Pessoas</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Visões do cadastro único por papel de relacionamento. A mesma pessoa pode ser cliente,
          investidor e fornecedor ao mesmo tempo — o cadastro é um só.
        </p>
      </div>

      <Chips
        itens={ABAS.map((c) => ({ chave: c, rotulo: PLURAL[c] }))}
        valor={aba}
        onChange={(c) => setAba(c ?? 'INVESTIDOR')}
        todos={null}
      />

      <div className="flex flex-col gap-[10px] rounded-card p-[16px]" style={cardStyle}>
        {!buscando ? (
          <div>
            <Botao variante="primaria" onClick={() => setBuscando(true)}>
              + Classificar titular como {NOME_CLASSIFICACAO[aba].toLowerCase()}
            </Botao>
          </div>
        ) : (
          <div className="flex flex-col gap-[8px]">
            <div className="flex flex-wrap items-end gap-[8px]">
              <div className="min-w-0 flex-1">
                <div className="mb-[4px] text-[11px] font-semibold" style={{ color: 'var(--text-label)' }}>
                  Buscar titular pelo nome (mínimo 3 letras)
                </div>
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="h-[34px] w-full max-w-[320px] rounded-[10px] px-[10px] text-[12.5px]"
                  style={inputStyle}
                />
              </div>
              <Botao variante="secundaria" onClick={() => { setBuscando(false); setBusca(''); }}>
                Cancelar
              </Botao>
            </div>
            {busca.trim().length >= 3 && (
              <div className="flex flex-col gap-[4px]">
                {(candidatos.data?.data ?? []).slice(0, 8).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => classificar(t.id)}
                    className="flex min-h-[34px] items-center justify-between gap-[8px] rounded-[10px] px-[10px] py-[7px] text-left text-[12.5px]"
                    style={inputStyle}
                  >
                    <span className="font-semibold">{t.nome}</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{t.cpfCnpj}</span>
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

      <Secao titulo={PLURAL[aba]} tag={pessoas.data ? `${pessoas.data.length}` : undefined}>
        <Tabela<Pessoa>
          colunas={colunas}
          linhas={pessoas.data ?? []}
          chave={(p) => p.id}
          carregando={pessoas.isLoading}
          larguraMinima={aba === 'INVESTIDOR' ? 640 : 520}
          vazio={`Nenhum titular classificado como ${NOME_CLASSIFICACAO[aba].toLowerCase()} ainda.`}
          acoes={(p) => (
            <Botao variante="perigo" tamanho="sm" onClick={() => remover(p.id)}>
              Remover classificação
            </Botao>
          )}
        />
      </Secao>
    </div>
  );
}
