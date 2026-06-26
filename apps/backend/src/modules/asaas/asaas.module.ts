import { Global, Module } from '@nestjs/common';
import { AsaasService } from './asaas.service';

// AsaasModule global — o cliente é injetado pelos workers de cobrança/conciliação.
@Global()
@Module({
  providers: [AsaasService],
  exports: [AsaasService],
})
export class AsaasModule {}
