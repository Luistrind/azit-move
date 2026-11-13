import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EVENTOS_ALERTA_EMAIL, ROTULO_ENTRADA_USUARIO } from '@azit/types';
import { authService } from '../services/auth.service';
import { useAuthStore } from '../stores/authStore';
import { queryClient } from '../lib/queryClient';
import { mensagemErro } from '../lib/permissoes';
import { colunasAcesso } from '../lib/acessos';
import { ENTRADA_USUARIO_COLORS } from '../config/statusColors';
import { Botao } from '../components/Botao';
import { Secao } from '../components/Secao';
import { StatusBadge } from '../components/StatusBadge';
import { Tabela } from '../components/Tabela';
import { ModalConfirmacao } from '../components/ModalConfirmacao';
import { toast } from '../components/Toast';
import { nomePapel, usuarioService } from '../services/usuario.service';
import { Interruptor } from '../components/Interruptor';

// "Minha conta" (doc 06 v1.1 §2.5): como eu entro no sistema, meus últimos
// acessos (forma, resultado, IP, dispositivo, quando — no fuso do Brasil) e o
// botão "Encerrar todas as sessões". Rota sem área (apoio a qualquer usuário
// autenticado); preferências de interface continuam onde estão (Início).

const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)' } as const;

export function MinhaContaPage() {
  const navigate = useNavigate();
  const usuario = useAuthStore((s) => s.usuario);
  const limpar = useAuthStore((s) => s.limpar);
  const dados = useQuery({ queryKey: ['me-acessos'], queryFn: () => authService.meusAcessos() });
  const [confirmando, setConfirmando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  // "Receber alertas por e-mail" (doc 06 v1.1 §12.3 item 4): ligado por padrão;
  // desligar não desliga o sino.
  const prefs = useQuery({ queryKey: ['me-preferencias'], queryFn: () => usuarioService.minhasPreferencias() });
  const [salvandoAlertas, setSalvandoAlertas] = useState(false);
  const emailAlertas = prefs.data?.emailAlertas !== false;

  async function alternarAlertas(ligado: boolean) {
    setSalvandoAlertas(true);
    try {
      await usuarioService.salvarPreferencias({ emailAlertas: ligado });
      await queryClient.invalidateQueries({ queryKey: ['me-preferencias'] });
      toast.sucesso(ligado ? 'Alertas por e-mail ligados.' : 'Alertas por e-mail desligados — o sino continua.');
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setSalvandoAlertas(false);
    }
  }

  async function encerrarSessoes() {
    setEncerrando(true);
    try {
      const r = await authService.encerrarMinhasSessoes();
      toast.sucesso(`${r.encerradas} sessão${r.encerradas === 1 ? '' : 'ões'} encerrada${r.encerradas === 1 ? '' : 's'}. Entre de novo.`);
      // Este navegador também perdeu a sessão: sai agora em vez de esperar o access token vencer.
      limpar();
      queryClient.clear();
      navigate('/login', { replace: true });
    } catch (e) {
      toast.erro(mensagemErro(e));
    } finally {
      setEncerrando(false);
      setConfirmando(false);
    }
  }

  const d = dados.data;

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <h1 className="font-display text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>Minha conta</h1>
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Como você entra no sistema e de onde entrou. Se algum acesso aqui não foi você, encerre todas as
          sessões e avise o administrador.
        </p>
      </div>

      <div className="rounded-card p-[16px]" style={cardStyle}>
        <Secao titulo="Identidade" tag={usuario?.email}>
          <div className="flex flex-wrap items-center gap-[14px]">
            <div>
              <div className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{usuario?.nome ?? '—'}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{usuario?.roles?.map(nomePapel).join(' · ') ?? ''}</div>
            </div>
            {d && (
              <div className="flex flex-wrap gap-[6px]">
                <StatusBadge label={d.entrada.googleVinculado ? ROTULO_ENTRADA_USUARIO.googleVinculado : ROTULO_ENTRADA_USUARIO.googlePendente} colors={ENTRADA_USUARIO_COLORS} />
                <StatusBadge label={d.entrada.permiteSenha ? ROTULO_ENTRADA_USUARIO.senhaLigada : ROTULO_ENTRADA_USUARIO.senhaDesligada} colors={ENTRADA_USUARIO_COLORS} />
              </div>
            )}
          </div>
          <div className="mt-[10px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            A porta de entrada é a sua conta Google da Azit ({usuario?.email ?? 'e-mail do Workspace'}). A senha é uma
            reserva ligada só pelo administrador; não existe "esqueci a senha" — entre pelo Google.
          </div>
        </Secao>
      </div>

      <div className="rounded-card p-[16px]" style={cardStyle}>
        <Secao
          titulo="Sessões abertas"
          tag={d ? `${d.sessoesAtivas} dispositivo${d.sessoesAtivas === 1 ? '' : 's'} com sessão válida` : undefined}
          acao={
            <Botao tamanho="sm" variante="perigo" onClick={() => setConfirmando(true)} disabled={!d}>
              Encerrar todas as sessões
            </Botao>
          }
        >
          <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Encerrar derruba a sessão em todos os dispositivos, inclusive neste — em até 15 minutos ninguém
            mais consegue continuar com os tokens antigos.
          </div>
        </Secao>
      </div>

      <div className="rounded-card p-[16px]" style={cardStyle}>
        <Secao titulo="Alertas por e-mail" tag={usuario?.email}>
          <Interruptor
            ligado={emailAlertas}
            onChange={(v) => void alternarAlertas(v)}
            carregando={salvandoAlertas || prefs.isLoading}
            rotulo="Receber alertas por e-mail"
            descricao="Só o que é dirigido a você. Desligar não desliga o sino do Hub."
          />
          <div className="mt-[10px] text-[12px]" style={{ color: 'var(--text-muted)' }}>
            O que chega por e-mail:
            <ul className="mt-[4px] list-disc pl-[18px]">
              {EVENTOS_ALERTA_EMAIL.map((e) => <li key={e}>{e}</li>)}
            </ul>
            <div className="mt-[6px]">
              O e-mail traz só a operação, o valor, quem solicitou, a data e o link — nunca dados do cliente. Avisos por área
              (ex.: nova aprovação na área Aprovações) e avisos gerais ficam só no sino.
            </div>
          </div>
        </Secao>
      </div>

      <div className="rounded-card p-[16px]" style={cardStyle}>
        <Secao titulo="Meus últimos acessos" tag="últimas 50 tentativas, com ou sem sucesso">
          <Tabela
            colunas={colunasAcesso({ comMotivo: false })}
            linhas={d?.acessos ?? []}
            chave={(a) => a.id}
            carregando={dados.isLoading}
            larguraMinima={640}
            vazio={dados.isError ? mensagemErro(dados.error) : 'Nenhum acesso registrado ainda.'}
          />
        </Secao>
      </div>

      <ModalConfirmacao
        open={confirmando}
        titulo="Encerrar todas as sessões"
        confirmar="Encerrar e sair"
        carregando={encerrando}
        onConfirmar={() => void encerrarSessoes()}
        onCancelar={() => setConfirmando(false)}
      >
        Todas as suas sessões serão encerradas, inclusive esta. Você volta para a tela de entrada agora e os
        outros dispositivos caem em até 15 minutos. Continuar?
      </ModalConfirmacao>
    </div>
  );
}
