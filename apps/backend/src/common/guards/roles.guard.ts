import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleUsuario } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UsuarioAutenticado } from '../decorators/current-user.decorator';

// Autorização por interseção de roles (Doc 6 §7.3). Como as permissões se somam,
// basta o usuário ter ao menos um dos roles exigidos pela rota.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleUsuario[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Sem @Roles na rota → não exige role específico (basta estar autenticado).
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: UsuarioAutenticado }>();
    const temAlgum = !!user && requiredRoles.some((r) => user.roles.includes(r));
    if (!temAlgum) {
      throw new ForbiddenException({
        erro: 'acesso_negado',
        mensagem: 'Você não tem permissão para esta operação',
      });
    }
    return true;
  }
}
