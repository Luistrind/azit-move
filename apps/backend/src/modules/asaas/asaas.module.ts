import { Global, Module } from '@nestjs/common';
import { AsaasService } from './asaas.service';
import { AsaasLeituraService } from './asaas-leitura.service';

// AsaasModule global — o cliente é injetado pelos workers de cobrança/conciliação.
@Global()
@Module({
  providers: [AsaasService, AsaasLeituraService],
  exports: [AsaasService, AsaasLeituraService],
})
export class AsaasModule {}
