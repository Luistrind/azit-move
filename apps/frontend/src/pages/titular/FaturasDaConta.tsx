import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatCurrency, nomeDiaSemanaISO } from '@azit/utils';
import { faturaService, type Fatura, type PosicaoConta, type VisaoFaturasConta } from '../../services/fatura.service';
import { dataBR, diasAtrasoBrasil } from '../../lib/datas';
import { FATURA_SITUACAO_COLORS, FATURA_SITUACAO_LABEL } from '../../config/statusColors';
import { Chips } from '../../components/Chips';
import { Tabela } from '../../components/Tabela';
import { Botao } from '../../components/Botao';
import { FaturaDetalhe } from './FaturaDetalhe';

// Faturas da conta em VISÕES (doc 02 §33.2), no lugar das páginas: a tela abre
// sempre em "Agora" (o que o cliente tem para pagar), e as listas longas crescem
// com "carregar mais" — nada volta para o começo nem pisca. A fatura abre na
// própria linha.
const BLOCO = 10;
const VISOES: { chave: VisaoFaturasConta; rotulo: string; dica: string; vazio: string }[] = [
  { chave: 'agora', rotulo: 'Agora', dica: 'Vencidas e as que já estão disponíveis para pagar.', vazio: 'Nada para pagar agora.' },
  { chave: 'vencer', rotulo: 'A vencer', dica: 'Previstas no cronograma; ainda não disponíveis para o cliente.', vazio: 'Nenhuma fatura a vencer.' },
  { chave: 'pagas', rotulo: 'Pagas', dica: 'Da mais recente para a mais antiga.', vazio: 'Nenhuma fatura paga ainda.' },
  { chave: 'outras', rotulo: 'Fora do cronograma', dica: 'Renegociadas, novadas e rescindidas — ficam no histórico.', vazio: 'Nenhuma.' },
];

// Selo da fatura: a situação calculada pelo servidor (Regra 7), com "em aberto"
// desdobrado pelo estado real — fechada = disponível; aberta = prevista.
function chaveSelo(f: Fatura): string {
  if (f.situacao !== 'em_aberto') return f.situacao;
  return f.status === 'fechada' ? 'disponivel' : 'prevista';
}
const selo = (chave: string) => ({ ...(FATURA_SITUACAO_COLORS[chave] ?? { bg: 'var(--surface-muted)', fg: 'var(--text-body)' }), label: FATURA_SITUACAO_LABEL[chave] ?? chave });

