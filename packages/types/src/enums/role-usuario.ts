// Roles internos (RBAC) — Doc 5 §3 / Doc 6 §5.2.
// Um usuário acumula múltiplos roles (tabela de junção UsuarioRole). As permissões se somam.
// "Cliente" e "investidor" NÃO são roles: são papéis derivados do que a conta possui (Doc 6 §5.3).
// Os valores são SCREAMING_SNAKE para casar com o payload do JWT (Doc 6 §4).
export enum RoleUsuario {
  DIRETOR    = 'DIRETOR',
  ADMIN      = 'ADMIN',
  APROVADOR  = 'APROVADOR',
  OPERADOR   = 'OPERADOR',
  FINANCEIRO = 'FINANCEIRO',
}
