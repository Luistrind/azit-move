import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { RoleUsuario } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ProdutoService } from './produto.service';
import { criarProdutoSchema, CriarProdutoBody, atualizarProdutoSchema, AtualizarProdutoBody } from './produto.dto';

@Controller('produtos')
export class ProdutoController {
  constructor(private readonly produto: ProdutoService) {}

  @Get()
  listar() {
    return this.produto.listar();
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Post()
  @HttpCode(201)
  criar(@Body(new ZodValidationPipe(criarProdutoSchema)) dto: CriarProdutoBody) {
    return this.produto.criar(dto);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Patch(':id')
  atualizar(@Param('id') id: string, @Body(new ZodValidationPipe(atualizarProdutoSchema)) dto: AtualizarProdutoBody) {
    return this.produto.atualizar(id, dto);
  }

  @Roles(RoleUsuario.ADMIN, RoleUsuario.OPERADOR)
  @Delete(':id')
  @HttpCode(204)
  async remover(@Param('id') id: string) {
    await this.produto.remover(id);
  }
}
