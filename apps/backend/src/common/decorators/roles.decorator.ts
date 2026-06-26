import { SetMetadata } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';

// Exige ao menos um dos roles listados (interseção) — Doc 6 §7.3.
export const ROLES_KEY = 'roles';
export const Roles = (...roles: RoleUsuario[]) => SetMetadata(ROLES_KEY, roles);
