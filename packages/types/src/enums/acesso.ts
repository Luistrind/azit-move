// Entrada do usuário interno (doc 06 v1.1 §2.5, §9).
// Por onde a pessoa entrou — casa com o enum FormaAcesso do Prisma.
export enum FormaAcesso {
  GOOGLE = 'GOOGLE',
  SENHA = 'SENHA',
  REFRESH = 'REFRESH',
}

// Nomes por extenso em tela (Regra 9: nada de código interno em tela).
export const NOME_FORMA_ACESSO: Record<FormaAcesso, string> = {
  [FormaAcesso.GOOGLE]: 'Google',
  [FormaAcesso.SENHA]: 'Senha',
  [FormaAcesso.REFRESH]: 'Renovação de sessão',
};

export function nomeFormaAcesso(forma: string): string {
  return (NOME_FORMA_ACESSO as Record<string, string>)[forma] ?? forma;
}

// Resultado de uma tentativa, como a tela rotula (chave do mapa de cores).
export const ROTULO_RESULTADO_ACESSO = { sucesso: 'Entrou', falha: 'Falhou' } as const;

// Situação da entrada de um usuário (tela Usuários e permissões).
export const ROTULO_ENTRADA_USUARIO = {
  googleVinculado: 'Google vinculado',
  googlePendente: 'Google pendente',
  senhaLigada: 'Senha ligada',
  senhaDesligada: 'Senha desligada',
} as const;
