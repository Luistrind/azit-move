import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { inicioService } from '../services/inicio.service';
import { rotuloStatus } from '../lib/rotulos';
import { useAuthStore } from '../stores/authStore';

// Tela Início (proposta UX §4.3): fila de trabalho do papel logado.
// Cada bloco vem do backend já filtrado pelas áreas efetivas do usuário.

const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;

export function InicioPage() {
  const usuario = useAuthStore((s) => s.usuario);
  const fila = useQuery({
    queryKey: ['inicio-fila'],
    queryFn: () => inicioService.fila(),
    refetchInterval: 60_000,
  });

  const primeiroNome = (usuario?.nome ?? '').split(' ')[0] || 'você';

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div>
        <h1 className="font-display text-[20px] font-bold">Olá, {primeiroNome}</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          O que está esperando por você agora. Clique em um item para abrir direto o caso.
        </p>
      </div>

      {fila.isLoading ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando sua fila…</div>
      ) : !fila.data || fila.data.length === 0 ? (
        <div className="rounded-[14px] p-[24px] text-[13px]" style={cardStyle}>
          Nenhuma fila configurada para o seu papel. Fale com o administrador sobre suas áreas de acesso.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2 xl:grid-cols-3">
          {fila.data.map((bloco) => (
            <div key={bloco.area} className="flex flex-col rounded-[14px] p-[16px]" style={cardStyle}>
              <div className="mb-[10px] flex items-start justify-between gap-[8px]">
                <div className="text-[13px] font-bold leading-snug">{bloco.titulo}</div>
                <span
                  className="rounded-full px-[9px] py-[2px] text-[12px] font-bold"
                  style={
                    bloco.quantidade > 0
                      ? { background: 'var(--navy)', color: '#fff' }
                      : { background: '#e5f5ec', color: '#1c7c4c' }
                  }
                >
                  {bloco.quantidade}
                </span>
              </div>

              {bloco.quantidade === 0 ? (
                <div className="flex-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>{bloco.vazio}</div>
              ) : (
                <div className="flex flex-1 flex-col gap-[6px]">
                  {bloco.itens.map((item, i) => (
                    <Link
                      key={i}
                      to={item.rota}
                      className="rounded-[9px] px-[10px] py-[7px] transition-colors hover:opacity-80"
                      style={{ background: 'var(--surface-input)', border: '1px solid var(--border-light)' }}
                    >
                      <div className="truncate text-[12.5px] font-semibold">{item.titulo}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {rotuloStatus(item.subtitulo)}
                      </div>
                    </Link>
                  ))}
                  {bloco.quantidade > bloco.itens.length && (
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      … e mais {bloco.quantidade - bloco.itens.length}
                    </div>
                  )}
                </div>
              )}

              <Link
                to={bloco.rota}
                className="mt-[12px] inline-block rounded-[8px] px-[12px] py-[7px] text-center text-[12px] font-semibold"
                style={{ background: 'var(--navy)', color: '#fff' }}
              >
                {bloco.rotaRotulo}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
