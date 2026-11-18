import type { ReactNode } from 'react';
import { bloqueioDisponivel, formatCurrency, nomeDiaSemanaISO } from '@azit/utils';
import type { PosicaoConta } from '../../services/fatura.service';
import { dataBR } from '../../lib/datas';
import { CONTA_SITUACAO_COLORS, CONTA_SITUACAO_LABEL } from '../../config/statusColors';
import { LinkFaturaAcoes } from '../../components/LinkFaturaAcoes';
import { Link } from 'react-router-dom';
import { ROTULO_PAGAMENTO, destinoEmTexto } from './PagamentosDaConta';

// Posição de hoje (doc 02 §33.1): a primeira coisa que a ficha responde — quanto
// falta pagar agora, qual é a próxima fatura e qual foi o último dinheiro que
// entrou — e o cronograma da conta numa linha. Os números vêm prontos da API.
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const rotulo = 'text-[10.5px] font-semibold uppercase tracking-[0.08em]';

function Coluna({ titulo, destaque, children, fundo }: { titulo: string; destaque: ReactNode; children: ReactNode; fundo?: string }) {
  return (
    <div
      className="flex min-w-0 flex-col gap-[4px] p-[18px] [&:not(:first-child)]:border-t md:[&:not(:first-child)]:border-l md:[&:not(:first-child)]:border-t-0"
      style={{ borderColor: 'var(--border-light)', background: fundo }}
    >
      <div className={rotulo} style={{ color: 'var(--text-label)' }}>{titulo}</div>
      {destaque}
      <div className="flex flex-col gap-[2px] text-[12.5px]" style={{ color: 'var(--text-body)' }}>{children}</div>
    </div>
  );
}

