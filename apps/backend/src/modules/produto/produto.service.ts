import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, NaturezaProduto, Credor, Periodicidade } from '@prisma/client';
import { centavosParaReaisString, reaisParaCentavos } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';

const cent = (d: Prisma.Decimal | null): number => (d !== null ? reaisParaCentavos(d.toString()) : 0);

export interface CriarProdutoDto {
  nome: string;
  natureza: 'parcelado' | 'recorrente';
  credorPadrao?: 'azit' | 'investidor' | 'terceiro';
  apartado?: boolean;
  valorPadrao?: number; // centavos
  periodicidade?: 'semanal' | 'quinzenal' | 'mensal';
  ancora?: boolean;
}

// 4.8 / §9 — Catálogo de Produtos. CRUD do que a Azit oferece (parcelamento, seguro,
// rastreador, taxa, crédito avulso). `apartado` = exige contrato próprio.
@Injectable()
export class ProdutoService {
  constructor(private readonly prisma: PrismaService) {}

  private api(p: {
    id: string; nome: string; natureza: NaturezaProduto; credorPadrao: Credor; apartado: boolean;
    valorPadrao: Prisma.Decimal | null; periodicidade: Periodicidade | null; ancora: boolean; ativo: boolean;
  }) {
    return {
      id: p.id,
      nome: p.nome,
      natureza: p.natureza.toLowerCase(),
      credorPadrao: p.credorPadrao.toLowerCase(),
      apartado: p.apartado,
      valorPadrao: p.valorPadrao !== null ? cent(p.valorPadrao) : null,
      periodicidade: p.periodicidade ? p.periodicidade.toLowerCase() : null,
      ancora: p.ancora,
      ativo: p.ativo,
    };
  }

  async listar() {
    const ps = await this.prisma.db.produto.findMany({ orderBy: [{ ancora: 'desc' }, { nome: 'asc' }] });
    return ps.map((p) => this.api(p));
  }

  async criar(dto: CriarProdutoDto) {
    const p = await this.prisma.db.produto.create({
      data: {
        nome: dto.nome,
        natureza: dto.natureza.toUpperCase() as NaturezaProduto,
        credorPadrao: (dto.credorPadrao ?? 'azit').toUpperCase() as Credor,
        apartado: dto.apartado ?? false,
        valorPadrao: dto.valorPadrao !== undefined ? centavosParaReaisString(dto.valorPadrao) : null,
        periodicidade: dto.periodicidade ? (dto.periodicidade.toUpperCase() as Periodicidade) : null,
        ancora: dto.ancora ?? false,
      },
    });
    return this.api(p);
  }

  async atualizar(
    id: string,
    dto: {
      nome?: string;
      natureza?: 'parcelado' | 'recorrente';
      credorPadrao?: 'azit' | 'investidor' | 'terceiro';
      apartado?: boolean;
      valorPadrao?: number | null;
      periodicidade?: 'semanal' | 'quinzenal' | 'mensal' | null;
      ancora?: boolean;
      ativo?: boolean;
    },
  ) {
    await this.garantir(id);
    const data: Prisma.ProdutoUpdateInput = { nome: dto.nome, apartado: dto.apartado, ancora: dto.ancora, ativo: dto.ativo };
    if (dto.natureza) data.natureza = dto.natureza.toUpperCase() as NaturezaProduto;
    if (dto.credorPadrao) data.credorPadrao = dto.credorPadrao.toUpperCase() as Credor;
    if (dto.periodicidade !== undefined) data.periodicidade = dto.periodicidade ? (dto.periodicidade.toUpperCase() as Periodicidade) : null;
    if (dto.valorPadrao !== undefined) data.valorPadrao = dto.valorPadrao !== null ? centavosParaReaisString(dto.valorPadrao) : null;
    const p = await this.prisma.db.produto.update({ where: { id }, data });
    return this.api(p);
  }

  async remover(id: string) {
    await this.garantir(id);
    await this.prisma.db.produto.delete({ where: { id } });
  }

  private async garantir(id: string) {
    const p = await this.prisma.db.produto.findFirst({ where: { id }, select: { id: true } });
    if (!p) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Produto não encontrado' });
  }
}
