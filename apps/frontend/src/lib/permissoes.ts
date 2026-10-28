import { useAuthStore } from '../stores/authStore';

// Permissões de UI por role (espelham os @Roles + alçadas do backend). Doc 6 §5/§6.
export const ROLE_OPERACAO = ['ADMIN', 'OPERADOR']; // cobrança, bloqueio, quitação, sinistro
export const ROLE_RENEGOCIACAO = ['ADMIN', 'OPERADOR', 'APROVADOR', 'DIRETOR'];
export const ROLE_NOVACAO = ['ADMIN', 'APROVADOR', 'DIRETOR']; // recuperação radical (mais sensível)
export const ROLE_REAJUSTE = ['ADMIN']; // ciclo gerar->aprovar->aplicar só fecha solo no ADMIN
export const ROLE_PARECER = ['ADMIN', 'APROVADOR', 'DIRETOR']; // análise de crédito (Bloco 7)

// Hook reativo: retorna uma função pode(rolesAlvo) -> boolean.
export function usePodeRole() {
  const roles = useAuthStore((s) => s.usuario?.roles ?? []);
  return (alvo: string[]) => alvo.some((r) => roles.includes(r));
}

// Mensagem amigável a partir de um erro de axios (403/alçada/etc).
// Erros com lista de itens (pacote mínimo incompleto — RF-22, 28/10) mostram
// o que falta, em vez de só o título.
export function mensagemErro(e: unknown): string {
  const err = e as { response?: { data?: { mensagem?: string; erro?: string; itens?: { item: string; ok: boolean }[] }; status?: number } };
  const itens = err?.response?.data?.itens;
  if (err?.response?.data?.mensagem && Array.isArray(itens) && itens.length) {
    return `${err.response.data.mensagem}:\n${itens.map((i) => `• ${i.item}`).join('\n')}`;
  }
  return (
    err?.response?.data?.mensagem ??
    (err?.response?.status === 403
      ? 'Sem permissão para esta operação'
      : err?.response?.status === 413
        ? 'Arquivo grande demais para enviar — reduza a foto ou o PDF (limite de 20 MB)'
        : 'Operação não permitida')
  );
}
