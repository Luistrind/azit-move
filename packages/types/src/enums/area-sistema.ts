// Áreas de trabalho do sistema (doc 02 §16, doc 06 §5.4 v1.1).
// A área é a unidade de AUTORIZAÇÃO de acesso: cada módulo da API e cada rota da
// tela declaram a(s) sua(s); quem não tem a área recebe 403 acesso_negado, qualquer
// que seja o papel. Os valores casam com o enum AreaSistema do Prisma.
// Fonte única dos nomes legíveis (Regra 9: nada de código interno em tela).
export enum AreaSistema {
  COMERCIAL = 'COMERCIAL',
  FINANCEIRO_ADMINISTRATIVO = 'FINANCEIRO_ADMINISTRATIVO',
  ANALISE_CADASTRO = 'ANALISE_CADASTRO',
  CONTRATOS = 'CONTRATOS',
  CARTEIRA_COBRANCA = 'CARTEIRA_COBRANCA',
  PESSOAS = 'PESSOAS',
  ATIVOS_FROTA = 'ATIVOS_FROTA',
  CAPITAL_INVESTIMENTO = 'CAPITAL_INVESTIMENTO',
  PRODUTOS = 'PRODUTOS',
  APROVACOES = 'APROVACOES',
  CONFIGURACOES = 'CONFIGURACOES',
}

// Nomes por extenso em tela e em mensagens da API (decisão 2026-08, Luís).
export const NOME_AREA: Record<AreaSistema, string> = {
  [AreaSistema.COMERCIAL]: 'Comercial',
  [AreaSistema.FINANCEIRO_ADMINISTRATIVO]: 'Financeiro administrativo',
  [AreaSistema.ANALISE_CADASTRO]: 'Análise de cadastro',
  [AreaSistema.CONTRATOS]: 'Contratos',
  [AreaSistema.CARTEIRA_COBRANCA]: 'Carteira e cobrança',
  [AreaSistema.PESSOAS]: 'Pessoas',
  [AreaSistema.ATIVOS_FROTA]: 'Ativos e frota',
  [AreaSistema.CAPITAL_INVESTIMENTO]: 'Capital e investimento',
  [AreaSistema.PRODUTOS]: 'Produtos',
  [AreaSistema.APROVACOES]: 'Aprovações',
  [AreaSistema.CONFIGURACOES]: 'Configurações',
};

export function nomeArea(area: string): string {
  return (NOME_AREA as Record<string, string>)[area] ?? area;
}

// Mensagem padrão do 403 acesso_negado por área (doc 06 §7.5) — a mesma na API
// (AreaGuard) e na tela (interceptor do axios / página "Sem acesso").
export function mensagemSemAcessoArea(area: string): string {
  return `Sem acesso à área ${nomeArea(area)}`;
}
