import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { EmailModule } from './email.module';
import { EmailService } from './email.service';
import { EmailProcessor } from './email.processor';
import { TRANSPORTE_EMAIL, TransporteNaoConfigurado } from './transporte-email';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PermissoesModule } from '../permissoes/permissoes.module';
import { QUEUE_NAMES } from '../queues/queues.module';
import { DatabaseModule } from '../../database/database.module';
import { PrismaService } from '../../database/prisma.service';

// Lição dos blocos 1 e 2 (homolog 13/11): "testes verdes" com o service montado à
// mão não pegam dependência fora do módulo Nest. Este teste compila EmailModule
// (+ NotificacaoModule, que o processor injeta e que injeta o EmailService de
// volta — sem ciclo de módulo, os dois são @Global) pela injeção do Nest, com
// banco, fila e configuração dublados. Sem Redis, sem Postgres, sem porta.
describe('EmailModule (injeção de dependências)', () => {
  it('compila e resolve EmailService, EmailProcessor e o transporte', async () => {
    const modulo = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ email: { remetente: '', serviceAccountJson: '' }, appUrl: 'http://localhost:3000' })] }),
        DatabaseModule,
        PermissoesModule,
        EmailModule,
        NotificacaoModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ db: {} })
      .overrideProvider(getQueueToken(QUEUE_NAMES.EMAIL))
      .useValue({ add: jest.fn(), getJobs: jest.fn().mockResolvedValue([]) })
      .compile();

    expect(modulo.get(EmailService)).toBeInstanceOf(EmailService);
    expect(modulo.get(EmailProcessor)).toBeInstanceOf(EmailProcessor);
    // Sem EMAIL_REMETENTE/GOOGLE_SERVICE_ACCOUNT_JSON a fábrica entrega o "não configurado".
    expect(modulo.get(TRANSPORTE_EMAIL)).toBeInstanceOf(TransporteNaoConfigurado);
    await modulo.close();
  });
});
