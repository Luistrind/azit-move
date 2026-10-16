import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { centavosParaReaisString, planejarReembolsosFaltantes, type DespesaDeclaradaBackfill, type FaturaMigrada, type PlanoReembolsosBackfill } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';

// ============================================================
// Migração do legado — "Completar reembolsos do legado" (doc 02 §26.8, 16/10/2026).
//
// Backfill de Reembolso Parcelado em caso JÁ MIGRADO: despesa cobrada junto
// da parcela (IPVA, manutenção) que não virou RP na migração. O operador
// (ADMIN/DIRETOR) vê as faturas do contrato migrado com a cobrança do Asaas
// que as prova, declara fatura + valor + rótulo, confere a PRÉVIA e grava.
// A estrutura criada é a MESMA do planner da migração (passo 5): contrato
// "<numero>-RPk" com snapshot legado, item PARCELADO, cotas como parcelas
// (pagas nascem pagas), recebíveis, item na fatura da semana.
//
// Idempotente: o planejador (puro, @azit/utils) ignora fatura que já tem o
// item do rótulo; a gravação replaneja DENTRO da transação sobre o estado
// atual do banco. Auditado em logAuditoria + migracaoResumo do caso.
// ============================================================

const isoDe = (data: Date | null | undefined) => (data ? data.toISOString().slice(0, 10) : null);
const cent = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Math.round(Number(v.toString()) * 100));
const reais = (c: number) => centavosParaReaisString(c);

export interface FaturaParaReembolso extends FaturaMigrada {
  somaItens: number;
  somaSemEncargo: number;
  reembolsosExistentes: { contrato: string; descricao: string; valor: number }[];
  // Pré-preenchimento: leitura da cobrança (extra) ou folga positiva da fatura.
  sugestao: { valor: number; rotulo: string | null; origem: 'leitura' | 'folga' } | null;
  elegivel: boolean;
  motivoInelegivel: string | null;
}

