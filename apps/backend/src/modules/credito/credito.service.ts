import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { precificarCreditoAvulso, precificarReembolsoParcelado, centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AtivoService } from '../ativo/ativo.service';
import { OrigemCapitalService } from '../origem-capital/origem-capital.service';
import { ContratoService } from '../contrato/contrato.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { AsaasService } from '../asaas/asaas.service';
import { ParametrosService } from '../simulador/parametros.service';
import { CatalogoFonteService, ParametrosCatalogoReembolso } from '../catalogo/catalogo-fonte.service';
import { ContasPagarService } from '../contas-pagar/contas-pagar.service';
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
    private readonly catalogoFonte: CatalogoFonteService,
    private readonly contasPagar: ContasPagarService,
  ) {}

  onModuleInit() {
    const efetivador = {
      aprovada: async (a: { referenciaId: string; decisorId: string }) => this.efetivar(a.referenciaId, a.decisorId),
      reprovada: async (a: { referenciaId: string; decisorId: string }) => {
        await this.cancelar(a.referenciaId, a.decisorId);
      },
    };
    this.aprovacao.registrarEfetivador('credito_avulso', efetivador);
    // F3: o Reembolso Parcelado usa o MESMO ciclo de efetivação, com alçada própria.
    this.aprovacao.registrarEfetivador('reembolso_parcelado', efetivador);
  }

  // F3: valida o pedido contra as regras do produto do Catálogo. O limite de 30%
  // usa a MAIOR parcela entre os contratos ativos da conta (parcela principal).
  private async validarReembolso(
    rp: ParametrosCatalogoReembolso,
    dto: { valor: number; numeroParcelas: number; valorEntrada: number; periodicidade?: string },
    titularId?: string,
  ): Promise<{ limiteParcela: number | null }> {
    const reaisFmt = (c: number) => `R$ ${centavosParaReaisString(c)}`;
    if (dto.valorEntrada > 0) {
      throw new UnprocessableEntityException({
        erro: 'entrada_nao_permitida',
        mensagem: 'O Reembolso Parcelado não tem entrada — o valor integral é parcelado',
      });
    }
    if (dto.valor < rp.valorMinimo || dto.valor > rp.valorMaximo) {
      throw new UnprocessableEntityException({
        erro: 'valor_fora_da_faixa',
        mensagem: `O valor do reembolso deve estar entre ${reaisFmt(rp.valorMinimo)} e ${reaisFmt(rp.valorMaximo)}`,
      });
    }
    const freq = (dto.periodicidade ?? 'mensal') as 'mensal' | 'quinzenal' | 'semanal';
    const maxParcelas = this.catalogoFonte.maxParcelasReembolso(rp.prazoMaximoMeses, freq);
    if (dto.numeroParcelas > maxParcelas) {
      throw new UnprocessableEntityException({
        erro: 'prazo_maximo',
        mensagem: `No ${freq} o máximo é ${maxParcelas} parcelas (prazo do produto: ${rp.prazoMaximoMeses} meses)`,
      });
    }
    if (!titularId) return { limiteParcela: null };
    const contaComContratos = await this.prisma.db.conta.findFirst({
      where: { titularId },
      include: {
        contratosCredito: {
          where: { status: { in: ['ATIVO', 'INADIMPLENTE'] } },
          select: { valorParcelaInicial: true },
        },
      },
    });
    const parcelas = (contaComContratos?.contratosCredito ?? []).map((c) => this.cent(c.valorParcelaInicial));
    if (parcelas.length === 0) {
      throw new UnprocessableEntityException({
        erro: 'sem_contrato_ativo',
        mensagem: 'O Reembolso Parcelado exige um contrato ativo — o titular não tem contrato vigente',
      });
    }
    const limiteParcela = Math.round(Math.max(...parcelas) * rp.limiteParcelaAcessoria);
    return { limiteParcela };
  }

  private cent(v: unknown): number {
    return Math.round(Number(v?.toString() ?? '0') * 100);
  }

  private passoDias(periodicidade: string): number {
    return periodicidade === 'mensal' ? 30 : periodicidade === 'quinzenal' ? 14 : 7;
  }

  // Precificação. Se o produto Reembolso Parcelado está ATIVO no Catálogo (F3),
  // valem as regras dele (encargo 19,99% a.m. equivalente + taxa inicial
  // financiada); senão, o provisório com a taxa vigente do simulador.
  private async precificar(
    dto: { valor: number; numeroParcelas: number; valorEntrada: number; periodicidade?: string },
    titularId?: string,
  ) {
    const rp = await this.catalogoFonte.reembolsoParcelado();
    if (rp) {
      const { limiteParcela } = await this.validarReembolso(rp, dto, titularId);
      const freq = (dto.periodicidade ?? 'mensal') as 'mensal' | 'quinzenal' | 'semanal';
      const r = precificarReembolsoParcelado({
        valorReembolso: dto.valor,
        numeroParcelas: dto.numeroParcelas,
        frequencia: freq,
        encargoMensal: rp.encargoMensal,
        taxaInicialPct: rp.taxaInicialPct,
        taxaInicialMinima: rp.taxaInicialMinima,
      });
      if (r.valorParcela < rp.valorMinimoParcela) {
        throw new UnprocessableEntityException({
          erro: 'parcela_minima',
          mensagem: `A parcela ficou abaixo da mínima do produto (R$ ${centavosParaReaisString(rp.valorMinimoParcela)}) — reduza o número de parcelas`,
        });
      }
      return {
        produto: 'reembolso_parcelado' as const,
        valorFinanciado: r.valorFinanciado,
        taxaInicial: r.taxaInicial,
        encargoMensal: rp.encargoMensal,
        limiteParcela,
        valorParcela: r.valorParcela,
        numeroParcelas: dto.numeroParcelas,
        totalAPagar: r.totalAPagar,
        taxaMensal: rp.encargoMensal,
        provisorio: false as const,
      };
    }
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
      produto: 'credito_avulso' as const,
      valorFinanciado,
      taxaInicial: 0,
      encargoMensal: params.taxaMensal,
      limiteParcela: null as number | null,
      valorParcela,
      numeroParcelas: dto.numeroParcelas,
      totalAPagar: dto.valorEntrada + valorParcela * dto.numeroParcelas,
      taxaMensal: params.taxaMensal,
      provisorio: true as const,
    };
  }

  // Prévia da parcela para a tela (não persiste).
  async simular(dto: SimularCreditoDto) {
    const p = await this.precificar(dto, dto.titularId);
    return {
      produto: p.produto,
      valor: dto.valor,
      valorEntrada: dto.valorEntrada,
      valorFinanciado: p.valorFinanciado,
      taxaInicial: p.taxaInicial,
      encargoMensal: p.encargoMensal,
      limiteParcela: p.limiteParcela,
      excedeLimite: p.limiteParcela !== null && p.valorParcela > p.limiteParcela,
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

    const p = await this.precificar(dto, titularId);
    // RF-RP04: na CONTRATAÇÃO o limite de 30% da parcela principal bloqueia.
    if (p.limiteParcela !== null && p.valorParcela > p.limiteParcela) {
      throw new UnprocessableEntityException({
        erro: 'limite_parcela_acessoria',
        mensagem: `A parcela (R$ ${centavosParaReaisString(p.valorParcela)}) ultrapassa 30% da parcela do contrato principal (limite R$ ${centavosParaReaisString(p.limiteParcela)}) — aumente o prazo ou reduza o valor`,
      });
    }
    const ehReembolso = p.produto === 'reembolso_parcelado';

    const ativo = await this.ativo.criar({
      tipo: 'outro',
      descricao: `${ehReembolso ? 'Reembolso Parcelado' : dto.descricao} — ${titular.nome}`,
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

    // Solicitação no motor (Doc 2 §7.9-A) — a decisão acontece na Central de
    // Aprovações. Alçada POR PRODUTO (decisão 13/07): reembolso tem tipo próprio.
    await this.aprovacao.criar({
      tipoOperacao: ehReembolso ? 'reembolso_parcelado' : 'credito_avulso',
      referenciaTipo: 'contrato_credito',
      referenciaId: contrato.id,
      titularId,
      valorCentavos: p.totalAPagar,
      resumo: ehReembolso
        ? `Reembolso Parcelado (termo TRP001) — ${dto.descricao} — ${dto.numeroParcelas}× de R$ ${centavosParaReaisString(p.valorParcela)} (taxa inicial R$ ${centavosParaReaisString(p.taxaInicial)} financiada)`
        : `${dto.descricao} — ${dto.numeroParcelas}× de R$ ${centavosParaReaisString(p.valorParcela)}`,
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
    // Decisão 5 (03/08, RCPG029): Reembolso Parcelado gera o TÍTULO DE
    // DESEMBOLSO no contas a pagar, vinculado à operação e ao recebível.
    if (await this.ehReembolso(contrato.id)) {
      await this.contasPagar.criarDesembolsoReembolso(
        {
          id: contrato.id,
          numero: contrato.numero,
          valorCentavos: this.cent(contrato.valorTotal),
          clienteNome: contrato.conta.titular.nome,
          ativoId: contrato.ativoId,
        },
        decisorId,
      );
    }
    return `Crédito ${contrato.numero} aprovado e ativado — parcelas lançadas nas faturas do titular; desembolso encaminhado ao contas a pagar quando aplicável.`;
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

  // O contrato veio de uma solicitação de Reembolso Parcelado? (aprovação com esse tipo)
  private async ehReembolso(contratoId: string): Promise<boolean> {
    const a = await this.prisma.db.aprovacao.findFirst({
      where: { referenciaTipo: 'contrato_credito', referenciaId: contratoId, tipoOperacao: 'reembolso_parcelado' },
    });
    return !!a;
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
