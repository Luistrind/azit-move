import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';

// Identidade autenticada, populada pela JwtStrategy em request.user (Doc 6 §4, §7.1).
export interface UsuarioAutenticado {
  id: string;
  roles: RoleUsuario[];
}

// Injeta o usuário autenticado no handler: @CurrentUser() user: UsuarioAutenticado
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsuarioAutenticado => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as UsuarioAutenticado;
  },
);
