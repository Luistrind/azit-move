import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, SituacaoCasoLegado, StatusCasoLegado } from '@prisma/client';
import {
  centavosParaReaisString,
  classificarCobrancaLegada,
  dataHojeBrasil,
  decomporParcelaLegada,
  triarCasoLegado,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasLeituraService, CobrancaAsaasLida } from '../asaas/asaas-leitura.service';
import { QUEUE_NAMES } from '../queues/queues.module';

// Migração do legado — F1 (doc 02 §26): lê o Asaas, monta um CASO por
// cliente, tria (sem vencida primeiro) e expõe a bancada. Nada aqui cria
// titular ou contrato: isso é a F3, sobre caso VALIDADO.

export const ROTULO_STATUS_CASO: Record<StatusCasoLegado, string> = {
  COLETADO: 'Coletado',
  EM_REVISAO: 'Em revisão',
  VALIDADO: 'Validado',
  MIGRADO: 'Migrado',
  DESCARTADO: 'Descartado',
};

export const ROTULO_SITUACAO: Record<SituacaoCasoLegado, string> = {
  SEM_VENCIDA: 'Em dia',
  COM_VENCIDA: 'Com vencida',
  SEM_MOVIMENTO: 'Sem movimento',
};

export const ROTULO_MODELO: Record<string, string> = {
  HB20: 'HB20 (997/semana)',
  MOBI_KWID: 'Mobi ou Kwid (697/semana)',
};

// Transições que a F1 permite ao operador. VALIDADO chega na F2 (conciliação)
// e MIGRADO na F3 — aqui ainda não existem, e a tela não os oferece.
const TRANSICOES_F1: Record<string, StatusCasoLegado[]> = {
  COLETADO: ['EM_REVISAO', 'DESCARTADO'],
  EM_REVISAO: ['COLETADO', 'DESCARTADO'],
  DESCARTADO: ['COLETADO'],
  VALIDADO: [],
  MIGRADO: [],
};

