import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, StatusTituloPagar, StatusLotePagamento } from '@prisma/client';
import { centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';

const reais = (c: number) => (c / 100).toFixed(2);
const cent = (d: Prisma.Decimal | null | undefined): number =>
  d !== null && d !== undefined ? Math.round(Number(d.toString()) * 100) : 0;
const DIA_MS = 24 * 60 * 60 * 1000;

// Contas a Pagar — Financeiro Administrativo / ERP Enxuto (doc 02 §18).
// Códigos RCPG/RF referem-se ao Processo de Contas a Pagar V1.0 (AZH-FIN-PROC-001).
// Aprovações (orçamento, despesa, lote, fornecedor, reabertura) usam o MOTOR
// EXISTENTE — cada tipo com faixas próprias de alçada (decisão 03/08).
@Injectable()
export class ContasPagarService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aprovacao: AprovacaoService,
  ) {}

  onModuleInit() {
    // RCPG011: eventos decisórios distintos, cada um com efetivação própria.
    this.aprovacao.registrarEfetivador('fornecedor_dados_bancarios', {
      aprovada: async (a) => this.efetivarFornecedor(a.referenciaId, a.decisorId),
      reprovada: async (a) => {
        await this.reprovarFornecedor(a.referenciaId, a.decisorId);
      },
    });
    this.aprovacao.registrarEfetivador('orcamento_contas_pagar', {
      aprovada: async (a) => this.efetivarOrcamento(a.referenciaId, true),
      reprovada: async (a) => {
        await this.efetivarOrcamento(a.referenciaId, false);
      },
    });
    this.aprovacao.registrarEfetivador('despesa_contas_pagar', {
      aprovada: async (a) => this.efetivarTitulo(a.referenciaId, true, a.decisorId),
      reprovada: async (a) => {
        await this.efetivarTitulo(a.referenciaId, false, a.decisorId);
      },
    });
    this.aprovacao.registrarEfetivador('lote_pagamento', {
      aprovada: async (a) => this.efetivarLote(a.referenciaId, true),
      reprovada: async (a) => {
        await this.efetivarLote(a.referenciaId, false);
      },
    });
    this.aprovacao.registrarEfetivador('reabertura_titulo', {
      aprovada: async (a) => this.efetivarReabertura(a.referenciaId, a.decisorId),
      reprovada: async () => undefined,
    });
  }

  private async auditar(usuarioId: string | undefined, acao: string, entidadeId: string, antes?: unknown, depois?: unknown) {
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao,
        entidade: 'contas_a_pagar',
        entidadeId,
        antes: antes ? (JSON.parse(JSON.stringify(antes)) as Prisma.InputJsonValue) : undefined,
        depois: depois ? (JSON.parse(JSON.stringify(depois)) as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  // RCPG015/016: corte 12h em dia útil — data programada padrão.
  proximaDataProgramada(agora = new Date()): Date {
    const d = new Date(agora);
    const diaUtil = (x: Date) => x.getDay() !== 0 && x.getDay() !== 6;
    if (!(diaUtil(d) && d.getHours() < 12)) {
      do {
        d.setTime(d.getTime() + DIA_MS);
      } while (!diaUtil(d));
    }
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ---------------------------------------------------------------------------
  // FA-CP-00 — cadastros estruturantes
  // ---------------------------------------------------------------------------

  async configuracao() {
    const [entidades, naturezas, centros, estruturas] = await Promise.all([
      this.prisma.db.entidadeLegal.findMany({
        where: { deletedAt: null },
        include: { contas: { where: { deletedAt: null } } },
        orderBy: { razaoSocial: 'asc' },
      }),
      this.prisma.db.naturezaFinanceira.findMany({ orderBy: { codigo: 'asc' } }),
      this.prisma.db.centroCustoArea.findMany({ orderBy: { codigo: 'asc' } }),
      this.prisma.db.estruturaJuridica.findMany({ where: { deletedAt: null }, select: { id: true, nome: true } }),
    ]);
    const nomeEstrutura = new Map(estruturas.map((s) => [s.id, s.nome]));
    return {
      entidades: entidades.map((e) => ({
        id: e.id,
        razaoSocial: e.razaoSocial,
        cnpj: e.cnpj,
        unidadeNegocio: e.unidadeNegocio,
        // Vínculo com a Estrutura Jurídica do Capital (decisão 3 de 03/08 +
        // homologação 04/08: produtos viram estruturas próprias).
        estruturaId: e.estruturaId,
        estruturaNome: e.estruturaId ? (nomeEstrutura.get(e.estruturaId) ?? null) : null,
        ativo: e.ativo,
        contas: e.contas.map((c) => ({ id: c.id, banco: c.banco, agencia: c.agencia, conta: c.conta, tipo: c.tipo, ativo: c.ativo })),
      })),
      naturezas: naturezas.map((n) => ({
        id: n.id, codigo: n.codigo, nome: n.nome, exigeAtivo: n.exigeAtivo,
        exigeCotacao: n.exigeCotacao, especial: n.especial, exigeJustificativa: n.exigeJustificativa, ativo: n.ativo,
      })),
      centros: centros.map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome, responsavelUsuarioId: c.responsavelUsuarioId, ativo: c.ativo })),
    };
  }

  async criarEntidade(dto: { razaoSocial: string; cnpj?: string; unidadeNegocio?: string; estruturaId?: string }, usuarioId?: string) {
    const e = await this.prisma.db.entidadeLegal.create({ data: dto });
    await this.auditar(usuarioId, 'cap_entidade_criada', e.id, undefined, dto);
    return e;
  }

  async criarContaBancaria(entidadeId: string, dto: { banco: string; agencia?: string; conta?: string; tipo?: string; finalidade?: string }, usuarioId?: string) {
    const c = await this.prisma.db.contaBancaria.create({ data: { entidadeId, ...dto } });
    await this.auditar(usuarioId, 'cap_conta_bancaria_criada', c.id, undefined, { entidadeId, ...dto });
    return c;
  }

  async criarNatureza(dto: { codigo: string; nome: string; exigeAtivo?: boolean; exigeCotacao?: boolean; especial?: boolean; exigeJustificativa?: boolean }, usuarioId?: string) {
    const n = await this.prisma.db.naturezaFinanceira.create({ data: dto });
    await this.auditar(usuarioId, 'cap_natureza_criada', n.id, undefined, dto);
    return n;
  }

  async criarCentro(dto: { codigo: string; nome: string; responsavelUsuarioId?: string }, usuarioId?: string) {
    const c = await this.prisma.db.centroCustoArea.create({ data: dto });
    await this.auditar(usuarioId, 'cap_centro_criado', c.id, undefined, dto);
    return c;
  }

  // ---------------------------------------------------------------------------
  // FA-CP-01 — fornecedores (RCPG007/008/025/026)
  // ---------------------------------------------------------------------------

  async listarFornecedores() {
    const fs = await this.prisma.db.fornecedorFin.findMany({
      where: { deletedAt: null },
      include: { dadosBancarios: { orderBy: { versao: 'desc' } } },
      orderBy: { nome: 'asc' },
    });
    return fs.map((f) => ({
      id: f.id,
      cpfCnpj: f.cpfCnpj,
      nome: f.nome,
      contato: f.contato,
      email: f.email,
      status: f.status,
      alertaProximoPagamento: f.alertaProximoPagamento,
      motivoBloqueio: f.motivoBloqueio,
      dadosBancarios: f.dadosBancarios.map((d) => ({
        id: d.id, versao: d.versao, banco: d.banco, agencia: d.agencia, conta: d.conta,
        chavePix: d.chavePix, ativo: d.ativo, motivo: d.motivo, criadoEm: d.createdAt,
      })),
    }));
  }

  // RF-02/03: cadastro com detecção de duplicidade; nasce aguardando aprovação.
  async criarFornecedor(
    dto: { cpfCnpj: string; nome: string; contato?: string; email?: string; banco?: string; agencia?: string; conta?: string; chavePix?: string },
    usuarioId: string,
  ) {
    const cpf = dto.cpfCnpj.replace(/\D/g, '');
    const existente = await this.prisma.db.fornecedorFin.findFirst({ where: { cpfCnpj: cpf } });
    if (existente) {
      throw new UnprocessableEntityException({
        erro: 'fornecedor_duplicado',
        mensagem: `Já existe fornecedor com este CPF/CNPJ: ${existente.nome} (${existente.status})`,
      });
    }
    const f = await this.prisma.db.fornecedorFin.create({
      data: {
        cpfCnpj: cpf,
        nome: dto.nome,
        contato: dto.contato,
        email: dto.email,
        status: 'AGUARDANDO_APROVACAO',
        dadosBancarios: {
          create: { versao: 1, banco: dto.banco, agencia: dto.agencia, conta: dto.conta, chavePix: dto.chavePix, criadoPor: usuarioId },
        },
      },
    });
    // RCPG008: quem cadastra não ativa — Diretor aprova na Central.
    await this.aprovacao.criar({
      tipoOperacao: 'fornecedor_dados_bancarios',
      referenciaTipo: 'fornecedor_financeiro',
      referenciaId: f.id,
      valorCentavos: 0,
      resumo: `Ativação de fornecedor — ${dto.nome} (${cpf})`,
      solicitanteId: usuarioId,
    });
    await this.auditar(usuarioId, 'cap_fornecedor_criado', f.id, undefined, { ...dto, cpfCnpj: cpf });
    return { id: f.id, status: 'aguardando_aprovacao' };
  }

  // RCPG026: alteração bancária cria NOVA VERSÃO inativa + aprovação do Diretor.
  async alterarDadosBancarios(
    fornecedorId: string,
    dto: { banco?: string; agencia?: string; conta?: string; chavePix?: string; motivo: string },
    usuarioId: string,
  ) {
    const f = await this.prisma.db.fornecedorFin.findFirst({
      where: { id: fornecedorId },
      include: { dadosBancarios: { orderBy: { versao: 'desc' }, take: 1 } },
    });
    if (!f) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fornecedor não encontrado' });
    const versao = (f.dadosBancarios[0]?.versao ?? 0) + 1;
    await this.prisma.db.fornecedorDadosBancarios.create({
      data: { fornecedorId, versao, banco: dto.banco, agencia: dto.agencia, conta: dto.conta, chavePix: dto.chavePix, motivo: dto.motivo, criadoPor: usuarioId },
    });
    await this.aprovacao.criar({
      tipoOperacao: 'fornecedor_dados_bancarios',
      referenciaTipo: 'fornecedor_financeiro',
      referenciaId: fornecedorId,
      valorCentavos: 0,
      resumo: `Alteração bancária — ${f.nome}: ${dto.motivo}`,
      solicitanteId: usuarioId,
    });
    await this.auditar(usuarioId, 'cap_fornecedor_alteracao_bancaria', fornecedorId, f.dadosBancarios[0] ?? undefined, dto);
    return { versao, status: 'aguardando_aprovacao' };
  }

  private async efetivarFornecedor(fornecedorId: string, decisorId: string): Promise<string> {
    const f = await this.prisma.db.fornecedorFin.findFirst({
      where: { id: fornecedorId },
      include: { dadosBancarios: { orderBy: { versao: 'desc' } } },
    });
    if (!f) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fornecedor não encontrado' });
    const maisRecente = f.dadosBancarios[0];
    const tinhaVersaoAtiva = f.dadosBancarios.some((d) => d.ativo && d.id !== maisRecente?.id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.fornecedorDadosBancarios.updateMany({ where: { fornecedorId }, data: { ativo: false } });
      if (maisRecente) {
        await tx.fornecedorDadosBancarios.update({ where: { id: maisRecente.id }, data: { ativo: true, aprovadoPor: decisorId } });
      }
      await tx.fornecedorFin.update({
        where: { id: fornecedorId },
        // RCPG025: primeiro pagamento após ALTERAÇÃO bancária gera alerta.
        data: { status: 'ATIVO', alertaProximoPagamento: tinhaVersaoAtiva },
      });
    });
    return `Fornecedor ${f.nome} ativo — dados bancários versão ${maisRecente?.versao ?? 1} aprovados.`;
  }

  private async reprovarFornecedor(fornecedorId: string, decisorId: string) {
    const f = await this.prisma.db.fornecedorFin.findFirst({ where: { id: fornecedorId } });
    if (!f) return;
    if (f.status === 'AGUARDANDO_APROVACAO') {
      await this.prisma.db.fornecedorFin.update({ where: { id: fornecedorId }, data: { status: 'EM_CADASTRO' } });
    }
    await this.auditar(decisorId, 'cap_fornecedor_reprovado', fornecedorId);
  }

  async statusFornecedor(fornecedorId: string, status: 'BLOQUEADO' | 'INATIVO' | 'ATIVO', motivo: string | undefined, usuarioId: string) {
    const f = await this.prisma.db.fornecedorFin.findFirst({ where: { id: fornecedorId } });
    if (!f) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fornecedor não encontrado' });
    await this.prisma.db.fornecedorFin.update({
      where: { id: fornecedorId },
      data: { status, motivoBloqueio: status === 'BLOQUEADO' ? (motivo ?? 'Bloqueado') : null },
    });
    await this.auditar(usuarioId, 'cap_fornecedor_status', fornecedorId, { status: f.status }, { status, motivo });
    return { resultado: 'ok' };
  }

  // ---------------------------------------------------------------------------
  // FA-CP-02 — orçamento (RF-04/05/06)
  // ---------------------------------------------------------------------------

  async listarOrcamentos() {
    const os = await this.prisma.db.solicitacaoOrcamento.findMany({
      where: { deletedAt: null },
      include: { propostas: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const fornecedores = await this.prisma.db.fornecedorFin.findMany({ select: { id: true, nome: true } });
    const nomeF = new Map(fornecedores.map((f) => [f.id, f.nome]));
    return os.map((o) => ({
      id: o.id,
      descricao: o.descricao,
      entidadeId: o.entidadeId,
      urgencia: o.urgencia,
      status: o.status,
      justificativaDispensa: o.justificativaDispensa,
      tituloGeradoId: o.tituloGeradoId,
      criadoEm: o.createdAt,
      propostas: o.propostas.map((p) => ({
        id: p.id,
        fornecedor: p.fornecedorId ? (nomeF.get(p.fornecedorId) ?? p.fornecedorId) : p.nomeFornecedor,
        fornecedorId: p.fornecedorId,
        valor: cent(p.valor),
        prazo: p.prazo,
        garantia: p.garantia,
        condicao: p.condicao,
        selecionado: p.selecionado,
        motivoSelecao: p.motivoSelecao,
      })),
    }));
  }

  async criarOrcamento(
    dto: {
      entidadeId: string; descricao: string; naturezaId?: string; centroCustoAreaId?: string; ativoId?: string;
      urgencia?: 'NORMAL' | 'PRIORIDADE' | 'EMERGENCIA'; justificativaDispensa?: string;
      propostas: { fornecedorId?: string; nomeFornecedor?: string; valor: number; prazo?: string; garantia?: string; condicao?: string }[];
    },
    usuarioId: string,
  ) {
    if (dto.propostas.length === 0) {
      throw new UnprocessableEntityException({ erro: 'sem_propostas', mensagem: 'Registre ao menos uma proposta de fornecedor' });
    }
    const o = await this.prisma.db.solicitacaoOrcamento.create({
      data: {
        entidadeId: dto.entidadeId,
        solicitanteId: usuarioId,
        descricao: dto.descricao,
        naturezaId: dto.naturezaId,
        centroCustoAreaId: dto.centroCustoAreaId,
        ativoId: dto.ativoId,
        urgencia: dto.urgencia ?? 'NORMAL',
        justificativaDispensa: dto.justificativaDispensa,
        propostas: {
          create: dto.propostas.map((p) => ({
            fornecedorId: p.fornecedorId,
            nomeFornecedor: p.nomeFornecedor,
            valor: reais(p.valor),
            prazo: p.prazo,
            garantia: p.garantia,
            condicao: p.condicao,
          })),
        },
      },
    });
    await this.auditar(usuarioId, 'cap_orcamento_criado', o.id, undefined, dto);
    return { id: o.id, status: o.status };
  }

  // Seleciona a proposta e submete à alçada (RF-05).
  async submeterOrcamento(id: string, propostaId: string, motivoSelecao: string | undefined, usuarioId: string) {
    const o = await this.prisma.db.solicitacaoOrcamento.findFirst({ where: { id }, include: { propostas: true } });
    if (!o) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Solicitação de orçamento não encontrada' });
    const proposta = o.propostas.find((p) => p.id === propostaId);
    if (!proposta) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Proposta não encontrada' });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.orcamentoFornecedor.updateMany({ where: { solicitacaoId: id }, data: { selecionado: false } });
      await tx.orcamentoFornecedor.update({ where: { id: propostaId }, data: { selecionado: true, motivoSelecao } });
      await tx.solicitacaoOrcamento.update({ where: { id }, data: { status: 'AGUARDANDO_APROVACAO' } });
    });
    await this.aprovacao.criar({
      tipoOperacao: 'orcamento_contas_pagar',
      referenciaTipo: 'solicitacao_orcamento',
      referenciaId: id,
      valorCentavos: cent(proposta.valor),
      resumo: `Orçamento — ${o.descricao}: ${proposta.nomeFornecedor ?? 'fornecedor cadastrado'} por R$ ${centavosParaReaisString(cent(proposta.valor))}`,
      solicitanteId: usuarioId,
    });
    await this.auditar(usuarioId, 'cap_orcamento_submetido', id, undefined, { propostaId, motivoSelecao });
    return { resultado: 'aguardando_aprovacao' };
  }

  private async efetivarOrcamento(id: string, aprovado: boolean): Promise<string | void> {
    await this.prisma.db.solicitacaoOrcamento.update({
      where: { id },
      data: { status: aprovado ? 'APROVADO' : 'RECUSADO' },
    });
    if (aprovado) return 'Orçamento aprovado — pode ser convertido em despesa.';
  }

  // RF-06: conversão preserva o vínculo (origemSolicitacaoId).
  async converterOrcamento(id: string, dto: { fornecedorId: string; vencimento: string; competencia?: string; naturezaId: string; centroCustoAreaId: string; formaPagamento?: string }, usuarioId: string) {
    const o = await this.prisma.db.solicitacaoOrcamento.findFirst({ where: { id }, include: { propostas: { where: { selecionado: true } } } });
    if (!o) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Solicitação não encontrada' });
    if (o.status !== 'APROVADO') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Só orçamento aprovado pode virar despesa' });
    }
    const proposta = o.propostas[0];
    if (!proposta) throw new UnprocessableEntityException({ erro: 'sem_selecao', mensagem: 'Nenhuma proposta selecionada' });
    const titulo = await this.criarTitulo(
      {
        entidadeId: o.entidadeId,
        fornecedorId: dto.fornecedorId,
        descricao: o.descricao,
        valor: cent(proposta.valor),
        vencimento: dto.vencimento,
        competencia: dto.competencia,
        naturezaId: dto.naturezaId,
        centroCustoAreaId: dto.centroCustoAreaId,
        formaPagamento: dto.formaPagamento,
        ativoId: o.ativoId ?? undefined,
        origemSolicitacaoId: o.id,
        urgente: o.urgencia !== 'NORMAL',
        justificativaUrgencia: o.urgencia !== 'NORMAL' ? `Urgência da solicitação de orçamento (${o.urgencia})` : undefined,
      },
      usuarioId,
    );
    await this.prisma.db.solicitacaoOrcamento.update({ where: { id }, data: { status: 'CONVERTIDO', tituloGeradoId: titulo.id } });
    return titulo;
  }

  // ---------------------------------------------------------------------------
  // FA-CP-03/04/05 — título: criação, validação, aprovação
  // ---------------------------------------------------------------------------

  async listarTitulos(filtro?: { status?: StatusTituloPagar; entidadeId?: string }) {
    const ts = await this.prisma.db.tituloPagar.findMany({
      where: { deletedAt: null, ...(filtro?.status ? { status: filtro.status } : {}), ...(filtro?.entidadeId ? { entidadeId: filtro.entidadeId } : {}) },
      include: { entidade: true, fornecedor: true, natureza: true, centro: true, pagamentos: { include: { conciliacao: true } }, documentos: { where: { ativo: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return ts.map((t) => this.mapearTitulo(t));
  }

  private mapearTitulo(t: {
    id: string; descricao: string; valor: Prisma.Decimal; vencimento: Date; competencia: string | null;
    status: StatusTituloPagar; urgente: boolean; justificativaUrgencia: string | null; formaPagamento: string;
    responsavelEconomico: string; ativoId: string | null; contratoCreditoId: string | null; loteId: string | null;
    dataProgramada: Date | null; motivoDevolucao: string | null; motivoBloqueio: string | null; createdAt: Date;
    entidade: { id: string; razaoSocial: string }; fornecedor: { id: string; nome: string; status: string; alertaProximoPagamento: boolean };
    natureza: { id: string; codigo: string; nome: string }; centro: { id: string; codigo: string; nome: string };
    pagamentos: { id: string; dataEfetiva: Date; valorEfetivo: Prisma.Decimal; identificador: string | null; comprovanteNome: string | null; divergencia: string | null; conciliacao: { id: string; status: string; dataSaida: Date; valorExtrato: Prisma.Decimal } | null }[];
    documentos: { id: string; tipo: string; nome: string; versao: number }[];
  }) {
    return {
      id: t.id,
      descricao: t.descricao,
      valor: cent(t.valor),
      vencimento: t.vencimento,
      competencia: t.competencia,
      status: t.status,
      urgente: t.urgente,
      justificativaUrgencia: t.justificativaUrgencia,
      formaPagamento: t.formaPagamento,
      responsavelEconomico: t.responsavelEconomico,
      ativoId: t.ativoId,
      contratoCreditoId: t.contratoCreditoId,
      loteId: t.loteId,
      dataProgramada: t.dataProgramada,
      motivoDevolucao: t.motivoDevolucao,
      motivoBloqueio: t.motivoBloqueio,
      criadoEm: t.createdAt,
      entidade: { id: t.entidade.id, nome: t.entidade.razaoSocial },
      fornecedor: { id: t.fornecedor.id, nome: t.fornecedor.nome, status: t.fornecedor.status, alertaProximoPagamento: t.fornecedor.alertaProximoPagamento },
      natureza: { id: t.natureza.id, codigo: t.natureza.codigo, nome: t.natureza.nome },
      centro: { id: t.centro.id, codigo: t.centro.codigo, nome: t.centro.nome },
      documentos: t.documentos.map((d) => ({ id: d.id, tipo: d.tipo, nome: d.nome, versao: d.versao })),
      pagamentos: t.pagamentos.map((p) => ({
        id: p.id, dataEfetiva: p.dataEfetiva, valorEfetivo: cent(p.valorEfetivo), identificador: p.identificador,
        comprovanteNome: p.comprovanteNome, divergencia: p.divergencia,
        conciliacao: p.conciliacao ? { id: p.conciliacao.id, status: p.conciliacao.status, dataSaida: p.conciliacao.dataSaida, valorExtrato: cent(p.conciliacao.valorExtrato) } : null,
      })),
    };
  }

  // FA-CP-03 (RF-07/08): a obrigação nasce completa; dimensões condicionais.
  async criarTitulo(
    dto: {
      entidadeId: string; fornecedorId: string; descricao: string; valor: number; vencimento: string;
      competencia?: string; naturezaId: string; centroCustoAreaId: string;
      responsavelEconomico?: 'AZIT' | 'INVESTIDOR' | 'CLIENTE' | 'OUTRA_ENTIDADE';
      formaPagamento?: string; ativoId?: string; contratoCreditoId?: string; origemSolicitacaoId?: string;
      urgente?: boolean; justificativaUrgencia?: string; justificativaNatureza?: string;
      documentoNome?: string; documentoTipo?: string; prazoPrestacaoContas?: string;
    },
    usuarioId?: string,
  ) {
    const natureza = await this.prisma.db.naturezaFinanceira.findFirst({ where: { id: dto.naturezaId } });
    if (!natureza) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Natureza financeira não encontrada' });
    // RCPG005: despesa veicular exige ativo/placa.
    if (natureza.exigeAtivo && !dto.ativoId) {
      throw new UnprocessableEntityException({ erro: 'ativo_obrigatorio', mensagem: `A natureza "${natureza.nome}" exige o veículo/ativo vinculado` });
    }
    // RCPG031: despesas diversas exigem justificativa.
    if (natureza.exigeJustificativa && !dto.justificativaNatureza) {
      throw new UnprocessableEntityException({ erro: 'justificativa_obrigatoria', mensagem: `A natureza "${natureza.nome}" é excepcional — justifique o uso` });
    }
    if (dto.urgente && !dto.justificativaUrgencia) {
      throw new UnprocessableEntityException({ erro: 'urgencia_sem_justificativa', mensagem: 'Urgência exige justificativa objetiva (RCPG014)' });
    }
    // RCPG024: duplicidade potencial BLOQUEIA (mesmo fornecedor + valor + vencimento).
    const venc = new Date(dto.vencimento);
    const duplicado = await this.prisma.db.tituloPagar.findFirst({
      where: {
        fornecedorId: dto.fornecedorId,
        valor: reais(dto.valor),
        vencimento: venc,
        status: { notIn: ['CANCELADO'] },
        deletedAt: null,
      },
    });
    const t = await this.prisma.db.tituloPagar.create({
      data: {
        entidadeId: dto.entidadeId,
        fornecedorId: dto.fornecedorId,
        descricao: dto.descricao,
        valor: reais(dto.valor),
        vencimento: venc,
        competencia: dto.competencia,
        naturezaId: dto.naturezaId,
        centroCustoAreaId: dto.centroCustoAreaId,
        responsavelEconomico: dto.responsavelEconomico ?? 'AZIT',
        formaPagamento: dto.formaPagamento ?? 'pix',
        ativoId: dto.ativoId,
        contratoCreditoId: dto.contratoCreditoId,
        origemSolicitacaoId: dto.origemSolicitacaoId,
        urgente: dto.urgente ?? false,
        justificativaUrgencia: dto.justificativaUrgencia,
        justificativaNatureza: dto.justificativaNatureza,
        prazoPrestacaoContas: dto.prazoPrestacaoContas ? new Date(dto.prazoPrestacaoContas) : undefined,
        status: duplicado ? 'BLOQUEADO' : 'SOLICITADO',
        motivoBloqueio: duplicado ? `Possível duplicidade do título ${duplicado.id} (mesmo fornecedor, valor e vencimento)` : undefined,
        criadoPor: usuarioId,
        documentos: dto.documentoNome
          ? { create: { tipo: dto.documentoTipo ?? 'documento', nome: dto.documentoNome, criadoPor: usuarioId } }
          : undefined,
      },
    });
    await this.auditar(usuarioId, 'cap_titulo_criado', t.id, undefined, { ...dto, duplicidade: !!duplicado });
    return { id: t.id, status: t.status, motivoBloqueio: t.motivoBloqueio };
  }

  // FA-CP-04: validação do Financeiro — valida, devolve ou bloqueia.
  async validarTitulo(id: string, decisao: 'validar' | 'devolver' | 'bloquear', motivo: string | undefined, usuarioId: string) {
    const t = await this.carregarTitulo(id);
    if (!['SOLICITADO', 'EM_VALIDACAO', 'BLOQUEADO'].includes(t.status)) {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: `Título em ${t.status} não está em validação` });
    }
    if (decisao === 'devolver') {
      if (!motivo) throw new UnprocessableEntityException({ erro: 'motivo_obrigatorio', mensagem: 'Informe o que precisa ser ajustado' });
      await this.prisma.db.tituloPagar.update({ where: { id }, data: { status: 'DEVOLVIDO', motivoDevolucao: motivo } });
      await this.auditar(usuarioId, 'cap_titulo_devolvido', id, { status: t.status }, { motivo });
      return { status: 'DEVOLVIDO' };
    }
    if (decisao === 'bloquear') {
      await this.prisma.db.tituloPagar.update({ where: { id }, data: { status: 'BLOQUEADO', motivoBloqueio: motivo ?? 'Bloqueado para análise' } });
      await this.auditar(usuarioId, 'cap_titulo_bloqueado', id, { status: t.status }, { motivo });
      return { status: 'BLOQUEADO' };
    }
    // validar: fornecedor precisa estar ATIVO (RCPG007).
    if (t.fornecedor.status !== 'ATIVO') {
      throw new UnprocessableEntityException({ erro: 'fornecedor_nao_ativo', mensagem: `O fornecedor está ${t.fornecedor.status} — ative-o antes de validar` });
    }
    await this.prisma.db.tituloPagar.update({ where: { id }, data: { status: 'AGUARDANDO_APROVACAO', motivoBloqueio: null, motivoDevolucao: null } });
    // RCPG013: natureza especial → só Diretor decide (valor não importa) — o motor
    // resolve pela alçada; naturezas especiais têm faixa só no Diretor.
    await this.aprovacao.criar({
      tipoOperacao: 'despesa_contas_pagar',
      referenciaTipo: 'titulo_pagar',
      referenciaId: id,
      valorCentavos: t.natureza.especial ? Math.max(cent(t.valor), 999999999) : cent(t.valor),
      resumo: `${t.natureza.nome} — ${t.descricao} — ${t.fornecedor.nome} — R$ ${centavosParaReaisString(cent(t.valor))} venc. ${t.vencimento.toISOString().slice(0, 10)}${t.urgente ? ' (URGENTE)' : ''}`,
      solicitanteId: usuarioId,
    });
    await this.auditar(usuarioId, 'cap_titulo_validado', id, { status: t.status }, { status: 'AGUARDANDO_APROVACAO' });
    return { status: 'AGUARDANDO_APROVACAO' };
  }

  // Solicitante corrige o devolvido e reenvia (mesmo caso, mesma trilha).
  async reenviarTitulo(id: string, dto: { descricao?: string; valor?: number; vencimento?: string; competencia?: string; documentoNome?: string }, usuarioId: string) {
    const t = await this.carregarTitulo(id);
    if (t.status !== 'DEVOLVIDO' && t.status !== 'RASCUNHO') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Só título devolvido ou rascunho pode ser reenviado' });
    }
    await this.prisma.db.tituloPagar.update({
      where: { id },
      data: {
        descricao: dto.descricao ?? undefined,
        valor: dto.valor !== undefined ? reais(dto.valor) : undefined,
        vencimento: dto.vencimento ? new Date(dto.vencimento) : undefined,
        competencia: dto.competencia ?? undefined,
        status: 'SOLICITADO',
        motivoDevolucao: null,
        documentos: dto.documentoNome ? { create: { tipo: 'documento', nome: dto.documentoNome, criadoPor: usuarioId } } : undefined,
      },
    });
    await this.auditar(usuarioId, 'cap_titulo_reenviado', id, undefined, dto);
    return { status: 'SOLICITADO' };
  }

  private async efetivarTitulo(id: string, aprovado: boolean, decisorId: string): Promise<string | void> {
    if (aprovado) {
      // RCPG021: campos críticos congelam a partir daqui (controlado no update).
      await this.prisma.db.tituloPagar.update({
        where: { id },
        data: { status: 'APROVADO', dataProgramada: this.proximaDataProgramada() },
      });
      return 'Despesa aprovada — título liberado para programação e lote.';
    }
    await this.prisma.db.tituloPagar.update({ where: { id }, data: { status: 'DEVOLVIDO', motivoDevolucao: 'Reprovado na alçada — ver parecer na Central de Aprovações' } });
    await this.auditar(decisorId, 'cap_titulo_reprovado', id);
  }

  async cancelarTitulo(id: string, motivo: string, usuarioId: string) {
    const t = await this.carregarTitulo(id);
    // Estados avançados exigem reabertura autorizada (RCPG034).
    if (['APROVADO', 'PROGRAMADO', 'ENVIADO_BPO', 'AGUARDANDO_CORA', 'PAGO', 'CONCILIADO'].includes(t.status)) {
      throw new UnprocessableEntityException({ erro: 'exige_reabertura', mensagem: 'Título em estado avançado — solicite reabertura autorizada pelo Diretor' });
    }
    await this.prisma.db.tituloPagar.update({ where: { id }, data: { status: 'CANCELADO', motivoCancelamento: motivo } });
    await this.auditar(usuarioId, 'cap_titulo_cancelado', id, { status: t.status }, { motivo });
    return { status: 'CANCELADO' };
  }

  // RCPG022/034: reabertura controlada — pedido vai ao Diretor pela Central.
  async solicitarReabertura(id: string, motivo: string, usuarioId: string) {
    const t = await this.carregarTitulo(id);
    await this.aprovacao.criar({
      tipoOperacao: 'reabertura_titulo',
      referenciaTipo: 'titulo_pagar',
      referenciaId: id,
      valorCentavos: cent(t.valor),
      resumo: `Reabertura do título — ${t.descricao} (${t.status}): ${motivo}`,
      solicitanteId: usuarioId,
    });
    await this.auditar(usuarioId, 'cap_reabertura_solicitada', id, { status: t.status }, { motivo });
    return { resultado: 'aguardando_autorizacao' };
  }

  private async efetivarReabertura(id: string, decisorId: string): Promise<string> {
    const t = await this.carregarTitulo(id);
    await this.prisma.db.tituloPagar.update({
      where: { id },
      data: { status: 'EM_VALIDACAO', loteId: null, dataProgramada: null },
    });
    await this.auditar(decisorId, 'cap_titulo_reaberto', id, { status: t.status }, { status: 'EM_VALIDACAO' });
    return 'Reabertura autorizada — o título voltou para validação e sairá do lote.';
  }

  // ---------------------------------------------------------------------------
  // FA-CP-06/07 — lote e envio ao BPO (RCPG002/015/028)
  // ---------------------------------------------------------------------------

  async listarLotes() {
    const ls = await this.prisma.db.lotePagamento.findMany({
      include: { entidade: true, conta: true, titulos: { include: { fornecedor: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return ls.map((l) => ({
      id: l.id,
      entidade: l.entidade.razaoSocial,
      conta: `${l.conta.banco}${l.conta.agencia ? ` ag ${l.conta.agencia}` : ''}${l.conta.conta ? ` c/c ${l.conta.conta}` : ''}`,
      dataProgramada: l.dataProgramada,
      versao: l.versao,
      status: l.status,
      urgente: l.urgente,
      totalValor: cent(l.totalValor),
      totalItens: l.totalItens,
      enviadoEm: l.enviadoEm,
      titulos: l.titulos.map((t) => ({ id: t.id, descricao: t.descricao, fornecedor: t.fornecedor.nome, valor: cent(t.valor), status: t.status, alertaBancario: t.fornecedor.alertaProximoPagamento })),
    }));
  }

  async criarLote(dto: { entidadeId: string; contaBancariaId: string; dataProgramada?: string; tituloIds: string[]; urgente?: boolean }, usuarioId: string) {
    const conta = await this.prisma.db.contaBancaria.findFirst({ where: { id: dto.contaBancariaId } });
    // RCPG003: a conta pagadora pertence à entidade do lote.
    if (!conta || conta.entidadeId !== dto.entidadeId) {
      throw new UnprocessableEntityException({ erro: 'conta_de_outra_entidade', mensagem: 'A conta pagadora precisa pertencer à entidade do lote (exceção intercompany exige aprovação)' });
    }
    const titulos = await this.prisma.db.tituloPagar.findMany({
      where: { id: { in: dto.tituloIds } },
      include: { fornecedor: true },
    });
    if (titulos.length === 0) throw new UnprocessableEntityException({ erro: 'sem_titulos', mensagem: 'Selecione títulos aprovados' });
    for (const t of titulos) {
      if (t.entidadeId !== dto.entidadeId) {
        throw new UnprocessableEntityException({ erro: 'entidade_misturada', mensagem: `O título "${t.descricao}" é de outra entidade legal — lote contém UMA entidade (RCPG002)` });
      }
      if (t.status !== 'APROVADO') {
        throw new UnprocessableEntityException({ erro: 'titulo_nao_aprovado', mensagem: `O título "${t.descricao}" está em ${t.status} — só título aprovado entra em lote` });
      }
      if (t.fornecedor.status !== 'ATIVO') {
        throw new UnprocessableEntityException({ erro: 'fornecedor_nao_ativo', mensagem: `Fornecedor ${t.fornecedor.nome} não está ativo (RCPG007)` });
      }
    }
    const total = titulos.reduce((s, t) => s + cent(t.valor), 0);
    const data = dto.dataProgramada ? new Date(dto.dataProgramada) : this.proximaDataProgramada();
    const lote = await this.prisma.db.$transaction(async (tx) => {
      const l = await tx.lotePagamento.create({
        data: {
          entidadeId: dto.entidadeId,
          contaBancariaId: dto.contaBancariaId,
          dataProgramada: data,
          urgente: dto.urgente ?? false,
          totalValor: reais(total),
          totalItens: titulos.length,
        },
      });
      await tx.tituloPagar.updateMany({ where: { id: { in: dto.tituloIds } }, data: { loteId: l.id, status: 'PROGRAMADO', dataProgramada: data } });
      return l;
    });
    // Liberação do lote é decisão própria do Diretor (RCPG011/018).
    await this.aprovacao.criar({
      tipoOperacao: 'lote_pagamento',
      referenciaTipo: 'lote_pagamento',
      referenciaId: lote.id,
      valorCentavos: total,
      resumo: `Lote ${lote.id.slice(-6)} — ${titulos.length} título(s), R$ ${centavosParaReaisString(total)}${dto.urgente ? ' (URGENTE)' : ''}`,
      solicitanteId: usuarioId,
    });
    await this.auditar(usuarioId, 'cap_lote_criado', lote.id, undefined, { ...dto, total });
    return { id: lote.id, status: lote.status, totalValor: total, totalItens: titulos.length };
  }

  private async efetivarLote(id: string, aprovado: boolean): Promise<string | void> {
    if (aprovado) {
      await this.prisma.db.lotePagamento.update({ where: { id }, data: { status: 'APROVADO' } });
      return 'Lote liberado — gere o resumo e envie ao BPO.';
    }
    const lote = await this.prisma.db.lotePagamento.findFirst({ where: { id } });
    if (!lote) return;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.tituloPagar.updateMany({ where: { loteId: id }, data: { loteId: null, status: 'APROVADO' } });
      await tx.lotePagamento.update({ where: { id }, data: { status: 'CANCELADO', observacao: 'Reprovado na liberação' } });
    });
  }

  // RF-15/16: resumo padronizado ao BPO (CSV) — minimização de dados (RNF-07).
  async resumoLote(id: string): Promise<{ nomeArquivo: string; conteudo: string }> {
    const l = await this.prisma.db.lotePagamento.findFirst({
      where: { id },
      include: { entidade: true, conta: true, titulos: { include: { fornecedor: { include: { dadosBancarios: { where: { ativo: true }, take: 1 } } } } } },
    });
    if (!l) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Lote não encontrado' });
    const linhas = [
      'entidade;cnpj;conta_pagadora;data_programada;fornecedor;cpf_cnpj;banco;agencia;conta;chave_pix;valor;vencimento;forma;descricao;alerta_alteracao_bancaria',
      ...l.titulos.map((t) => {
        const db = t.fornecedor.dadosBancarios[0];
        return [
          l.entidade.razaoSocial, l.entidade.cnpj ?? '', `${l.conta.banco} ${l.conta.agencia ?? ''} ${l.conta.conta ?? ''}`.trim(),
          l.dataProgramada.toISOString().slice(0, 10),
          t.fornecedor.nome, t.fornecedor.cpfCnpj,
          db?.banco ?? '', db?.agencia ?? '', db?.conta ?? '', db?.chavePix ?? '',
          centavosParaReaisString(cent(t.valor)).replace('.', ','), t.vencimento.toISOString().slice(0, 10),
          t.formaPagamento, t.descricao.replace(/;/g, ','),
          t.fornecedor.alertaProximoPagamento ? 'SIM' : '',
        ].join(';');
      }),
    ];
    return { nomeArquivo: `lote-${l.entidade.razaoSocial.replace(/\s+/g, '-').toLowerCase()}-${l.dataProgramada.toISOString().slice(0, 10)}-v${l.versao}.csv`, conteudo: linhas.join('\n') };
  }

  // FA-CP-07/08: eventos manuais (RF-17) — o Hub é a fonte de status.
  async registrarEventoLote(id: string, evento: 'enviado_bpo' | 'cadastrado_cora' | 'aprovado_banco', usuarioId: string) {
    const l = await this.prisma.db.lotePagamento.findFirst({ where: { id }, include: { titulos: true } });
    if (!l) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Lote não encontrado' });
    const mapa: Record<string, { de: StatusLotePagamento[]; para: StatusLotePagamento; titulo?: StatusTituloPagar }> = {
      enviado_bpo: { de: ['APROVADO'], para: 'ENVIADO_BPO', titulo: 'ENVIADO_BPO' },
      cadastrado_cora: { de: ['ENVIADO_BPO'], para: 'AGUARDANDO_APROVACAO_BANCO', titulo: 'AGUARDANDO_CORA' },
      aprovado_banco: { de: ['AGUARDANDO_APROVACAO_BANCO'], para: 'APROVADO_BANCO' },
    };
    const regra = mapa[evento];
    if (!regra.de.includes(l.status)) {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: `Lote em ${l.status} não aceita o evento ${evento}` });
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.lotePagamento.update({
        where: { id },
        data: { status: regra.para, ...(evento === 'enviado_bpo' ? { enviadoEm: new Date(), enviadoPor: usuarioId } : {}) },
      });
      if (regra.titulo) {
        await tx.tituloPagar.updateMany({ where: { loteId: id }, data: { status: regra.titulo } });
      }
    });
    await this.auditar(usuarioId, `cap_lote_${evento}`, id);
    return { status: regra.para };
  }

  // ---------------------------------------------------------------------------
  // FA-CP-09 — pagamento, comprovante e conciliação (RCPG019/020)
  // ---------------------------------------------------------------------------

  async registrarPagamento(
    tituloId: string,
    dto: { dataEfetiva: string; valorEfetivo: number; identificador?: string; comprovanteNome?: string; divergencia?: string },
    usuarioId: string,
  ) {
    const t = await this.carregarTitulo(tituloId);
    if (!['AGUARDANDO_CORA', 'ENVIADO_BPO', 'PROGRAMADO'].includes(t.status)) {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: `Título em ${t.status} — registre o fluxo do lote antes do pagamento` });
    }
    // RCPG019: Pago exige evidência de execução.
    if (!dto.comprovanteNome) {
      throw new UnprocessableEntityException({ erro: 'comprovante_obrigatorio', mensagem: 'Anexe o comprovante — sem evidência o título não pode ser marcado como Pago' });
    }
    const pagamento = await this.prisma.db.$transaction(async (tx) => {
      const p = await tx.pagamentoTitulo.create({
        data: {
          tituloId,
          loteId: t.loteId,
          dataEfetiva: new Date(dto.dataEfetiva),
          valorEfetivo: reais(dto.valorEfetivo),
          identificador: dto.identificador,
          comprovanteNome: dto.comprovanteNome,
          divergencia: dto.divergencia,
          registradoPor: usuarioId,
        },
      });
      await tx.tituloPagar.update({ where: { id: tituloId }, data: { status: 'PAGO' } });
      // RCPG025: o alerta de alteração bancária é consumido no primeiro pagamento.
      await tx.fornecedorFin.update({ where: { id: t.fornecedorId }, data: { alertaProximoPagamento: false } });
      // Lote parcialmente pago / pago.
      if (t.loteId) {
        const restantes = await tx.tituloPagar.count({ where: { loteId: t.loteId, status: { notIn: ['PAGO', 'CONCILIADO', 'CANCELADO'] } } });
        await tx.lotePagamento.update({ where: { id: t.loteId }, data: { status: restantes === 0 ? 'PAGO' : 'PARCIALMENTE_PAGO' } });
      }
      return p;
    });
    await this.auditar(usuarioId, 'cap_pagamento_registrado', tituloId, undefined, dto);
    return { id: pagamento.id, statusTitulo: 'PAGO' };
  }

  async conciliar(pagamentoId: string, dto: { dataSaida: string; valorExtrato: number; observacao?: string }, usuarioId: string) {
    const p = await this.prisma.db.pagamentoTitulo.findFirst({ where: { id: pagamentoId }, include: { conciliacao: true } });
    if (!p) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Pagamento não encontrado' });
    if (p.conciliacao) throw new UnprocessableEntityException({ erro: 'ja_conciliado', mensagem: 'Este pagamento já tem conciliação registrada' });
    const divergente = cent(p.valorEfetivo) !== dto.valorExtrato;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.conciliacaoTitulo.create({
        data: {
          pagamentoId,
          dataSaida: new Date(dto.dataSaida),
          valorExtrato: reais(dto.valorExtrato),
          status: divergente ? 'DIVERGENTE' : 'CONCILIADA',
          observacao: dto.observacao,
          responsavelId: usuarioId,
        },
      });
      if (!divergente) {
        await tx.tituloPagar.update({ where: { id: p.tituloId }, data: { status: 'CONCILIADO' } });
      }
    });
    await this.auditar(usuarioId, 'cap_conciliacao_registrada', pagamentoId, undefined, { ...dto, divergente });
    return { status: divergente ? 'DIVERGENTE' : 'CONCILIADA' };
  }

  // ---------------------------------------------------------------------------
  // Desembolso do Reembolso Parcelado (decisão 5 — RCPG006/029, RF-22)
  // ---------------------------------------------------------------------------

  // Chamado pela efetivação do RP: cria o título de desembolso vinculado à
  // operação. Beneficiário nasce como placeholder e é definido pelo Financeiro.
  async criarDesembolsoReembolso(contrato: { id: string; numero: string; valorCentavos: number; clienteNome: string; ativoId: string }, usuarioId?: string) {
    const entidade = await this.prisma.db.entidadeLegal.findFirst({ where: { unidadeNegocio: 'Reembolso Parcelado' } });
    const natureza = await this.prisma.db.naturezaFinanceira.findFirst({ where: { codigo: 'NF11' } });
    const centro = await this.prisma.db.centroCustoArea.findFirst({ where: { codigo: 'CC05' } });
    if (!entidade || !natureza || !centro) return null; // fundação ausente — não trava o RP
    let beneficiario = await this.prisma.db.fornecedorFin.findFirst({ where: { cpfCnpj: '00000000000000' } });
    if (!beneficiario) {
      beneficiario = await this.prisma.db.fornecedorFin.create({
        data: {
          cpfCnpj: '00000000000000',
          nome: 'Beneficiário a definir (Reembolso Parcelado)',
          status: 'ATIVO',
          dadosBancarios: { create: { versao: 1, ativo: true, motivo: 'Placeholder — definir beneficiário real no título' } },
        },
      });
    }
    const t = await this.prisma.db.tituloPagar.create({
      data: {
        entidadeId: entidade.id,
        fornecedorId: beneficiario.id,
        descricao: `Desembolso Reembolso Parcelado — contrato ${contrato.numero} — cliente ${contrato.clienteNome}`,
        valor: reais(contrato.valorCentavos),
        vencimento: this.proximaDataProgramada(),
        naturezaId: natureza.id,
        centroCustoAreaId: centro.id,
        responsavelEconomico: 'CLIENTE',
        ativoId: contrato.ativoId,
        contratoCreditoId: contrato.id,
        status: 'RASCUNHO',
        criadoPor: usuarioId,
      },
    });
    await this.auditar(usuarioId, 'cap_desembolso_rp_criado', t.id, undefined, { contratoId: contrato.id, valor: contrato.valorCentavos });
    return t.id;
  }

  // Painel para a fila do Início e a tela principal.
  async painel() {
    const [porStatus, pagosNaoConciliados, urgentes] = await Promise.all([
      this.prisma.db.tituloPagar.groupBy({ by: ['status'], _count: { id: true }, where: { deletedAt: null } }),
      this.prisma.db.tituloPagar.count({ where: { status: 'PAGO', deletedAt: null } }),
      this.prisma.db.tituloPagar.count({ where: { urgente: true, status: { notIn: ['PAGO', 'CONCILIADO', 'CANCELADO'] }, deletedAt: null } }),
    ]);
    return {
      porStatus: Object.fromEntries(porStatus.map((s) => [s.status, s._count.id])),
      pagosNaoConciliados,
      urgentesAbertas: urgentes,
    };
  }

  private async carregarTitulo(id: string) {
    const t = await this.prisma.db.tituloPagar.findFirst({
      where: { id, deletedAt: null },
      include: { fornecedor: true, natureza: true },
    });
    if (!t) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Título não encontrado' });
    return t;
  }
}
