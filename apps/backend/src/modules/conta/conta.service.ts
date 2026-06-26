import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CriarContaDto } from './dto/criar-conta.dto';
import { AtualizarContaDto } from './dto/atualizar-conta.dto';
import { ContaApi, contaParaApi, mapearStatusConta } from './conta.mapper';

@Injectable()
export class ContaService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarContaDto): Promise<ContaApi> {
    // Titular precisa existir e não estar deletado (findFirst respeita soft delete).
    const titular = await this.prisma.db.titular.findFirst({
      where: { id: dto.titularId },
      select: { id: true },
    });
    if (!titular) {
      throw new NotFoundException({
        erro: 'nao_encontrado',
        mensagem: 'Titular não encontrado',
      });
    }

    // 1:1 — um titular tem no máximo uma conta (titularId @unique).
    const existente = await this.prisma.db.conta.findFirst({
      where: { titularId: dto.titularId },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException({
        erro: 'conta_existente',
        mensagem: 'Este titular já possui uma conta',
      });
    }

    const conta = await this.prisma.db.conta.create({
      data: { titularId: dto.titularId },
    });
    return contaParaApi(conta);
  }

  async buscarPorId(id: string): Promise<ContaApi> {
    const conta = await this.prisma.db.conta.findFirst({ where: { id } });
    if (!conta) throw this.naoEncontrada();
    return contaParaApi(conta);
  }

  async buscarPorTitular(titularId: string): Promise<ContaApi> {
    const conta = await this.prisma.db.conta.findFirst({ where: { titularId } });
    if (!conta) throw this.naoEncontrada();
    return contaParaApi(conta);
  }

  async atualizar(id: string, dto: AtualizarContaDto): Promise<ContaApi> {
    await this.garantirExiste(id);
    const conta = await this.prisma.db.conta.update({
      where: { id },
      data: { status: mapearStatusConta.paraPrisma(dto.status) },
    });
    return contaParaApi(conta);
  }

  private async garantirExiste(id: string): Promise<void> {
    const existe = await this.prisma.db.conta.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw this.naoEncontrada();
  }

  private naoEncontrada(): NotFoundException {
    return new NotFoundException({
      erro: 'nao_encontrado',
      mensagem: 'Conta não encontrada',
    });
  }
}
