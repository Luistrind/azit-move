import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { analiseService } from '../services/analise.service';
import { rotuloStatus } from '../lib/rotulos';
import { horaBR, instanteBR } from '../lib/datas';
import { Tabela, type Coluna } from '../components/Tabela';
import { Chips } from '../components/Chips';
import { Botao } from '../components/Botao';

// Fila de análises de cadastro (proposta UX: área Análise de Cadastro).
// Resolve o gap apontado no teste: não havia como voltar a uma análise pelo menu.
// Layout v2 (doc 03 §11, 30/10): a linha abre o dossiê; o filtro em andamento ×
// finalizadas virou Chips. O título da tela vem do Shell.

const FINAIS = ['LIBERADO_PARA_FORMALIZACAO', 'NAO_APROVADO', 'PROPOSTA_ENCERRADA'];

type Analise = Awaited<ReturnType<typeof analiseService.listar>>[number];

export function AnalisesPage() {
  const navigate = useNavigate();
  // null = todas; padrão é só o que está em andamento (comportamento de sempre).
  const [filtro, setFiltro] = useState<string | null>('andamento');
  const analises = useQuery({ queryKey: ['analises'], queryFn: () => analiseService.listar() });

  const todas = analises.data ?? [];
  const emAndamento = todas.filter((a) => !FINAIS.includes(a.status));
  const finalizadas = todas.filter((a) => FINAIS.includes(a.status));
  const lista = filtro === 'andamento' ? emAndamento : filtro === 'finalizadas' ? finalizadas : todas;

  const corSituacao = (status: string) =>
    FINAIS.includes(status)
      ? status === 'LIBERADO_PARA_FORMALIZACAO'
        ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' }
        : { background: 'var(--danger-bg)', color: 'var(--danger-fg)' }
      : { background: 'var(--info-bg)', color: 'var(--info-fg)' };

  const colunas: Coluna<Analise>[] = [
    { chave: 'titular', titulo: 'Titular', render: (a) => a.titular, celular: 'titulo' },
    {
      chave: 'situacao',
      titulo: 'Situação',
      celular: 'campo',
      render: (a) => (
        <span className="inline-flex rounded-full px-[8px] py-[2px] text-[11px] font-bold" style={corSituacao(a.status)}>
          {rotuloStatus(a.status)}
        </span>
      ),
    },
    {
      chave: 'comprometimento',
      titulo: 'Comprometimento de renda',
      alinhar: 'right',
      celular: 'destaque',
      classe: 'tabular-nums',
      render: (a) => (a.comprometimento != null ? `${a.comprometimento.toFixed(0)}%` : '—'),
    },
    {
      chave: 'atualizadaEm',
      titulo: 'Última movimentação',
      celular: 'campo',
      classe: 'tabular-nums',
      render: (a) => `${instanteBR(a.atualizadaEm)} ${horaBR(a.atualizadaEm)}`,
    },
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <Chips
          valor={filtro}
          onChange={setFiltro}
          itens={[
            { chave: 'andamento', rotulo: 'Em andamento', contagem: analises.data ? emAndamento.length : undefined },
            { chave: 'finalizadas', rotulo: 'Finalizadas', contagem: analises.data ? finalizadas.length : undefined },
          ]}
        />
        <span className="ml-auto text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {lista.length} análise{lista.length === 1 ? '' : 's'}
        </span>
      </div>

      <Tabela
        colunas={colunas}
        linhas={lista}
        chave={(a) => a.id}
        carregando={analises.isLoading}
        onClick={(a) => navigate(`/analises/${a.id}`)}
        larguraMinima={640}
        vazio={
          <>
            Nenhuma análise {filtro === 'andamento' ? 'em andamento' : filtro === 'finalizadas' ? 'finalizada' : 'registrada'}. A análise é criada a
            partir da proposta, na etapa de análise de cadastro.
          </>
        }
        acoes={(a) => (
          <Botao variante="secundaria" tamanho="sm" onClick={() => navigate(`/analises/${a.id}`)}>
            Abrir análise
          </Botao>
        )}
      />
    </div>
  );
}
