import { Module } from '@nestjs/common';
import { BigDataCorpService } from './bigdatacorp.service';
import { Camada1Service } from './camada1.service';

// Bureau de dados (doc 02 §20): provider BigDataCorp isolado + Camada 1.
@Module({
  providers: [BigDataCorpService, Camada1Service],
  exports: [BigDataCorpService, Camada1Service],
})
export class BureauModule {}
