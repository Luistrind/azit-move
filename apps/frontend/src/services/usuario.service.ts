import { api } from '../lib/api';
import type { AcessoRegistrado } from './auth.service';

// Gestão de Usuários e Permissões por Área (doc 02 §16).
// Papel carrega as áreas do seu domínio (matriz papel×área); exceções por usuário ajustam.
// Entrada (doc 06 v1.1 §2): Google é a porta normal; senha é reserva ligada por usuário.

export interface UsuarioInterno {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  papeis: string[];
  excecoes: ExcecaoArea[];
  areasEfetivas: string[];
  permiteSenha: boolean;
  temSenha: boolean;
  googleVinculado: boolean;
  ultimoAcessoEm: string | null;
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
  // Preferências de interface do próprio usuário (ordem dos cards do Início).
  async minhasPreferencias(): Promise<{ ordemInicio?: string[] }> {
    const { data } = await api.get<{ ordemInicio?: string[] }>('/api/v1/me/preferencias');
    return data;
  },
  async salvarPreferencias(prefs: { ordemInicio?: string[] }): Promise<void> {
    await api.put('/api/v1/me/preferencias', prefs);
  },
  async listar(): Promise<UsuarioInterno[]> {
    const { data } = await api.get<UsuarioInterno[]>('/api/v1/usuarios');
    return data;
  },
  // Senha só vai quando o Admin liga "permite senha" na criação (doc 06 §2.3).
  async criar(body: { nome: string; email: string; papeis: string[]; permiteSenha: boolean; senha?: string }) {
    const { data } = await api.post<{ id: string }>('/api/v1/usuarios', body);
    return data;
  },
  async atualizar(id: string, body: { nome?: string; ativo?: boolean; papeis?: string[] }) {
    const { data } = await api.patch(`/api/v1/usuarios/${id}`, body);
    return data;
  },
  // Exclusão lógica (só administrador): acesso cortado na hora, histórico preservado.
  async excluir(id: string) {
    const { data } = await api.delete(`/api/v1/usuarios/${id}`);
    return data;
  },
  async redefinirSenha(id: string, senha: string) {
    const { data } = await api.post(`/api/v1/usuarios/${id}/senha`, { senha });
    return data;
  },
  // Liga/desliga a entrada por senha — só Admin, motivo obrigatório, auditado.
  async definirPermiteSenha(id: string, body: { permiteSenha: boolean; motivo: string }) {
    const { data } = await api.patch<{ resultado: string; permiteSenha: boolean; temSenha: boolean }>(`/api/v1/usuarios/${id}/permite-senha`, body);
    return data;
  },
  // Zera o vínculo com a conta Google (e-mail recriado no Workspace) — só Admin.
  async religarGoogle(id: string) {
    const { data } = await api.post(`/api/v1/usuarios/${id}/religar-google`);
    return data;
  },
  // Revoga todas as sessões do usuário (cai em até 15 min em todo dispositivo).
  async encerrarSessoes(id: string) {
    const { data } = await api.post<{ encerradas: number }>(`/api/v1/usuarios/${id}/encerrar-sessoes`);
    return data;
  },
  async acessos(id: string) {
    const { data } = await api.get<{ acessos: AcessoRegistrado[]; sessoesAtivas: number }>(`/api/v1/usuarios/${id}/acessos`);
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
// Fonte única em @azit/types: a API usa os mesmos nomes no 403 por área (doc 06 §7.5).
export { NOME_AREA, nomeArea } from '@azit/types';

export const NOME_PAPEL: Record<string, string> = {
  ADMIN: 'Administrador',
  DIRETOR: 'Diretor',
  APROVADOR: 'Aprovador',
  OPERADOR: 'Operador',
  FINANCEIRO: 'Financeiro',
};

export function nomePapel(papel: string): string {
  return NOME_PAPEL[papel] ?? papel;
}
