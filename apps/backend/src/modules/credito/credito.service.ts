import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { precificarPrice } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AtivoService } from '../ativo/ativo.service';
import { OrigemCapitalService } from '../origem-capital/origem-capital.service';
import { ContratoService } from '../contrato/contrato.service';
import { AlcadaService } from '../alcada/alcada.service';
import { AsaasService } from '../asaas/asaas.service';
import {
  OriginarCreditoDto,
  ReprovarCreditoDto,
  SimularCreditoDto,
} from './dto/credito.dto';

const DIA_MS = 24 * 60 * 60 * 1000;

// Crédito de manutenção (crédito avulso para cliente já ativo) — Doc 2 §4.7-A.
// É um ContratoCredito COMPRA_PARCELADA, ancorado num Ativo sintético (tipo OUTRO)
// com OrigemCapital própria (capital AZIT), na Conta existente do titular. Nasce em
// RASCUNHO (= aguardando aprovação); a alçada (§7.9) é o gatilho de ativação.
@Injectable()
export class CreditoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ativo: AtivoService,
    private readonly origem: OrigemCapitalService,
    private readonly contrato: ContratoService,
    private readonly alcada: AlcadaService,
    private readonly asaas: AsaasService,
  ) {}

  private cent(v: unknown): number {
    return Math.round(Number(v?.toString() ?? '0') * 100);
  }

  private passoDias(periodicidade: string): number {
    return periodicidade === 'mensal' ? 30 : periodicidade === 'quinzenal' ? 14 : 7;
  }

  private precificar(dto: { valor: number; numeroParcelas: number; valorEntrada: number }) {
    // Motor provisório (taxa zerada — placeholder do Vicente; marca provisorio:true).
    return precificarPrice({
      valorVenda: dto.valor,
      valorEntrada: dto.valorEntrada,
      prazoSemanas: dto.numeroParcelas,
    });
  }

  // Prévia da parcela para a tela (não persiste).
  async simular(dto: SimularCreditoDto) {
    const p = this.precificar(dto);
    return {
      valor: dto.valor,
      valorEntrada: dto.valorEntrada,
      valorFinanciado: p.valorFinanciado,
      numeroParcelas: p.numeroParcelas,
      valorParcela: p.valorParcela,
      totalAPagar: p.totalAPagar,
      provisorio: p.provisorio,
    };
  }

  // Operador origina o crédito: cria ativo sintético + origem de capital + contrato
  // COMPRA_PARCELADA em RASCUNHO (aguardando alçada). NÃO gera cronograma ainda.
  async originar(titularId: string, dto: OriginarCreditoDto, solicitanteId: string) {
    const titular = await this.prisma.db.titular.findFirst({
      where: { id: titularId },
      select: { id: true, nome: true },
    });
    if (!titular) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Titular não encontrado' });
    }
    const conta = await this.prisma.db.conta.findFirst({
      where: { titularId },
      select: { id: true },
    });
    if (!conta) {
      throw new UnprocessableEntityException({
        erro: 'sem_conta',
        mensagem: 'Titular não possui conta — crédito de manutenção é só para cliente já ativo',
      });
    }

    const p = this.precificar(dto);

    const ativo = await this.ativo.criar({
      tipo: 'outro',
      descricao: `${dto.descricao} — ${titular.nome}`,
      valorVenda: dto.valor,
    });
    await this.origem.criar(ativo.id, {
      tipo: 'capital_proprio',
      valorAportado: p.valorFinanciado,
      dataAporte: new Date(),
      taxaRetorno: 0,
    });

    const contrato = await this.contrato.criar(
      {
        contaId: conta.id,
        ativoId: ativo.id,
        dataAssinatura: new Date(),
        dataPrimeiraParcela: new Date(Date.now() + this.passoDias(dto.periodicidade) * DIA_MS),
        valorTotal: p.totalAPagar,
        valorEntrada: dto.valorEntrada,
        numeroParcelas: dto.numeroParcelas,
        valorParcelaInicial: p.valorParcela,
        periodicidade: dto.periodicidade,
        modalidade: 'compra_parcelada',
        descricaoFinanciamento: dto.descricao,
        credor: 'azit',
      },
      'RASCUNHO',
      false, // sem cronograma — nasce na aprovação pela alçada
    );

    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      data: { solicitadoPor: solicitanteId },
    });

    return {
      contratoId: contrato.id,
      numero: contrato.numero,
      status: 'aguardando_aprovacao',
      valor: dto.valor,
      valorEntrada: dto.valorEntrada,
      numeroParcelas: dto.numeroParcelas,
      valorParcela: p.valorParcela,
      totalAPagar: p.totalAPagar,
    };
  }

  // Fila de aprovação: contratos COMPRA_PARCELADA em RASCUNHO.
  async pendentes() {
    const rows = await this.prisma.db.contratoCredito.findMany({
      where: { modalidade: 'COMPRA_PARCELADA', status: 'RASCUNHO' },
      include: {
        conta: { include: { titular: { select: { id: true, nome: true } } } },
        ativo: { select: { descricao: true } },
      },
      orderBy: { dataAssinatura: 'desc' },
    });
    return rows.map((c) => ({
      contratoId: c.id,
      numero: c.numero,
      titularId: c.conta.titular.id,
      titular: c.conta.titular.nome,
      descricao: c.ativo.descricao,
      valorTotal: this.cent(c.valorTotal),
      valorEntrada: this.cent(c.valorEntrada),
      numeroParcelas: c.numeroParcelas,
      valorParcela: this.cent(c.valorParcelaInicial),
      solicitadoPor: c.solicitadoPor,
      solicitadoEm: c.dataAssinatura,
    }));
  }

  // Aprovação pela alçada (§7.9). Aprovado → ativa (sem entrada: gera cronograma já;
  // com entrada: cobra a entrada e o pagamento dispara a ativação via webhook).
  async aprovar(contratoId: string, aprovadorId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      include: {
        conta: {
          include: {
            titular: {
              select: {
                id: true,
                nome: true,
                cpfCnpj: true,
                email: true,
                whatsapp: true,
                asaasCustomerId: true,
              },
            },
          },
        },
      },
    });
    if (!contrato) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    }
    if (contrato.modalidade !== 'COMPRA_PARCELADA' || contrato.status !== 'RASCUNHO') {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Crédito não está aguardando aprovação',
      });
    }

    const valor = this.cent(contrato.valorTotal);
    const alc = await this.alcada.verificar(aprovadorId, 'credito_avulso', valor);
    if (!alc.aprovado) {
      throw new ForbiddenException({ erro: 'fora_da_alcada', mensagem: alc.motivo });
    }

    const entrada = this.cent(contrato.valorEntrada);
    if (entrada > 0) {
      const customerId = await this.garantirCliente(contrato.conta.titular);
      const cobranca = await this.asaas.criarCobranca({
        externalReference: `ativacao:${contrato.id}`,
        valor: entrada,
        vencimento: new Date(Date.now() + 3 * DIA_MS),
        descricao: `Entrada do crédito ${contrato.numero}`,
        customerId,
        multaPct: Number(contrato.taxaMultaAtraso.toString()),
        jurosPct: Number(contrato.taxaJurosAtraso.toString()),
      });
      await this.prisma.db.contratoCredito.update({
        where: { id: contrato.id },
        data: {
          status: 'AGUARDANDO_PAGAMENTO_INICIAL',
          aprovadoPor: aprovadorId,
          dataAprovacao: new Date(),
        },
      });
      return {
        contratoId: contrato.id,
        numero: contrato.numero,
        status: 'aguardando_pagamento_inicial',
        entrada,
        cobranca: { id: cobranca.id, valor: cobranca.value, simulada: cobranca.simulada },
      };
    }

    // Sem entrada: o "dia zero" é a aprovação — gera cronograma e ativa (Doc 2 §4.7-A).
    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      data: { aprovadoPor: aprovadorId, dataAprovacao: new Date() },
    });
    await this.contrato.ativarComCronograma(contrato.id);
    return {
      contratoId: contrato.id,
      numero: contrato.numero,
      status: 'ativo',
      cronogramaGerado: true,
    };
  }

  async reprovar(contratoId: string, aprovadorId: string, dto: ReprovarCreditoDto) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, modalidade: true, status: true, ativoId: true },
    });
    if (!contrato) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    }
    if (contrato.modalidade !== 'COMPRA_PARCELADA' || contrato.status !== 'RASCUNHO') {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Crédito não está aguardando aprovação',
      });
    }
    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      data: {
        status: 'CANCELADO',
        dataEncerramento: new Date(),
        aprovadoPor: aprovadorId,
      },
    });
    // Libera o ativo sintético (sai de EM_CONTRATO).
    await this.prisma.db.ativo.update({
      where: { id: contrato.ativoId },
      data: { status: 'DISPONIVEL' },
    });
    return { contratoId: contrato.id, status: 'cancelado', motivo: dto.motivo };
  }

  // Garante o cliente no Asaas (idempotente) — mesmo padrão da formalização.
  private async garantirCliente(titular: {
    id: string;
    nome: string;
    cpfCnpj: string;
    email: string | null;
    whatsapp: string;
    asaasCustomerId: string | null;
  }): Promise<string> {
    if (titular.asaasCustomerId) return titular.asaasCustomerId;
    const customerId = await this.asaas.criarCliente({
      titularId: titular.id,
      nome: titular.nome,
      cpfCnpj: titular.cpfCnpj,
      email: titular.email,
      telefone: titular.whatsapp,
    });
    await this.prisma.db.titular.update({
      where: { id: titular.id },
      data: { asaasCustomerId: customerId },
    });
    return customerId;
  }
}
