import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AreaSistema, mensagemSemAcessoArea } from '@azit/types';
import { useAuthStore } from '../stores/authStore';
import { usuarioService } from '../services/usuario.service';
import { toast } from '../components/Toast';

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

// ---------------------------------------------------------------------------
// Áreas de trabalho como AUTORIZAÇÃO (doc 06 §5.4 v1.1). As áreas do usuário
// vêm de GET /me/areas (matriz papel×área ± exceções, calculadas no backend por
// PermissoesService — nunca do token). UMA query, compartilhada pelo menu
// lateral, pelo roteador (RotaPorArea) e pelos links entre áreas.
// ---------------------------------------------------------------------------

export const QUERY_ME_AREAS = ['me-areas'] as const;

// Telas compartilhadas — os MESMOS conjuntos que o backend declara em
// common/decorators/area.decorator.ts (AREAS_CONTRATO / AREAS_FICHA_TITULAR).
// A primeira área é a dona (aparece na página "Sem acesso").
export const AREAS_ROTA_CONTRATO: AreaSistema[] = [AreaSistema.CONTRATOS, AreaSistema.CARTEIRA_COBRANCA, AreaSistema.COMERCIAL];
export const AREAS_ROTA_FICHA_TITULAR: AreaSistema[] = [AreaSistema.PESSOAS, AreaSistema.COMERCIAL];

export type AreaRota = AreaSistema | AreaSistema[];

export function useMinhasAreas() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const q = useQuery({
    queryKey: QUERY_ME_AREAS,
    queryFn: () => usuarioService.minhasAreas(),
    staleTime: 5 * 60_000,
    enabled: isAuthenticated,
  });
  return { areas: q.data as string[] | undefined, carregando: isAuthenticated && q.data === undefined && !q.isError, erro: q.isError };
}

export function temAlgumaArea(areas: string[] | undefined, alvo: AreaRota): boolean {
  if (!areas) return false;
  const lista = Array.isArray(alvo) ? alvo : [alvo];
  return lista.some((a) => areas.includes(a));
}

// Verdadeiro se o usuário tem (ao menos uma) área. Enquanto as áreas não
// chegaram, assume que tem: evita piscar links desabilitados — quem decide de
// verdade é o RotaPorArea (que espera carregar) e a API (403).
export function useTemArea(area: AreaRota): boolean {
  const { areas } = useMinhasAreas();
  if (!areas) return true;
  return temAlgumaArea(areas, area);
}

// Texto único para link/botão desabilitado por falta de área.
export function tituloSemArea(area: AreaRota): string {
  const dona = Array.isArray(area) ? area[0] : area;
  return `${mensagemSemAcessoArea(dona)} — peça ao administrador`;
}

// Para quem navega por código (linha de tabela, botão): navega se tem a área;
// se não tem, avisa em vez de abrir a tela e cair em "Sem acesso".
export function useIrParaArea() {
  const navigate = useNavigate();
  const { areas } = useMinhasAreas();
  return useCallback(
    (area: AreaRota, destino: string) => {
      if (areas && !temAlgumaArea(areas, area)) {
        toast.erro(tituloSemArea(area));
        return;
      }
      navigate(destino);
    },
    [areas, navigate],
  );
}

// Mensagem amigável a partir de um erro de axios (403/alçada/etc).
// Erros com lista de itens (pacote mínimo incompleto — RF-22, 28/10) mostram
// o que falta, em vez de só o título. 403 acesso_negado com `area` (doc 06 §7.5)
// vira "Sem acesso à área X — peça ao administrador".
export function mensagemErro(e: unknown): string {
  const err = e as {
    response?: {
      data?: { mensagem?: string; erro?: string; area?: string; itens?: { item: string; ok: boolean }[] };
      status?: number;
    };
  };
  const dados = err?.response?.data;
  if (err?.response?.status === 403 && dados?.erro === 'acesso_negado' && dados.area) {
    return tituloSemArea(dados.area as AreaSistema);
  }
  const itens = dados?.itens;
  if (dados?.mensagem && Array.isArray(itens) && itens.length) {
    return `${dados.mensagem}:\n${itens.map((i) => `• ${i.item}`).join('\n')}`;
  }
  return (
    dados?.mensagem ??
    (err?.response?.status === 403
      ? 'Sem permissão para esta operação'
      : err?.response?.status === 413
        ? 'Arquivo grande demais para enviar — reduza a foto ou o PDF (limite de 20 MB)'
        : 'Operação não permitida')
  );
}
