import { SetMetadata } from '@nestjs/common';

// Marca uma rota como pública — dispensa o JwtAuthGuard global (Doc 6 §7.2).
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
