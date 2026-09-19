import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

// Bootstrap com Fastify (Doc 4 §4.2). Prefixo global api/v1, CORS restrito ao frontend.
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
    // Corpo cru disponível em req.rawBody: o webhook da Meta é autenticado por
    // HMAC do corpo EXATO recebido (X-Hub-Signature-256, doc 02 §23).
    { rawBody: true },
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3001);
  const frontendUrl = configService.get<string>('frontendUrl');

  // Métodos explícitos: o default do adapter não incluía PATCH/DELETE, e o
  // preflight do navegador bloqueava essas operações (curl não faz preflight).
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.setGlobalPrefix('api/v1');

  await app.listen(port, '0.0.0.0');
  console.log(`Backend rodando em http://localhost:${port}/api/v1`);
}

void bootstrap();
