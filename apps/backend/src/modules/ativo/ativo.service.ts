import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CriarAtivoDto } from './dto/criar-ativo.dto';
import { AtualizarAtivoDto } from './dto/atualizar-ativo.dto';
import { ListarAtivosDto } from './dto/listar-ativos.dto';
import {
  AtivoApi,
  ativoParaApi,
  mapearAtivoEnums,
  valorAquisicaoParaPrisma,
} from './ativo.mapper';

export interface ListaPaginada<T> {
  total: number;
  page: number;
  limit: number;
  data: T[];
}

@Injectable()
export class AtivoService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarAtivoDto): Promise<AtivoApi> {
    if (dto.placa) await this.garantirPlacaLivre(dto.placa);
    if (dto.chassi) await this.garantirChassiLivre(dto.chassi);

    const ativo = await this.prisma.db.ativo.create({
      data: {
        tipo: mapearAtivoEnums.tipoParaPrisma(dto.tipo),
        descricao: dto.descricao,
        marca: dto.marca,
        modelo: dto.modelo,
        anoFabricacao: dto.anoFabricacao,
        anoModelo: dto.anoModelo,
        cor: dto.cor,
        placa: dto.placa,
        chassi: dto.chassi,
        renavam: dto.renavam,
        origem: dto.origem
          ? mapearAtivoEnums.origemParaPrisma(dto.origem)
          : undefined,
        combustivel: dto.combustivel
          ? mapearAtivoEnums.combustivelParaPrisma(dto.combustivel)
          : undefined,
        quilometragemEntrada: dto.quilometragemEntrada,
        valorAquisicao:
          dto.valorAquisicao !== undefined
            ? valorAquisicaoParaPrisma(dto.valorAquisicao)
            : undefined,
      },
    });
    return ativoParaApi(ativo);
  }

  async listar(filtros: ListarAtivosDto): Promise<ListaPaginada<AtivoApi>> {
    const where: Prisma.AtivoWhereInput = {};
    if (filtros.status) where.status = mapearAtivoEnums.statusParaPrisma(filtros.status);
    if (filtros.placa) where.placa = { contains: filtros.placa, mode: 'insensitive' };
    if (filtros.chassi) where.chassi = { contains: filtros.chassi, mode: 'insensitive' };

    const [total, registros] = await Promise.all([
      this.prisma.db.ativo.count({ where }),
      this.prisma.db.ativo.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filtros.page - 1) * filtros.limit,
        take: filtros.limit,
      }),
    ]);

    return {
      total,
      page: filtros.page,
      limit: filtros.limit,
      data: registros.map(ativoParaApi),
    };
  }

  async buscarPorId(id: string): Promise<AtivoApi> {
    const ativo = await this.prisma.db.ativo.findFirst({ where: { id } });
    if (!ativo) throw this.naoEncontrado();
    return ativoParaApi(ativo);
  }

  // Busca por chassi ou placa exatos (item 2.3). Um dos dois é obrigatório.
  async buscarPorIdentificador(params: {
    chassi?: string;
    placa?: string;
  }): Promise<AtivoApi> {
    if (!params.chassi && !params.placa) {
      throw new BadRequestException({
        erro: 'validacao',
        mensagem: 'Informe chassi ou placa',
      });
    }
    const where: Prisma.AtivoWhereInput = params.chassi
      ? { chassi: params.chassi }
      : { placa: params.placa };
    const ativo = await this.prisma.db.ativo.findFirst({ where });
    if (!ativo) throw this.naoEncontrado();
    return ativoParaApi(ativo);
  }

  async atualizar(id: string, dto: AtualizarAtivoDto): Promise<AtivoApi> {
    await this.garantirExiste(id);

    const data: Prisma.AtivoUpdateInput = {
      descricao: dto.descricao,
      marca: dto.marca,
      modelo: dto.modelo,
      anoFabricacao: dto.anoFabricacao,
      anoModelo: dto.anoModelo,
      cor: dto.cor,
      renavam: dto.renavam,
      quilometragemEntrada: dto.quilometragemEntrada,
    };
    if (dto.tipo) data.tipo = mapearAtivoEnums.tipoParaPrisma(dto.tipo);
    if (dto.status) data.status = mapearAtivoEnums.statusParaPrisma(dto.status);
    if (dto.origem !== undefined) {
      data.origem = dto.origem ? mapearAtivoEnums.origemParaPrisma(dto.origem) : null;
    }
    if (dto.combustivel !== undefined) {
      data.combustivel = dto.combustivel
        ? mapearAtivoEnums.combustivelParaPrisma(dto.combustivel)
        : null;
    }
    if (dto.valorAquisicao !== undefined) {
      data.valorAquisicao =
        dto.valorAquisicao === null
          ? null
          : valorAquisicaoParaPrisma(dto.valorAquisicao);
    }
    if (dto.placa !== undefined) {
      if (dto.placa) await this.garantirPlacaLivre(dto.placa, id);
      data.placa = dto.placa;
    }
    if (dto.chassi !== undefined) {
      if (dto.chassi) await this.garantirChassiLivre(dto.chassi, id);
      data.chassi = dto.chassi;
    }

    const ativo = await this.prisma.db.ativo.update({ where: { id }, data });
    return ativoParaApi(ativo);
  }

  async remover(id: string): Promise<void> {
    await this.garantirExiste(id);
    await this.prisma.db.ativo.delete({ where: { id } }); // soft delete
  }

  // --- helpers ---

  private async garantirExiste(id: string): Promise<void> {
    const existe = await this.prisma.db.ativo.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw this.naoEncontrado();
  }

  // findUnique vê deletados de propósito: placa/chassi são UNIQUE globais no banco.
  private async garantirPlacaLivre(placa: string, ignorarId?: string): Promise<void> {
    const existente = await this.prisma.db.ativo.findUnique({
      where: { placa },
      select: { id: true },
    });
    if (existente && existente.id !== ignorarId) {
      throw new ConflictException({
        erro: 'placa_duplicada',
        mensagem: 'Já existe um ativo com esta placa',
      });
    }
  }

  private async garantirChassiLivre(chassi: string, ignorarId?: string): Promise<void> {
    const existente = await this.prisma.db.ativo.findUnique({
      where: { chassi },
      select: { id: true },
    });
    if (existente && existente.id !== ignorarId) {
      throw new ConflictException({
        erro: 'chassi_duplicado',
        mensagem: 'Já existe um ativo com este chassi',
      });
    }
  }

  private naoEncontrado(): NotFoundException {
    return new NotFoundException({
      erro: 'nao_encontrado',
      mensagem: 'Ativo não encontrado',
    });
  }
}
