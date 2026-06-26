import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { limparDocumento } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CriarTitularDto } from './dto/criar-titular.dto';
import { AtualizarTitularDto } from './dto/atualizar-titular.dto';
import { ListarTitularesDto } from './dto/listar-titulares.dto';
import {
  TitularApi,
  titularParaApi,
  mapearTipoPessoa,
  mapearStatusTitular,
} from './titular.mapper';

export interface ListaPaginada<T> {
  total: number;
  page: number;
  limit: number;
  data: T[];
}

@Injectable()
export class TitularService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarTitularDto): Promise<TitularApi> {
    const cpfCnpj = limparDocumento(dto.cpfCnpj);
    await this.garantirDocumentoLivre(cpfCnpj);

    const titular = await this.prisma.db.titular.create({
      data: {
        nome: dto.nome,
        tipoPessoa: mapearTipoPessoa.paraPrisma(dto.tipoPessoa),
        cpfCnpj,
        rg: dto.rg,
        estadoCivil: dto.estadoCivil,
        profissao: dto.profissao,
        whatsapp: dto.whatsapp,
        email: dto.email,
        endereco: dto.endereco,
        bairro: dto.bairro,
        cidade: dto.cidade,
        estado: dto.estado,
        cep: dto.cep,
      },
    });
    return titularParaApi(titular);
  }

  async listar(filtros: ListarTitularesDto): Promise<ListaPaginada<TitularApi>> {
    const where: Prisma.TitularWhereInput = {};
    if (filtros.nome) {
      where.nome = { contains: filtros.nome, mode: 'insensitive' };
    }
    if (filtros.cpfCnpj) {
      where.cpfCnpj = { contains: limparDocumento(filtros.cpfCnpj) };
    }
    if (filtros.status) {
      where.status = mapearStatusTitular.paraPrisma(filtros.status);
    }

    const [total, registros] = await Promise.all([
      this.prisma.db.titular.count({ where }),
      this.prisma.db.titular.findMany({
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
      data: registros.map(titularParaApi),
    };
  }

  async buscarPorId(id: string): Promise<TitularApi> {
    // findFirst (não findUnique) para que a extensão de soft delete filtre deletedAt.
    const titular = await this.prisma.db.titular.findFirst({ where: { id } });
    if (!titular) throw this.naoEncontrado();
    return titularParaApi(titular);
  }

  // Busca por CPF/CNPJ exato (item 2.1) — usada na originação para identificar
  // titular existente antes de criar. Retorna null quando não há cadastro ativo.
  async buscarPorDocumento(documento: string): Promise<TitularApi | null> {
    const cpfCnpj = limparDocumento(documento);
    const titular = await this.prisma.db.titular.findFirst({
      where: { cpfCnpj },
    });
    return titular ? titularParaApi(titular) : null;
  }

  async atualizar(id: string, dto: AtualizarTitularDto): Promise<TitularApi> {
    await this.garantirExiste(id);

    const data: Prisma.TitularUpdateInput = {
      nome: dto.nome,
      rg: dto.rg,
      estadoCivil: dto.estadoCivil,
      profissao: dto.profissao,
      whatsapp: dto.whatsapp,
      email: dto.email,
      endereco: dto.endereco,
      bairro: dto.bairro,
      cidade: dto.cidade,
      estado: dto.estado,
      cep: dto.cep,
    };
    if (dto.tipoPessoa) data.tipoPessoa = mapearTipoPessoa.paraPrisma(dto.tipoPessoa);
    if (dto.status) data.status = mapearStatusTitular.paraPrisma(dto.status);
    if (dto.cpfCnpj !== undefined) {
      const cpfCnpj = limparDocumento(dto.cpfCnpj);
      await this.garantirDocumentoLivre(cpfCnpj, id);
      data.cpfCnpj = cpfCnpj;
    }

    const titular = await this.prisma.db.titular.update({ where: { id }, data });
    return titularParaApi(titular);
  }

  async remover(id: string): Promise<void> {
    await this.garantirExiste(id);
    // Soft delete via extensão (preenche deletedAt).
    await this.prisma.db.titular.delete({ where: { id } });
  }

  // --- helpers ---

  private async garantirExiste(id: string): Promise<void> {
    // findFirst para respeitar o soft delete (um titular deletado não "existe").
    const existe = await this.prisma.db.titular.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw this.naoEncontrado();
  }

  private async garantirDocumentoLivre(
    cpfCnpj: string,
    ignorarId?: string,
  ): Promise<void> {
    // findUnique (vê deletados de propósito): a constraint UNIQUE de cpfCnpj vale
    // globalmente; um titular soft-deleted ainda ocupa o documento no banco.
    const existente = await this.prisma.db.titular.findUnique({
      where: { cpfCnpj },
      select: { id: true },
    });
    if (existente && existente.id !== ignorarId) {
      throw new ConflictException({
        erro: 'documento_duplicado',
        mensagem: 'Já existe um titular com este CPF/CNPJ',
      });
    }
  }

  private naoEncontrado(): NotFoundException {
    return new NotFoundException({
      erro: 'nao_encontrado',
      mensagem: 'Titular não encontrado',
    });
  }
}
