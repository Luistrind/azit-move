import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { inicioService } from '../services/inicio.service';
import { usuarioService } from '../services/usuario.service';
import { toast } from '../components/Toast';
import { mensagemErro } from '../lib/permissoes';
import { rotuloStatus } from '../lib/rotulos';
import { useAuthStore } from '../stores/authStore';

// Tela Início (proposta UX §4.3): fila de trabalho do papel logado.
// Cada bloco vem do backend já filtrado pelas áreas efetivas do usuário.
// Ordem dos cards personalizável (16/09): arrasta pela alça ⠿; a ordem fica
// salva nas preferências do usuário (acompanha em qualquer computador).

const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;

export function InicioPage() {
  const usuario = useAuthStore((s) => s.usuario);
  const fila = useQuery({
    queryKey: ['inicio-fila'],
    queryFn: () => inicioService.fila(),
    refetchInterval: 60_000,
  });

  const primeiroNome = (usuario?.nome ?? '').split(' ')[0] || 'você';

  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ['me-preferencias'],
    queryFn: () => usuarioService.minhasPreferencias(),
    staleTime: 5 * 60_000,
  });
  const ordemSalva = prefs.data?.ordemInicio ?? [];
  // Blocos na ordem do usuário; os que não estão na preferência (novos ou
  // nunca movidos) seguem a ordem padrão do servidor, ao final.
  const blocos = [...(fila.data ?? [])].sort((a, b) => {
    const ia = ordemSalva.indexOf(a.area);
    const ib = ordemSalva.indexOf(b.area);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);

  function salvarOrdem(ordem: string[]) {
    qc.setQueryData(['me-preferencias'], { ...(prefs.data ?? {}), ordemInicio: ordem });
    usuarioService.salvarPreferencias({ ordemInicio: ordem }).catch((e) => {
      toast.erro(mensagemErro(e));
      void qc.invalidateQueries({ queryKey: ['me-preferencias'] });
    });
  }

  function mover(de: string, para: string) {
    if (de === para) return;
    const ordem = blocos.map((b) => b.area).filter((a) => a !== de);
    ordem.splice(ordem.indexOf(para) + (blocos.findIndex((b) => b.area === de) < blocos.findIndex((b) => b.area === para) ? 1 : 0), 0, de);
    salvarOrdem(ordem);
  }

  return (
    <div className="flex flex-col gap-[16px] p-[24px]">
      <div className="flex flex-wrap items-end justify-between gap-[8px]">
        <div>
          <h1 className="font-display text-[20px] font-bold">Olá, {primeiroNome}</h1>
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            O que está esperando por você agora. Clique em um item para abrir direto o caso — arraste
            um card pela alça <b>⠿</b> para reorganizar.
          </p>
        </div>
        {ordemSalva.length > 0 && (
          <button onClick={() => salvarOrdem([])} className="text-[12px] font-semibold underline" style={{ color: 'var(--text-muted)' }}>
            Restaurar ordem padrão
          </button>
        )}
      </div>

      {fila.isLoading ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando sua fila…</div>
      ) : !fila.data || fila.data.length === 0 ? (
        <div className="rounded-[14px] p-[24px] text-[13px]" style={cardStyle}>
          Nenhuma fila configurada para o seu papel. Fale com o administrador sobre suas áreas de acesso.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2 xl:grid-cols-3">
          {blocos.map((bloco) => (
            <div
              key={bloco.area}
              data-card
              onDragOver={(e) => {
                if (!arrastando) return;
                e.preventDefault();
                if (alvo !== bloco.area) setAlvo(bloco.area);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (arrastando) mover(arrastando, bloco.area);
                setArrastando(null);
                setAlvo(null);
              }}
              className="flex flex-col rounded-[14px] p-[16px] transition-opacity"
              style={{
                ...cardStyle,
                opacity: arrastando === bloco.area ? 0.45 : 1,
                ...(alvo === bloco.area && arrastando && arrastando !== bloco.area
                  ? { border: '2px dashed var(--accent)' }
                  : {}),
              }}
            >
              <div className="mb-[10px] flex items-start justify-between gap-[8px]">
                <div className="flex items-start gap-[6px]">
                  <span
                    draggable
                    title="Arraste para reorganizar"
                    aria-label={`Mover o card ${bloco.titulo}`}
                    onDragStart={(e) => {
                      setArrastando(bloco.area);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', bloco.area);
                      const card = (e.currentTarget as HTMLElement).closest('[data-card]');
                      if (card) e.dataTransfer.setDragImage(card, 24, 24);
                    }}
                    onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                    className="cursor-grab select-none text-[14px] leading-none active:cursor-grabbing"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    ⠿
                  </span>
                  <div className="text-[13px] font-bold leading-snug">{bloco.titulo}</div>
                </div>
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
