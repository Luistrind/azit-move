import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { DatabaseModule } from '../../database/database.module';
import { PrismaService } from '../../database/prisma.service';
import { AsaasModule } from '../asaas/asaas.module';
import { CobrancaModule } from '../cobranca/cobranca.module';
import { FaturaService } from '../cobranca/fatura.service';
import { WebhookController } from '../cobranca/webhook.controller';
import { ContratoModule } from '../contrato/contrato.module';
import { FaturaPublicaController } from '../fatura-publica/fatura-publica.controller';
import { FaturaPublicaModule } from '../fatura-publica/fatura-publica.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PermissoesModule } from '../permissoes/permissoes.module';
import { QUEUE_NAMES } from '../queues/queues.module';
import { BaixaContaService } from './baixa-conta.service';
import { ContaFaturaService } from './conta-fatura.service';
import { FaturamentoController } from './faturamento.controller';
import { FaturamentoModule } from './faturamento.module';
import { GATEWAY_PIX } from './gateway-pix';
import { GatewayPixAsaas } from './gateway-pix-asaas';
import { IntencaoPagamentoProcessor } from './intencao-pagamento.processor';
import { IntencaoPagamentoService } from './intencao-pagamento.service';
import { PagamentoContaController } from './pagamento-conta.controller';
import { ParametrosFaturamentoService } from './parametros-faturamento.service';

// Compila os módulos da Fatura Azit F2 DE VERDADE (injeção do Nest), com banco e
// filas dublados, sem abrir conexão nem porta. Os specs unitários instanciam os
// serviços à mão e não enxergam provider faltando — foi assim que o backend
// deixou de subir no 1º deploy do bloco 2 do acesso (13/11/2026).
describe('Fatura Azit F2 — módulos (injeção de dependências)', () => {
  it('FaturamentoModule, CobrancaModule e FaturaPublicaModule compilam e resolvem tudo', async () => {
    let construtor = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ nodeEnv: 'test', ambiente: 'desenvolvimento', faturaPublicaUrl: 'http://localhost:3002', atendimentoWhatsapp: '' })] }),
        DatabaseModule,
        PermissoesModule,
        IntegracoesModule,
        AsaasModule,
        NotificacaoModule,
        ContratoModule,
        FaturamentoModule,
        CobrancaModule,
        FaturaPublicaModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ db: {} });
    // Filas: só o token — nada de Redis.
    for (const nome of Object.values(QUEUE_NAMES)) {
      construtor = construtor.overrideProvider(getQueueToken(nome)).useValue({ add: jest.fn() });
    }
    const modulo = await construtor.compile();

    expect(modulo.get(ParametrosFaturamentoService)).toBeInstanceOf(ParametrosFaturamentoService);
    expect(modulo.get(ContaFaturaService)).toBeInstanceOf(ContaFaturaService);
    expect(modulo.get(IntencaoPagamentoService)).toBeInstanceOf(IntencaoPagamentoService);
    expect(modulo.get(BaixaContaService)).toBeInstanceOf(BaixaContaService);
    expect(modulo.get(IntencaoPagamentoProcessor)).toBeInstanceOf(IntencaoPagamentoProcessor);
    // O gateway entra pela interface; hoje a implementação registrada é o Asaas.
    expect(modulo.get(GATEWAY_PIX)).toBeInstanceOf(GatewayPixAsaas);
    expect(modulo.get(FaturamentoController)).toBeInstanceOf(FaturamentoController);
    expect(modulo.get(PagamentoContaController)).toBeInstanceOf(PagamentoContaController);
    // Quem consome o módulo novo: fechamento (chave), webhook (intencao:) e página pública.
    expect(modulo.get(FaturaService)).toBeInstanceOf(FaturaService);
    expect(modulo.get(WebhookController)).toBeInstanceOf(WebhookController);
    expect(modulo.get(FaturaPublicaController)).toBeInstanceOf(FaturaPublicaController);
    await modulo.close();
  });
});
