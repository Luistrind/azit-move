import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '@azit/utils';
import { aprovacaoService, Aprovacao, DecisaoInput } from '../services/aprovacao.service';
import { mensagemErro } from '../lib/permissoes';
import { toast } from '../components/Toast';
import { Modal } from '../components/Modal';

function fmtDataHora(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const DECISAO_LABEL: Record<string, { rotulo: string; cor: string }> = {
  APROVADA: { rotulo: 'aprovou', cor: '#1f9d5b' },
  RECOMENDADA: { rotulo: 'recomendou', cor: '#b8860b' },
  REPROVADA: { rotulo: 'reprovou', cor: '#c0392b' },
};

// Central única de aprovações (Doc 2 §7.9-A): todas as operações sujeitas a alçada,
// com contexto do titular e trilha de decisões. Aprovar às cegas não é aprovar.
export function AprovacoesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [aba, setAba] = useState<'pendentes' | 'historico'>('pendentes');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [parecerDe, setParecerDe] = useState<{ id: string; decisao: DecisaoInput } | null>(null);
  const [parecer, setParecer] = useState('');

  const pendentes = useQuery({
    queryKey: ['aprovacoes-pendentes'],
    queryFn: () => aprovacaoService.pendentes(),
  });
  const historico = useQuery({
    queryKey: ['aprovacoes-historico'],
    queryFn: () => aprovacaoService.historico(),
    enabled: aba === 'historico',
  });

  async function recarregar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['aprovacoes-pendentes'] }),
      queryClient.invalidateQueries({ queryKey: ['aprovacoes-historico'] }),
      queryClient.invalidateQueries({ queryKey: ['aprovacoes-contagem'] }),
    ]);
  }

  async function decidir(id: string, decisao: DecisaoInput, textoParecer?: string) {
    setOcupado(id);
    try {
      const r = await aprovacaoService.decidir(id, decisao, textoParecer);
      await recarregar();
      if (decisao === 'aprovar') {
        toast.sucesso(r.efetivada ? (r.mensagem ?? 'Aprovada e efetivada.') : 'Aprovação registrada — aguarda as demais.');
      } else if (decisao === 'recomendar') {
        toast.info('Recomendação registrada — escalada para alçada superior.');
      } else {
        toast.info('Solicitação reprovada.');
      }
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setOcupado(null);
      setParecerDe(null);
      setParecer('');
    }
  }

  const lista = (aba === 'pendentes' ? pendentes.data : historico.data) ?? [];
  const tipos = Array.from(new Set(lista.map((a) => a.tipoOperacaoNome)));
  const filtrada = filtroTipo ? lista.filter((a) => a.tipoOperacaoNome === filtroTipo) : lista;
  const carregando = aba === 'pendentes' ? pendentes.isLoading : historico.isLoading;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-center gap-[10px]">
        {(['pendentes', 'historico'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className="h-[32px] rounded-[9px] px-[14px] text-[12.5px] font-semibold"
            style={
              aba === t
                ? { background: 'var(--navy)', color: '#fff' }
                : { background: 'var(--surface)', color: 'var(--text-body)', border: '1px solid var(--border)' }
            }
          >
            {t === 'pendentes' ? `Pendentes${pendentes.data ? ` (${pendentes.data.length})` : ''}` : 'Histórico'}
          </button>
        ))}
        <div className="flex-1" />
        {tipos.length > 1 && (
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="h-[32px] rounded-[9px] px-[10px] text-[12px]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <option value="">Todos os tipos</option>
            {tipos.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {carregando ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Carregando…</div>
      ) : filtrada.length === 0 ? (
        <div className="rounded-[14px] py-[32px] text-center text-[13px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          {aba === 'pendentes' ? 'Nenhuma solicitação aguardando aprovação.' : 'Sem histórico ainda.'}
        </div>
      ) : (
        <div className="flex flex-col gap-[12px]">
          {filtrada.map((a) => (
            <CardAprovacao
              key={a.id}
              a={a}
              ocupado={ocupado === a.id}
              pendente={aba === 'pendentes'}
              onTitular={(id) => navigate(`/titulares/${id}`)}
              onDecidir={(decisao) => {
                if (decisao === 'aprovar') void decidir(a.id, 'aprovar');
                else setParecerDe({ id: a.id, decisao });
              }}
            />
          ))}
        </div>
      )}

      {/* Parecer para recomendar/reprovar */}
      <Modal
        open={!!parecerDe}
        onClose={() => setParecerDe(null)}
        title={parecerDe?.decisao === 'reprovar' ? 'Reprovar solicitação' : 'Recomendar aprovação'}
      >
        <div className="flex flex-col gap-[12px]">
          <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
            {parecerDe?.decisao === 'reprovar'
              ? 'A solicitação será encerrada. Registre o motivo:'
              : 'Sua alçada não cobre o valor — a recomendação fica registrada na trilha e a solicitação segue para quem pode aprovar.'}
          </p>
          <textarea
            value={parecer}
            onChange={(e) => setParecer(e.target.value)}
            rows={3}
            placeholder="Parecer (opcional)"
            className="rounded-[8px] p-[10px] text-[13px]"
            style={{ background: 'var(--surface-input)', border: '1px solid var(--border)' }}
          />
          <button
            onClick={() => parecerDe && decidir(parecerDe.id, parecerDe.decisao, parecer || undefined)}
            className="h-[36px] rounded-[9px] text-[13px] font-semibold"
            style={
              parecerDe?.decisao === 'reprovar'
                ? { background: '#c0392b', color: '#fff' }
                : { background: 'var(--navy)', color: '#fff' }
            }
          >
            {parecerDe?.decisao === 'reprovar' ? 'Confirmar reprovação' : 'Registrar recomendação'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function CardAprovacao({
  a,
  ocupado,
  pendente,
  onTitular,
  onDecidir,
}: {
  a: Aprovacao;
  ocupado: boolean;
  pendente: boolean;
  onTitular: (id: string) => void;
  onDecidir: (d: DecisaoInput) => void;
}) {
  const statusCor =
    a.status === 'APROVADA' ? '#1f9d5b' : a.status === 'REPROVADA' ? '#c0392b' : a.status === 'CANCELADA' ? 'var(--text-muted)' : '#b8860b';
  return (
    <div className="rounded-[14px] p-[16px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-start gap-[12px]">
        <div className="min-w-[220px] flex-1">
          <div className="flex items-center gap-[8px]">
            <span
              className="rounded-[6px] px-[8px] py-[3px] text-[10.5px] font-bold uppercase tracking-[0.04em]"
              style={{ background: 'var(--surface-input)', color: 'var(--text-label)' }}
            >
              {a.tipoOperacaoNome}
            </span>
            {!pendente && (
              <span className="text-[11px] font-bold" style={{ color: statusCor }}>{a.status}</span>
            )}
          </div>
          <div className="mt-[6px] text-[14px] font-bold">{a.resumo}</div>
          <div className="mt-[2px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {a.titular ? (
              <button onClick={() => onTitular(a.titular!.id)} className="font-semibold" style={{ color: 'var(--navy)' }}>
                {a.titular.nome}
              </button>
            ) : '—'}
            {' · '}solicitado por {a.solicitante} em {fmtDataHora(a.solicitadoEm)}
          </div>
        </div>

        <div className="text-right">
          <div className="text-[16px] font-bold tabular-nums">{formatCurrency(a.valor)}</div>
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {a.aprovacoesFeitas}/{a.aprovacoesNecessarias} aprovação(ões)
          </div>
        </div>
      </div>

      {/* Contexto financeiro do titular — base da decisão */}
      {a.contexto && (
        <div className="mt-[12px] grid grid-cols-2 gap-[8px] rounded-[10px] p-[10px] text-[12px] sm:grid-cols-4" style={{ background: 'var(--surface-input)' }}>
          <div><span style={{ color: 'var(--text-muted)' }}>Contratos ativos</span><div className="font-bold">{a.contexto.contratosAtivos}</div></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Saldo devedor</span><div className="font-bold tabular-nums">{formatCurrency(a.contexto.saldoDevedor)}</div></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Em atraso</span><div className="font-bold tabular-nums" style={{ color: a.contexto.valorEmAtraso > 0 ? '#c0392b' : undefined }}>{formatCurrency(a.contexto.valorEmAtraso)}</div></div>
          <div><span style={{ color: 'var(--text-muted)' }}>Faturas vencidas</span><div className="font-bold" style={{ color: a.contexto.faturasVencidas > 0 ? '#c0392b' : undefined }}>{a.contexto.faturasVencidas}</div></div>
        </div>
      )}

      {/* Trilha de decisões */}
      {a.decisoes.length > 0 && (
        <div className="mt-[10px] flex flex-col gap-[4px]">
          {a.decisoes.map((d, i) => {
            const m = DECISAO_LABEL[d.decisao] ?? { rotulo: d.decisao, cor: 'var(--text-muted)' };
            return (
              <div key={i} className="text-[12px]" style={{ color: 'var(--text-body)' }}>
                <span className="font-semibold" style={{ color: m.cor }}>● {d.usuario} {m.rotulo}</span>
                {' '}em {fmtDataHora(d.em)}{d.parecer ? <span style={{ color: 'var(--text-muted)' }}> — “{d.parecer}”</span> : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Ações do usuário logado */}
      {pendente && (
        <div className="mt-[12px] flex items-center gap-[8px] border-t pt-[12px]" style={{ borderColor: 'var(--border-light)' }}>
          {a.minha.ehSolicitante ? (
            <span className="text-[12px] font-semibold" style={{ color: 'var(--text-muted)' }}>
              Você solicitou — a decisão é de outra pessoa (segregação).
            </span>
          ) : a.minha.jaDecidiu ? (
            <span className="text-[12px] font-semibold" style={{ color: 'var(--text-muted)' }}>
              Você já registrou sua decisão nesta solicitação.
            </span>
          ) : (
            <>
              {a.minha.podeAprovar ? (
                <button disabled={ocupado} onClick={() => onDecidir('aprovar')} className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>
                  Aprovar
                </button>
              ) : (
                <button disabled={ocupado} onClick={() => onDecidir('recomendar')} className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold disabled:opacity-50" style={{ background: 'var(--navy)', color: '#fff' }} title="Sua alçada não cobre o valor — endosse e escale">
                  Recomendar ↑
                </button>
              )}
              <button disabled={ocupado || !a.minha.podeAprovar} onClick={() => onDecidir('reprovar')} className="h-[32px] rounded-[8px] px-[14px] text-[12px] font-semibold disabled:opacity-40" style={{ background: '#fdeceb', color: '#c0392b' }} title={a.minha.podeAprovar ? undefined : 'Reprovar exige alçada para o valor'}>
                Reprovar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
