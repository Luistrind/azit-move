import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { RoleUsuario } from '@prisma/client';
import { UsuarioAutenticado } from '../../../common/decorators/current-user.decorator';

// Payload do access token interno (Doc 6 §4).
export interface JwtPayload {
  sub: string;
  roles: RoleUsuario[];
  iat?: number;
  exp?: number;
}

// Valida o access token e popula request.user (Doc 6 §7.1).
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret') as string,
    });
  }

  // O retorno vira request.user. Não consultamos o banco aqui — autorização grossa
  // vem do token; limites de alçada são consultados no banco no momento da operação (Doc 6 §4.1).
  validate(payload: JwtPayload): UsuarioAutenticado {
    return { id: payload.sub, roles: payload.roles ?? [] };
  }
}
