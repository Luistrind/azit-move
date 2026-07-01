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
import { StatusContratoCredito, Credor, Periodicidade as PeriodicidadeTypes } from '@azit/types';
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

// Cliente de transação do Prisma ESTENDIDO (soft-delete) — tipo do `tx` no $transaction.
type TxEstendido = Omit<
  PrismaService['db'],
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

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
    comCronograma = true,
    opts: { verificarEstoque?: boolean; propostaPacoteId?: string } = {},
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
    // verificarEstoque=false para contratos APARTADOS (ex: seguro) sobre o mesmo
    // ativo do financiamento — a regra "1 ativo = 1 contrato" vale para o financiamento.
    const jaContratado = opts.verificarEstoque === false ? null : await this.prisma.db.contratoCredito.findFirst({
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

    // Recebível exige a OrigemCapital do ativo. Só é obrigatória quando o cronograma
    // é gerado agora; na originação nativa o cronograma nasce na ATIVAÇÃO (Decisão
    // 2026-06-29), então a origem de capital é cobrada lá.
    const origemCapital = await this.prisma.db.origemCapital.findFirst({
      where: { ativoId: dto.ativoId },
      select: { id: true },
    });
    if (comCronograma && !origemCapital) {
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
          entradaParcelada: dto.entradaParcelada ?? false,
          saldoDevedor: reais(saldoDevedor),
          numeroParcelas: dto.numeroParcelas,
          valorParcelaInicial: reais(dto.valorParcelaInicial),
          periodicidade: periodicidadePrisma,
          indiceReajuste: dto.indiceReajuste,
          taxaMultaAtraso: dto.taxaMultaAtraso,
          taxaJurosAtraso: dto.taxaJurosAtraso,
          taxaDescontoQuitacao: dto.taxaDescontoQuitacao,
          status: statusInicial,
          propostaPacoteId: opts.propostaPacoteId,
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

      // Cronograma (parcelas + recebíveis + faturas + intermediárias). Na originação
      // nativa NÃO é gerado aqui — nasce na ativação pelo pagamento da entrada.
      if (comCronograma) {
        await this.aplicarCronograma(tx, {
          contratoId: criado.id,
          contaId: dto.contaId,
          itemFinanciamentoId: itemFinanciamento.id,
          origemCapitalId: origemCapital!.id,
          cronograma,
          entradaParcelada: dto.entradaParcelada ?? false,
          valorEntrada: dto.valorEntrada,
          descricaoItem: itemFinanciamento.descricao,
          credorItem: itemFinanciamento.credor,
        });
      }

      return criado;
    });

    return { ...contratoParaApi(contrato), totalParcelasGeradas: comCronograma ? cronograma.length : 0 };
  }

  // Gera parcelas + recebíveis + faturas + intermediárias dentro de uma transação.
  // Reutilizado pela criação (legado/novação) e pela ativação (originação nativa).
  private async aplicarCronograma(
    tx: TxEstendido,
    p: {
      contratoId: string;
      contaId: string;
      itemFinanciamentoId: string;
      origemCapitalId: string;
      cronograma: ReturnType<typeof gerarCronograma>;
      entradaParcelada: boolean;
      valorEntrada: number;
      descricaoItem?: string; // p/ distinguir itens na fatura agregada (pacote)
      credorItem?: 'AZIT' | 'INVESTIDOR' | 'TERCEIRO';
    },
  ): Promise<void> {
    await tx.parcela.createMany({
      data: p.cronograma.map((c) => ({
        contratoId: p.contratoId,
        itemContratadoId: p.itemFinanciamentoId,
        numero: c.numero,
        totalParcelas: c.totalParcelas,
        display: c.display,
        valorNominal: reais(c.valorNominal),
        dataVencimento: c.dataVencimento,
      })),
    });
    const parcelasCriadas = await tx.parcela.findMany({
      where: { contratoId: p.contratoId },
      select: { id: true, numero: true },
      orderBy: { numero: 'asc' },
    });
    const porNumero = new Map(p.cronograma.map((c) => [c.numero, c]));
    await tx.recebivel.createMany({
      data: parcelasCriadas.map((pc) => {
        const cron = porNumero.get(pc.numero)!;
        return {
          contratoId: p.contratoId,
          parcelaId: pc.id,
          origemCapitalId: p.origemCapitalId,
          dataPrevista: cron.dataVencimento,
          valorPrevisto: reais(cron.valorNominal),
        };
      }),
    });

    let seqFatura = await tx.fatura.count({ where: { contaId: p.contaId } });
    const faturasDoContrato: { id: string; valorNominal: number; venc: Date }[] = [];
    const credor = p.credorItem ?? 'AZIT';
    const sufixo = p.descricaoItem ? ` · ${p.descricaoItem}` : '';
    for (const pc of parcelasCriadas) {
      const cron = porNumero.get(pc.numero)!;
      const venc = cron.dataVencimento;
      const fechamento = new Date(venc.getTime() - 5 * 24 * 60 * 60 * 1000);
      // Fatura única por conta + dia de vencimento — agrega itens de TODOS os
      // contratos do pacote (veículo + apartados) no mesmo ciclo (Doc 2 §372).
      const diaIni = new Date(venc); diaIni.setHours(0, 0, 0, 0);
      const diaFim = new Date(diaIni.getTime() + 24 * 60 * 60 * 1000);
      let fatura = await tx.fatura.findFirst({
        where: { contaId: p.contaId, dataVencimento: { gte: diaIni, lt: diaFim } },
        select: { id: true, valorTotal: true },
      });
      if (!fatura) {
        seqFatura += 1;
        fatura = await tx.fatura.create({
          data: {
            contaId: p.contaId,
            numero: seqFatura,
            periodoReferencia: venc,
            dataFechamento: fechamento,
            dataVencimento: venc,
            valorTotal: reais(cron.valorNominal),
            status: 'ABERTA',
          },
          select: { id: true, valorTotal: true },
        });
      } else {
        await tx.fatura.update({
          where: { id: fatura.id },
          data: { valorTotal: reais(this.cent(fatura.valorTotal) + cron.valorNominal) },
        });
      }
      faturasDoContrato.push({ id: fatura.id, valorNominal: cron.valorNominal, venc });
      await tx.itemFatura.create({
        data: {
          faturaId: fatura.id,
          parcelaId: pc.id,
          tipo: 'PRINCIPAL',
          descricao: `Parcela ${cron.display}${sufixo}`,
          valor: reais(cron.valorNominal),
          credor,
        },
      });
      await tx.parcela.update({ where: { id: pc.id }, data: { faturaId: fatura.id } });
    }

    // Intermediárias (Doc 2 §4-A.3): 40% da entrada diluído em parcelas-balão.
    if (p.entradaParcelada && p.valorEntrada > 0 && faturasDoContrato.length) {
      const aVista = Math.round(p.valorEntrada * 0.6);
      const diluido = p.valorEntrada - aVista;
      if (diluido > 0) {
        const n = Math.min(3, faturasDoContrato.length);
        const base = Math.floor(diluido / n);
        for (let i = 0; i < n; i++) {
          const valor = i < n - 1 ? base : diluido - base * (n - 1);
          const f = faturasDoContrato[i];
          await tx.itemFatura.create({
            data: { faturaId: f.id, tipo: 'INTERMEDIARIA', descricao: `Intermediária ${i + 1}/${n} (entrada parcelada)`, valor: reais(valor), credor: 'AZIT' },
          });
          await tx.fatura.update({ where: { id: f.id }, data: { valorTotal: reais(f.valorNominal + valor) } });
        }
      }
    }

    // Itens recorrentes da cesta (proteção/taxa não-apartados) — cobrados como
    // SERVICO em cada fatura do ciclo dentro da janela do item (Doc §4.8/Bloco 4).
    // A cadência respeita a periodicidade do item (semanal/quinzenal/mensal).
    const recorrentes = await tx.itemContratado.findMany({
      where: { contratoId: p.contratoId, natureza: 'RECORRENTE' },
      select: { descricao: true, valor: true, credor: true, periodicidade: true, dataInicio: true, dataFim: true },
    });
    if (recorrentes.length && faturasDoContrato.length) {
      const passoContrato = faturasDoContrato.length > 1
        ? Math.round((faturasDoContrato[1].venc.getTime() - faturasDoContrato[0].venc.getTime()) / (24 * 60 * 60 * 1000))
        : 7;
      const passoDe = (per: 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | null) =>
        per === 'MENSAL' ? 30 : per === 'QUINZENAL' ? 14 : per === 'SEMANAL' ? 7 : passoContrato;
      for (let i = 0; i < faturasDoContrato.length; i++) {
        const f = faturasDoContrato[i];
        for (const r of recorrentes) {
          if (r.dataInicio) {
            const ini = new Date(r.dataInicio); ini.setHours(0, 0, 0, 0);
            const v = new Date(f.venc); v.setHours(0, 0, 0, 0);
            if (v < ini) continue;
          }
          if (r.dataFim && f.venc > r.dataFim) continue;
          // Cadência: cobra quando o ciclo do item alinha com este período.
          const passoItem = passoDe(r.periodicidade);
          if ((i * passoContrato) % passoItem >= passoContrato) continue;
          const valorItem = this.cent(r.valor);
          if (valorItem <= 0) continue;
          await tx.itemFatura.create({
            data: { faturaId: f.id, tipo: 'SERVICO', descricao: r.descricao, valor: reais(valorItem), credor: r.credor },
          });
          await tx.fatura.update({ where: { id: f.id }, data: { valorTotal: { increment: reais(valorItem) } } });
        }
      }
    }
  }

  // "Dia zero" — gera o cronograma e ATIVA o contrato (chamado no pagamento da
  // entrada na originação nativa). A primeira parcela conta a partir de agora.
  async ativarComCronograma(contratoId: string): Promise<void> {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      include: { itensContratados: { where: { natureza: 'PARCELADO' }, take: 1 } },
    });
    if (!contrato) throw this.naoEncontrado();
    const jaTem = await this.prisma.db.parcela.count({ where: { contratoId } });
    if (jaTem > 0) return; // idempotente: cronograma já existe
    const item = contrato.itensContratados[0];
    if (!item) throw new UnprocessableEntityException({ erro: 'sem_item', mensagem: 'Contrato sem item de financiamento' });

    const origemCapital = await this.prisma.db.origemCapital.findFirst({ where: { ativoId: contrato.ativoId }, select: { id: true } });
    if (!origemCapital) {
      throw new UnprocessableEntityException({
        erro: 'origem_capital_ausente',
        mensagem: 'O ativo não possui origem de capital — necessária para gerar os recebíveis',
      });
    }

    const periodicidade = PeriodicidadeTypes[contrato.periodicidade] as 'semanal' | 'quinzenal' | 'mensal';
    const passo = periodicidade === 'mensal' ? 30 : periodicidade === 'quinzenal' ? 14 : 7;
    const dataPrimeira = new Date(Date.now() + passo * 24 * 60 * 60 * 1000);
    const saldo = this.cent(contrato.valorTotal) - this.cent(contrato.valorEntrada);
    const cronograma = gerarCronograma({
      numeroParcelas: contrato.numeroParcelas,
      valorParcela: this.cent(contrato.valorParcelaInicial),
      valorTotal: saldo,
      dataPrimeiraParcela: dataPrimeira,
      periodicidade,
    });

    await this.prisma.db.$transaction(async (tx) => {
      await this.aplicarCronograma(tx, {
        contratoId,
        contaId: contrato.contaId,
        itemFinanciamentoId: item.id,
        origemCapitalId: origemCapital.id,
        cronograma,
        entradaParcelada: contrato.entradaParcelada,
        valorEntrada: this.cent(contrato.valorEntrada),
        descricaoItem: item.descricao,
        credorItem: item.credor,
      });
      await tx.contratoCredito.update({
        where: { id: contratoId },
        data: { status: 'ATIVO', dataPrimeiraParcela: dataPrimeira, cronogramaGeradoEm: new Date() },
      });
    });
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
    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [porStatus, saldo, recebido] = await Promise.all([
      this.prisma.db.contratoCredito.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.db.parcela.aggregate({
        where: { status: null, acordoId: null },
        _sum: { valorNominal: true },
      }),
      // Recebido na semana: parcelas pagas (com data de pagamento) nos últimos 7 dias.
      this.prisma.db.parcela.aggregate({
        where: { status: { in: PARCELA_PAGA }, dataPagamento: { gte: seteDiasAtras } },
        _sum: { valorPago: true },
      }),
    ]);
    const cont = (s: string) => porStatus.find((g) => g.status === s)?._count._all ?? 0;
    const totalContratos = porStatus.reduce((s, g) => s + g._count._all, 0);
    const ativos = cont('ATIVO');
    const inadimplentes = cont('INADIMPLENTE') + cont('BLOQUEADO');
    const baseVigente = ativos + inadimplentes; // contratos vigentes (não terminais)
    return {
      totalContratos,
      porStatus: porStatus.map((g) => ({ status: StatusContratoCredito[g.status], total: g._count._all })),
      saldoDevedorTotal: this.cent(saldo._sum.valorNominal),
      // KPIs da Carteira (Doc 3 §8.1).
      carteiraSobGestao: this.cent(saldo._sum.valorNominal),
      contratosAtivos: ativos,
      inadimplentes,
      inadimplenciaPct: baseVigente > 0 ? Math.round((inadimplentes / baseVigente) * 1000) / 10 : 0,
      recebidoNaSemana: this.cent(recebido._sum.valorPago),
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
    const [saldoAtual, pagoAgg] = await Promise.all([
      this.prisma.db.parcela.aggregate({
        where: { contratoId: id, status: null, acordoId: null },
        _sum: { valorNominal: true },
      }),
      this.prisma.db.parcela.aggregate({
        where: { contratoId: id, status: { in: PARCELA_PAGA } },
        _sum: { valorPago: true },
      }),
    ]);

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
        valorPago: this.cent(pagoAgg._sum.valorPago),
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
      include: { itemContratado: { select: { descricao: true } } },
    });
    // "Contrato" (antiga "Composição"): natureza do item que origina a parcela.
    return parcelas.map((p) => ({ ...parcelaParaApi(p), composicao: p.itemContratado?.descricao ?? null }));
  }

  // Documento do contrato (instrumento) — gerado na formalização e congelado no
  // snapshot. Permite visualizar/baixar. Legado pode não ter snapshot.
  async documento(id: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id },
      select: { numero: true, snapshotJson: true },
    });
    if (!contrato) throw this.naoEncontrado();
    const snap = contrato.snapshotJson as { documento?: string } | null;
    const texto = snap?.documento
      ?? `Contrato nº ${contrato.numero}\n\nInstrumento não disponível (contrato migrado do legado, sem documento gerado).`;
    return { numero: contrato.numero, texto, disponivel: !!snap?.documento };
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
