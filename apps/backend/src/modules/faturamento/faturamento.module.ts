import { Module } from '@nestjs/common';
import { FaturamentoController } from './faturamento.controller';
import { ParametrosFaturamentoService } from './parametros-faturamento.service';

// Fatura Azit F2 (doc 02 §32): parâmetros de faturamento, motor da conta,
// intenção de pagamento (Pix sob demanda) e baixa pela conta. Não importa o
// CobrancaModule (que importa este) — sem ciclo.
@Module({
  controllers: [FaturamentoController],
  providers: [ParametrosFaturamentoService],
  exports: [ParametrosFaturamentoService],
})
export class FaturamentoModule {}
