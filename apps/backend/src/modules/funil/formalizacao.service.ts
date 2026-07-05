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
import { PropostaService } from './proposta.service';

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

// Instrumento dos contratos APARTADOS (ex: proteção veicular / seguro). Jurídica e
// tributariamente independente do financiamento — NÃO há reserva de domínio.
const APARTADO_TEMPLATE = `INSTRUMENTO PARTICULAR DE CONTRATAÇÃO — {{produto}}

Contrato nº {{numero}}, firmado em {{dataAssinatura}}.

CONTRATANTE: {{cliente}}, CPF/CNPJ {{cpf}}.
CONTRATADA: Azit Move (na qualidade de {{credor}}).

OBJETO: {{produto}} — contrato apartado, vinculado à compra do veículo mas com
existência jurídica própria (independe do financiamento).

CONDIÇÕES:
- Valor total: {{valorTotal}} ({{valorTotalExtenso}}).
- Cobrança: {{numeroParcelas}} de {{valorParcela}}, periodicidade {{periodicidade}}.
- Primeira cobrança em {{dataPrimeiraParcela}}.

Este instrumento não transfere domínio de veículo e não se confunde com o contrato
de financiamento. Documento gerado automaticamente (assinatura digital MOCK — provisória).`;

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
    private readonly proposta: PropostaService,
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
        simulacao: { include: { ofertas: true } },
        itens: true,
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
    // Gate defensivo: documentos obrigatórios completos (Doc 2 §4-A.5).
    const pendencias = await this.proposta.pendenciasProposta(propostaId);
    if (pendencias.length) {
      throw new UnprocessableEntityException({
        erro: 'documentos_pendentes',
        mensagem: `Documentos obrigatórios pendentes: ${pendencias
          .map((p) => `${p.nome} (${p.faltando.join(', ')})`)
          .join('; ')}`,
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
    // V3 (Doc 2 §4-A.3): a periodicidade do contrato vem da FREQUÊNCIA da oferta
    // escolhida (mensal/quinzenal/semanal); legado sem frequência segue semanal.
    const periodicidadeApi = (proposta.frequencia?.toLowerCase() ?? 'semanal') as
      | 'semanal'
      | 'quinzenal'
      | 'mensal';
    const passoDias = periodicidadeApi === 'mensal' ? 30 : periodicidadeApi === 'quinzenal' ? 14 : 7;
    const dataPrimeira = new Date(dataAssinatura.getTime() + passoDias * DIA_MS);

    // Carrinho: produtos apartados (seguro) viram contratos próprios; os demais
    // entram como itens recorrentes na cesta do contrato do veículo (§4.8).
    const apartados = proposta.itens.filter((i) => i.apartado);
    const naoApartados = proposta.itens.filter((i) => !i.apartado);
    const itensRecorrentes = naoApartados.map((i) => ({
      descricao: i.nome,
      credor: i.credor.toLowerCase() as 'azit' | 'investidor' | 'terceiro',
      valor: cent(i.valor),
      periodicidade: (i.periodicidade ? i.periodicidade.toLowerCase() : 'semanal') as 'semanal' | 'quinzenal' | 'mensal',
    }));

    // Contrato âncora (veículo) em AGUARDANDO_ASSINATURA SEM cronograma. O cronograma
    // nasce só no pagamento da entrada (ativação) — Decisão 2026-06-29.
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
        periodicidade: periodicidadeApi,
        entradaParcelada: proposta.simulacao?.ofertas.find((o) => o.selecionada)?.entradaParcelada ?? false,
        descricaoFinanciamento: `Financiamento ${proposta.ativo.descricao}`,
        credor: 'azit',
        itensRecorrentes,
      },
      'AGUARDANDO_ASSINATURA',
      false, // comCronograma = false → nasce na ativação
      { propostaPacoteId: propostaId },
    );

    // Contratos apartados (ex: seguro) — contrato próprio, mesmo ativo/conta,
    // cobrado por igual período (parcelado-shaped). Cronograma nasce na ativação.
    for (const ap of apartados) {
      const valorAp = cent(ap.valor);
      const totalAp = valorAp * proposta.numeroParcelas;
      const apContrato = await this.contrato.criar(
        {
          contaId: conta.id,
          ativoId: proposta.ativoId,
          numero: undefined,
          dataAssinatura,
          dataPrimeiraParcela: dataPrimeira,
          valorTotal: totalAp,
          valorEntrada: 0,
          numeroParcelas: proposta.numeroParcelas,
          valorParcelaInicial: valorAp,
          periodicidade: 'semanal',
          descricaoFinanciamento: ap.nome,
          credor: ap.credor.toLowerCase() as 'azit' | 'investidor' | 'terceiro',
        },
        'AGUARDANDO_ASSINATURA',
        false,
        { verificarEstoque: false, propostaPacoteId: propostaId },
      );

      // Instrumento próprio do contrato apartado (congelado no snapshot).
      const docAp = renderTemplate(APARTADO_TEMPLATE, {
        produto: ap.nome,
        numero: apContrato.numero,
        dataAssinatura: dataPorExtenso(dataAssinatura),
        cliente: proposta.titular.nome,
        cpf: proposta.titular.cpfCnpj,
        credor: ap.credor.toLowerCase(),
        valorTotal: formatCurrency(totalAp),
        valorTotalExtenso: valorPorExtenso(totalAp),
        numeroParcelas: proposta.numeroParcelas,
        valorParcela: formatCurrency(valorAp),
        periodicidade: 'semanal',
        dataPrimeiraParcela: dataPorExtenso(dataPrimeira),
      });
      const snapshotAp = {
        contrato: { numero: apContrato.numero, valorTotal: totalAp, valorEntrada: 0, numeroParcelas: proposta.numeroParcelas, valorParcela: valorAp },
        cliente: { nome: proposta.titular.nome, cpfCnpj: proposta.titular.cpfCnpj, whatsapp: proposta.titular.whatsapp },
        produto: { nome: ap.nome, apartado: true, credor: ap.credor.toLowerCase() },
        documento: docAp,
      };
      await this.prisma.db.contratoCredito.update({
        where: { id: apContrato.id },
        data: { snapshotJson: snapshotAp as unknown as Prisma.InputJsonValue, snapshotLockedAt: new Date() },
      });
    }

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

  // Status do contrato + assinaturas (para a tela de conclusão da proposta).
  async statusContrato(contratoId: string) {
    const c = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, numero: true, status: true, valorEntrada: true, entradaParcelada: true, assinaturaTitularEm: true, assinaturaAzitEm: true, cronogramaGeradoEm: true },
    });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    const entrada = cent(c.valorEntrada);
    return {
      id: c.id,
      numero: c.numero,
      status: c.status.toLowerCase(),
      entrada,
      entradaAVista: c.entradaParcelada ? Math.round(entrada * 0.6) : entrada,
      entradaParcelada: c.entradaParcelada,
      assinadoTitular: !!c.assinaturaTitularEm,
      assinadoAzit: !!c.assinaturaAzitEm,
      ambasAssinaturas: !!c.assinaturaTitularEm && !!c.assinaturaAzitEm,
      cronogramaGerado: !!c.cronogramaGeradoEm,
    };
  }

  // Status do PACOTE de contratos de uma proposta (veículo + apartados) para a
  // tela de conclusão: assina cada contrato; cobra a entrada quando todos assinados.
  async statusPacote(propostaId: string) {
    const contratos = await this.prisma.db.contratoCredito.findMany({
      where: { propostaPacoteId: propostaId },
      select: {
        id: true, numero: true, status: true, valorEntrada: true, entradaParcelada: true,
        assinaturaTitularEm: true, assinaturaAzitEm: true, cronogramaGeradoEm: true,
        itensContratados: { where: { natureza: 'PARCELADO' }, select: { descricao: true }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
    const lista = contratos.map((c) => {
      const entrada = cent(c.valorEntrada);
      return {
        id: c.id,
        numero: c.numero,
        descricao: c.itensContratados[0]?.descricao ?? c.numero,
        status: c.status.toLowerCase(),
        entrada,
        entradaAVista: c.entradaParcelada ? Math.round(entrada * 0.6) : entrada,
        entradaParcelada: c.entradaParcelada,
        ancora: entrada > 0,
        assinadoTitular: !!c.assinaturaTitularEm,
        assinadoAzit: !!c.assinaturaAzitEm,
        ambasAssinaturas: !!c.assinaturaTitularEm && !!c.assinaturaAzitEm,
        cronogramaGerado: !!c.cronogramaGeradoEm,
      };
    });
    const ancora = lista.find((c) => c.ancora) ?? lista[0] ?? null;
    return {
      propostaId,
      ancoraId: ancora?.id ?? null,
      entrada: ancora?.entrada ?? 0,
      entradaAVista: ancora?.entradaAVista ?? 0,
      entradaParcelada: ancora?.entradaParcelada ?? false,
      contratos: lista,
      todasAssinaturas: lista.length > 0 && lista.every((c) => c.ambasAssinaturas),
      cronogramaGerado: lista.length > 0 && lista.every((c) => c.cronogramaGerado),
    };
  }

  // Assinatura mock (Doc 3 §8-A.6) — titular e Azit assinam separadamente.
  async assinar(contratoId: string, parte: 'titular' | 'azit') {
    const c = await this.prisma.db.contratoCredito.findFirst({ where: { id: contratoId }, select: { status: true } });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    if (c.status !== 'AGUARDANDO_ASSINATURA') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Contrato não está em assinatura' });
    }
    await this.prisma.db.contratoCredito.update({
      where: { id: contratoId },
      data: parte === 'titular' ? { assinaturaTitularEm: new Date() } : { assinaturaAzitEm: new Date() },
    });
    return this.statusContrato(contratoId);
  }

  // 7.11 — Ativação: cria a cobrança da entrada (Asaas) e marca aguardando pagamento.
  // Exige as duas assinaturas (titular + Azit).
  async ativar(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      include: { conta: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true, email: true, whatsapp: true, asaasCustomerId: true } } } } },
    });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    // Pacote: todos os contratos da proposta (veículo + apartados) precisam estar
    // assinados pelo titular e pela Azit antes de cobrar a entrada.
    if (contrato.propostaPacoteId) {
      const pendente = await this.prisma.db.contratoCredito.findFirst({
        where: {
          propostaPacoteId: contrato.propostaPacoteId,
          OR: [{ assinaturaTitularEm: null }, { assinaturaAzitEm: null }],
        },
        select: { numero: true },
      });
      if (pendente) {
        throw new UnprocessableEntityException({
          erro: 'assinatura_pendente',
          mensagem: 'Todos os contratos do pacote precisam estar assinados (titular + Azit) antes de cobrar a entrada',
        });
      }
    } else if (!contrato.assinaturaTitularEm || !contrato.assinaturaAzitEm) {
      throw new UnprocessableEntityException({
        erro: 'assinatura_pendente',
        mensagem: 'O contrato precisa estar assinado pelo titular e pela Azit antes de cobrar a entrada',
      });
    }
    if (!['AGUARDANDO_ASSINATURA', 'AGUARDANDO_PAGAMENTO_INICIAL'].includes(contrato.status)) {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Contrato não está aguardando assinatura/pagamento inicial',
      });
    }
    // Garante o cliente no Asaas antes da 1ª cobrança (pré-requisito do gateway real).
    const customerId = await this.garantirCliente(contrato.conta.titular);

    // Entrada parcelada: cobra só os 60% à vista agora; os 40% diluídos já estão
    // nas faturas seguintes como intermediárias (Doc 2 §4-A.3).
    const valorEntrada = cent(contrato.valorEntrada);
    const valorAVista = contrato.entradaParcelada ? Math.round(valorEntrada * 0.6) : valorEntrada;
    const cobranca = await this.asaas.criarCobranca({
      externalReference: `ativacao:${contrato.id}`,
      valor: valorAVista,
      vencimento: new Date(Date.now() + 3 * DIA_MS),
      descricao: `Entrada do contrato ${contrato.numero}${contrato.entradaParcelada ? ' (à vista 60%)' : ''}`,
      customerId,
      multaPct: Number(contrato.taxaMultaAtraso.toString()),
      jurosPct: Number(contrato.taxaJurosAtraso.toString()),
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
      entradaAVista: valorAVista,
      entradaParcelada: contrato.entradaParcelada,
      cobranca: { id: cobranca.id, valor: cobranca.value, simulada: cobranca.simulada },
    };
  }

  // Garante o cadastro do cliente no Asaas (idempotente): reaproveita o id salvo
  // ou cria e persiste. Em modo simulado o AsaasService devolve um id determinístico.
  private async garantirCliente(titular: {
    id: string; nome: string; cpfCnpj: string; email: string | null; whatsapp: string; asaasCustomerId: string | null;
  }): Promise<string> {
    if (titular.asaasCustomerId) return titular.asaasCustomerId;
    const customerId = await this.asaas.criarCliente({
      titularId: titular.id, nome: titular.nome, cpfCnpj: titular.cpfCnpj, email: titular.email, telefone: titular.whatsapp,
    });
    await this.prisma.db.titular.update({ where: { id: titular.id }, data: { asaasCustomerId: customerId } });
    return customerId;
  }

  // "Dia zero": o pagamento da entrada gera o cronograma e ativa o contrato âncora
  // e TODOS os contratos do pacote (apartados — ex: seguro). Chamado tanto pelo
  // webhook PAYMENT_RECEIVED (ref ativacao:) quanto pelo simulador dev.
  async ativarPacotePorPagamento(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, numero: true, propostaPacoteId: true },
    });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    const pacote = contrato.propostaPacoteId
      ? await this.prisma.db.contratoCredito.findMany({
          where: { propostaPacoteId: contrato.propostaPacoteId },
          select: { id: true, numero: true },
        })
      : [{ id: contrato.id, numero: contrato.numero }];
    for (const c of pacote) {
      await this.contrato.ativarComCronograma(c.id);
    }
    this.logger.log(`Pacote ativado (${pacote.length} contrato(s)): entrada paga → cronogramas gerados.`);
    return { contratoId: contrato.id, numero: contrato.numero, status: 'ativo', cronogramaGerado: true, contratosAtivados: pacote.length };
  }

  // Dev: simula o pagamento da entrada (faz o papel do webhook PAYMENT_RECEIVED).
  async simularPagamentoAtivacao(contratoId: string) {
    return this.ativarPacotePorPagamento(contratoId);
  }

  private naoEncontrada() {
    return new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Proposta não encontrada' });
  }
}
