import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificacaoModule } from './notificacao.module';
import { NotificacaoService } from './notificacao.service';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { PermissoesModule } from '../permissoes/permissoes.module';
import { QUEUE_NAMES } from '../queues/queues.module';
import { DatabaseModule } from '../../database/database.module';
import { PrismaService } from '../../database/prisma.service';

// NotificacaoService passou a depender de EmailService e ConfigService (ponte do
// e-mail, doc 06 §12). Compila o módulo pela injeção do Nest — como a AppModule
// faz — e confere que o boot registra a origem 'notificacao' no serviço de e-mail.
describe('NotificacaoModule (injeção de dependências)', () => {
  it('compila, resolve o NotificacaoService e registra a origem do e-mail no init', async () => {
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
      .useValue({ db: {}, $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(getQueueToken(QUEUE_NAMES.EMAIL))
      .useValue({ add: jest.fn(), getJobs: jest.fn().mockResolvedValue([]) })
      .compile();

    const service = modulo.get(NotificacaoService);
    expect(service).toBeInstanceOf(NotificacaoService);
    service.onModuleInit();
    expect(modulo.get(EmailService).ganchos('notificacao')).toBeDefined();
    await modulo.close();
  });
});
