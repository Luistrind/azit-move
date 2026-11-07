import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { FipeService } from './fipe.service';

// Busca na Tabela FIPE para o veículo de REFERÊNCIA do atendimento (doc 02 §31.1):
// marca → modelo → ano → valor. Só leitura; o valor nunca é digitado.
@Controller('fipe')
export class FipeController {
  constructor(private readonly fipe: FipeService) {}

  // Lista curta do balcão (decisão Luís 03/11): só os modelos com que a
  // operação trabalha, versões de entrada, com todos os anos reunidos.
  @Get('modelos-trabalho')
  modelosTrabalho() {
    return this.fipe.modelosTrabalho();
  }

  @Get('modelos-trabalho/:chave/anos')
  anosTrabalho(@Param('chave') chave: string) {
    return this.fipe.anosTrabalho(chave);
  }

  @Get('marcas')
  marcas() {
    return this.fipe.marcas();
  }

  @Get('modelos')
  modelos(@Query('marca') marca?: string) {
    if (!marca) throw new BadRequestException({ erro: 'parametro_obrigatorio', mensagem: 'Informe a marca' });
    return this.fipe.modelos(marca);
  }

  @Get('anos')
  anos(@Query('marca') marca?: string, @Query('modelo') modelo?: string) {
    if (!marca || !modelo) throw new BadRequestException({ erro: 'parametro_obrigatorio', mensagem: 'Informe marca e modelo' });
    return this.fipe.anos(marca, modelo);
  }

  @Get('valor')
  valor(@Query('marca') marca?: string, @Query('modelo') modelo?: string, @Query('ano') ano?: string) {
    if (!marca || !modelo || !ano) throw new BadRequestException({ erro: 'parametro_obrigatorio', mensagem: 'Informe marca, modelo e ano' });
    return this.fipe.valorPorCodigos({ codigoMarca: marca, codigoModelo: modelo, ano });
  }
}
