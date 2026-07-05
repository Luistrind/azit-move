import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { precificarCreditoAvulso, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AtivoService } from '../ativo/ativo.service';
import { OrigemCapitalService } from '../origem-capital/origem-capital.service';
import { ContratoService } from '../contrato/contrato.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { AsaasService } from '../asaas/asaas.service';
import { ParametrosService } from '../simulador/parametros.service';
import {
  OriginarCreditoDto,
  SimularCreditoDto,
} from './dto/credito.dto';

const DIA_MS = 24 * 60 * 60 * 1000;

// Crédito avulso para cliente já ativo (Doc 2 §4.7-A) — "crédito de manutenção" é um
// caso; o produto independe da finalidade. É um ContratoCredito COMPRA_PARCELADA,
// ancorado num Ativo sintético (OUTRO) com OrigemCapital AZIT, na Conta existente do
// titular. Nasce em RASCUNHO e passa pelo MOTOR DE APROVAÇÃO (§7.9-A): aprovado →
// ativa (sem entrada) ou cobra a entrada (webhook ativa); reprovado → cancela.
@Injectable()
export class CreditoService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ativo: AtivoService,
    private readonly origem: OrigemCapitalService,
    private readonly contrato: ContratoService,
    private readonly aprovacao: AprovacaoService,
    private readonly asaas: AsaasService,
    private readonly parametros: ParametrosService,
  ) {}

  onModuleInit() {
    this.aprovacao.registrarEfetivador('credito_avulso', {
      aprovada: async (a) => this.efetivar(a.referenciaId, a.decisorId),
      reprovada: async (a) => {
        await this.cancelar(a.referenciaId, a.decisorId);
      },
    });
  }

  private cent(v: unknown): number {
    return Math.round(Number(v?.toString() ?? '0') * 100);
  }

  private passoDias(periodicidade: string): number {
    return periodicidade === 'mensal' ? 30 : periodicidade === 'quinzenal' ? 14 : 7;
  }

  // Precificação com a TAXA VIGENTE do simulador (TR a.m. convertida à taxa
  // periódica equivalente). Provisório até o Vicente formalizar a régua do avulso.
  private async precificar(dto: {
    valor: number;
    numeroParcelas: number;
    valorEntrada: number;
    periodicidade?: string;
  }) {
    const params = await this.parametros.vigente();
    const periodicidade = dto.periodicidade ?? 'mensal';
    const fator =
      periodicidade === 'mensal' ? 1 : periodicidade === 'quinzenal' ? params.fatorQuinzenal : params.fatorSemanal;
    const valorFinanciado = Math.max(0, dto.valor - dto.valorEntrada);
    const { valorParcela } = precificarCreditoAvulso({
      valorFinanciado,
      numeroParcelas: dto.numeroParcelas,
      taxaMensal: params.taxaMensal,
      fator,
    });
    return {
      valorFinanciado,
      valorParcela,
      numeroParcelas: dto.numeroParcelas,
      totalAPagar: dto.valorEntrada + valorParcela * dto.numeroParcelas,
      taxaMensal: params.taxaMensal,
      provisorio: true as const,
    };
  }

  // Prévia da parcela para a tela (não persiste).
  async simular(dto: SimularCreditoDto) {
    const p = await this.precificar(dto);
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

  // Origina o crédito: ativo sintético + origem de capital + contrato COMPRA_PARCELADA
  // em RASCUNHO + solicitação no motor de aprovação. NÃO gera cronograma ainda.
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
        mensagem: 'Titular não possui conta — crédito avulso é só para cliente já ativo',
      });
    }

    const p = await this.precificar(dto);

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
      false, // sem cronograma — nasce na efetivação da aprovação
    );

    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      data: { solicitadoPor: solicitanteId },
    });

    // Solicitação no motor (Doc 2 §7.9-A) — a decisão acontece na Central de Aprovações.
    await this.aprovacao.criar({
      tipoOperacao: 'credito_avulso',
      referenciaTipo: 'contrato_credito',
      referenciaId: contrato.id,
      titularId,
      valorCentavos: p.totalAPagar,
      resumo: `${dto.descricao} — ${dto.numeroParcelas}× de R$ ${centavosParaReaisString(p.valorParcela)}`,
      solicitanteId,
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

  // Efetivação (chamada pelo motor ao completar as aprovações). Sem entrada: "dia
  // zero" imediato. Com entrada: cobra no Asaas e o webhook ativa (ativacao:).
  async efetivar(contratoId: string, decisorId: string): Promise<string> {
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
    if (contrato.status !== 'RASCUNHO') {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Crédito não está aguardando aprovação',
      });
    }

    const entrada = this.cent(contrato.valorEntrada);
    if (entrada > 0) {
      const customerId = await this.garantirCliente(contrato.conta.titular);
      await this.asaas.criarCobranca({
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
          aprovadoPor: decisorId,
          dataAprovacao: new Date(),
        },
      });
      return `Crédito ${contrato.numero} aprovado — cobrança da entrada gerada no Asaas.`;
    }

    // Sem entrada: a aprovação é o "dia zero" (Doc 2 §4.7-A).
    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      data: { aprovadoPor: decisorId, dataAprovacao: new Date() },
    });
    await this.contrato.ativarComCronograma(contrato.id);
    return `Crédito ${contrato.numero} aprovado e ativado — parcelas lançadas nas faturas do titular.`;
  }

  // Reprovação (via motor): cancela o contrato e libera o ativo sintético.
  async cancelar(contratoId: string, decisorId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, status: true, ativoId: true },
    });
    if (!contrato || contrato.status !== 'RASCUNHO') return;
    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      data: {
        status: 'CANCELADO',
        dataEncerramento: new Date(),
        aprovadoPor: decisorId,
      },
    });
    await this.prisma.db.ativo.update({
      where: { id: contrato.ativoId },
      data: { status: 'DISPONIVEL' },
    });
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
