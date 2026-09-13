import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { precificarCreditoAvulso, precificarReembolsoParcelado, centavosParaReaisString, formatCurrency, renderTemplate, valorPorExtenso, numeroPorExtenso, dataPorExtenso } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { ContratoService } from '../contrato/contrato.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { AsaasService } from '../asaas/asaas.service';
import { ParametrosService } from '../simulador/parametros.service';
import { CatalogoFonteService, ParametrosCatalogoReembolso } from '../catalogo/catalogo-fonte.service';
import { ContasPagarService } from '../contas-pagar/contas-pagar.service';
import { AssinaturaService } from '../assinatura/assinatura.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { TERMO_REEMBOLSO_TEMPLATE } from './templates/termo-reembolso.template';
import {
  OriginarCreditoDto,
  SimularCreditoDto,
} from './dto/credito.dto';

const DIA_MS = 24 * 60 * 60 * 1000;

// Contratação avulsa para cliente já ativo (Doc 2 §4.7-A) — Reembolso Parcelado é o
// caso principal. É um ContratoCredito COMPRA_PARCELADA SEM ativo (doc 02 §19,
// 12/09): obrigação da CONTA, capital da ESTRUTURA do produto — sem Ativo sintético
// nem OrigemCapital fictícia. Fluxo do RP (doc 02 §18.5, 13/09): RASCUNHO → motor
// de aprovação → aprovado → TERMO enviado para assinatura (AGUARDANDO_ASSINATURA)
// → assinado por todos → cronograma nas faturas + título de desembolso ao
// FORNECEDOR (à vista, pelo principal); reprovado → cancela.
@Injectable()
export class CreditoService implements OnModuleInit {
  private readonly logger = new Logger(CreditoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contrato: ContratoService,
    private readonly aprovacao: AprovacaoService,
    private readonly asaas: AsaasService,
    private readonly parametros: ParametrosService,
    private readonly catalogoFonte: CatalogoFonteService,
    private readonly contasPagar: ContasPagarService,
    private readonly assinatura: AssinaturaService,
    private readonly notificacao: NotificacaoService,
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
    // Assinado por todos -> dia zero do RP (doc 02 sec.18.5, 13/09).
    this.assinatura.registrarPosAssinatura((contratoId) => this.aoAssinarDocumento(contratoId));
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
          where: { status: 'ATIVO' },
          select: { valorParcelaInicial: true, periodicidade: true },
        },
      },
    });
    // Limite de 30% em periodicidade EQUIVALENTE (doc 02 §17, 2026-08-16): a
    // parcela do principal (ex.: semanal) converte para MENSAL pelo fator de
    // prazo, aplica o limite e converte para a periodicidade do RP — comparar
    // parcela mensal do RP com 30% da parcela SEMANAL crua bloqueava indevido.
    const paraFreq = (p: string): 'mensal' | 'quinzenal' | 'semanal' =>
      p === 'MENSAL' ? 'mensal' : p === 'QUINZENAL' ? 'quinzenal' : 'semanal';
    const mensaisEquivalentes = (contaComContratos?.contratosCredito ?? []).map((c) =>
      Math.round(this.cent(c.valorParcelaInicial) * this.catalogoFonte.fatorPrazo(paraFreq(c.periodicidade))),
    );
    if (mensaisEquivalentes.length === 0) {
      throw new UnprocessableEntityException({
        erro: 'sem_contrato_ativo',
        mensagem: 'O Reembolso Parcelado exige um contrato ativo — o titular não tem contrato vigente',
      });
    }
    // Arredonda em centavos (A7, 04/09) — comparação de limite não usa float.
    const limiteMensal = Math.round(Math.max(...mensaisEquivalentes) * rp.limiteParcelaAcessoria);
    const limiteParcela = Math.round(limiteMensal / this.catalogoFonte.fatorPrazo(freq));
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

  // Periodicidade HERDADA do contrato principal da conta (decisão Luís 07/09 —
  // mesmo padrão do acordo, doc 02 §7.7): o crédito avulso cai nas MESMAS
  // faturas do titular, então segue o ritmo delas; o operador não escolhe.
  private async periodicidadeHerdada(titularId?: string): Promise<'semanal' | 'quinzenal' | 'mensal'> {
    if (!titularId) return 'mensal';
    const principal = await this.prisma.db.contratoCredito.findFirst({
      where: { conta: { titularId }, status: 'ATIVO' },
      orderBy: { createdAt: 'asc' },
      select: { periodicidade: true },
    });
    return principal?.periodicidade === 'MENSAL' ? 'mensal' : principal?.periodicidade === 'QUINZENAL' ? 'quinzenal' : principal?.periodicidade === 'SEMANAL' ? 'semanal' : 'mensal';
  }

  // Prévia da parcela para a tela (não persiste).
  async simular(dto: SimularCreditoDto) {
    const periodicidade = await this.periodicidadeHerdada(dto.titularId);
    const p = await this.precificar({ ...dto, periodicidade }, dto.titularId);
    return {
      periodicidade,
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

    // Periodicidade herdada (07/09): ignora a enviada — o ritmo é o das faturas.
    const periodicidadeHerdada = await this.periodicidadeHerdada(titularId);
    dto = { ...dto, periodicidade: periodicidadeHerdada };
    const p = await this.precificar(dto, titularId);
    // RF-RP04: na CONTRATAÇÃO o limite de 30% da parcela principal bloqueia.
    if (p.limiteParcela !== null && p.valorParcela > p.limiteParcela) {
      throw new UnprocessableEntityException({
        erro: 'limite_parcela_acessoria',
        mensagem: `A parcela (R$ ${centavosParaReaisString(p.valorParcela)}) ultrapassa 30% da parcela do contrato principal em periodicidade equivalente (limite R$ ${centavosParaReaisString(p.limiteParcela)} por parcela) — aumente o prazo, reduza o valor ou mude a periodicidade`,
      });
    }
    const ehReembolso = p.produto === 'reembolso_parcelado';

    // Doc 02 §18.5 (13/09): o RP paga o FORNECEDOR do cliente, nunca o cliente
    // — o beneficiário do desembolso é escolhido NA CONTRATAÇÃO.
    let fornecedor: { id: string; nome: string } | null = null;
    if (ehReembolso) {
      if (!dto.fornecedorId) {
        throw new UnprocessableEntityException({
          erro: 'fornecedor_obrigatorio',
          mensagem: 'O Reembolso Parcelado paga o fornecedor do cliente — selecione quem vamos pagar (ou cadastre o fornecedor)',
        });
      }
      fornecedor = await this.prisma.db.fornecedorFin.findFirst({
        where: { id: dto.fornecedorId, deletedAt: null, status: { not: 'BLOQUEADO' } },
        select: { id: true, nome: true },
      });
      if (!fornecedor) {
        throw new UnprocessableEntityException({
          erro: 'fornecedor_invalido',
          mensagem: 'Fornecedor não encontrado ou bloqueado — confira o cadastro em Fornecedores (financeiro)',
        });
      }
    }

    // SEM ativo sintético (doc 02 §19, 12/09): o RP é obrigação da CONTA com
    // capital da ESTRUTURA do produto — nada de Ativo OUTRO nem OrigemCapital
    // fictícia. O contrato nasce sem ativo; recebíveis sem origem de capital.
    const contrato = await this.contrato.criar(
      {
        contaId: conta.id,
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
      // Duas pontas SEPARADAS no texto (correção Luís 13/09): o fornecedor
      // recebe À VISTA; quem paga parcelado é o CLIENTE, à Azit.
      resumo: ehReembolso
        ? `Reembolso Parcelado — ${dto.descricao} — pagamos ${formatCurrency(dto.valor)} à vista a ${fornecedor!.nome}; o cliente nos paga ${dto.numeroParcelas}× de ${formatCurrency(p.valorParcela)} (taxa inicial ${formatCurrency(p.taxaInicial)} financiada)`
        : `${dto.descricao} — ${dto.numeroParcelas}× de ${formatCurrency(p.valorParcela)}`,
      // PRINCIPAL do reembolso (correção 12/09): é o valor que a Azit desembolsa
      // — o título do contas a pagar usa este número, nunca o total com encargos.
      // Fornecedor (13/09): beneficiário real do título de desembolso.
      payload: { valorPrincipal: dto.valor, fornecedorId: fornecedor?.id, fornecedorNome: fornecedor?.nome },
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

    // Reembolso Parcelado (doc 02 §18.5, 13/09): aprovação NÃO ativa — gera o
    // MINI CONTRATO e envia para assinatura digital. Cronograma e título só
    // nascem quando TODOS assinam (handler pós-assinatura registrado abaixo).
    const aprovacaoRp = await this.aprovacaoReembolso(contrato.id);
    if (aprovacaoRp) {
      const termo = await this.gerarTermoReembolso(contrato.id);
      await this.prisma.db.contratoCredito.update({
        where: { id: contrato.id },
        data: {
          aprovadoPor: decisorId,
          dataAprovacao: new Date(),
          status: 'AGUARDANDO_ASSINATURA',
          snapshotJson: { documento: termo } as unknown as Prisma.InputJsonValue,
        },
      });
      // Envio automático: a aprovação JÁ é a decisão de gastar o documento do
      // plano. Falha da ZapSign não desfaz a aprovação — vira alerta e o
      // operador reenvia pelo detalhe do contrato.
      try {
        await this.assinatura.enviar(contrato.id, decisorId);
      } catch (e) {
        this.logger.error(`Envio do termo do RP ${contrato.numero} falhou: ${(e as Error).message}`);
        await this.notificacao
          .emitir({
            titulo: `Termo do Reembolso ${contrato.numero} NÃO foi enviado para assinatura`,
            corpo: `${(e as Error).message}. Reenvie pelo detalhe do contrato.`,
            rota: `/contratos/${contrato.id}`,
            tipo: 'FALHA',
            area: 'COMERCIAL',
          })
          .catch(() => undefined);
      }
      return `Reembolso ${contrato.numero} aprovado — termo enviado para assinatura digital; o cronograma e o pagamento ao fornecedor saem quando todos assinarem.`;
    }

    // Crédito avulso genérico sem entrada: a aprovação é o "dia zero" (Doc 2 §4.7-A).
    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      data: { aprovadoPor: decisorId, dataAprovacao: new Date() },
    });
    await this.contrato.ativarComCronograma(contrato.id);
    return `Crédito ${contrato.numero} aprovado e ativado — parcelas lançadas nas faturas do titular.`;
  }

  // Assinado por todos → "dia zero" do RP: cronograma nas faturas + título de
  // desembolso ao fornecedor (doc 02 §18.5, 13/09). Idempotente: o cronograma
  // tem guard próprio e o título só nasce uma vez por contrato.
  private async aoAssinarDocumento(contratoId: string): Promise<void> {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId, status: 'AGUARDANDO_ASSINATURA' },
      include: { conta: { include: { titular: { select: { nome: true } } } } },
    });
    if (!contrato) return; // não é um contrato aguardando assinatura (ou já ativado)
    const aprovacaoRp = await this.aprovacaoReembolso(contratoId);
    if (!aprovacaoRp) return; // contrato principal — o fluxo dele segue pela entrada
    await this.contrato.ativarComCronograma(contratoId);
    const jaTemTitulo = await this.prisma.db.tituloPagar.count({ where: { contratoCreditoId: contratoId, deletedAt: null } });
    if (jaTemTitulo === 0) {
      const payload = aprovacaoRp.payload as null | { valorPrincipal?: number; fornecedorId?: string };
      await this.contasPagar.criarDesembolsoReembolso(
        {
          id: contrato.id,
          numero: contrato.numero,
          valorCentavos: payload?.valorPrincipal ?? this.cent(contrato.valorTotal),
          clienteNome: contrato.conta.titular.nome,
          ativoId: contrato.ativoId,
          fornecedorId: payload?.fornecedorId ?? null,
        },
        undefined,
      );
    }
    await this.notificacao
      .emitir({
        titulo: `Reembolso ${contrato.numero} assinado e ativado`,
        corpo: 'Parcelas lançadas nas faturas do cliente; pagamento ao fornecedor criado no contas a pagar.',
        rota: '/contas-a-pagar',
        tipo: 'ASSINATURA',
        area: 'FINANCEIRO_ADMINISTRATIVO',
      })
      .catch(() => undefined);
  }

  // Texto do mini contrato (placeholder funcional — Regra 12, jurídico valida).
  private async gerarTermoReembolso(contratoId: string): Promise<string> {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      include: {
        conta: { include: { titular: { select: { nome: true, cpfCnpj: true, whatsapp: true } } } },
        itensContratados: { where: { natureza: 'PARCELADO' }, take: 1, select: { descricao: true } },
      },
    });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    const aprovacao = await this.aprovacaoReembolso(contratoId);
    const payload = (aprovacao?.payload ?? {}) as { valorPrincipal?: number; fornecedorId?: string; fornecedorNome?: string };
    const fornecedorDoc = payload.fornecedorId
      ? (await this.prisma.db.fornecedorFin.findFirst({ where: { id: payload.fornecedorId }, select: { cpfCnpj: true } }))?.cpfCnpj
      : undefined;
    const rp = await this.catalogoFonte.reembolsoParcelado();
    const params = await this.assinatura.obterParametros();
    const t = contrato.conta.titular;
    const principal = payload.valorPrincipal ?? this.cent(contrato.valorTotal);
    const total = this.cent(contrato.valorTotal);
    const parcela = this.cent(contrato.valorParcelaInicial);
    const plural = { MENSAL: 'mensais', QUINZENAL: 'quinzenais', SEMANAL: 'semanais' }[contrato.periodicidade] ?? 'mensais';
    const linhaTest = (nome?: string, cpf?: string) => (nome ? `${nome}\nCPF: ${cpf || '—'}` : 'Nome:\nCPF:');
    return renderTemplate(TERMO_REEMBOLSO_TEMPLATE, {
      numeroContrato: contrato.numero,
      razaoCredora: 'Azit Move (entidade Reembolso Parcelado)',
      nomeCliente: t.nome,
      cpfCliente: t.cpfCnpj,
      telefoneCliente: t.whatsapp ?? '—',
      valorPrincipal: `R$ ${centavosParaReaisString(principal)}`,
      valorPrincipalExtenso: valorPorExtenso(principal),
      nomeFornecedor: payload.fornecedorNome ?? 'fornecedor indicado pelo cliente',
      docFornecedor: fornecedorDoc ? `CPF/CNPJ ${fornecedorDoc}` : 'documento no cadastro de fornecedores',
      finalidade: contrato.itensContratados[0]?.descricao ?? 'despesa indicada pelo cliente',
      valorTotal: `R$ ${centavosParaReaisString(total)}`,
      valorTotalExtenso: valorPorExtenso(total),
      taxaInicial: `R$ ${centavosParaReaisString(rp ? Math.max(Math.round(principal * rp.taxaInicialPct), rp.taxaInicialMinima) : 0)}`,
      encargoMensal: `${(((rp?.encargoMensal ?? 0.1999) * 100)).toFixed(2).replace('.', ',')}%`,
      qtdeParcelas: contrato.numeroParcelas,
      qtdeParcelasExtenso: numeroPorExtenso(contrato.numeroParcelas),
      periodicidadePlural: plural,
      valorParcela: `R$ ${centavosParaReaisString(parcela)}`,
      valorParcelaExtenso: valorPorExtenso(parcela),
      dataPrimeiraParcela: contrato.dataPrimeiraParcela.toLocaleDateString('pt-BR'),
      dataAssinaturaLinha: `VITÓRIA/ES, ${dataPorExtenso(new Date())}.`,
      testemunha1Linha: linhaTest(params.testemunha1Nome, params.testemunha1Cpf),
      testemunha2Linha: linhaTest(params.testemunha2Nome, params.testemunha2Cpf),
    });
  }

  // Reprovação (via motor): cancela o contrato (contratos legados com ativo
  // sintético liberam o ativo; os novos nascem sem ativo — doc 02 §19, 12/09).
  async cancelar(contratoId: string, decisorId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, status: true, ativoId: true },
    });
    if (!contrato || contrato.status !== 'RASCUNHO') return;
    await this.prisma.db.contratoCredito.update({
      where: { id: contrato.id },
      data: {
        status: 'ENCERRADO',
        motivoEncerramento: 'CANCELAMENTO',
        dataEncerramento: new Date(),
        aprovadoPor: decisorId,
      },
    });
    if (contrato.ativoId) {
      await this.prisma.db.ativo.update({
        where: { id: contrato.ativoId },
        data: { status: 'DISPONIVEL' },
      });
    }
  }

  // Solicitação de Reembolso Parcelado deste contrato (com o payload — traz o
  // valor PRINCIPAL para o título de desembolso).
  private async aprovacaoReembolso(contratoId: string) {
    return this.prisma.db.aprovacao.findFirst({
      where: { referenciaTipo: 'contrato_credito', referenciaId: contratoId, tipoOperacao: 'reembolso_parcelado' },
      select: { payload: true },
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
    const reutilizavel = this.asaas.clienteReutilizavel(titular.asaasCustomerId);
    if (reutilizavel) return reutilizavel;
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
