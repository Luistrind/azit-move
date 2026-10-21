import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { VezAprovacao } from '@azit/types';
import { aprovacaoService, Aprovacao } from '../services/aprovacao.service';
import { StatusBadge } from '../components/StatusBadge';
import { esperaDesde, instanteCurtoBR } from '../lib/datas';
import { motivosDe, resumoDecisoes, tituloHumano } from '../lib/aprovacao';
import {
  APROVACAO_STATUS_COLORS,
  APROVACAO_STATUS_LABEL,
  TOM_DOSSIE_FG,
  VEZ_APROVACAO_COLORS,
  VEZ_APROVACAO_LABEL,
} from '../config/statusColors';

// Fila parada: acima de 2 dias a espera fica em alerta (protótipo de 14/10).
const ESPERA_ALERTA_HORAS = 48;
// "Minhas para decidir": o que depende de quem está olhando.
const VEZ_MINHA = new Set<string>([VezAprovacao.DECIDIR, VezAprovacao.RECOMENDAR, VezAprovacao.RESPONDER_COMPLEMENTO]);

const card = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;
const th = 'px-[12px] py-[10px] text-left text-[11px] font-semibold uppercase tracking-[.04em]';

// Central única de aprovações (Doc 2 §7.9-A) — LISTA (protótipo de 14/10,
// implementado em 21/10): tipo, pedido em uma frase, com quem é a operação,
// valor, quem pediu, espera, decisões e de quem é a vez. A linha abre o
// dossiê (/aprovacoes/:id) — aprovar às cegas não é aprovar.
export function AprovacoesPage() {
  const navigate = useNavigate();
  const [aba, setAba] = useState<'pendentes' | 'historico'>('pendentes');
  const [escopo, setEscopo] = useState<'minhas' | 'todas' | null>(null); // null = automático
  const [filtroTipo, setFiltroTipo] = useState('');

  const pendentes = useQuery({ queryKey: ['aprovacoes-pendentes'], queryFn: () => aprovacaoService.pendentes() });
  const historico = useQuery({ queryKey: ['aprovacoes-historico'], queryFn: () => aprovacaoService.historico(), enabled: aba === 'historico' });

  const lista = (aba === 'pendentes' ? pendentes.data : historico.data) ?? [];
  const minhas = (pendentes.data ?? []).filter((a) => a.minha.vez && VEZ_MINHA.has(a.minha.vez));
  const escopoEfetivo = aba === 'historico' ? 'todas' : (escopo ?? (minhas.length > 0 ? 'minhas' : 'todas'));
  const tipos = useMemo(() => Array.from(new Set(lista.map((a) => a.tipoOperacaoNome))).sort(), [lista]);
  const filtrada = lista
    .filter((a) => escopoEfetivo === 'todas' || (a.minha.vez && VEZ_MINHA.has(a.minha.vez)))
    .filter((a) => !filtroTipo || a.tipoOperacaoNome === filtroTipo);
  const carregando = aba === 'pendentes' ? pendentes.isLoading : historico.isLoading;

  const maisAntiga = (pendentes.data ?? []).reduce<string | null>((min, a) => (!min || a.solicitadoEm < min ? a.solicitadoEm : min), null);

  const chip = (on: boolean) =>
    on
      ? { background: 'var(--surface-input)', color: 'var(--navy)', border: '1px solid var(--navy)' }
      : { background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)' };

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <div className="min-w-[220px] flex-1 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          {pendentes.data
            ? [
                `${pendentes.data.length} pendente(s)`,
                `${minhas.length} ${minhas.length === 1 ? 'depende' : 'dependem'} de você`,
                maisAntiga ? `a mais antiga espera há ${esperaDesde(maisAntiga).texto}` : null,
              ].filter(Boolean).join(' · ')
            : ' '}
        </div>
        {(['pendentes', 'historico'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setAba(t); setFiltroTipo(''); }}
            className="h-[32px] rounded-[9px] px-[14px] text-[12.5px] font-semibold"
            style={aba === t ? { background: 'var(--navy)', color: '#fff' } : { background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)' }}
          >
            {t === 'pendentes' ? `Pendentes${pendentes.data ? ` (${pendentes.data.length})` : ''}` : 'Histórico'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-[8px]">
        {aba === 'pendentes' && (
          <>
            <button onClick={() => setEscopo('minhas')} className="h-[28px] rounded-[9px] px-[10px] text-[12px] font-semibold" style={chip(escopoEfetivo === 'minhas')}>
              Minhas para decidir ({minhas.length})
            </button>
            <button onClick={() => setEscopo('todas')} className="h-[28px] rounded-[9px] px-[10px] text-[12px] font-semibold" style={chip(escopoEfetivo === 'todas')}>
              Todas
            </button>
          </>
        )}
        {tipos.length > 1 && (
          <>
            <span className="mx-[4px] text-[12px]" style={{ color: 'var(--text-muted)' }}>Tipo:</span>
            {tipos.map((t) => (
              <button key={t} onClick={() => setFiltroTipo(filtroTipo === t ? '' : t)} className="h-[28px] rounded-[9px] px-[10px] text-[12px] font-semibold" style={chip(filtroTipo === t)}>
                {t}
              </button>
            ))}
          </>
        )}
      </div>

      {carregando ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
      ) : filtrada.length === 0 ? (
        <div className="rounded-[14px] py-[32px] text-center text-[13px]" style={{ ...card, color: 'var(--text-muted)' }}>
          {aba === 'historico'
            ? 'Sem histórico ainda.'
            : escopoEfetivo === 'minhas'
              ? 'Nada depende de você agora — veja "Todas" para acompanhar a fila.'
              : 'Nenhuma solicitação aguardando aprovação.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[14px]" style={card}>
          <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
            <thead>
              <tr style={{ color: 'var(--text-label)', borderBottom: '1px solid var(--border)' }}>
                <th className={th}>Tipo</th>
                <th className={th}>Pedido</th>
                <th className={th}>Titular / fornecedor</th>
                <th className={th + ' text-right'}>Valor</th>
                <th className={th}>Solicitante</th>
                <th className={th}>{aba === 'pendentes' ? 'Espera' : 'Pedido em'}</th>
                <th className={th}>Decisões</th>
                <th className={th}>{aba === 'pendentes' ? 'Sua vez?' : 'Resultado'}</th>
              </tr>
            </thead>
            <tbody>
              {filtrada.map((a) => (
                <LinhaAprovacao key={a.id} a={a} pendente={aba === 'pendentes'} onAbrir={() => navigate(`/aprovacoes/${a.id}`)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LinhaAprovacao({ a, pendente, onAbrir }: { a: Aprovacao; pendente: boolean; onAbrir: () => void }) {
  const espera = esperaDesde(a.solicitadoEm);
  const motivos = motivosDe(a);
  const vez = a.minha.vez ? VEZ_APROVACAO_LABEL[a.minha.vez] : null;
  return (
    <tr onClick={onAbrir} className="cursor-pointer hover:bg-[var(--surface-muted)]" style={{ borderBottom: '1px solid var(--border-light)' }}>
      <td className="px-[12px] py-[11px] align-middle">
        <span className="whitespace-nowrap rounded-[6px] px-[8px] py-[2px] text-[10.5px] font-bold uppercase tracking-[.04em]" style={{ background: 'var(--surface-input)', color: 'var(--text-label)' }}>
          {a.tipoOperacaoNome}
        </span>
      </td>
      <td className="px-[12px] py-[11px] align-middle">
        <div className="font-bold" style={{ color: 'var(--text-primary)' }}>{tituloHumano(a.resumo)}</div>
        {motivos.length > 0 && (
          <div className="mt-[2px] text-[11.5px]" style={{ color: TOM_DOSSIE_FG.atencao }}>⚠ {motivos[0]}{motivos.length > 1 ? ` (+${motivos.length - 1})` : ''}</div>
        )}
      </td>
      <td className="px-[12px] py-[11px] align-middle">{a.contraparte?.nome ?? '—'}</td>
      <td className="whitespace-nowrap px-[12px] py-[11px] text-right align-middle font-bold tabular-nums">{formatCurrency(a.valor)}</td>
      <td className="px-[12px] py-[11px] align-middle">{a.solicitante}</td>
      <td className="whitespace-nowrap px-[12px] py-[11px] align-middle text-[11.5px]">
        {pendente ? (
          <span style={espera.horas >= ESPERA_ALERTA_HORAS ? { color: TOM_DOSSIE_FG.alerta, fontWeight: 700 } : { color: 'var(--text-muted)' }}>{espera.texto}</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>{instanteCurtoBR(a.solicitadoEm)}</span>
        )}
      </td>
      <td className="px-[12px] py-[11px] align-middle text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
        {resumoDecisoes(a)}
        {a.complementoAberto && <div style={{ color: a.complementoAberto.vencido ? TOM_DOSSIE_FG.alerta : TOM_DOSSIE_FG.atencao }}>complemento pedido{a.complementoAberto.vencido ? ' · prazo vencido' : ''}</div>}
      </td>
      <td className="px-[12px] py-[11px] align-middle">
        {pendente
          ? vez && <StatusBadge label={vez} colors={VEZ_APROVACAO_COLORS} />
          : <StatusBadge label={APROVACAO_STATUS_LABEL[a.status] ?? a.status} colors={APROVACAO_STATUS_COLORS} />}
      </td>
    </tr>
  );
}
