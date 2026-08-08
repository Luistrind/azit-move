import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

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
  lida: boolean;
  em: string;
}

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
                (notif.data?.itens ?? []).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => void abrirNotificacao(n)}
                    className="block w-full px-[14px] py-[10px] text-left"
                    style={{ borderBottom: '1px solid var(--border-light)', background: n.lida ? 'transparent' : 'var(--surface-input)' }}
                  >
                    <div className="text-[12.5px] font-bold">{n.titulo}</div>
                    {n.corpo && <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{n.corpo}</div>}
                    <div className="mt-[2px] text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                      {new Date(n.em).toLocaleString('pt-BR')}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
}
