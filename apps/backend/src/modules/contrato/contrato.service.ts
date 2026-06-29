import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  StatusParcela as StatusParcelaPrisma,
  StatusContratoCredito as StatusContratoCreditoPrisma,
} from '@prisma/client';
import { StatusContratoCredito, Credor } from '@azit/types';
import { gerarCronograma, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CriarContratoDto } from './dto/criar-contrato.dto';
import { ListarContratosDto } from './dto/listar-contratos.dto';
import {
  ContratoApi,
  contratoParaApi,
  parcelaParaApi,
  periodicidadeParaPrisma,
  chavePrisma,
} from './contrato.mapper';

// Status de parcela que contam como "paga".
const PARCELA_PAGA: StatusParcelaPrisma[] = [
  'PAGA',
  'PAGA_EM_ATRASO',
  'PAGA_ANTECIPADA',
];

const reais = (centavos: number) => centavosParaReaisString(centavos);

@Injectable()
export class ContratoService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(
    dto: CriarContratoDto,
    statusInicial: StatusContratoCreditoPrisma = 'ATIVO',
  ): Promise<ContratoApi & { totalParcelasGeradas: number }> {
    // Pré-condições (fora da transação, leituras).
    const conta = await this.prisma.db.conta.findFirst({
      where: { id: dto.contaId },
      select: { id: true },
    });
    if (!conta) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Conta não encontrada' });

    const ativo = await this.prisma.db.ativo.findFirst({
      where: { id: dto.ativoId },
      select: { id: true },
    });
    if (!ativo) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Ativo não encontrado' });

    // Regra "1 ativo = 1 contrato ATIVO" (Doc 2 §4.4): bloqueia só se já houver um
    // contrato NÃO-terminal. Contratos liquidados/quitados/cancelados liberam o ativo
    // (ex: novação gera um contrato novo sobre o mesmo ativo).
    const jaContratado = await this.prisma.db.contratoCredito.findFirst({
      where: {
        ativoId: dto.ativoId,
        status: {
          notIn: [
            'LIQUIDADO_POR_NOVACAO',
            'CANCELADO',
            'RESCINDIDO',
            'QUITADO_AGUARDANDO_TRANSFERENCIA',
            'QUITADO_TRANSFERENCIA_EFETIVADA',
          ],
        },
      },
      select: { id: true },
    });
    if (jaContratado) {
      throw new ConflictException({
        erro: 'ativo_indisponivel',
        mensagem: 'Ativo já vinculado a um contrato de crédito ativo',
      });
    }

    // Recebível exige a OrigemCapital do ativo (origemCapitalId é obrigatório).
    const origemCapital = await this.prisma.db.origemCapital.findFirst({
      where: { ativoId: dto.ativoId },
      select: { id: true },
    });
    if (!origemCapital) {
      throw new UnprocessableEntityException({
        erro: 'origem_capital_ausente',
        mensagem: 'O ativo não possui origem de capital — necessária para gerar os recebíveis',
      });
    }

    const saldoDevedor = dto.valorTotal - dto.valorEntrada;
    if (saldoDevedor < 0) {
      throw new BadRequestException({
        erro: 'validacao',
        mensagem: 'Entrada não pode ser maior que o valor total',
      });
    }

    // Cronograma (puro, em centavos).
    const cronograma = gerarCronograma({
      numeroParcelas: dto.numeroParcelas,
      valorParcela: dto.valorParcelaInicial,
      valorTotal: saldoDevedor,
      dataPrimeiraParcela: dto.dataPrimeiraParcela,
      periodicidade: dto.periodicidade,
    });

    const periodicidadePrisma = periodicidadeParaPrisma(dto.periodicidade);
    const credorPrisma = chavePrisma(Credor, dto.credor) as
      | 'AZIT'
      | 'INVESTIDOR'
      | 'TERCEIRO';

    const contrato = await this.prisma.db.$transaction(async (tx) => {
      // Número AAAAMMNNNN — sequência por mês da assinatura (Doc 2 §4.7).
      let numero = dto.numero;
      if (!numero) {
        const ano = dto.dataAssinatura.getUTCFullYear();
        const mes = String(dto.dataAssinatura.getUTCMonth() + 1).padStart(2, '0');
        const prefixo = `${ano}${mes}`;
        const count = await tx.contratoCredito.count({
          where: { numero: { startsWith: prefixo } },
        });
        numero = `${prefixo}${String(count + 1).padStart(4, '0')}`;
      }

      const criado = await tx.contratoCredito.create({
        data: {
          numero,
          contaId: dto.contaId,
          ativoId: dto.ativoId,
          dataAssinatura: dto.dataAssinatura,
          dataPrimeiraParcela: dto.dataPrimeiraParcela,
          valorTotal: reais(dto.valorTotal),
          valorEntrada: reais(dto.valorEntrada),
          saldoDevedor: reais(saldoDevedor),
          numeroParcelas: dto.numeroParcelas,
          valorParcelaInicial: reais(dto.valorParcelaInicial),
          periodicidade: periodicidadePrisma,
          indiceReajuste: dto.indiceReajuste,
          taxaMultaAtraso: dto.taxaMultaAtraso,
          taxaJurosAtraso: dto.taxaJurosAtraso,
          taxaDescontoQuitacao: dto.taxaDescontoQuitacao,
          status: statusInicial,
        },
      });

      // Regra de estoque (Doc 2 §4.4): o ativo passa a EM_CONTRATO — sai do estoque
      // disponível para novas simulações.
      await tx.ativo.update({
        where: { id: dto.ativoId },
        data: { status: 'EM_CONTRATO' },
      });

      // Item âncora de financiamento (parcelado) — dono das parcelas do cronograma.
      const itemFinanciamento = await tx.itemContratado.create({
        data: {
          contratoId: criado.id,
          descricao: dto.descricaoFinanciamento,
          natureza: 'PARCELADO',
          origem: 'VENDA',
          credor: credorPrisma,
          credorId: dto.credorId,
          valor: reais(saldoDevedor),
          numeroParcelas: dto.numeroParcelas,
          periodicidade: periodicidadePrisma,
          dataInicio: dto.dataPrimeiraParcela,
        },
      });

      // Itens recorrentes (proteção/taxa) — sem parcelas (cobrados em fatura, Bloco 4).
      for (const r of dto.itensRecorrentes ?? []) {
        await tx.itemContratado.create({
          data: {
            contratoId: criado.id,
            descricao: r.descricao,
            natureza: 'RECORRENTE',
            origem: 'VENDA',
            credor: chavePrisma(Credor, r.credor) as
              | 'AZIT'
              | 'INVESTIDOR'
              | 'TERCEIRO',
            credorId: r.credorId,
            valor: reais(r.valor),
            periodicidade: r.periodicidade ? periodicidadeParaPrisma(r.periodicidade) : null,
            dataInicio: dto.dataPrimeiraParcela,
            dataFim: r.dataFim,
          },
        });
      }

      // Parcelas — maior insert do contrato, em createMany (Doc 5 §11.3).
      await tx.parcela.createMany({
        data: cronograma.map((p) => ({
          contratoId: criado.id,
          itemContratadoId: itemFinanciamento.id,
          numero: p.numero,
          totalParcelas: p.totalParcelas,
          display: p.display,
          valorNominal: reais(p.valorNominal),
          dataVencimento: p.dataVencimento,
        })),
      });

      // Recebíveis — um por parcela (estado esperado). Breakdown fica null (placeholder).
      const parcelasCriadas = await tx.parcela.findMany({
        where: { contratoId: criado.id },
        select: { id: true, numero: true },
      });
      const porNumero = new Map(cronograma.map((p) => [p.numero, p]));
      await tx.recebivel.createMany({
        data: parcelasCriadas.map((pc) => {
          const cron = porNumero.get(pc.numero)!;
          return {
            contratoId: criado.id,
            parcelaId: pc.id,
            origemCapitalId: origemCapital.id,
            dataPrevista: cron.dataVencimento,
            valorPrevisto: reais(cron.valorNominal),
          };
        }),
      });

      // Faturas no dia zero (item 4.1, §8.1 passo 6): uma por ciclo, status ABERTA,
      // fechamento em D-5. Para uma conta com um contrato, 1 fatura por parcela.
      let seqFatura = await tx.fatura.count({ where: { contaId: dto.contaId } });
      for (const pc of parcelasCriadas) {
        const cron = porNumero.get(pc.numero)!;
        const venc = cron.dataVencimento;
        const fechamento = new Date(venc.getTime() - 5 * 24 * 60 * 60 * 1000);
        seqFatura += 1;
        const fatura = await tx.fatura.create({
          data: {
            contaId: dto.contaId,
            numero: seqFatura,
            periodoReferencia: venc,
            dataFechamento: fechamento,
            dataVencimento: venc,
            valorTotal: reais(cron.valorNominal),
            status: 'ABERTA',
          },
        });
        await tx.itemFatura.create({
          data: {
            faturaId: fatura.id,
            parcelaId: pc.id,
            tipo: 'PRINCIPAL',
            descricao: `Parcela ${cron.display}`,
            valor: reais(cron.valorNominal),
            credor: 'AZIT',
          },
        });
        await tx.parcela.update({
          where: { id: pc.id },
          data: { faturaId: fatura.id },
        });
      }

      return criado;
    });

    return { ...contratoParaApi(contrato), totalParcelasGeradas: cronograma.length };
  }

  async listar(filtros: ListarContratosDto) {
    const where: Prisma.ContratoCreditoWhereInput = {};
    if (filtros.contaId) where.contaId = filtros.contaId;
    if (filtros.status) {
      where.status = chavePrisma(StatusContratoCredito, filtros.status) as Prisma.ContratoCreditoWhereInput['status'];
    }

    const [total, registros] = await Promise.all([
      this.prisma.db.contratoCredito.count({ where }),
      this.prisma.db.contratoCredito.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filtros.page - 1) * filtros.limit,
        take: filtros.limit,
        include: {
          conta: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true } } } },
          ativo: { select: { placa: true, modelo: true, anoModelo: true } },
        },
      }),
    ]);

    const ids = registros.map((r) => r.id);
    const [pagas, saldos] = await Promise.all([
      this.prisma.db.parcela.groupBy({
        by: ['contratoId'],
        where: { contratoId: { in: ids }, status: { in: PARCELA_PAGA } },
        _count: { _all: true },
      }),
      this.prisma.db.parcela.groupBy({
        by: ['contratoId'],
        // saldo em aberto: exclui parcelas cobertas por acordo (acordoId).
        where: { contratoId: { in: ids }, status: null, acordoId: null },
        _sum: { valorNominal: true },
      }),
    ]);
    const pagasPorId = new Map(pagas.map((g) => [g.contratoId, g._count._all]));
    const saldoPorId = new Map(
      saldos.map((g) => [g.contratoId, g._sum.valorNominal]),
    );

    const data = registros.map((c) => ({
      id: c.id,
      numero: c.numero,
      status: StatusContratoCredito[c.status],
      dataAssinatura: c.dataAssinatura.toISOString(),
      valorTotal: this.cent(c.valorTotal),
      saldoDevedor: this.cent(c.saldoDevedor),
      saldoDevedorAtual: this.cent(saldoPorId.get(c.id) ?? c.saldoDevedor),
      numeroParcelas: c.numeroParcelas,
      parcelasPagas: pagasPorId.get(c.id) ?? 0,
      titular: c.conta.titular,
      ativo: c.ativo,
    }));

    return { total, page: filtros.page, limit: filtros.limit, data };
  }

  async kpis() {
    const porStatus = await this.prisma.db.contratoCredito.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const saldo = await this.prisma.db.parcela.aggregate({
      where: { status: null, acordoId: null },
      _sum: { valorNominal: true },
    });
    return {
      totalContratos: porStatus.reduce((s, g) => s + g._count._all, 0),
      porStatus: porStatus.map((g) => ({
        status: StatusContratoCredito[g.status],
        total: g._count._all,
      })),
      saldoDevedorTotal: this.cent(saldo._sum.valorNominal),
    };
  }

  async buscarPorId(id: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id },
      include: {
        conta: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true, whatsapp: true } } } },
        ativo: { include: { origemCapital: { select: { tipo: true } } } },
      },
    });
    if (!contrato) throw this.naoEncontrado();

    const [parcelasPagas, proxima] = await Promise.all([
      this.prisma.db.parcela.count({
        where: { contratoId: id, status: { in: PARCELA_PAGA } },
      }),
      this.prisma.db.parcela.findFirst({
        where: { contratoId: id, status: null, acordoId: null },
        orderBy: { dataVencimento: 'asc' },
        select: { numero: true, dataVencimento: true, valorNominal: true },
      }),
    ]);
    const saldoAtual = await this.prisma.db.parcela.aggregate({
      where: { contratoId: id, status: null, acordoId: null },
      _sum: { valorNominal: true },
    });

    return {
      ...contratoParaApi(contrato),
      titular: contrato.conta.titular,
      ativo: {
        placa: contrato.ativo.placa,
        modelo: contrato.ativo.modelo,
        descricao: contrato.ativo.descricao,
        anoModelo: contrato.ativo.anoModelo,
        origemCapitalTipo: contrato.ativo.origemCapital?.tipo ?? null,
      },
      resumo: {
        parcelasPagas,
        totalParcelas: contrato.numeroParcelas,
        saldoDevedorAtual: this.cent(saldoAtual._sum.valorNominal),
        proximaParcela: proxima
          ? {
              numero: proxima.numero,
              dataVencimento: proxima.dataVencimento.toISOString(),
              valorNominal: this.cent(proxima.valorNominal),
            }
          : null,
      },
    };
  }

  async cronograma(id: string) {
    await this.garantirExiste(id);
    const parcelas = await this.prisma.db.parcela.findMany({
      where: { contratoId: id },
      orderBy: { numero: 'asc' },
    });
    return parcelas.map(parcelaParaApi);
  }

  // --- helpers ---

  private cent(d: Prisma.Decimal | null): number {
    return d !== null ? Math.round(Number(d.toString()) * 100) : 0;
  }

  private async garantirExiste(id: string): Promise<void> {
    const existe = await this.prisma.db.contratoCredito.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw this.naoEncontrado();
  }

  private naoEncontrado(): NotFoundException {
    return new NotFoundException({
      erro: 'nao_encontrado',
      mensagem: 'Contrato não encontrado',
    });
  }
}
