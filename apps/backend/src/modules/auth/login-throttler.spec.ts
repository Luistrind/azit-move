import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { JANELA_LIMITE_ENTRADA_MS, LIMITE_ENTRADA_POR_IP, MENSAGEM_FALHA_ENTRADA } from '@azit/utils';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginThrottlerGuard } from './login-throttler.guard';

// Limite por IP nas rotas de entrada (doc 06 §2.5, §11.3): e2e LEVE — sobe só o
// AuthController com o AuthService dublado, sem banco nem rede, e bate nas rotas
// com `inject` do Fastify. A 11ª tentativa no mesmo minuto recebe 429 no formato
// de erro do sistema; /auth/refresh não tem limite; IP diferente tem contador próprio.
describe('LoginThrottlerGuard (10 por minuto por IP)', () => {
  let app: NestFastifyApplication;
  const authService = {
    login: jest.fn(async () => { throw new UnauthorizedException({ erro: 'credenciais_invalidas', mensagem: MENSAGEM_FALHA_ENTRADA }); }),
    loginGoogle: jest.fn(async () => { throw new UnauthorizedException({ erro: 'credenciais_invalidas', mensagem: MENSAGEM_FALHA_ENTRADA }); }),
    refresh: jest.fn(async () => { throw new UnauthorizedException({ erro: 'refresh_invalido', mensagem: 'x' }); }),
    configPublica: async () => ({ googleClientId: null, senhaDisponivel: true }),
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'entrada', ttl: JANELA_LIMITE_ENTRADA_MS, limit: LIMITE_ENTRADA_POR_IP }] })],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }, LoginThrottlerGuard],
    }).compile();
    app = modulo.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const bater = (url: string, ip: string, payload: object) =>
    app.inject({ method: 'POST', url, payload, remoteAddress: ip, headers: { 'x-forwarded-for': ip } });

  it('login: 10 tentativas passam (401 genérico), a 11ª vira 429 no formato do sistema', async () => {
    for (let i = 0; i < LIMITE_ENTRADA_POR_IP; i++) {
      const r = await bater('/auth/login', '203.0.113.10', { email: 'a@azit.com.br', senha: 'x' });
      expect(r.statusCode).toBe(401);
    }
    const bloqueada = await bater('/auth/login', '203.0.113.10', { email: 'a@azit.com.br', senha: 'x' });
    expect(bloqueada.statusCode).toBe(429);
    expect(bloqueada.json()).toEqual({ erro: 'muitas_tentativas', mensagem: expect.stringContaining('Muitas tentativas') });
    expect(authService.login).toHaveBeenCalledTimes(LIMITE_ENTRADA_POR_IP);
  });

  it('outro IP tem contador próprio', async () => {
    const r = await bater('/auth/login', '203.0.113.11', { email: 'a@azit.com.br', senha: 'x' });
    expect(r.statusCode).toBe(401);
  });

  it('google: mesmo limite, contador separado do login', async () => {
    for (let i = 0; i < LIMITE_ENTRADA_POR_IP; i++) {
      const r = await bater('/auth/google', '203.0.113.10', { credential: 'c'.repeat(40) });
      expect(r.statusCode).toBe(401);
    }
    const bloqueada = await bater('/auth/google', '203.0.113.10', { credential: 'c'.repeat(40) });
    expect(bloqueada.statusCode).toBe(429);
  });

  it('refresh não tem limite por IP (renovação a cada 15 min de todo mundo atrás do mesmo NAT)', async () => {
    for (let i = 0; i < LIMITE_ENTRADA_POR_IP + 2; i++) {
      const r = await bater('/auth/refresh', '203.0.113.10', { refreshToken: 'abc' });
      expect(r.statusCode).toBe(401);
    }
  });
});
