import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { faturaService, type PagamentoDaConta } from '../../services/fatura.service';
import { dataBR } from '../../lib/datas';
import { Tabela } from '../../components/Tabela';
import { Botao } from '../../components/Botao';

// Pagamentos da conta (doc 02 §33.3): cada dinheiro que entrou, do mais recente
// para o mais antigo, e a fatura que ele quitou. Um Pix que cobre mais de uma
// fatura aparece uma vez, com os destinos lado a lado.
const BLOCO = 10;
export const ROTULO_PAGAMENTO: Record<PagamentoDaConta['tipo'], string> = {
  pix: 'Pix',
  cobranca: 'Cobrança do Asaas',
  sinistro: 'Indenização do sinistro',
  entrada_contrato: 'Entrada de contrato',
  entrada_acordo: 'Entrada de acordo',
};

// Para onde o dinheiro foi, em palavras (usado também no topo da ficha).
export function destinoEmTexto(p: PagamentoDaConta): string {
  if (p.destinos.length === 0) return p.descricao ?? ROTULO_PAGAMENTO[p.tipo];
  if (p.destinos.length === 1) {
    const d = p.destinos[0];
    return d.quitou ? `quitou a fatura nº ${d.numero}` : `foi para a fatura nº ${d.numero}, que ficou paga em parte`;
  }
  return `dividido entre as faturas ${p.destinos.map((d) => `nº ${d.numero}`).join(' e ')}`;
}

export function PagamentosDaConta({ contaId, encargosPagos }: { contaId: string; encargosPagos: number }) {
  const navigate = useNavigate();
  const q = useInfiniteQuery({
    queryKey: ['titular-pagamentos', contaId],
    queryFn: ({ pageParam }) => faturaService.pagamentos(contaId, pageParam, BLOCO),
    initialPageParam: 0,
    getNextPageParam: (ultima, todas) => {
      const naTela = todas.reduce((s, b) => s + b.data.length, 0);
      return ultima.data.length > 0 && naTela < ultima.total ? naTela : undefined;
    },
  });
  const linhas = q.data?.pages.flatMap((b) => b.data) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
        <span>Cada linha é um dinheiro que entrou, do mais recente para o mais antigo, com a fatura que ele quitou.</span>
        {encargosPagos > 0 && (
          <span>
            Multa e atualização pagas até hoje: <b className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(encargosPagos)}</b>
          </span>
        )}
      </div>

      <Tabela
        semMoldura
        colunas={[
          {
            chave: 'dia',
            titulo: 'Data',
            celular: 'subtitulo',
            classe: 'tabular-nums',
            render: (p) => (
              <>
                {dataBR(p.dia)}
                {p.hora && <span className="ml-[6px] text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{p.hora}</span>}
              </>
            ),
          },
          { chave: 'tipo', titulo: 'Como entrou', celular: 'titulo', render: (p) => ROTULO_PAGAMENTO[p.tipo] },
          { chave: 'valor', titulo: 'Valor', alinhar: 'right', celular: 'destaque', classe: 'tabular-nums font-bold', render: (p) => <span style={{ color: 'var(--text-primary)' }}>{formatCurrency(p.valor)}</span> },
          {
            chave: 'destino',
            titulo: 'Para onde foi',
            celular: 'campo',
            render: (p) => (
              <span className="inline-flex flex-wrap items-center gap-[5px]">
                {p.destinos.map((d) => (
                  <span
                    key={d.faturaId}
                    className="whitespace-nowrap rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold"
                    style={d.quitou ? { background: 'var(--ok-bg)', color: 'var(--ok-fg)' } : { background: 'var(--info-bg)', color: 'var(--info-fg)' }}
                    title={d.encargos > 0 ? `Inclui ${formatCurrency(d.encargos)} de multa e atualização.` : undefined}
                  >
                    Fatura nº {d.numero} · {formatCurrency(d.valor)}
                    {d.quitou ? '' : ' · em parte'}
                    {d.encargos > 0 ? ` · ${formatCurrency(d.encargos)} de multa e atualização` : ''}
                  </span>
                ))}
                {p.destinos.length === 0 && <span style={{ color: 'var(--text-body)' }}>{p.descricao ?? (p.contratoNumero ? `Contrato ${p.contratoNumero}` : '—')}</span>}
                {p.excedente > 0 && (
                  <span className="whitespace-nowrap rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-fg)' }} title="Dinheiro que entrou além do que a conta devia.">
                    {formatCurrency(p.excedente)} a mais
                  </span>
                )}
              </span>
            ),
          },
        ]}
        linhas={linhas}
        chave={(p) => p.id}
        carregando={q.isLoading}
        larguraMinima={720}
        vazio="Nenhum pagamento registrado nesta conta."
        acoes={(p) => (p.acordoId ? <Botao variante="fantasma" tamanho="sm" onClick={() => navigate(`/acordos?acordo=${p.acordoId}`)}>ver o acordo →</Botao> : null)}
      />

      {q.hasNextPage && (
        <div className="flex justify-center">
          <Botao variante="secundaria" tamanho="sm" carregando={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            Carregar mais {Math.min(BLOCO, total - linhas.length)} · faltam {total - linhas.length}
          </Botao>
        </div>
      )}
    </div>
  );
}