// Cliente de transação do Prisma ESTENDIDO (soft-delete) — o mesmo `tx` do $transaction e o `db` fora dela.
type Tx = Omit<PrismaService['db'], '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class LegadoReembolsosService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- Listagem: as faturas do contrato migrado ----------------

  async listar(casoId: string) {
    const { caso, contrato } = await this.carregarMigrado(casoId);
    const faturas = await this.faturasDoContrato(this.prisma.db, caso.id, contrato.id, contrato.contaId);
    const rps = await this.prisma.db.contratoCredito.findMany({ where: { numero: { startsWith: `${contrato.numero}-RP` }, deletedAt: null }, select: { id: true, numero: true, status: true, valorTotal: true, numeroParcelas: true, itensContratados: { select: { descricao: true }, take: 1 } }, orderBy: { numero: 'asc' } });
    return {
      contrato: { id: contrato.id, numero: contrato.numero, periodicidade: contrato.periodicidade },
      reembolsosExistentes: rps.map((r) => ({ id: r.id, numero: r.numero, status: r.status, total: cent(r.valorTotal), parcelas: r.numeroParcelas, descricao: r.itensContratados[0]?.descricao ?? null })),
      faturas: faturas.map((f) => this.enriquecer(f)),
    };
  }

  private enriquecer(f: FaturaMigrada & { leitura: { extra: number; extraRotulo: string | null } | null }): FaturaParaReembolso {
    const somaItens = f.itens.reduce((s, it) => s + it.valor, 0);
    const somaSemEncargo = f.itens.filter((it) => it.tipo !== 'ENCARGO').reduce((s, it) => s + it.valor, 0);
    const reembolsosExistentes = f.itens.filter((it) => it.contratoDaParcela).map((it) => ({ contrato: it.contratoDaParcela!, descricao: it.descricao, valor: it.valor }));
    const folga = f.valorTotal - somaSemEncargo;
    let sugestao: FaturaParaReembolso['sugestao'] = null;
    if (f.leitura && f.leitura.extra > 0 && !reembolsosExistentes.length) sugestao = { valor: f.leitura.extra, rotulo: f.leitura.extraRotulo, origem: 'leitura' };
    else if (folga > 0 && !reembolsosExistentes.length) sugestao = { valor: folga, rotulo: null, origem: 'folga' };
    let motivo: string | null = null;
    if (!f.parcelaVeiculo) motivo = 'não cobra parcela do veículo';
    else if (f.status === 'ABERTA') motivo = 'ainda aberta — o sistema emite';
    else if (f.status === 'RENEGOCIADA' || f.status === 'NOVADA') motivo = `${f.status.toLowerCase()} — sem cobrança própria`;
    else if (!f.cobranca) motivo = 'sem cobrança do Asaas vinculada';
    const { leitura: _l, ...resto } = f;
    return { ...resto, somaItens, somaSemEncargo, reembolsosExistentes, sugestao, elegivel: !motivo, motivoInelegivel: motivo };
  }

  // ---------------- Prévia (nada é gravado) ----------------

  async previa(casoId: string, corpo: unknown): Promise<PlanoReembolsosBackfill> {
    const despesas = this.validarCorpo(corpo);
    const { caso, contrato } = await this.carregarMigrado(casoId);
    return this.planejar(this.prisma.db, caso.id, contrato, despesas);
  }

  // ---------------- Gravar ----------------

  async completar(casoId: string, corpo: unknown, usuarioId: string) {
    const despesas = this.validarCorpo(corpo);
    const { caso, contrato } = await this.carregarMigrado(casoId);
    const PER = contrato.periodicidade;

    return this.prisma.db.$transaction(async (tx) => {
      // Replaneja sobre o estado ATUAL (duas gravações seguidas não duplicam nada).
      const plano = await this.planejar(tx, caso.id, contrato, despesas);
      if (plano.erros.length) throw new UnprocessableEntityException({ erro: 'inconsistencias', mensagem: `Há ${plano.erros.length} fatura(s) com inconsistência — corrija antes de gravar`, erros: plano.erros });
      if (!plano.rps.length) throw new UnprocessableEntityException({ erro: 'nada_a_criar', mensagem: plano.ignoradas.length ? 'Todos os reembolsos informados já existem' : 'Nenhum reembolso a criar', ignoradas: plano.ignoradas });

      const ajustePorFatura = new Map(plano.ajustes.map((a) => [a.faturaId, a]));
      const criados: { id: string; numero: string; rotulo: string; total: number; parcelas: number; status: string }[] = [];
      for (const rp of plano.rps) {
        // Número único mesmo se alguém criou um RP entre a prévia e a gravação.
        let numero = rp.numero;
        for (let k = 1; await tx.contratoCredito.findFirst({ where: { numero }, select: { id: true } }); k++) numero = `${rp.numero}-${k}`;
        const c = await tx.contratoCredito.create({
          data: {
            numero,
            contaId: contrato.contaId,
            ativoId: null,
            legadoCasoId: null,
            catalogoVersaoRef: contrato.catalogoVersaoRef,
            dataAssinatura: dataDe(rp.dataAssinatura),
            dataPrimeiraParcela: dataDe(rp.dataAssinatura),
            valorTotal: reais(rp.total), valorEntrada: reais(0), saldoDevedor: reais(rp.total),
            modalidade: 'COMPRA_PARCELADA',
            cronogramaGeradoEm: new Date(),
            numeroParcelas: rp.numeroParcelas,
            valorParcelaInicial: reais(rp.cotas[0].valor),
            periodicidade: PER,
            taxaDescontoQuitacao: contrato.taxaDescontoQuitacao,
            status: rp.status,
            motivoEncerramento: rp.status === 'ENCERRADO' ? 'QUITACAO' : null,
            dataEncerramento: rp.dataEncerramento ? dataDe(rp.dataEncerramento) : null,
            snapshotJson: { legado: { casoId: caso.id, reembolsoDe: contrato.numero, rotulo: rp.rotulo, semTaxa: true, backfill: { em: new Date().toISOString(), por: usuarioId, faturas: rp.cotas.map((x) => x.faturaId) } } } as Prisma.InputJsonValue,
          },
          select: { id: true, numero: true },
        });
        const item = await tx.itemContratado.create({
          data: { contratoId: c.id, descricao: `Reembolso Parcelado — ${rp.rotulo}`, natureza: 'PARCELADO', credor: 'AZIT', valor: reais(rp.total), numeroParcelas: rp.numeroParcelas, periodicidade: PER, dataInicio: dataDe(rp.dataAssinatura) },
          select: { id: true },
        });
        for (const cota of rp.cotas) {
          const fatura = await tx.fatura.findUniqueOrThrow({ where: { id: cota.faturaId }, select: { id: true, dataVencimento: true, dataPagamento: true } });
          const parcela = await tx.parcela.create({
            data: {
              contratoId: c.id, itemContratadoId: item.id,
              numero: cota.n, totalParcelas: rp.numeroParcelas, display: `${cota.n}/${rp.numeroParcelas}`,
              valorNominal: reais(cota.valor), dataVencimento: fatura.dataVencimento,
              dataPagamento: cota.paga ? fatura.dataPagamento ?? fatura.dataVencimento : null,
              valorPago: cota.paga ? reais(cota.valor) : null,
              status: cota.statusParcela,
              faturaId: fatura.id,
            },
            select: { id: true },
          });
          await tx.recebivel.create({
            data: { contratoId: c.id, parcelaId: parcela.id, origemCapitalId: null, dataPrevista: fatura.dataVencimento, valorPrevisto: reais(cota.valor), dataRealizada: cota.paga ? fatura.dataPagamento ?? fatura.dataVencimento : null, valorRealizado: cota.paga ? reais(cota.valor) : null, status: cota.paga ? 'REALIZADO' : 'ESPERADO' },
          });
          await tx.itemFatura.create({ data: { faturaId: fatura.id, parcelaId: parcela.id, tipo: 'PRINCIPAL', descricao: cota.descricaoItem, valor: reais(cota.valor), credor: 'AZIT' } });
          await this.aplicarAjuste(tx, ajustePorFatura.get(fatura.id)!);
        }
        criados.push({ id: c.id, numero: c.numero, rotulo: rp.rotulo, total: rp.total, parcelas: rp.numeroParcelas, status: rp.status });
      }

      // Auditoria + resumo do caso (a tela "Migrado em…" passa a contar estes reembolsos).
      const resumoAtual = ((await tx.casoMigracaoLegado.findUnique({ where: { id: caso.id }, select: { migracaoResumo: true } }))?.migracaoResumo as Record<string, unknown> | null) ?? {};
      const registro = { em: new Date().toISOString(), por: usuarioId, contratos: criados, ajustes: plano.ajustes.map((a) => ({ faturaId: a.faturaId, vencimento: a.vencimento, modo: a.modo, valor: a.valor })) };
      const resumo = {
        ...resumoAtual,
        reembolsos: ((resumoAtual.reembolsos as number | undefined) ?? 0) + criados.length,
        reembolsosIds: [...((resumoAtual.reembolsosIds as string[] | undefined) ?? []), ...criados.map((x) => x.id)],
        reembolsosCompletados: [...((resumoAtual.reembolsosCompletados as unknown[] | undefined) ?? []), registro],
      };
      await tx.casoMigracaoLegado.update({ where: { id: caso.id }, data: { migracaoResumo: resumo as Prisma.InputJsonValue } });
      await tx.logAuditoria.create({ data: { usuarioId, acao: 'legado_reembolsos_completados', entidade: 'caso_migracao_legado', entidadeId: caso.id, depois: { contrato: contrato.numero, ...registro, ignoradas: plano.ignoradas } as unknown as Prisma.InputJsonValue } });
      return { criados, ajustes: plano.ajustes, ignoradas: plano.ignoradas };
    }, { timeout: 60_000 });
  }

  // Ajuste da fatura da semana conforme o modo decidido pelo planejador. Nunca
  // toca em data de pagamento nem em cobrança do Asaas.
  private async aplicarAjuste(tx: Tx, a: PlanoReembolsosBackfill['ajustes'][number]) {
    if (a.modo === 'folga') return; // o item do RP fecha a conta sozinho
    if (a.modo === 'faltante') {
      await tx.fatura.update({ where: { id: a.faturaId }, data: { valorTotal: reais(a.totalDepois), ...(a.pagoDepois != null ? { valorPago: reais(a.pagoDepois) } : {}) } });
      return;
    }
    // principal: o item do veículo diminui; parcela e recebível acompanham.
    await tx.itemFatura.update({ where: { id: a.principal!.itemId }, data: { valor: reais(a.principal!.depois) } });
    const pv = a.parcelaVeiculo!;
    await tx.parcela.update({ where: { id: pv.id }, data: { valorNominal: reais(pv.nominalDepois), ...(pv.pagoDepois != null ? { valorPago: reais(pv.pagoDepois) } : {}) } });
    const rec = await tx.recebivel.findUnique({ where: { parcelaId: pv.id }, select: { id: true, valorPrevisto: true, valorRealizado: true } });
    if (rec) {
      const previsto = cent(rec.valorPrevisto)! - (pv.nominalAntes - pv.nominalDepois);
      const realizado = rec.valorRealizado != null ? cent(rec.valorRealizado)! - a.valor : null;
      await tx.recebivel.update({ where: { id: rec.id }, data: { valorPrevisto: reais(previsto), ...(realizado != null ? { valorRealizado: reais(Math.max(0, realizado)) } : {}) } });
    }
  }

  // ---------------- Planejamento sobre o banco ----------------

  private async planejar(db: Tx, casoId: string, contrato: ContratoMigrado, despesas: DespesaDeclaradaBackfill[]) {
    const faturas = await this.faturasDoContrato(db, casoId, contrato.id, contrato.contaId);
    const rpsExistentes = await db.contratoCredito.count({ where: { numero: { startsWith: `${contrato.numero}-RP` } } });
    return planejarReembolsosFaltantes({ contratoNumero: contrato.numero, faturas, despesas, rpsExistentes });
  }

  private async faturasDoContrato(db: Tx, casoId: string, contratoId: string, contaId: string): Promise<(FaturaMigrada & { leitura: { extra: number; extraRotulo: string | null } | null })[]> {
    const faturas = await db.fatura.findMany({
      where: { contaId, deletedAt: null, parcelas: { some: { contratoId, deletedAt: null } } },
      orderBy: [{ dataVencimento: 'asc' }, { numero: 'asc' }],
      select: {
        id: true, numero: true, dataVencimento: true, status: true, valorTotal: true, valorPago: true, dataPagamento: true, asaasChargeId: true,
        itensFatura: { select: { id: true, tipo: true, descricao: true, valor: true, parcelaId: true, parcela: { select: { contratoId: true, contrato: { select: { numero: true } } } } }, orderBy: { createdAt: 'asc' } },
        parcelas: { where: { contratoId, deletedAt: null }, select: { id: true, numero: true, valorNominal: true, valorPago: true }, take: 1 },
      },
    });
    const cobrancas = await db.cobrancaLegada.findMany({ where: { casoId }, select: { asaasPaymentId: true, descricao: true, valorOriginal: true, valor: true, valorPago: true, interpretacao: true } });
    const porCharge = new Map(cobrancas.map((c) => [c.asaasPaymentId, c]));
    return faturas.map((f) => {
      const cob = f.asaasChargeId ? porCharge.get(f.asaasChargeId) : undefined;
      const interp = (cob?.interpretacao as { extra?: number; extraRotulo?: string | null } | null) ?? null;
      const pv = f.parcelas[0];
      return {
        id: f.id, numero: f.numero, vencimento: isoDe(f.dataVencimento)!, status: f.status,
        valorTotal: cent(f.valorTotal)!, valorPago: cent(f.valorPago), pagoEm: isoDe(f.dataPagamento), asaasChargeId: f.asaasChargeId,
        cobranca: cob ? { asaasPaymentId: cob.asaasPaymentId, descricao: cob.descricao, valorOriginal: cent(cob.valorOriginal ?? cob.valor)!, valorPago: cent(cob.valorPago) } : null,
        itens: f.itensFatura.map((it) => ({ id: it.id, tipo: it.tipo, descricao: it.descricao, valor: cent(it.valor)!, parcelaId: it.parcelaId, contratoDaParcela: it.parcela && it.parcela.contratoId !== contratoId ? it.parcela.contrato.numero : null })),
        parcelaVeiculo: pv ? { id: pv.id, numero: pv.numero, valorNominal: cent(pv.valorNominal)!, valorPago: cent(pv.valorPago) } : null,
        leitura: interp && (interp.extra ?? 0) > 0 ? { extra: interp.extra!, extraRotulo: interp.extraRotulo ?? null } : null,
      };
    });
  }

  private async carregarMigrado(casoId: string): Promise<{ caso: { id: string }; contrato: ContratoMigrado }> {
    const caso = await this.prisma.db.casoMigracaoLegado.findUnique({ where: { id: casoId }, select: { id: true, status: true, contratoId: true } });
    if (!caso) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Caso não encontrado' });
    if (caso.status !== 'MIGRADO' || !caso.contratoId) throw new UnprocessableEntityException({ erro: 'nao_migrado', mensagem: 'Só um caso migrado pode ter reembolsos completados' });
    const contrato = await this.prisma.db.contratoCredito.findUnique({ where: { id: caso.contratoId }, select: { id: true, numero: true, contaId: true, periodicidade: true, catalogoVersaoRef: true, taxaDescontoQuitacao: true } });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato do caso não encontrado' });
    return { caso: { id: caso.id }, contrato };
  }

  private validarCorpo(corpo: unknown): DespesaDeclaradaBackfill[] {
    const lista = (corpo as { despesas?: unknown } | null)?.despesas;
    if (!Array.isArray(lista) || !lista.length) throw new UnprocessableEntityException({ erro: 'despesas_vazias', mensagem: 'Informe ao menos uma despesa (fatura, valor e rótulo)' });
    if (lista.length > 60) throw new UnprocessableEntityException({ erro: 'despesas_demais', mensagem: 'No máximo 60 despesas por vez' });
    return lista.map((d) => {
      const x = (d ?? {}) as { faturaId?: unknown; valor?: unknown; rotulo?: unknown };
      return { faturaId: String(x.faturaId ?? ''), valor: typeof x.valor === 'number' ? Math.round(x.valor) : Number.NaN, rotulo: String(x.rotulo ?? '').slice(0, 80) };
    });
  }
}

type ContratoMigrado = { id: string; numero: string; contaId: string; periodicidade: 'SEMANAL' | 'QUINZENAL' | 'MENSAL'; catalogoVersaoRef: string | null; taxaDescontoQuitacao: Prisma.Decimal | null };

const dataDe = (iso: string) => new Date(`${iso}T03:00:00.000Z`); // meia-noite de Brasília, como o planner
