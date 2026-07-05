import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const cent = (d: unknown): number => Math.round(Number(d?.toString() ?? '0') * 100);
const reais = (c: number) => (c / 100).toFixed(2);
const PAGAS = ['PAGA', 'PAGA_EM_ATRASO', 'PAGA_ANTECIPADA'] as const;

// Centro de custo do ativo (Doc 2 §4.4-A): custo = aquisição + lançamentos;
// receita = CALCULADA (entrada paga + parcelas pagas dos contratos do ativo —
// acordos/itens entram automaticamente). Crédito avulso = visão agregada própria.
@Injectable()
export class CentroCustoService {
  constructor(private readonly prisma: PrismaService) {}

  // Entrada efetivamente recebida de um contrato (dia zero = cronogramaGeradoEm).
  // Entrada parcelada: 60% à vista; o diluído entra como intermediárias nas faturas.
  private entradaPaga(c: {
    cronogramaGeradoEm: Date | null;
    entradaParcelada: boolean;
    valorEntrada: Prisma.Decimal;
  }): number {
    if (!c.cronogramaGeradoEm) return 0;
    const entrada = cent(c.valorEntrada);
    return c.entradaParcelada ? Math.round(entrada * 0.6) : entrada;
  }

  // Agregados financeiros por lista de contratos (parcelas pagas × em aberto).
  private async receitasPorContrato(contratoIds: string[]) {
    if (contratoIds.length === 0) {
      return { pagasPorContrato: new Map<string, number>(), abertasPorContrato: new Map<string, number>() };
    }
    const [pagas, abertas] = await Promise.all([
      this.prisma.db.parcela.groupBy({
        by: ['contratoId'],
        where: { contratoId: { in: contratoIds }, status: { in: [...PAGAS] } },
        _sum: { valorNominal: true },
      }),
      this.prisma.db.parcela.groupBy({
        by: ['contratoId'],
        where: { contratoId: { in: contratoIds }, status: null, acordoId: null },
        _sum: { valorNominal: true },
      }),
    ]);
    return {
      pagasPorContrato: new Map(pagas.map((p) => [p.contratoId, cent(p._sum.valorNominal)])),
      abertasPorContrato: new Map(abertas.map((p) => [p.contratoId, cent(p._sum.valorNominal)])),
    };
  }

