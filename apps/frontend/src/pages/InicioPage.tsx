import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { inicioService } from '../services/inicio.service';
import { usuarioService } from '../services/usuario.service';
import { toast } from '../components/Toast';
import { Bloco } from '../components/Bloco';
import { Botao } from '../components/Botao';
import { mensagemErro } from '../lib/permissoes';
import { rotuloStatus } from '../lib/rotulos';
import { useAuthStore } from '../stores/authStore';

// Tela Início (proposta UX §4.3): fila de trabalho do papel logado.
// Cada bloco vem do backend já filtrado pelas áreas efetivas do usuário.
// Ordem dos cards personalizável (16/09): arrasta pela alça ⠿; a ordem fica
// salva nas preferências do usuário (acompanha em qualquer computador).
// Layout v2 (30/10, doc 03 §11): cada fila é um <Bloco> do painel — rótulo,
// contagem, itens e "Explorar"; a alça de arrasto vive na ação do bloco.

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
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-end justify-between gap-[8px]">
        <div>
          <h1 className="font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Olá, {primeiroNome}</h1>
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            O que está esperando por você agora. Clique em um item para abrir direto o caso — arraste
            um card pela alça <b>⠿</b> para reorganizar.
          </p>
        </div>
        {ordemSalva.length > 0 && (
          <Botao variante="fantasma" tamanho="sm" onClick={() => salvarOrdem([])}>
            Restaurar ordem padrão
          </Botao>
        )}
      </div>

      {fila.isLoading ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando sua fila…</div>
      ) : !fila.data || fila.data.length === 0 ? (
        <Bloco titulo="Sua fila">
          <div className="text-[13px]" style={{ color: 'var(--text-body)' }}>
            Nenhuma fila configurada para o seu papel. Fale com o administrador sobre suas áreas de acesso.
          </div>
        </Bloco>
      ) : (
        <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2 xl:grid-cols-3">
          {blocos.map((bloco) => {
            const ehAlvo = alvo === bloco.area && !!arrastando && arrastando !== bloco.area;
            return (
              // Invólucro do arrasto: recebe o drop e marca o alvo; o cartão em si é o <Bloco>.
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
                className="flex rounded-card transition-opacity"
                style={{
                  opacity: arrastando === bloco.area ? 0.45 : 1,
                  outline: ehAlvo ? '2px dashed var(--accent)' : 'none',
                  outlineOffset: -2,
                }}
              >
                <Bloco
                  titulo={bloco.titulo}
                  className="flex-1"
                  acao={
                    <div className="flex items-center gap-[8px]">
                      <span
                        className="rounded-full px-[9px] py-[2px] text-[12px] font-bold"
                        style={
                          bloco.quantidade > 0
                            ? { background: 'var(--navy)', color: '#fff' }
                            : { background: 'var(--ok-bg)', color: 'var(--ok-fg)' }
                        }
                      >
                        {bloco.quantidade}
                      </span>
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
                    </div>
                  }
                  leitura={
                    bloco.quantidade > bloco.itens.length ? (
                      <>Mostrando {bloco.itens.length} de <b>{bloco.quantidade}</b> — abra a lista para ver o restante.</>
                    ) : undefined
                  }
                  explorar={{ rotulo: bloco.rotaRotulo, to: bloco.rota }}
                >
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
                          <div className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{item.titulo}</div>
                          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {rotuloStatus(item.subtitulo)}
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </Bloco>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
