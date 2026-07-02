// Roda UMA vez o mesmo fechamento D-5 do cron (fecha faturas vencendo + gera as
// cobranças no Asaas). Usado para testar o gatilho sem esperar o agendador das 3h.
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FaturaService } from '../src/modules/cobranca/fatura.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });
  const fatura = app.get(FaturaService);
  const r = await fatura.fechar();
  console.log(`>> Faturas fechadas: ${r.fechadas} — cobranças enfileiradas para o Asaas.`);
  // Dá tempo do worker de gerar-cobrança processar (cria a cobrança no Asaas).
  await new Promise((res) => setTimeout(res, 12000));
  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
