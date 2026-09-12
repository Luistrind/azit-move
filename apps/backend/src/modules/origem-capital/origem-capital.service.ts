import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CriarOrigemCapitalDto } from './dto/criar-origem-capital.dto';
import { AtualizarOrigemCapitalDto } from './dto/atualizar-origem-capital.dto';
import {
  OrigemCapitalApi,
  origemCapitalParaApi,
  mapearOrigemCapitalEnums,
  valorAportadoParaPrisma,
} from './origem-capital.mapper';

@Injectable()
export class OrigemCapitalService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(
    ativoId: string,
    dto: CriarOrigemCapitalDto,
  ): Promise<OrigemCapitalApi> {
    await this.garantirAtivoExiste(ativoId);

    const existente = await this.prisma.db.origemCapital.findFirst({
      where: { ativoId },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException({
        erro: 'origem_capital_existente',
        mensagem: 'Este ativo já possui origem de capital registrada',
      });
    }

    // A origem ESPELHA a estrutura dona do ativo por construção (doc 02 §19,
    // 12/09): a estrutura é a origem do capital — fim do vínculo duplicado
    // sincronizado à mão.
    const donoAtivo = await this.prisma.db.ativo.findFirst({
      where: { id: ativoId },
      select: { estruturaJuridicaId: true },
    });

    const origem = await this.prisma.db.origemCapital.create({
      data: {
        ativoId,
        estruturaId: donoAtivo?.estruturaJuridicaId ?? null,
        tipo: mapearOrigemCapitalEnums.tipoParaPrisma(dto.tipo),
        contratoInvestimentoId: dto.contratoInvestimentoId,
        valorAportado: valorAportadoParaPrisma(dto.valorAportado),
        taxaRetorno: dto.taxaRetorno,
        dataAporte: dto.dataAporte,
      },
    });
    return origemCapitalParaApi(origem);
  }

  async buscarPorAtivo(ativoId: string): Promise<OrigemCapitalApi> {
    const origem = await this.prisma.db.origemCapital.findFirst({
      where: { ativoId },
    });
    if (!origem) throw this.naoEncontrada();
    return origemCapitalParaApi(origem);
  }

  async atualizar(
    ativoId: string,
    dto: AtualizarOrigemCapitalDto,
  ): Promise<OrigemCapitalApi> {
    const atual = await this.prisma.db.origemCapital.findFirst({
      where: { ativoId },
      select: { id: true },
    });
    if (!atual) throw this.naoEncontrada();

    const data: Prisma.OrigemCapitalUpdateInput = { dataAporte: dto.dataAporte };
    if (dto.status) data.status = mapearOrigemCapitalEnums.statusParaPrisma(dto.status);
    if (dto.valorAportado !== undefined) {
      data.valorAportado = valorAportadoParaPrisma(dto.valorAportado);
    }
    if (dto.taxaRetorno !== undefined) data.taxaRetorno = dto.taxaRetorno;

    const origem = await this.prisma.db.origemCapital.update({
      where: { id: atual.id },
      data,
    });
    return origemCapitalParaApi(origem);
  }

  private async garantirAtivoExiste(ativoId: string): Promise<void> {
    const ativo = await this.prisma.db.ativo.findFirst({
      where: { id: ativoId },
      select: { id: true },
    });
    if (!ativo) {
      throw new NotFoundException({
        erro: 'nao_encontrado',
        mensagem: 'Ativo não encontrado',
      });
    }
  }

  private naoEncontrada(): NotFoundException {
    return new NotFoundException({
      erro: 'nao_encontrado',
      mensagem: 'Origem de capital não encontrada',
    });
  }
}
