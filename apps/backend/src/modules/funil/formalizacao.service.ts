import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  reaisParaCentavos,
  centavosParaReaisString,
  renderTemplate,
  valorPorExtenso,
  dataPorExtenso,
  formatCurrency,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { ContratoService } from '../contrato/contrato.service';
import { AsaasService } from '../asaas/asaas.service';

const cent = (d: Prisma.Decimal): number => reaisParaCentavos(d.toString());
const DIA_MS = 24 * 60 * 60 * 1000;

// Template provisório do instrumento de crédito (7.9/7.10) — substituível.
const CONTRATO_TEMPLATE = `INSTRUMENTO PARTICULAR DE FINANCIAMENTO COM RESERVA DE DOMÍNIO

Contrato nº {{numero}}, firmado em {{dataAssinatura}}.

CREDOR: Azit Move.
DEVEDOR(A): {{cliente}}, CPF/CNPJ {{cpf}}.
{{papeisLinha}}

OBJETO: {{ativo}}.

CONDIÇÕES:
- Valor total: {{valorTotal}} ({{valorTotalExtenso}}).
- Entrada: {{valorEntrada}}.
- Parcelas: {{numeroParcelas}} de {{valorParcela}}, periodicidade {{periodicidade}}.
- Primeira parcela em {{dataPrimeiraParcela}}.

A reserva de domínio do veículo permanece com o credor até a quitação integral.
Documento gerado automaticamente (assinatura digital MOCK — provisória).`;

// 7.10 Formalização + 7.11 Ativação. A proposta aprovada vira ContratoCredito em
// AGUARDANDO_ASSINATURA, com snapshot congelado e documento gerado por template.
// A ativação cria a cobrança da entrada (Asaas) e, no pagamento, ativa o contrato.
@Injectable()
export class FormalizacaoService {
  private readonly logger = new Logger(FormalizacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contrato: ContratoService,
    private readonly asaas: AsaasService,
  ) {}

