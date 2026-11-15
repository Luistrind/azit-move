import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { mensagemSemAcessoArea } from '@azit/types';
import { UsuarioAutenticado } from '../decorators/current-user.decorator';
import { PermissoesService } from '../../modules/permissoes/permissoes.service';
import { classificarRota } from './area.classificacao';

// Autorização por ÁREA de trabalho (doc 06 §5.4, §7.5 — v1.1). Guard global que
// roda depois do JwtAuthGuard (precisa de request.user) e antes do RolesGuard
// (dentro da área, ação sensível ainda pode exigir papel: os dois se somam).
//
// - @Public → não passa por aqui (não há usuário).
// - @AreaLivre → libera (apoio a qualquer autenticado, justificado no código).
// - @Area(a, b) → basta ter UMA; o 403 aponta a primeira (área dona).
// - Sem classificação → nega (fail-closed); o boot já derruba esse caso.
// - ADMIN não é curinga: valem as áreas que a matriz lhe dá. Áreas nunca vêm do
//   token — sempre de PermissoesService.areasEfetivas (banco + cache de 60 s).
@Injectable()
export class AreaGuard implements CanActivate {
  constructor(private readonly permissoes: PermissoesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const classificacao = classificarRota(context.getHandler(), context.getClass());
    if (classificacao?.tipo === 'publica' || classificacao?.tipo === 'livre') return true;
    if (!classificacao) {
      throw new ForbiddenException({ erro: 'acesso_negado', mensagem: 'Rota sem área classificada' });
    }

    const { user } = context.switchToHttp().getRequest<{ user?: UsuarioAutenticado }>();
    if (!user?.id) {
      throw new ForbiddenException({ erro: 'acesso_negado', mensagem: 'Usuário não identificado' });
    }
    const efetivas = await this.permissoes.areasEfetivas(user.id);
    if (classificacao.areas.some((a) => efetivas.has(a))) return true;

    const area = classificacao.areas[0];
    throw new ForbiddenException({ erro: 'acesso_negado', mensagem: mensagemSemAcessoArea(area), area });
  }
}
