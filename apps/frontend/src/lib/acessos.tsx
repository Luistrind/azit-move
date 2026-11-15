import { nomeFormaAcesso, ROTULO_RESULTADO_ACESSO } from '@azit/types';
import { ACESSO_RESULTADO_COLORS } from '../config/statusColors';
import { StatusBadge } from '../components/StatusBadge';
import type { Coluna } from '../components/Tabela';
import type { AcessoRegistrado } from '../services/auth.service';
import { instanteHoraBR } from './datas';

// Colunas do registro de acessos (doc 06 v1.1 §2.5) — UMA definição para a tela
// Usuários e permissões (Admin, com o motivo interno) e para "Minha conta" (sem
// o motivo: o próprio usuário vê só forma, resultado, IP, dispositivo e quando).

// Motivos internos legíveis pelo Admin (os códigos vivem no AuthService).
const MOTIVO_LEGIVEL: Record<string, string> = {
  token_invalido: 'token do Google inválido ou de outro aplicativo',
  email_nao_verificado: 'e-mail não verificado no Google',
  dominio_invalido: 'conta fora dos domínios da Azit',
  usuario_inexistente: 'e-mail sem usuário cadastrado',
  usuario_inativo: 'usuário desativado',
  sub_divergente: 'conta Google diferente da vinculada (religar)',
  senha_desligada: 'entrada por senha desligada',
  bloqueado: 'bloqueado por tentativas seguidas (15 min)',
  senha_invalida: 'senha incorreta',
  refresh_invalido: 'sessão expirada ou encerrada',
};

export function motivoAcessoLegivel(motivo: string | null): string {
  if (!motivo) return '';
  return MOTIVO_LEGIVEL[motivo] ?? motivo;
}

// Agente curto: "Chrome · Windows" em vez da string inteira do navegador.
export function agenteCurto(agente: string | null): string {
  if (!agente) return '—';
  const nav = /Edg\//.test(agente) ? 'Edge' : /OPR\//.test(agente) ? 'Opera' : /Chrome\//.test(agente) ? 'Chrome' : /Firefox\//.test(agente) ? 'Firefox' : /Safari\//.test(agente) ? 'Safari' : 'Navegador';
  const so = /Windows/.test(agente) ? 'Windows' : /Android/.test(agente) ? 'Android' : /iPhone|iPad/.test(agente) ? 'iOS' : /Mac OS/.test(agente) ? 'macOS' : /Linux/.test(agente) ? 'Linux' : '';
  return so ? `${nav} · ${so}` : nav;
}

export function colunasAcesso(opcoes: { comMotivo: boolean }): Coluna<AcessoRegistrado>[] {
  const colunas: Coluna<AcessoRegistrado>[] = [
    { chave: 'em', titulo: 'Quando', render: (a) => instanteHoraBR(a.em), celular: 'titulo', classe: 'tabular-nums' },
    {
      chave: 'resultado',
      titulo: 'Resultado',
      celular: 'destaque',
      render: (a) => (
        <StatusBadge label={a.sucesso ? ROTULO_RESULTADO_ACESSO.sucesso : ROTULO_RESULTADO_ACESSO.falha} colors={ACESSO_RESULTADO_COLORS} />
      ),
    },
    { chave: 'forma', titulo: 'Forma', render: (a) => nomeFormaAcesso(a.forma), celular: 'subtitulo' },
    { chave: 'ip', titulo: 'IP', render: (a) => a.ip ?? '—', classe: 'tabular-nums' },
    { chave: 'agente', titulo: 'Dispositivo', render: (a) => <span title={a.agente ?? undefined}>{agenteCurto(a.agente)}</span> },
  ];
  if (opcoes.comMotivo) {
    colunas.push({ chave: 'motivo', titulo: 'Motivo (interno)', render: (a) => (a.sucesso ? '' : motivoAcessoLegivel(a.motivo)) });
  }
  return colunas;
}
