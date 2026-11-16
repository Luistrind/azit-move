import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { DatabaseModule } from '../../database/database.module';
import { PrismaService } from '../../database/prisma.service';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { AsaasModule } from '../asaas/asaas.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PermissoesModule } from '../permissoes/permissoes.module';
import { QUEUE_NAMES } from '../queues/queues.module';
import { WhatsappModule } from './whatsapp.module';
import { WhatsappEnvioService } from './whatsapp-envio.service';
import { WhatsappEventosService } from './whatsapp-eventos.service';
import { WhatsappProcessor } from './whatsapp.processor';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappConfigController } from './whatsapp-config.controller';
import { LembreteService } from './lembrete.service';
import { LembreteController } from './lembrete.controller';

// Compila o WhatsappModule de verdade (DI do Nest), com banco dublado, fila
// dublada e configuração mínima — sem abrir conexão nem porta. Os testes
// unitários instanciam os serviços à mão e não veem provedor faltando no
// módulo (regressão do 1º deploy do bloco 2 do doc 06, 13/11).
describe('WhatsappModule (injeção de dependências)', () => {
  it('compila e resolve serviços, controllers e o consumidor da fila', async () => {
    const modulo = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ ambiente: 'desenvolvimento', faturaPublicaUrl: 'http://localhost:3002' })],
        }),
        DatabaseModule,
        PermissoesModule,
        NotificacaoModule,
        IntegracoesModule,
        AsaasModule,
        WhatsappModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ db: {} })
      .overrideProvider(getQueueToken(QUEUE_NAMES.WHATSAPP))
      .useValue({ add: jest.fn() })
      .compile();

    expect(modulo.get(WhatsappEnvioService)).toBeInstanceOf(WhatsappEnvioService);
    expect(modulo.get(WhatsappEventosService)).toBeInstanceOf(WhatsappEventosService);
    expect(modulo.get(WhatsappProcessor)).toBeInstanceOf(WhatsappProcessor);
    expect(modulo.get(WhatsappWebhookController)).toBeInstanceOf(WhatsappWebhookController);
    expect(modulo.get(WhatsappConfigController)).toBeInstanceOf(WhatsappConfigController);
    expect(modulo.get(LembreteService)).toBeInstanceOf(LembreteService);
    expect(modulo.get(LembreteController)).toBeInstanceOf(LembreteController);
    await modulo.close();
  });
});
