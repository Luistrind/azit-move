import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CriarInvestimentoDto, ListarInvestimentosDto } from './dto/investimento.dto';
import {
  ContratoInvestimentoApi,
  investimentoParaApi,
  modeloParaPrisma,
} from './investimento.mapper';

const reais = (c: number) => centavosParaReaisString(c);

@Injectable()
export class InvestimentoService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarInvestimentoDto): Promise<ContratoInvestimentoApi> {
    const conta = await this.prisma.db.conta.findFirst({
      where: { id: dto.contaId },
      select: { id: true },
    });
    if (!conta) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Conta não encontrada' });
    }

    const investimento = await this.prisma.db.$transaction(async (tx) => {
      // Número INV AAAAMM + sequência.
      const d = dto.dataAporte;
      const prefixo = `INV${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const count = await tx.contratoInvestimento.count({ where: { numero: { startsWith: prefixo } } });
      const numero = `${prefixo}${String(count + 1).padStart(4, '0')}`;
      return tx.contratoInvestimento.create({
        data: {
          numero,
          contaId: dto.contaId,
          modelo: modeloParaPrisma(dto.modelo),
          valorAportado: reais(dto.valorAportado),
          taxaRetorno: dto.taxaRetorno,
          dataAporte: dto.dataAporte,
          dataInicio: dto.dataInicio ?? dto.dataAporte,
          dataVencimento: dto.dataVencimento,
          status: 'ATIVO',
        },
      });
    });
    return investimentoParaApi(investimento);
  }

  async listar(filtros: ListarInvestimentosDto) {
    const where: Prisma.ContratoInvestimentoWhereInput = {};
    if (filtros.contaId) where.contaId = filtros.contaId;
    if (filtros.status) where.status = filtros.status === 'ativo' ? 'ATIVO' : 'ENCERRADO';

    const [total, registros] = await Promise.all([
      this.prisma.db.contratoInvestimento.count({ where }),
      this.prisma.db.contratoInvestimento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filtros.page - 1) * filtros.limit,
        take: filtros.limit,
        include: { conta: { include: { titular: { select: { nome: true, cpfCnpj: true } } } } },
      }),
    ]);
    return {
      total,
      page: filtros.page,
      limit: filtros.limit,
      data: registros.map((r) => ({
        ...investimentoParaApi(r),
        titular: r.conta.titular,
      })),
    };
  }

  async buscarPorId(id: string): Promise<ContratoInvestimentoApi> {
    const inv = await this.prisma.db.contratoInvestimento.findFirst({ where: { id } });
    if (!inv) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato de investimento não encontrado' });
    }
    return investimentoParaApi(inv);
  }

  // Visão consolidada da conta (api-spec §4.8): agrega os dois lados — crédito
  // (o que o titular deve) e investimento (o que a Azit lhe deve). O papel é
  // derivado do que a conta possui (Regra nº 8). Rendimento/breakdown do lado
  // investidor é PLACEHOLDER (fórmula do fundo — Sebastião).
  async visaoGeral(contaId: string) {
    const conta = await this.prisma.db.conta.findFirst({
      where: { id: contaId },
      include: { titular: { select: { id: true, nome: true, cpfCnpj: true } } },
    });
    if (!conta) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Conta não encontrada' });
    }

    const creditos = await this.prisma.db.contratoCredito.findMany({
      where: { contaId },
      select: { id: true },
    });
    const creditoIds = creditos.map((c) => c.id);
    const saldo = creditoIds.length
      ? await this.prisma.db.parcela.aggregate({
          where: { contratoId: { in: creditoIds }, status: null },
          _sum: { valorNominal: true },
        })
      : { _sum: { valorNominal: null } };

    const investimentos = await this.prisma.db.contratoInvestimento.findMany({ where: { contaId } });
    const capitalAportado = investimentos.reduce(
      (s, i) => s + Math.round(Number(i.valorAportado.toString()) * 100),
      0,
    );

    const temCredito = creditos.length > 0;
    const temInvestimento = investimentos.length > 0;

    return {
      conta: { id: conta.id, status: conta.status.toLowerCase() },
      titular: conta.titular,
      papeis: {
        cliente: temCredito,
        investidor: temInvestimento,
      },
      credito: {
        contratosAtivos: creditos.length,
        saldoDevedorTotal: saldo._sum.valorNominal
          ? Math.round(Number(saldo._sum.valorNominal.toString()) * 100)
          : 0,
      },
      investimento: {
        contratos: investimentos.length,
        capitalAportado,
        // PLACEHOLDER (fórmula do fundo — Sebastião):
        rendimentoAcumulado: null,
        breakdown: null,
      },
    };
  }

  async porTitular(titularId: string): Promise<ContratoInvestimentoApi[]> {
    const conta = await this.prisma.db.conta.findFirst({
      where: { titularId },
      select: { id: true },
    });
    if (!conta) return [];
    const invs = await this.prisma.db.contratoInvestimento.findMany({
      where: { contaId: conta.id },
      orderBy: { createdAt: 'desc' },
    });
    return invs.map(investimentoParaApi);
  }
}
