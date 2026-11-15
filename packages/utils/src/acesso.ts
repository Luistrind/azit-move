// Entrada do usuário interno (doc 06 v1.1 §2) — constantes e contas ÚNICAS
// (Regra 16) usadas pelo backend (AuthService, UsuariosController) e pela tela.

// Os dois domínios do Workspace são a MESMA caixa (domínio e alias): o vínculo
// entre a conta Google e o Usuario é pela parte local do e-mail (§2.1).
export const DOMINIOS_WORKSPACE = ['azit.com.br', 'azitmove.com.br'] as const;

// Limite por IP nas rotas de entrada (§2.5): 10 tentativas por minuto → 429.
export const LIMITE_ENTRADA_POR_IP = 10;
export const JANELA_LIMITE_ENTRADA_MS = 60_000;

// Bloqueio temporário por usuário, SÓ na entrada por senha (§2.5):
// 10 falhas seguidas → 15 minutos. Nunca revelado na resposta.
export const FALHAS_PARA_BLOQUEIO_SENHA = 10;
export const DURACAO_BLOQUEIO_SENHA_MS = 15 * 60_000;

// Senha de reserva, quando existe: mínimo 10 caracteres (§2.3).
export const SENHA_MINIMO_CARACTERES = 10;

// Mensagem ÚNICA de falha de entrada (§2.4, §11.3): não diz se foi o e-mail, a
// senha, a senha desligada, a conta fora do domínio ou o bloqueio.
export const MENSAGEM_FALHA_ENTRADA = 'Não foi possível entrar. Confira a conta usada ou fale com o administrador.';

// Quantos acessos a tela mostra por usuário ("últimos acessos").
export const LIMITE_ACESSOS_LISTADOS = 50;

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Parte local e domínio de um e-mail normalizado; null se não for e-mail.
export function partesEmail(email: string): { local: string; dominio: string } | null {
  const e = normalizarEmail(email);
  const arroba = e.lastIndexOf('@');
  if (arroba <= 0 || arroba === e.length - 1) return null;
  return { local: e.slice(0, arroba), dominio: e.slice(arroba + 1) };
}

export function ehDominioWorkspace(dominio: string): boolean {
  return (DOMINIOS_WORKSPACE as readonly string[]).includes(dominio.trim().toLowerCase());
}

export function ehEmailWorkspace(email: string): boolean {
  const p = partesEmail(email);
  return !!p && ehDominioWorkspace(p.dominio);
}

// Dois e-mails são a MESMA caixa do Workspace quando têm a mesma parte local e
// ambos os domínios estão em DOMINIOS_WORKSPACE (joao@azit.com.br ≡ joao@azitmove.com.br).
// Fora do Workspace, só a igualdade exata (normalizada) conta.
export function mesmaCaixaWorkspace(a: string, b: string): boolean {
  const pa = partesEmail(a);
  const pb = partesEmail(b);
  if (!pa || !pb) return false;
  if (pa.local !== pb.local) return false;
  if (pa.dominio === pb.dominio) return true;
  return ehDominioWorkspace(pa.dominio) && ehDominioWorkspace(pb.dominio);
}

// Todas as grafias com que o mesmo e-mail pode estar gravado no cadastro: para
// um e-mail do Workspace, a parte local em cada domínio; fora dele, só ele mesmo.
export function variantesEmailWorkspace(email: string): string[] {
  const p = partesEmail(email);
  if (!p) return [normalizarEmail(email)];
  if (!ehDominioWorkspace(p.dominio)) return [`${p.local}@${p.dominio}`];
  return DOMINIOS_WORKSPACE.map((d) => `${p.local}@${d}`);
}
