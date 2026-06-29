import { useAuthStore } from '../stores/authStore';

// Permissões de UI por role (espelham os @Roles + alçadas do backend). Doc 6 §5/§6.
export const ROLE_OPERACAO = ['ADMIN', 'OPERADOR']; // cobrança, bloqueio, quitação, sinistro
export const ROLE_RENEGOCIACAO = ['ADMIN', 'OPERADOR', 'APROVADOR', 'DIRETOR'];
export const ROLE_REAJUSTE = ['ADMIN']; // ciclo gerar->aprovar->aplicar só fecha solo no ADMIN

// Hook reativo: retorna uma função pode(rolesAlvo) -> boolean.
export function usePodeRole() {
  const roles = useAuthStore((s) => s.usuario?.roles ?? []);
  return (alvo: string[]) => alvo.some((r) => roles.includes(r));
}

// Mensagem amigável a partir de um erro de axios (403/alçada/etc).
export function mensagemErro(e: unknown): string {
  const err = e as { response?: { data?: { mensagem?: string; erro?: string }; status?: number } };
  return (
    err?.response?.data?.mensagem ??
    (err?.response?.status === 403 ? 'Sem permissão para esta operação' : 'Operação não permitida')
  );
}
