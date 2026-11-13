import { ROTULO_EMAIL_NOTIFICACAO, motivoEmailLegivel } from '@azit/types';
import { EMAIL_NOTIFICACAO_COLORS } from '../config/statusColors';
import { StatusBadge } from '../components/StatusBadge';
import type { Coluna } from '../components/Tabela';
import type { AlertaEmailNotificacao } from '../services/usuario.service';
import { instanteHoraBR } from './datas';

// Colunas do rastro de alerta por e-mail (doc 06 v1.1 §12.4) — UMA definição
// para o painel do usuário em Usuários e permissões (e para onde mais a
// auditoria da notificação for mostrada).

export function rotuloEmailNotificacao(n: { emailEnviadoEm: string | null; emailFalha: string | null }): string {
  if (n.emailEnviadoEm) return ROTULO_EMAIL_NOTIFICACAO.enviado;
  if (n.emailFalha) return ROTULO_EMAIL_NOTIFICACAO.naoEnviado;
  return ROTULO_EMAIL_NOTIFICACAO.semEmail;
}

export function colunasAlertaEmail(): Coluna<AlertaEmailNotificacao>[] {
  return [
    { chave: 'em', titulo: 'Quando', render: (n) => instanteHoraBR(n.em), celular: 'titulo', classe: 'tabular-nums' },
    { chave: 'titulo', titulo: 'Notificação', render: (n) => n.titulo, celular: 'subtitulo' },
    {
      chave: 'email',
      titulo: 'E-mail',
      celular: 'destaque',
      render: (n) => <StatusBadge label={rotuloEmailNotificacao(n)} colors={EMAIL_NOTIFICACAO_COLORS} />,
    },
    {
      chave: 'detalhe',
      titulo: 'Enviado em / motivo',
      render: (n) => (n.emailEnviadoEm ? instanteHoraBR(n.emailEnviadoEm) : n.emailFalha ? motivoEmailLegivel(n.emailFalha) : '—'),
    },
    { chave: 'lida', titulo: 'Lida no sino', render: (n) => (n.lidaEm ? instanteHoraBR(n.lidaEm) : 'não'), classe: 'tabular-nums' },
  ];
}