export function PosicaoHoje({
  posicao: p,
  situacao,
  valorPago,
  acordos,
  novacoes,
  titularId,
}: {
  posicao: PosicaoConta;
  situacao: string;
  valorPago: number; // "pago até o momento" da conta, com entradas e sem encargos (decisão 02/10)
  acordos: number;
  novacoes: number;
  titularId: string;
}) {
  const emAtraso = p.atraso.faturas > 0;
  const cor = CONTA_SITUACAO_COLORS[situacao] ?? CONTA_SITUACAO_COLORS.em_dia;
  const t = p.trilho;
  const totalTrilho = t.pagas + t.emAtraso + t.aVencer;
  const u = p.ultimoPagamento;

  return (
    <section className="overflow-hidden rounded-card" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="grid grid-cols-1 md:grid-cols-[1.35fr_1fr_1fr]">
        {emAtraso ? (
          <Coluna
            titulo="Falta pagar hoje"
            fundo="var(--danger-bg)"
            destaque={<div className="font-display text-[30px] font-bold leading-[1.1] tabular-nums" style={{ color: 'var(--danger-fg)' }}>{formatCurrency(p.atraso.valorHoje)}</div>}
          >
            <span>
              <b style={{ color: 'var(--text-primary)' }}>{plural(p.atraso.faturas, 'fatura vencida', 'faturas vencidas')}</b>
              {p.atraso.faturas > 1 ? ', a mais antiga' : ''} há {plural(p.atraso.diasMaisAntiga, 'dia', 'dias')}
              {p.atraso.encargos > 0 ? ` · inclui ${formatCurrency(p.atraso.encargos)} de multa e atualização` : ''}
            </span>
            {p.atraso.comEncargoNoAsaas > 0 && (
              <span className="text-[11.5px]" style={{ color: 'var(--text-secondary)' }}>
                {p.atraso.comEncargoNoAsaas === p.atraso.faturas ? 'A multa e a atualização' : `Em ${p.atraso.comEncargoNoAsaas} dela${p.atraso.comEncargoNoAsaas === 1 ? '' : 's'}, a multa e a atualização`} são
                somadas pelo Asaas na hora do pagamento e não estão neste valor.
              </span>
            )}
            {situacao !== 'bloqueada' && bloqueioDisponivel(p.atraso.diasMaisAntiga) && (
              <span className="text-[11.5px] font-semibold" style={{ color: 'var(--danger-fg)' }}>Bloqueio do veículo disponível (pela régua de cobrança).</span>
            )}
            {p.faturaComLinkId && <div className="mt-[8px]"><LinkFaturaAcoes faturaId={p.faturaComLinkId} compacto /></div>}
          </Coluna>
        ) : (
          <Coluna
            titulo="Posição de hoje"
            destaque={<div className="font-display text-[30px] font-bold leading-[1.1]" style={{ color: cor.fg }}>{CONTA_SITUACAO_LABEL[situacao] ?? 'Em dia'}</div>}
          >
            <span>
              Nada vencido{t.pagas > 0 ? <> · <b style={{ color: 'var(--text-primary)' }}>{plural(t.pagas, 'fatura paga', 'faturas pagas')}</b></> : ''}
            </span>
            {p.faturaComLinkId && <div className="mt-[8px]"><LinkFaturaAcoes faturaId={p.faturaComLinkId} compacto /></div>}
          </Coluna>
        )}

        <Coluna
          titulo="Próxima fatura"
          destaque={<div className="font-display text-[19px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{p.proxima ? formatCurrency(p.proxima.valor) : '—'}</div>}
        >
          {p.proxima ? (
            <>
              <span>nº {p.proxima.numero} · vence {nomeDiaSemanaISO(p.proxima.dataVencimento.slice(0, 10))}, {dataBR(p.proxima.dataVencimento).slice(0, 5)}</span>
              <span>{p.proxima.disponivel ? 'já disponível para pagamento' : 'ainda não disponível para o cliente'}</span>
            </>
          ) : (
            <span>Nenhuma fatura à frente.</span>
          )}
        </Coluna>

        <Coluna
          titulo="Último pagamento"
          destaque={<div className="font-display text-[19px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{u ? formatCurrency(u.valor) : '—'}</div>}
        >
          {u ? (
            <>
              <span>{ROTULO_PAGAMENTO[u.tipo]} em {dataBR(u.dia).slice(0, 5)}{u.hora ? `, ${u.hora}` : ''}</span>
              <span>{destinoEmTexto(u)}</span>
            </>
          ) : (
            <span>Nenhum pagamento ainda.</span>
          )}
        </Coluna>
      </div>

      {/* O cronograma da conta numa linha: pagas, em atraso e a vencer. */}
      {totalTrilho > 0 && (
        <div className="flex flex-col gap-[8px] px-[18px] pb-[16px] pt-[14px]" style={{ borderTop: '1px solid var(--border-light)' }}>
          <div className="flex flex-wrap items-center justify-between gap-[8px]">
            <span className={rotulo} style={{ color: 'var(--text-label)' }}>Cronograma da conta · {plural(totalTrilho, 'fatura', 'faturas')}</span>
            {(acordos > 0 || novacoes > 0) && (
              <Link to={`/acordos?titular=${titularId}`} className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                {[acordos > 0 ? plural(acordos, 'acordo', 'acordos') : null, novacoes > 0 ? plural(novacoes, 'novação', 'novações') : null].filter(Boolean).join(' e ')} deste titular →
              </Link>
            )}
          </div>
          <div
            className="flex h-[8px] gap-[2px] overflow-hidden rounded-full"
            style={{ background: 'var(--surface-input)' }}
            role="img"
            aria-label={`${t.pagas} pagas, ${t.emAtraso} em atraso, ${t.aVencer} a vencer`}
          >
            {t.pagas > 0 && <i className="block h-full" style={{ flex: t.pagas, background: 'var(--ok-fg)' }} />}
            {t.emAtraso > 0 && <i className="block h-full" style={{ flex: t.emAtraso, background: 'var(--danger-fg)' }} />}
            {t.aVencer > 0 && <i className="block h-full" style={{ flex: t.aVencer, background: 'var(--border)' }} />}
          </div>
          <div className="flex flex-wrap gap-x-[18px] gap-y-[4px] text-[12px]" style={{ color: 'var(--text-body)' }}>
            <Legenda cor="var(--ok-fg)" forte={plural(t.pagas, 'paga', 'pagas')} resto={`${formatCurrency(valorPago)} pagos até hoje, com entradas`} />
            {t.emAtraso > 0 && <Legenda cor="var(--danger-fg)" forte={`${t.emAtraso} em atraso`} resto={formatCurrency(t.valorEmAtraso)} />}
            <Legenda cor="var(--border)" forte={`${t.aVencer} a vencer`} resto={formatCurrency(t.valorAVencer)} />
          </div>
        </div>
      )}
    </section>
  );
}

function Legenda({ cor, forte, resto }: { cor: string; forte: string; resto: string }) {
  return (
    <span className="inline-flex items-center gap-[6px]">
      <i className="block h-[8px] w-[8px] flex-none rounded-[2px]" style={{ background: cor }} />
      <b className="font-semibold" style={{ color: 'var(--text-primary)' }}>{forte}</b>
      <span className="tabular-nums">· {resto}</span>
    </span>
  );
}
