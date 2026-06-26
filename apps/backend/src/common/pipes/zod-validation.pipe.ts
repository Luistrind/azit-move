import { PipeTransform, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

// Pipe de validação com Zod (Doc 4 §4.3, §11.4). Aplicado por DTO via @UsePipes.
// Em erro, retorna 400 no formato da api-spec §5 (erro: "validacao", campos[]).
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          erro: 'validacao',
          mensagem: 'Dados inválidos na requisição',
          campos: e.errors.map((err) => ({
            campo: err.path.join('.'),
            mensagem: err.message,
          })),
        });
      }
      throw e;
    }
  }
}
