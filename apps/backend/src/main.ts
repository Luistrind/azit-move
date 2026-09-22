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
    // bodyLimit: o padrão do Fastify é 1 MB — foto de celular em base64 passa disso e
    // voltava 413 sem mensagem ("Operação não permitida", caso real 22/09).
    new FastifyAdapter({ logger: true, bodyLimit: 30 * 1024 * 1024 }),
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