  // 7.10 — congela snapshot, gera documento, cria o contrato.
  async formalizar(propostaId: string) {
    const proposta = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      include: {
        titular: true,
        ativo: true,
        parecer: true,
        vinculos: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true } } } },
      },
    });
    if (!proposta) throw this.naoEncontrada();
    if (!['APROVADA', 'EM_FORMALIZACAO'].includes(proposta.status)) {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Só formaliza proposta Aprovada ou Em Formalização',
      });
    }
    if (proposta.contratoGeradoId) {
      throw new UnprocessableEntityException({ erro: 'ja_formalizada', mensagem: 'Proposta já gerou contrato' });
    }
    // Ressalva do parecer: exige garantidor → precisa do papel.
    if (proposta.parecer?.exigeGarantidor && !proposta.vinculos.some((v) => v.papel === 'GARANTIDOR')) {
      throw new UnprocessableEntityException({
        erro: 'garantidor_exigido',
        mensagem: 'O parecer exige garantidor; adicione o papel antes de formalizar',
      });
    }

    const conta = await this.prisma.db.conta.findFirst({ where: { titularId: proposta.titularId }, select: { id: true } });
    if (!conta) {
      throw new UnprocessableEntityException({ erro: 'sem_conta', mensagem: 'Titular sem conta — promova o lead antes' });
    }

    const valorEntrada = cent(proposta.valorEntrada);
    const valorParcela = cent(proposta.valorParcela);
    const valorTotal = valorEntrada + valorParcela * proposta.numeroParcelas;
    const dataAssinatura = new Date();
    const dataPrimeira = new Date(dataAssinatura.getTime() + 7 * DIA_MS);

    // Núcleo do sistema gera contrato + cronograma + faturas, em AGUARDANDO_ASSINATURA.
    const novo = await this.contrato.criar(
      {
        contaId: conta.id,
        ativoId: proposta.ativoId,
        numero: undefined,
        dataAssinatura,
        dataPrimeiraParcela: dataPrimeira,
        valorTotal,
        valorEntrada,
        numeroParcelas: proposta.numeroParcelas,
        valorParcelaInicial: valorParcela,
        periodicidade: 'semanal',
        descricaoFinanciamento: `Financiamento ${proposta.ativo.descricao}`,
        credor: 'azit',
      },
      'AGUARDANDO_ASSINATURA',
    );

    // Papéis migram da proposta para o contrato (Doc 2 §4-A.7).
    for (const v of proposta.vinculos) {
      await this.prisma.db.vinculoPapel.create({
        data: { contratoCreditoId: novo.id, titularId: v.titularId, papel: v.papel },
      });
    }

    // Snapshot congelado + documento gerado.
    const papeisLinha = proposta.vinculos
      .map((v) => `${v.papel.toLowerCase()}: ${v.titular.nome} (CPF ${v.titular.cpfCnpj})`)
      .join('\n');
    const documento = renderTemplate(CONTRATO_TEMPLATE, {
      numero: novo.numero,
      dataAssinatura: dataPorExtenso(dataAssinatura),
      cliente: proposta.titular.nome,
      cpf: proposta.titular.cpfCnpj,
      papeisLinha,
      ativo: proposta.ativo.descricao,
      valorTotal: formatCurrency(valorTotal),
      valorTotalExtenso: valorPorExtenso(valorTotal),
      valorEntrada: formatCurrency(valorEntrada),
      numeroParcelas: proposta.numeroParcelas,
      valorParcela: formatCurrency(valorParcela),
      periodicidade: 'semanal',
      dataPrimeiraParcela: dataPorExtenso(dataPrimeira),
    });
    const snapshot = {
      contrato: { numero: novo.numero, valorTotal, valorEntrada, numeroParcelas: proposta.numeroParcelas, valorParcela },
      cliente: { nome: proposta.titular.nome, cpfCnpj: proposta.titular.cpfCnpj, whatsapp: proposta.titular.whatsapp },
      ativo: { descricao: proposta.ativo.descricao, chassi: proposta.ativo.chassi, placa: proposta.ativo.placa },
      papeis: proposta.vinculos.map((v) => ({ papel: v.papel.toLowerCase(), nome: v.titular.nome, cpfCnpj: v.titular.cpfCnpj })),
      documento,
    };

    await this.prisma.db.contratoCredito.update({
      where: { id: novo.id },
      data: { snapshotJson: snapshot as unknown as Prisma.InputJsonValue, snapshotLockedAt: new Date() },
    });
    await this.prisma.db.proposta.update({
      where: { id: propostaId },
      data: { status: 'CONVERTIDA', contratoGeradoId: novo.id },
    });

    this.logger.log(`Proposta ${propostaId} formalizada → contrato ${novo.numero} (aguardando assinatura)`);
    return { contratoId: novo.id, numero: novo.numero, status: 'aguardando_assinatura', documento, snapshot };
  }

  // 7.11 — Ativação: cria a cobrança da entrada (Asaas) e marca aguardando pagamento.
  async ativar(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      include: { conta: { include: { titular: { select: { id: true, nome: true, asaasCustomerId: true } } } } },
    });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    if (!['AGUARDANDO_ASSINATURA', 'AGUARDANDO_PAGAMENTO_INICIAL'].includes(contrato.status)) {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Contrato não está aguardando assinatura/pagamento inicial',
      });
    }
    const valorEntrada = cent(contrato.valorEntrada);
    const cobranca = await this.asaas.criarCobranca({
      externalReference: `ativacao:${contrato.id}`,
      valor: valorEntrada,
      vencimento: new Date(Date.now() + 3 * DIA_MS),
      descricao: `Entrada do contrato ${contrato.numero}`,
    });
    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      data: { status: 'AGUARDANDO_PAGAMENTO_INICIAL' },
    });
    return {
      contratoId: contrato.id,
      numero: contrato.numero,
      status: 'aguardando_pagamento_inicial',
      entrada: valorEntrada,
      cobranca: { id: cobranca.id, valor: cobranca.value, simulada: cobranca.simulada },
    };
  }

  // Dev: simula o pagamento da entrada (faz o papel do webhook PAYMENT_RECEIVED):
  // cadastra o cliente no Asaas (mock) e ativa o contrato.
  async simularPagamentoAtivacao(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      include: { conta: { include: { titular: { select: { id: true, asaasCustomerId: true } } } } },
    });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });

    const titular = contrato.conta.titular;
    if (!titular.asaasCustomerId) {
      // Cadastro do cliente no Asaas (mock no modo simulado).
      await this.prisma.db.titular.update({
        where: { id: titular.id },
        data: { asaasCustomerId: `cus_sim_${titular.id.slice(0, 8)}` },
      });
    }
    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      data: { status: 'ATIVO' },
    });
    this.logger.log(`Contrato ${contrato.numero} ativado (entrada paga, cliente no Asaas).`);
    return { contratoId: contrato.id, numero: contrato.numero, status: 'ativo' };
  }

  private naoEncontrada() {
    return new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Proposta não encontrada' });
  }
}