const reais = (centavos: number) => new Prisma.Decimal(centavosParaReaisString(centavos));
const centavos = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Math.round(Number(v) * 100));
const dataUTC = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00.000Z`) : null);
const soDigitos = (v: string | null | undefined) => (v ? v.replace(/\D/g, '') || null : null);

@Injectable()
export class MigracaoLegadoService {
  private readonly logger = new Logger(MigracaoLegadoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasLeituraService,
    @InjectQueue(QUEUE_NAMES.COLETA_LEGADO) private readonly fila: Queue,
  ) {}

  // ---------------- Coleta ----------------

  // Dispara a leitura do Asaas em segundo plano (são centenas de chamadas —
  // não cabe na requisição). Só uma coleta em andamento por vez.
  async iniciarColeta(usuarioId: string) {
    const emAndamento = await this.prisma.db.coletaLegado.findFirst({
      where: { concluidaEm: null, erro: null },
      orderBy: { iniciadaEm: 'desc' },
    });
    if (emAndamento) {
      // Coleta travada (backend reiniciou no meio): libera depois de 30 min.
      const idade = Date.now() - emAndamento.iniciadaEm.getTime();
      if (idade < 30 * 60_000) {
        throw new ConflictException({ erro: 'coleta_em_andamento', mensagem: 'Já existe uma leitura do Asaas em andamento — aguarde terminar' });
      }
      await this.prisma.db.coletaLegado.update({ where: { id: emAndamento.id }, data: { erro: 'Interrompida (não concluiu em 30 min)' } });
    }
    const coleta = await this.prisma.db.coletaLegado.create({
      data: { ambiente: this.asaas.ambiente, iniciadaPor: usuarioId },
    });
    await this.fila.add('coletar', { coletaId: coleta.id }, { attempts: 1 });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'legado_coleta_iniciada', entidade: 'coleta_legado', entidadeId: coleta.id, depois: { ambiente: coleta.ambiente } },
    });
    return { coletaId: coleta.id, ambiente: coleta.ambiente };
  }

  // Executada pelo worker. Idempotente: reler atualiza a triagem e as
  // cobranças, mas NUNCA mexe no status nem na observação que o operador deu.
  async executarColeta(coletaId: string) {
    const coleta = await this.prisma.db.coletaLegado.findUnique({ where: { id: coletaId } });
    if (!coleta || coleta.concluidaEm) return { resultado: 'ja_concluida' as const };
    const hoje = dataHojeBrasil();
    let clientesLidos = 0;
    let cobrancasLidas = 0;
    let casosNovos = 0;
    let casosAtualizados = 0;
    try {
      const clientes = await this.asaas.listarClientes();
      for (const cliente of clientes) {
        if (cliente.deleted) continue;
        // Sequencial de propósito: o ritmo das chamadas ao Asaas é limitado.
        const assinaturas = await this.asaas.listarAssinaturas(cliente.id);
        const cobrancas = await this.asaas.listarCobrancas(cliente.id);
        const triagem = triarCasoLegado({
          assinaturas: assinaturas.filter((a) => !a.deleted).map((a) => ({ status: a.status, valor: Math.round(a.value * 100), ciclo: a.cycle })),
          cobrancas: cobrancas.map((c) => ({
            valor: Math.round(c.value * 100),
            vencimento: c.dueDate,
            status: c.status,
            pagoEm: c.paymentDate ?? c.confirmedDate ?? null,
            deletada: !!c.deleted,
          })),
          hoje,
        });
        // A assinatura "principal": a ativa, senão a mais recente.
        const principal =
          assinaturas.find((a) => a.status === 'ACTIVE' && !a.deleted) ??
          [...assinaturas].sort((a, b) => (b.dateCreated ?? '').localeCompare(a.dateCreated ?? ''))[0] ??
          null;
        const dados = {
          nome: cliente.name,
          cpfCnpj: soDigitos(cliente.cpfCnpj),
          email: cliente.email ?? null,
          telefone: cliente.mobilePhone ?? cliente.phone ?? null,
          situacao: triagem.situacao,
          prioridade: triagem.prioridade,
          totalCobrancas: triagem.totalCobrancas,
          cobrancasPagas: triagem.cobrancasPagas,
          cobrancasPendentes: triagem.cobrancasPendentes,
          cobrancasVencidas: triagem.cobrancasVencidas,
          cobrancasOutras: triagem.cobrancasOutras,
          valorParcelaPadrao: triagem.valorParcelaPadrao == null ? null : reais(triagem.valorParcelaPadrao),
          modeloSugerido: triagem.modeloSugerido,
          primeiraCobrancaEm: dataUTC(triagem.primeiraCobrancaEm),
          ultimaCobrancaEm: dataUTC(triagem.ultimaCobrancaEm),
          assinaturaId: principal?.id ?? null,
          assinaturaStatus: principal?.status ?? null,
          assinaturaValor: principal ? reais(Math.round(principal.value * 100)) : null,
          assinaturaCiclo: principal?.cycle ?? null,
          assinaturaProximoVencimento: dataUTC(principal?.nextDueDate),
          assinaturaAtiva: triagem.assinaturaAtiva,
          clienteBruto: cliente as Prisma.InputJsonValue,
          assinaturaBruto: (principal ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          coletadoEm: new Date(),
        };
        const existente = await this.prisma.db.casoMigracaoLegado.findUnique({ where: { asaasCustomerId: cliente.id }, select: { id: true } });
        const caso = existente
          ? await this.prisma.db.casoMigracaoLegado.update({ where: { id: existente.id }, data: dados })
          : await this.prisma.db.casoMigracaoLegado.create({ data: { asaasCustomerId: cliente.id, ...dados } });
        if (existente) casosAtualizados += 1;
        else casosNovos += 1;

        for (const c of cobrancas) {
          const linha = this.cobrancaParaBanco(caso.id, c);
          await this.prisma.db.cobrancaLegada.upsert({
            where: { asaasPaymentId: c.id },
            create: { asaasPaymentId: c.id, ...linha },
            update: linha,
          });
        }
        cobrancasLidas += cobrancas.length;
        clientesLidos += 1;
        if (clientesLidos % 10 === 0) {
          await this.prisma.db.coletaLegado.update({ where: { id: coletaId }, data: { clientesLidos, cobrancasLidas, casosNovos, casosAtualizados } });
        }
      }
      await this.prisma.db.coletaLegado.update({
        where: { id: coletaId },
        data: { concluidaEm: new Date(), clientesLidos, cobrancasLidas, casosNovos, casosAtualizados },
      });
      this.logger.log(`Coleta ${coletaId}: ${clientesLidos} clientes, ${cobrancasLidas} cobranças (${casosNovos} novos, ${casosAtualizados} atualizados)`);
      return { resultado: 'concluida' as const, clientesLidos, cobrancasLidas };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.db.coletaLegado.update({
        where: { id: coletaId },
        data: { erro: msg.slice(0, 500), concluidaEm: new Date(), clientesLidos, cobrancasLidas, casosNovos, casosAtualizados },
      });
      this.logger.error(`Coleta ${coletaId} falhou após ${clientesLidos} clientes: ${msg}`);
      return { resultado: 'falhou' as const, erro: msg };
    }
  }

  private cobrancaParaBanco(casoId: string, c: CobrancaAsaasLida) {
    return {
      casoId,
      assinaturaId: c.subscription ?? null,
      valor: reais(Math.round(c.value * 100)),
      valorPago: c.status === 'RECEIVED' || c.status === 'CONFIRMED' || c.status === 'RECEIVED_IN_CASH' ? reais(Math.round(c.value * 100)) : null,
      vencimento: dataUTC(c.dueDate) as Date,
      pagoEm: dataUTC(c.paymentDate ?? c.clientPaymentDate ?? c.confirmedDate ?? null),
      status: c.status,
      tipo: c.billingType ?? null,
      descricao: c.description ?? null,
      invoiceUrl: c.invoiceUrl ?? null,
      deletada: !!c.deleted,
      bruto: c as Prisma.InputJsonValue,
    };
  }

  // ---------------- Consulta ----------------

  async resumo() {
    const [ultima, porStatus, porSituacao] = await Promise.all([
      this.prisma.db.coletaLegado.findFirst({ orderBy: { iniciadaEm: 'desc' } }),
      this.prisma.db.casoMigracaoLegado.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.db.casoMigracaoLegado.groupBy({ by: ['situacao'], _count: { _all: true }, where: { status: { notIn: ['DESCARTADO', 'MIGRADO'] } } }),
    ]);
    return {
      ambiente: this.asaas.ambiente,
      coleta: ultima
        ? {
            id: ultima.id,
            iniciadaEm: ultima.iniciadaEm.toISOString(),
            concluidaEm: ultima.concluidaEm?.toISOString() ?? null,
            emAndamento: !ultima.concluidaEm && !ultima.erro,
            erro: ultima.erro,
            ambiente: ultima.ambiente,
            clientesLidos: ultima.clientesLidos,
            cobrancasLidas: ultima.cobrancasLidas,
            casosNovos: ultima.casosNovos,
            casosAtualizados: ultima.casosAtualizados,
          }
        : null,
      porStatus: Object.fromEntries(porStatus.map((l) => [l.status, l._count._all])),
      porSituacao: Object.fromEntries(porSituacao.map((l) => [l.situacao, l._count._all])),
      opcoes: {
        status: Object.entries(ROTULO_STATUS_CASO).map(([valor, rotulo]) => ({ valor, rotulo })),
        situacao: Object.entries(ROTULO_SITUACAO).map(([valor, rotulo]) => ({ valor, rotulo })),
      },
    };
  }

  async listar(f: { status?: string; situacao?: string; busca?: string } = {}) {
    const where: Prisma.CasoMigracaoLegadoWhereInput = {};
    if (f.status && f.status in ROTULO_STATUS_CASO) where.status = f.status as StatusCasoLegado;
    if (f.situacao && f.situacao in ROTULO_SITUACAO) where.situacao = f.situacao as SituacaoCasoLegado;
    if (f.busca?.trim()) {
      const b = f.busca.trim();
      where.OR = [
        { nome: { contains: b, mode: 'insensitive' } },
        { cpfCnpj: { contains: b.replace(/\D/g, '') || b } },
        { asaasCustomerId: { contains: b } },
      ];
    }
    const casos = await this.prisma.db.casoMigracaoLegado.findMany({
      where,
      // Triagem (doc 02 §26.4): sem vencida primeiro; dentro dela, quem tem
      // menos vencidas e mais histórico pago.
      orderBy: [{ prioridade: 'asc' }, { cobrancasVencidas: 'asc' }, { cobrancasPagas: 'desc' }, { nome: 'asc' }],
    });
    return casos.map((c) => this.casoParaApi(c));
  }

  async caso(id: string) {
    const c = await this.prisma.db.casoMigracaoLegado.findUnique({
      where: { id },
      include: { cobrancas: { orderBy: { vencimento: 'asc' } } },
    });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Caso não encontrado' });
    const hoje = dataHojeBrasil();
    const parcela = centavos(c.valorParcelaPadrao);
    return {
      ...this.casoParaApi(c),
      email: c.email,
      telefone: c.telefone,
      assinatura: c.assinaturaId
        ? {
            id: c.assinaturaId,
            status: c.assinaturaStatus,
            valor: centavos(c.assinaturaValor),
            ciclo: c.assinaturaCiclo,
            proximoVencimento: c.assinaturaProximoVencimento?.toISOString().slice(0, 10) ?? null,
            descricao: (c.assinaturaBruto as { description?: string } | null)?.description ?? null,
          }
        : null,
      // Proposta de decomposição (doc 02 §26.2) — a F2 confirma no caso.
      decomposicao: parcela == null ? null : decomporParcelaLegada(parcela),
      cobrancas: c.cobrancas.map((p) => ({
        id: p.id,
        asaasPaymentId: p.asaasPaymentId,
        assinaturaId: p.assinaturaId,
        valor: centavos(p.valor) ?? 0,
        valorPago: centavos(p.valorPago),
        vencimento: p.vencimento.toISOString().slice(0, 10),
        pagoEm: p.pagoEm?.toISOString().slice(0, 10) ?? null,
        status: p.status,
        classe: classificarCobrancaLegada(
          { valor: centavos(p.valor) ?? 0, vencimento: p.vencimento.toISOString().slice(0, 10), status: p.status, deletada: p.deletada },
          hoje,
        ),
        tipo: p.tipo,
        descricao: p.descricao,
        invoiceUrl: p.invoiceUrl,
        deletada: p.deletada,
      })),
    };
  }

  private casoParaApi(c: Prisma.CasoMigracaoLegadoGetPayload<object>) {
    return {
      id: c.id,
      asaasCustomerId: c.asaasCustomerId,
      nome: c.nome,
      cpfCnpj: c.cpfCnpj,
      status: c.status,
      statusRotulo: ROTULO_STATUS_CASO[c.status],
      situacao: c.situacao,
      situacaoRotulo: ROTULO_SITUACAO[c.situacao],
      prioridade: c.prioridade,
      totalCobrancas: c.totalCobrancas,
      cobrancasPagas: c.cobrancasPagas,
      cobrancasPendentes: c.cobrancasPendentes,
      cobrancasVencidas: c.cobrancasVencidas,
      cobrancasOutras: c.cobrancasOutras,
      valorParcelaPadrao: centavos(c.valorParcelaPadrao),
      modeloSugerido: c.modeloSugerido,
      modeloRotulo: c.modeloSugerido ? ROTULO_MODELO[c.modeloSugerido] ?? c.modeloSugerido : null,
      primeiraCobrancaEm: c.primeiraCobrancaEm?.toISOString().slice(0, 10) ?? null,
      ultimaCobrancaEm: c.ultimaCobrancaEm?.toISOString().slice(0, 10) ?? null,
      assinaturaAtiva: c.assinaturaAtiva,
      assinaturaValor: centavos(c.assinaturaValor),
      assinaturaCiclo: c.assinaturaCiclo,
      observacao: c.observacao,
      statusAlteradoEm: c.statusAlteradoEm?.toISOString() ?? null,
      coletadoEm: c.coletadoEm.toISOString(),
      titularId: c.titularId,
      contratoId: c.contratoId,
    };
  }

  // ---------------- Ações do operador ----------------

  async mudarStatus(id: string, novo: string, usuarioId: string, observacao?: string) {
    const c = await this.prisma.db.casoMigracaoLegado.findUnique({ where: { id } });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Caso não encontrado' });
    if (!(novo in ROTULO_STATUS_CASO)) {
      throw new UnprocessableEntityException({ erro: 'status_invalido', mensagem: 'Status desconhecido' });
    }
    const permitidos = TRANSICOES_F1[c.status] ?? [];
    if (!permitidos.includes(novo as StatusCasoLegado)) {
      throw new UnprocessableEntityException({
        erro: 'transicao_invalida',
        mensagem: `De "${ROTULO_STATUS_CASO[c.status]}" não dá para ir a "${ROTULO_STATUS_CASO[novo as StatusCasoLegado]}" nesta fase`,
      });
    }
    if (novo === 'DESCARTADO' && !observacao?.trim()) {
      throw new UnprocessableEntityException({ erro: 'motivo_obrigatorio', mensagem: 'Diga por que o caso está sendo descartado' });
    }
    const atualizado = await this.prisma.db.casoMigracaoLegado.update({
      where: { id },
      data: {
        status: novo as StatusCasoLegado,
        statusAlteradoEm: new Date(),
        statusAlteradoPor: usuarioId,
        ...(observacao !== undefined ? { observacao: observacao.trim() || null } : {}),
      },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'legado_caso_status',
        entidade: 'caso_migracao_legado',
        entidadeId: id,
        antes: { status: c.status },
        depois: { status: novo, observacao: observacao ?? null },
      },
    });
    return this.casoParaApi(atualizado);
  }

  async anotar(id: string, observacao: string, usuarioId: string) {
    const c = await this.prisma.db.casoMigracaoLegado.findUnique({ where: { id }, select: { id: true, observacao: true } });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Caso não encontrado' });
    const atualizado = await this.prisma.db.casoMigracaoLegado.update({ where: { id }, data: { observacao: observacao.trim() || null } });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'legado_caso_anotado', entidade: 'caso_migracao_legado', entidadeId: id, antes: { observacao: c.observacao }, depois: { observacao: observacao.trim() || null } },
    });
    return this.casoParaApi(atualizado);
  }
}
