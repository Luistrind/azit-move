import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { JANELA_LIMITE_ENTRADA_MS, LIMITE_ENTRADA_POR_IP } from '@azit/utils';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleIdTokenVerificador, VERIFICADOR_GOOGLE } from './google-verificador';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { ControleBloqueioSenha } from './bloqueio-senha';

// Autenticação do usuário interno (doc 06 v1.1): Google (caminho normal) e
// senha de reserva. O ThrottlerModule fica AQUI (não é global): só as rotas de
// entrada levam o LoginThrottlerGuard — 10 por minuto por IP (§2.5, §11.3).
// O AuthService é exportado porque Usuários e permissões usa "encerrar sessões"
// e "últimos acessos" (uma função só para a tela do Admin e a Minha conta).
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'entrada', ttl: JANELA_LIMITE_ENTRADA_MS, limit: LIMITE_ENTRADA_POR_IP }],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LoginThrottlerGuard,
    { provide: VERIFICADOR_GOOGLE, useClass: GoogleIdTokenVerificador },
    // Contador de bloqueio por senha (§2.5). Fábrica, não `useClass`: o construtor
    // recebe relógio e limites (injetáveis só nos testes), que o Nest não resolveria.
    // Faltou no 1º deploy do bloco 2 (homolog 13/11): o backend não subia por
    // dependência não resolvida — auth.module.spec.ts compila o módulo para pegar isso.
    { provide: ControleBloqueioSenha, useFactory: () => new ControleBloqueioSenha() },
  ],
  exports: [AuthService],
})
export class AuthModule {}
