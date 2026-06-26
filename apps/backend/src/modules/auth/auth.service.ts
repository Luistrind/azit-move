import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { RoleUsuario } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { JwtPayload } from './strategies/jwt.strategy';

export interface TokensResponse {
  accessToken: string;
  refreshToken: string;
  usuario: { id: string; nome: string; email: string; roles: RoleUsuario[] };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // Login interno (Doc 6 §2.2). Resposta genérica 401 em qualquer falha — não revela
  // se foi e-mail ou senha (Doc 6 §11.3).
  async login(email: string, senha: string): Promise<TokensResponse> {
    const usuario = await this.prisma.db.usuario.findUnique({
      where: { email },
      include: { roles: true },
    });

    const falhaGenerica = new UnauthorizedException({
      erro: 'credenciais_invalidas',
      mensagem: 'E-mail ou senha inválidos',
    });

    if (!usuario || !usuario.ativo) throw falhaGenerica;

    const senhaOk = await bcrypt.compare(senha, usuario.senhaHash);
    if (!senhaOk) throw falhaGenerica;

    const roles = usuario.roles.map((r) => r.role);
    return this.emitirTokens({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      roles,
    });
  }

  // Renovação com rotação (Doc 6 §3.3): valida o refresh, revoga-o e emite um novo par.
  async refresh(refreshToken: string): Promise<TokensResponse> {
    const registro = await this.prisma.db.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { usuario: { include: { roles: true } } },
    });

    if (
      !registro ||
      registro.revogado ||
      registro.expiraEm < new Date() ||
      !registro.usuario.ativo
    ) {
      throw new UnauthorizedException({
        erro: 'refresh_invalido',
        mensagem: 'Sessão expirada. Faça login novamente.',
      });
    }

    // Rotação: revoga o refresh usado.
    await this.prisma.db.refreshToken.update({
      where: { id: registro.id },
      data: { revogado: true },
    });

    const roles = registro.usuario.roles.map((r) => r.role);
    return this.emitirTokens({
      id: registro.usuario.id,
      nome: registro.usuario.nome,
      email: registro.usuario.email,
      roles,
    });
  }

  // Logout (Doc 6 §3.4): revoga o refresh atual. O access segue válido até expirar (≤15min).
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { token: refreshToken, revogado: false },
      data: { revogado: true },
    });
  }

  // Gera access token (JWT assinado) + refresh token (opaco, persistido e revogável).
  private async emitirTokens(usuario: {
    id: string;
    nome: string;
    email: string;
    roles: RoleUsuario[];
  }): Promise<TokensResponse> {
    const payload: JwtPayload = { sub: usuario.id, roles: usuario.roles };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
    });

    const refreshToken = randomBytes(48).toString('hex');
    const dias = this.config.get<number>('jwt.refreshExpiresInDays') ?? 7;
    const expiraEm = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

    await this.prisma.db.refreshToken.create({
      data: { usuarioId: usuario.id, token: refreshToken, expiraEm },
    });

    return { accessToken, refreshToken, usuario };
  }
}