export function FaturasDaConta({ contaId, contagem, recarregar }: { contaId: string; contagem?: PosicaoConta['contagem']; recarregar: () => Promise<unknown> }) {
  const [visao, setVisao] = useState<VisaoFaturasConta>('agora');
  const [aberta, setAberta] = useState<string | null>(null);
  useEffect(() => { setVisao('agora'); setAberta(null); }, [contaId]); // outro titular: volta para o que ele tem agora

  const q = useInfiniteQuery({
    queryKey: ['titular-faturas', contaId, visao],
    queryFn: ({ pageParam }) => faturaService.daConta(contaId, visao, pageParam, BLOCO),
    initialPageParam: 0,
    getNextPageParam: (ultima, todas) => {
      const naTela = todas.reduce((s, b) => s + b.data.length, 0);
      return ultima.data.length > 0 && naTela < ultima.total ? naTela : undefined;
    },
  });
  const linhas = q.data?.pages.flatMap((b) => b.data) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  const atual = VISOES.find((v) => v.chave === visao)!;
  // "Fora do cronograma" só aparece quando existe alguma (regra: o que não se usa não se mostra).
  const visiveis = VISOES.filter((v) => v.chave !== 'outras' || (contagem?.outras ?? 0) > 0 || visao === 'outras');

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
        <Chips
          itens={visiveis.map((v) => ({ chave: v.chave, rotulo: v.rotulo, contagem: contagem?.[v.chave] }))}
          valor={visao}
          onChange={(c) => { setVisao((c as VisaoFaturasConta) ?? 'agora'); setAberta(null); }}
          todos={null}
        />
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{atual.dica}</span>
      </div>

      <Tabela
        semMoldura
        colunas={[
          {
            chave: 'numero',
            titulo: 'Fatura',
            celular: 'titulo',
            render: (f) => (
              <>
                nº {f.numero}
                {/* Visibilidade da renegociação (30/08): a parcela do acordo aparece como item da fatura. */}
                {f.itens.some((it) => it.descricao.startsWith('Renegociação')) && (
                  <span className="ml-[6px] rounded-[6px] px-[6px] py-[1px] text-[10.5px] font-semibold" style={{ background: 'var(--info-bg)', color: 'var(--info-fg)' }}>inclui acordo</span>
                )}
                {f.itens.length > 0 && (
                  <span className="block max-w-[240px] truncate text-[11.5px] font-normal" style={{ color: 'var(--text-muted)' }} title={f.itens.map((it) => it.descricao).join(' + ')}>
                    {f.itens.map((it) => it.descricao).join(' + ')}
                  </span>
                )}
              </>
            ),
          },
          {
            chave: 'vencimento',
            titulo: 'Vencimento',
            celular: 'subtitulo',
            classe: 'tabular-nums',
            render: (f) => (
              <>
                {dataBR(f.dataVencimento)}
                <span className="block text-[11.5px]" style={{ color: 'var(--text-muted)' }}>{nomeDiaSemanaISO(f.dataVencimento.slice(0, 10))}</span>
              </>
            ),
          },
          { chave: 'valor', titulo: 'Valor da fatura', alinhar: 'right', celular: 'campo', classe: 'tabular-nums', render: (f) => formatCurrency(f.valorTotal) },
          {
            // O que entrou de fato nesta fatura (com encargo, quando houve) e quando.
            chave: 'pago',
            titulo: 'Pago',
            alinhar: 'right',
            celular: 'campo',
            classe: 'tabular-nums',
            render: (f) =>
              f.valorPago > 0 ? (
                <>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(f.valorPago)}</span>
                  {f.dataPagamento && <span className="ml-[6px] text-[11px]" style={{ color: 'var(--text-muted)' }}>em {dataBR(f.dataPagamento).slice(0, 5)}</span>}
                </>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              ),
          },
          {
            // O que falta pagar HOJE: na vencida do Pix sob demanda já vem com multa e
            // atualização (a mesma conta da página do cliente).
            chave: 'falta',
            titulo: 'Falta hoje',
            alinhar: 'right',
            celular: 'destaque',
            classe: 'tabular-nums',
            render: (f) =>
              f.faltaHoje == null ? (
                <span style={{ color: 'var(--text-muted)' }}>—</span>
              ) : (
                <span
                  className={f.situacao === 'vencida' || f.faltaHoje !== f.valorTotal ? 'font-bold' : undefined}
                  style={{ color: f.situacao === 'vencida' ? 'var(--danger-fg)' : f.faltaHoje !== f.valorTotal ? 'var(--text-primary)' : 'var(--text-body)' }}
                  title={(f.encargoHoje ?? 0) > 0 ? `Inclui ${formatCurrency(f.encargoHoje ?? 0)} de multa e atualização até hoje.` : undefined}
                >
                  {formatCurrency(f.faltaHoje)}
                </span>
              ),
          },
          {
            chave: 'situacao',
            titulo: 'Situação',
            celular: 'campo',
            render: (f) => {
              const s = selo(chaveSelo(f));
              const dias = f.situacao === 'vencida' ? diasAtrasoBrasil(f.dataVencimento) : 0;
              // Em aberto com dinheiro já recebido: paga em parte (o detalhe mostra o que cada pagamento quitou).
              const parcial = f.faltaHoje != null && f.valorPago > 0 ? selo('paga_em_parte') : null;
              return (
                <span className="inline-flex flex-wrap items-center gap-[5px]">
                  <span className="whitespace-nowrap rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: s.bg, color: s.fg }}>
                    {s.label}{dias > 0 ? ` há ${dias} dia${dias === 1 ? '' : 's'}` : ''}
                  </span>
                  {parcial && <span className="whitespace-nowrap rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold" style={{ background: parcial.bg, color: parcial.fg }}>{parcial.label}</span>}
                </span>
              );
            },
          },
        ]}
        linhas={linhas}
        chave={(f) => f.id}
        carregando={q.isLoading}
        larguraMinima={780}
        vazio={atual.vazio}
        onClick={(f) => setAberta((a) => (a === f.id ? null : f.id))}
        expandida={(f) => (aberta === f.id ? <FaturaDetalhe faturaId={f.id} contaId={contaId} recarregar={recarregar} /> : null)}
        acoes={(f) => (
          // O link para o cliente (copiar / WhatsApp) fica dentro da fatura aberta e no topo da ficha.
          <Botao variante="fantasma" tamanho="sm" aria-expanded={aberta === f.id} onClick={() => setAberta((a) => (a === f.id ? null : f.id))}>
            {aberta === f.id ? 'Fechar' : 'Abrir'}
          </Botao>
        )}
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
