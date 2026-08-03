import { api } from '../lib/api';

// Gestão de Usuários e Permissões por Área (doc 02 §16).
// Papel carrega as áreas do seu domínio (matriz papel×área); exceções por usuário ajustam.

export interface UsuarioInterno {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  papeis: string[];
  excecoes: ExcecaoArea[];
  areasEfetivas: string[];
}

export interface ExcecaoArea {
  area: string;
  concedida: boolean;
  motivo: string | null;
}

export interface MatrizPermissao {
  papeis: string[];
  areas: string[];
  celulas: { papel: string; area: string; permitido: boolean }[];
}

export interface PermissoesUsuario {
  papeis: string[];
  excecoes: ExcecaoArea[];
  areasDoPapel: string[];
  areasEfetivas: string[];
}

export const usuarioService = {
  async minhasAreas(): Promise<string[]> {
    const { data } = await api.get<{ areas: string[] }>('/api/v1/me/areas');
    return data.areas;
  },
  async listar(): Promise<UsuarioInterno[]> {
    const { data } = await api.get<UsuarioInterno[]>('/api/v1/usuarios');
    return data;
  },
  async criar(body: { nome: string; email: string; senha: string; papeis: string[] }) {
    const { data } = await api.post<{ id: string }>('/api/v1/usuarios', body);
    return data;
  },
  async atualizar(id: string, body: { nome?: string; ativo?: boolean; papeis?: string[] }) {
    const { data } = await api.patch(`/api/v1/usuarios/${id}`, body);
    return data;
  },
  async redefinirSenha(id: string, senha: string) {
    const { data } = await api.post(`/api/v1/usuarios/${id}/senha`, { senha });
    return data;
  },
  async matriz(): Promise<MatrizPermissao> {
    const { data } = await api.get<MatrizPermissao>('/api/v1/permissoes/matriz');
    return data;
  },
  async salvarCelula(body: { papel: string; area: string; permitido: boolean }) {
    const { data } = await api.put('/api/v1/permissoes/matriz', body);
    return data;
  },
  async permissoes(id: string): Promise<PermissoesUsuario> {
    const { data } = await api.get<PermissoesUsuario>(`/api/v1/usuarios/${id}/permissoes`);
    return data;
  },
  async definirExcecao(id: string, body: { area: string; concedida: boolean | null; motivo?: string }) {
    const { data } = await api.put(`/api/v1/usuarios/${id}/permissoes`, body);
    return data;
  },
};

// Nomes por extenso em tela — nunca siglas/códigos internos (decisão 2026-08, Luís).
export const NOME_AREA: Record<string, string> = {
  COMERCIAL: 'Comercial',
  FINANCEIRO_ADMINISTRATIVO: 'Financeiro administrativo',
  ANALISE_CADASTRO: 'Análise de cadastro',
  CONTRATOS: 'Contratos',
  CARTEIRA_COBRANCA: 'Carteira e cobrança',
  PESSOAS: 'Pessoas',
  ATIVOS_FROTA: 'Ativos e frota',
  CAPITAL_INVESTIMENTO: 'Capital e investimento',
  PRODUTOS: 'Produtos',
  APROVACOES: 'Aprovações',
  CONFIGURACOES: 'Configurações',
};

export const NOME_PAPEL: Record<string, string> = {
  ADMIN: 'Administrador',
  DIRETOR: 'Diretor',
  APROVADOR: 'Aprovador',
  OPERADOR: 'Operador',
  FINANCEIRO: 'Financeiro',
};

export function nomeArea(area: string): string {
  return NOME_AREA[area] ?? area;
}
export function nomePapel(papel: string): string {
  return NOME_PAPEL[papel] ?? papel;
}
