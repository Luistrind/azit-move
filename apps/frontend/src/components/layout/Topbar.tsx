import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { tempoRelativo } from '../../lib/datas';

// Topbar 60px — Doc 3 §7.3. Título da página + sub à esquerda; notificações à direita.
// Sino REAL (doc 02 §20 passo 13): marcos do pós-contrato (assinado / cobrança
// gerada / entrada paga) chegam aqui, com polling leve.
type TopbarProps = {
  title: string;
  subtitle?: string;
  onMenu?: () => void;
};

interface NotificacaoItem {
  id: string;
  titulo: string;
  corpo: string | null;
  rota: string | null;
  tipo: string;
  lida: boolean;
  em: string;
}

// Tipo → ícone e cor (doc 02 §16.1): o dropdown é escaneável por natureza do
// evento — aprovação, dinheiro, assinatura, cobrança, falha.
const TIPO_NOTIF: Record<string, { icone: string; bg: string; fg: string }> = {
  aprovacao: { icone: '✔', bg: '#eef4ff', fg: '#2456c7' },
  dinheiro: { icone: '$', bg: '#eafaf1', fg: '#1f9d5b' },
  assinatura: { icone: '✍', bg: '#efeaff', fg: '#6b4fd6' },
  cobranca: { icone: '!', bg: '#fef6e9', fg: '#c98a0a' },
  falha: { icone: '×', bg: '#fdeceb', fg: '#e0413c' },
  info: { icone: 'i', bg: '#f1f4f8', fg: '#8694a4' },
};

export function Topbar({ title, subtitle, onMenu }: TopbarProps) {
  const [aberto, setAberto] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notif = useQuery({
    queryKey: ['notificacoes'],
    queryFn: async () => {
      const { data } = await api.get<{ naoLidas: number; itens: NotificacaoItem[] }>('/api/v1/notificacoes');
      return data;
    },
    refetchInterval: 30000,
  });

  async function abrirNotificacao(n: NotificacaoItem) {
    setAberto(false);
    try {
      if (!n.lida) await api.post(`/api/v1/notificacoes/${n.id}/lida`);
    } catch { /* marcar como lida é melhor-esforço */ }
    await qc.invalidateQueries({ queryKey: ['notificacoes'] });
    if (n.rota) navigate(n.rota);
  }

  async function marcarTodas() {
    try { await api.post('/api/v1/notificacoes/marcar-todas-lidas'); } catch { /* idem */ }
    await qc.invalidateQueries({ queryKey: ['notificacoes'] });
  }

  const naoLidas = notif.data?.naoLidas ?? 0;

  return (
    <header
      className="relative flex h-[60px] flex-none items-center gap-[12px] px-[14px] lg:gap-[18px] lg:px-[26px]"
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
    >
      <button
        onClick={onMenu}
        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] lg:hidden"
        style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
        aria-label="Abrir menu"
      >
        <span className="flex flex-col gap-[4px]">
          <span className="h-[2px] w-[16px] rounded" style={{ background: 'var(--navy)' }} />
          <span className="h-[2px] w-[16px] rounded" style={{ background: 'var(--navy)' }} />
          <span className="h-[2px] w-[16px] rounded" style={{ background: 'var(--navy)' }} />
        </span>
      </button>
      <div className="min-w-0 leading-tight">
        <div className="truncate font-display text-[15px] font-bold tracking-[-0.01em] lg:text-[16px]">
          {title}
        </div>
        {subtitle && (
          <div className="mt-px hidden truncate text-[11.5px] sm:block" style={{ color: 'var(--text-body)' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex-1" />
      <button
        onClick={() => setAberto((a) => !a)}
        className="relative flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px]"
        style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
        aria-label="Notificações"
      >
        <span className="text-[16px]" aria-hidden>🔔</span>
        {naoLidas > 0 && (
          <span
            className="absolute -right-[5px] -top-[5px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[4px] text-[10.5px] font-bold"
            style={{ background: '#e0413c', color: '#fff', border: '1.5px solid #fff' }}
          >
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div
            className="absolute right-[14px] top-[56px] z-50 w-[340px] max-w-[calc(100vw-28px)] overflow-hidden rounded-[14px] shadow-lg lg:right-[26px]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between px-[14px] py-[10px]" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <span className="text-[13px] font-bold">Notificações</span>
              {naoLidas > 0 && (
                <button onClick={marcarTodas} className="text-[12px] font-semibold" style={{ color: 'var(--navy)' }}>
                  Marcar todas como lidas
                </button>
              )}
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {(notif.data?.itens ?? []).length === 0 ? (
                <div className="px-[14px] py-[18px] text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                  Nenhuma notificação ainda. Os marcos do contrato (assinatura, cobrança da
                  entrada, ativação) aparecem aqui.
                </div>
              ) : (
                (() => {
                  const itens = notif.data?.itens ?? [];
                  const hojeISO = new Date().toDateString();
                  const grupos: { rotulo: string; itens: NotificacaoItem[] }[] = [
                    { rotulo: 'Hoje', itens: itens.filter((n) => new Date(n.em).toDateString() === hojeISO) },
                    { rotulo: 'Anteriores', itens: itens.filter((n) => new Date(n.em).toDateString() !== hojeISO) },
                  ].filter((g) => g.itens.length > 0);
                  return grupos.map((g) => (
                    <div key={g.rotulo}>
                      <div className="px-[14px] pb-[2px] pt-[8px] text-[10.5px] font-semibold uppercase tracking-[0.05em]" style={{ color: 'var(--text-label)' }}>
                        {g.rotulo}
                      </div>
                      {g.itens.map((n) => {
                        const t = TIPO_NOTIF[n.tipo] ?? TIPO_NOTIF.info;
                        return (
                          <button
                            key={n.id}
                            onClick={() => void abrirNotificacao(n)}
                            className="flex w-full items-start gap-[10px] px-[14px] py-[10px] text-left"
                            style={{ borderBottom: '1px solid var(--border-light)', background: n.lida ? 'transparent' : 'var(--surface-input)' }}
                          >
                            <span className="mt-[1px] flex h-[24px] w-[24px] flex-none items-center justify-center rounded-full text-[12px] font-bold" style={{ background: t.bg, color: t.fg }}>
                              {t.icone}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-[8px]">
                                <span className="truncate text-[12.5px] font-bold">{n.titulo}</span>
                                <span className="flex-none text-[10.5px]" style={{ color: 'var(--text-muted)' }}>{tempoRelativo(n.em)}</span>
                              </span>
                              {n.corpo && <span className="block truncate text-[12px]" style={{ color: 'var(--text-muted)' }}>{n.corpo}</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ));
                })()
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
}