  // Visão por VEÍCULO: gasto (aquisição + lançamentos) × recebido × a receber.
  async ativos() {
    const ativos = await this.prisma.db.ativo.findMany({
      where: { tipo: 'VEICULO' },
      select: {
        id: true,
        descricao: true,
        placa: true,
        status: true,
        valorAquisicao: true,
        contratosCredito: {
          select: {
            id: true,
            cronogramaGeradoEm: true,
            entradaParcelada: true,
            valorEntrada: true,
          },
        },
        lancamentosCusto: { where: { deletedAt: null }, select: { valor: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const contratoIds = ativos.flatMap((a) => a.contratosCredito.map((c) => c.id));
    const { pagasPorContrato, abertasPorContrato } = await this.receitasPorContrato(contratoIds);

    return ativos.map((a) => {
      const aquisicao = cent(a.valorAquisicao);
      const custosExtras = a.lancamentosCusto.reduce((s, l) => s + cent(l.valor), 0);
      const recebido = a.contratosCredito.reduce(
        (s, c) => s + this.entradaPaga(c) + (pagasPorContrato.get(c.id) ?? 0),
        0,
      );
      const aReceber = a.contratosCredito.reduce((s, c) => s + (abertasPorContrato.get(c.id) ?? 0), 0);
      const totalGasto = aquisicao + custosExtras;
      return {
        ativoId: a.id,
        descricao: a.descricao,
        placa: a.placa,
        status: a.status.toLowerCase(),
        aquisicao,
        custosExtras,
        totalGasto,
        recebido,
        aReceber,
        resultado: recebido - totalGasto,
      };
    });
  }

  // Detalhe de um veículo: lançamentos + contratos com posição.
  async detalheAtivo(ativoId: string) {
    const a = await this.prisma.db.ativo.findFirst({
      where: { id: ativoId },
      select: {
        id: true,
        descricao: true,
        placa: true,
        status: true,
        valorAquisicao: true,
        contratosCredito: {
          select: {
            id: true,
            numero: true,
            status: true,
            cronogramaGeradoEm: true,
            entradaParcelada: true,
            valorEntrada: true,
            conta: { select: { titular: { select: { nome: true } } } },
          },
        },
        lancamentosCusto: {
          where: { deletedAt: null },
          orderBy: { data: 'desc' },
          select: { id: true, tipo: true, descricao: true, valor: true, data: true },
        },
      },
    });
    if (!a) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Ativo não encontrado' });

    const ids = a.contratosCredito.map((c) => c.id);
    const { pagasPorContrato, abertasPorContrato } = await this.receitasPorContrato(ids);
    const contratos = a.contratosCredito.map((c) => ({
      contratoId: c.id,
      numero: c.numero,
      status: c.status.toLowerCase(),
      titular: c.conta.titular.nome,
      entradaPaga: this.entradaPaga(c),
      parcelasPagas: pagasPorContrato.get(c.id) ?? 0,
      emAberto: abertasPorContrato.get(c.id) ?? 0,
    }));
    const aquisicao = cent(a.valorAquisicao);
    const custosExtras = a.lancamentosCusto.reduce((s, l) => s + cent(l.valor), 0);
    const recebido = contratos.reduce((s, c) => s + c.entradaPaga + c.parcelasPagas, 0);
    return {
      ativoId: a.id,
      descricao: a.descricao,
      placa: a.placa,
      status: a.status.toLowerCase(),
      aquisicao,
      custosExtras,
      totalGasto: aquisicao + custosExtras,
      recebido,
      aReceber: contratos.reduce((s, c) => s + c.emAberto, 0),
      resultado: recebido - (aquisicao + custosExtras),
      lancamentos: a.lancamentosCusto.map((l) => ({
        id: l.id,
        tipo: l.tipo,
        descricao: l.descricao,
        valor: cent(l.valor),
        data: l.data.toISOString(),
      })),
      contratos,
    };
  }

  async criarLancamento(
    ativoId: string,
    dto: { tipo: string; descricao: string; valor: number; data?: Date },
    usuarioId: string,
  ) {
    const ativo = await this.prisma.db.ativo.findFirst({ where: { id: ativoId }, select: { id: true } });
    if (!ativo) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Ativo não encontrado' });
    await this.prisma.db.lancamentoCustoAtivo.create({
      data: {
        ativoId,
        tipo: dto.tipo.trim().toLowerCase(),
        descricao: dto.descricao,
        valor: reais(dto.valor),
        data: dto.data ?? new Date(),
        criadoPor: usuarioId,
      },
    });
    return this.detalheAtivo(ativoId);
  }

  async removerLancamento(lancamentoId: string) {
    const l = await this.prisma.db.lancamentoCustoAtivo.findFirst({ where: { id: lancamentoId, deletedAt: null } });
    if (!l) throw new NotFoundException({ erro: 'nao_encontrado' });
    await this.prisma.db.lancamentoCustoAtivo.update({
      where: { id: lancamentoId },
      data: { deletedAt: new Date() },
    });
    return this.detalheAtivo(l.ativoId);
  }

  // Crédito avulso como centro de custo PRÓPRIO (agregado): liberado × retornado.
  async creditoAvulso() {
    const contratos = await this.prisma.db.contratoCredito.findMany({
      where: { modalidade: 'COMPRA_PARCELADA', ativo: { tipo: 'OUTRO' } },
      select: {
        id: true,
        numero: true,
        status: true,
        cronogramaGeradoEm: true,
        entradaParcelada: true,
        valorEntrada: true,
        ativo: { select: { descricao: true, valorVenda: true } },
        conta: { select: { titular: { select: { nome: true } } } },
      },
      orderBy: { dataAssinatura: 'desc' },
    });
    const ids = contratos.map((c) => c.id);
    const { pagasPorContrato, abertasPorContrato } = await this.receitasPorContrato(ids);

    const linhas = contratos.map((c) => {
      // Liberado ao cliente = valor do crédito (ativo sintético) − entrada.
      const valorCredito = cent(c.ativo.valorVenda);
      const liberado = Math.max(0, valorCredito - cent(c.valorEntrada));
      const retornado = this.entradaPaga(c) + (pagasPorContrato.get(c.id) ?? 0);
      return {
        contratoId: c.id,
        numero: c.numero,
        titular: c.conta.titular.nome,
        finalidade: c.ativo.descricao,
        status: c.status.toLowerCase(),
        liberado,
        retornado,
        emAberto: abertasPorContrato.get(c.id) ?? 0,
      };
    });
    return {
      totalLiberado: linhas.reduce((s, l) => s + l.liberado, 0),
      totalRetornado: linhas.reduce((s, l) => s + l.retornado, 0),
      totalEmAberto: linhas.reduce((s, l) => s + l.emAberto, 0),
      quantidade: linhas.length,
      creditos: linhas,
    };
  }
}
