import { Injectable, Logger, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, StatusParcela as StatusParcelaPrisma } from '@prisma/client';
import {
  AcertoRescisao,
  calcularAcertoRescisao,
  centavosParaReaisString,
  dataCalendarioUTC,
  dataHojeBrasil,
  diasCalendarioEntre,
  formatCurrency,
  inicioDiaUTC,
  PERCENTUAL_CREDITO_RESCISAO,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { AsaasService } from '../asaas/asaas.service';

const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null | undefined): number => (d ? Math.round(Number(d.toString()) * 100) : 0);
const PARCELA_PAGA: StatusParcelaPrisma[] = ['PAGA', 'PAGA_EM_ATRASO', 'PAGA_ANTECIPADA'];
const FATURA_VIVA = ['ABERTA', 'FECHADA', 'RENEGOCIADA'] as const;

export interface RescisaoApi {
  id: string;
  contratoId: string;
  status: string; // pendente | efetivada | reprovada | cancelada
  dataBase: string; // 'YYYY-MM-DD'
  observacao: string | null;
  solicitanteId: string;
  aprovadaPor: string | null;
  efetivadaEm: string | null;
  devolvidoEm: string | null;
  devolucaoObservacao: string | null;
  acerto: AcertoRescisao;
  avisos: string[];
  aprovacaoId: string | null; // solicitação pendente na Central (link do dossiê)
}

// Rescisão por inadimplência (doc 02 §29, decisão Luís 04/11/2026). A CONTA do
// acerto é calcularAcertoRescisao em @azit/utils (Regra 16); aqui só carregamos
// os fatos, validamos, pedimos aprovação (1 aprovador, tipo 'rescisao') e
// efetivamos quando o motor aprova — referenciaId da solicitação é o CONTRATO
// (uma rescisão pendente por contrato; a rota do ocorrido é a ficha dele).
@Injectable()
export class RescisaoService implements OnModuleInit {
  private readonly logger = new Logger(RescisaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aprovacao: AprovacaoService,
    private readonly asaas: AsaasService,
  ) {}

  onModuleInit() {
    this.aprovacao.registrarEfetivador('rescisao', {
      aprovada: async (a) => {
        const r = await this.efetivar(a.referenciaId, a.decisorId);
        if (!r) return 'Rescisão sem solicitação pendente — nada efetivado.';
        const resultado = r.acerto.valorADevolver > 0
          ? `a devolver ao cliente ${formatCurrency(r.acerto.valorADevolver)}`
          : r.acerto.saldoRemanescente > 0
            ? `saldo remanescente do cliente ${formatCurrency(r.acerto.saldoRemanescente)}`
            : 'acerto zerado';
        return `Contrato ${r.numero} rescindido: ${r.acerto.vencidas.length} parcela(s) vencida(s) compensada(s) com o crédito de ${formatCurrency(r.acerto.valorCredito)} — ${resultado}.`;
      },
      reprovada: async (a) => {
        await this.prisma.db.rescisaoContrato.updateMany({
          where: { contratoId: a.referenciaId, status: 'PENDENTE' },
          data: { status: 'REPROVADA' },
        });
      },
    });
  }

  // --- Fatos e acerto ---------------------------------------------------------------

  private async carregar(contratoId: string, dataBase: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: {
        id: true, numero: true, status: true, ativoId: true, contaId: true,
        valorEntradaPago: true, taxaMultaAtraso: true, taxaJurosAtraso: true, recuperacaoIniciadaEm: true, veiculoBloqueadoEm: true,
        conta: { select: { titularId: true, titular: { select: { nome: true } } } },
        ativo: { select: { descricao: true, placa: true, modelo: true } },
      },
    });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });

    const [pagas, abertas] = await Promise.all([
      this.prisma.db.parcela.findMany({
        where: { contratoId, status: { in: PARCELA_PAGA } },
        select: { display: true, valorNominal: true, valorPago: true, valorEncargo: true, itensFatura: { select: { tipo: true, valor: true } } },
      }),
      this.prisma.db.parcela.findMany({
        where: { contratoId, status: null, acordoId: null },
        orderBy: { dataVencimento: 'asc' },
        select: { id: true, display: true, valorNominal: true, dataVencimento: true },
      }),
    ]);

    const acerto = calcularAcertoRescisao({
      dataBase,
      entradaPaga: cent(contrato.valorEntradaPago),
      parcelasPagas: pagas.map((p) => ({
        display: p.display,
        valorNominal: cent(p.valorNominal),
        valorPago: p.valorPago === null ? null : cent(p.valorPago),
        valorEncargo: p.valorEncargo === null ? null : cent(p.valorEncargo),
        // Proteção veicular embutida: item SERVICO da própria parcela (mesma regra da decomposição da novação).
        protecao: Math.min(cent(p.valorNominal), p.itensFatura.filter((i) => i.tipo === 'SERVICO').reduce((s, i) => s + cent(i.valor), 0)),
      })),
      parcelasAbertas: abertas.map((p) => ({ id: p.id, display: p.display, valorNominal: cent(p.valorNominal), dataVencimento: dataCalendarioUTC(p.dataVencimento) })),
      taxaMultaPercent: Number(contrato.taxaMultaAtraso.toString()),
      taxaJurosMensalPercent: Number(contrato.taxaJurosAtraso.toString()),
    });
    const maisAntiga = abertas[0]?.dataVencimento;
    const diasAtraso = maisAntiga ? Math.max(0, diasCalendarioEntre(dataCalendarioUTC(maisAntiga), dataHojeBrasil())) : 0;
    const saldoEmAberto = abertas.reduce((s, p) => s + cent(p.valorNominal), 0);
    return { contrato, acerto, diasAtraso, saldoEmAberto };
  }

  private validarDataBase(dataBase?: string): string {
    const hoje = dataHojeBrasil();
    const d = dataBase ?? hoje;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(inicioDiaUTC(d).getTime())) {
      throw new UnprocessableEntityException({ erro: 'data_invalida', mensagem: 'Data-base inválida (use AAAA-MM-DD)' });
    }
    if (d > hoje) throw new UnprocessableEntityException({ erro: 'data_futura', mensagem: 'A data da retomada não pode ser futura' });
    return d;
  }

  private motivoInelegivel(c: { status: string; ativoId: string | null }, acerto: AcertoRescisao): string | null {
    if (c.status !== 'ATIVO') return `Só contrato em vida pode ser rescindido (fase atual: ${c.status})`;
    if (!c.ativoId) return 'Rescisão por inadimplência é do contrato do veículo (este contrato não tem ativo)';
    if (acerto.vencidas.length === 0) return 'Não há parcela vencida até a data-base';
    return null;
  }

  // Prévia do acerto para a tela (sem gravar nada).
  async previa(contratoId: string, dataBase?: string) {
    const d = this.validarDataBase(dataBase);
    const { contrato, acerto, diasAtraso, saldoEmAberto } = await this.carregar(contratoId, d);
    const pendente = await this.prisma.db.rescisaoContrato.findFirst({ where: { contratoId, status: 'PENDENTE' }, select: { id: true } });
    const motivo = pendente ? 'Já existe uma rescisão aguardando aprovação na Central' : this.motivoInelegivel(contrato, acerto);
    return {
      contrato: {
        id: contrato.id, numero: contrato.numero, status: contrato.status, titular: contrato.conta.titular.nome,
        ativo: contrato.ativo, diasAtraso, saldoEmAberto, recuperacaoIniciadaEm: contrato.recuperacaoIniciadaEm?.toISOString() ?? null,
      },
      acerto,
      elegivel: !motivo,
      motivoInelegivel: motivo,
    };
  }

  // --- Solicitação -------------------------------------------------------------------

  async solicitar(contratoId: string, dto: { dataBase?: string; observacao?: string }, solicitanteId: string) {
    const d = this.validarDataBase(dto.dataBase);
    const { contrato, acerto, saldoEmAberto } = await this.carregar(contratoId, d);
    const motivo = this.motivoInelegivel(contrato, acerto);
    if (motivo) throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: motivo });
    const pendente = await this.prisma.db.rescisaoContrato.findFirst({ where: { contratoId, status: 'PENDENTE' }, select: { id: true } });
    if (pendente) throw new UnprocessableEntityException({ erro: 'ja_pendente', mensagem: 'Já existe uma rescisão aguardando aprovação na Central' });

    const rescisao = await this.prisma.db.rescisaoContrato.create({
      data: { ...this.snapshot(acerto, []), contratoId, dataBase: inicioDiaUTC(d), observacao: dto.observacao?.trim() || null, solicitanteId },
    });
    const resultado = acerto.valorADevolver > 0
      ? `a devolver ${formatCurrency(acerto.valorADevolver)}`
      : `saldo remanescente ${formatCurrency(acerto.saldoRemanescente)}`;
    await this.aprovacao.criar({
      tipoOperacao: 'rescisao',
      referenciaTipo: 'rescisao',
      referenciaId: contratoId,
      titularId: contrato.conta.titularId,
      valorCentavos: saldoEmAberto,
      resumo: `Rescisão por inadimplência — contrato ${contrato.numero} (${contrato.conta.titular.nome}): ${acerto.vencidas.length} parcela(s) vencida(s), crédito de ${PERCENTUAL_CREDITO_RESCISAO}% ${formatCurrency(acerto.valorCredito)}, ${resultado}`,
      payload: { rescisaoId: rescisao.id, dataBase: d },
      solicitanteId,
    });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId: solicitanteId, acao: 'rescisao_solicitada', entidade: 'contrato', entidadeId: contratoId, depois: { rescisaoId: rescisao.id, dataBase: d, acerto: acerto as unknown as Prisma.InputJsonValue } },
    });
    return { id: rescisao.id, status: 'pendente', acerto };
  }

  private snapshot(acerto: AcertoRescisao, avisos: string[]) {
    return {
      principalEntrada: reais(acerto.entradaPaga),
      principalParcelas: reais(acerto.principalParcelas),
      percentualCredito: acerto.percentualCredito.toFixed(2),
      valorCredito: reais(acerto.valorCredito),
      dividaVencida: reais(acerto.dividaVencida),
      encargosVencidos: reais(acerto.encargosVencidos),
      valorCompensado: reais(acerto.valorCompensado),
      valorADevolver: reais(acerto.valorADevolver),
      saldoRemanescente: reais(acerto.saldoRemanescente),
      memoriaJson: { acerto, avisos } as unknown as Prisma.InputJsonValue,
    };
  }

  // --- Efetivação (ao aprovar) --------------------------------------------------------

  async efetivar(contratoId: string, decisorId: string) {
    const r = await this.prisma.db.rescisaoContrato.findFirst({ where: { contratoId, status: 'PENDENTE' }, orderBy: { createdAt: 'desc' } });
    if (!r) return null;
    const dataBase = dataCalendarioUTC(r.dataBase);
    // Recalcula na MESMA data-base: pagamento entre o pedido e a aprovação muda o acerto.
    const { contrato, acerto } = await this.carregar(contratoId, dataBase);
    if (contrato.status !== 'ATIVO') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: `Contrato já não está em vida (fase ${contrato.status})` });
    }
    const avisos: string[] = [];
    const cobrancasParaRemover: string[] = [];
    const instanteBase = inicioDiaUTC(dataBase);

    await this.prisma.db.$transaction(async (tx) => {
      // 1. Obrigações do contrato: parcelas em aberto → RESCINDIDA (Regra 3: nada se apaga);
      //    recebíveis esperados → CANCELADO; itens contratados → ENCERRADO.
      await tx.recebivel.updateMany({ where: { contratoId, status: 'ESPERADO', parcela: { status: null } }, data: { status: 'CANCELADO' } });
      await tx.parcela.updateMany({ where: { contratoId, status: null }, data: { status: 'RESCINDIDA' } });
      await tx.itemContratado.updateMany({ where: { contratoId, status: 'ATIVO' }, data: { status: 'ENCERRADO' } });

      // 2. Faturas não pagas da conta: só deste contrato → RESCINDIDA (cobrança sai do
      //    ar); mista → tira os itens deste contrato e recalcula (cobrança sai do ar e a
      //    fatura volta a ABERTA para a emissão normal reemitir com o valor certo).
      const faturas = await tx.fatura.findMany({
        where: { contaId: contrato.contaId, status: { in: [...FATURA_VIVA] }, deletedAt: null },
        select: { id: true, numero: true, status: true, asaasChargeId: true, itensFatura: { select: { id: true, valor: true, parcelaId: true, parcela: { select: { contratoId: true } } } } },
      });
      for (const f of faturas) {
        const deste = f.itensFatura.filter((i) => i.parcela?.contratoId === contratoId);
        const deOutros = f.itensFatura.filter((i) => i.parcela && i.parcela.contratoId !== contratoId);
        if (deste.length === 0 && deOutros.length > 0) continue; // fatura de outro contrato
        if (deste.length === 0 && deOutros.length === 0) {
          // só itens recorrentes (sem parcela): não dá para atribuir ao contrato.
          const outrosAtivos = await tx.contratoCredito.count({ where: { contaId: contrato.contaId, id: { not: contratoId }, status: 'ATIVO' } });
          if (outrosAtivos > 0) { avisos.push(`Fatura #${f.numero} só tem itens recorrentes e a conta tem outro contrato ativo — conferir manualmente.`); continue; }
        }
        if (deOutros.length === 0) {
          if (f.asaasChargeId) cobrancasParaRemover.push(f.asaasChargeId);
          await tx.fatura.update({ where: { id: f.id }, data: { status: 'RESCINDIDA' } });
          continue;
        }
        // Mista: remove os itens deste contrato e recalcula o total.
        const retirado = deste.reduce((s, i) => s + cent(i.valor), 0);
        await tx.itemFatura.deleteMany({ where: { id: { in: deste.map((i) => i.id) } } });
        const restante = f.itensFatura.filter((i) => !deste.some((d) => d.id === i.id)).reduce((s, i) => s + cent(i.valor), 0);
        const data: Prisma.FaturaUpdateInput = { valorTotal: reais(restante) };
        if (f.asaasChargeId) {
          cobrancasParaRemover.push(f.asaasChargeId);
          data.asaasChargeId = null;
          if (f.status === 'FECHADA') data.status = 'ABERTA';
          avisos.push(`Fatura #${f.numero} é de mais de um contrato: ${formatCurrency(retirado)} deste contrato saíram dela e a cobrança será reemitida com ${formatCurrency(restante)}.`);
        } else {
          avisos.push(`Fatura #${f.numero} é de mais de um contrato: ${formatCurrency(retirado)} deste contrato saíram dela (novo total ${formatCurrency(restante)}).`);
        }
        await tx.fatura.update({ where: { id: f.id }, data });
      }

      // 3. Acordos vivos da conta cujo plano é só deste contrato → CANCELADO.
      const acordos = await tx.acordo.findMany({
        where: { contaId: contrato.contaId, status: { in: ['RASCUNHO', 'AGUARDANDO_ENTRADA', 'ATIVO'] } },
        select: { id: true, status: true, itensGerados: { select: { contratoId: true } } },
      });
      for (const a of acordos) {
        const contratos = new Set(a.itensGerados.map((i) => i.contratoId));
        if (contratos.size === 0 || (contratos.size === 1 && contratos.has(contratoId))) {
          await tx.acordo.update({ where: { id: a.id }, data: { status: 'CANCELADO' } });
        } else {
          avisos.push(`Acordo ${a.id} envolve outro contrato da conta e não foi cancelado — conferir manualmente.`);
        }
      }

      // 4. Contrato encerrado por rescisão; recuperação carimbada se não havia; ativo recuperado.
      await tx.contratoCredito.update({
        where: { id: contratoId },
        data: {
          status: 'ENCERRADO',
          motivoEncerramento: 'RESCISAO',
          dataEncerramento: instanteBase,
          recuperacaoIniciadaEm: contrato.recuperacaoIniciadaEm ?? instanteBase,
        },
      });
      if (contrato.ativoId) await tx.ativo.update({ where: { id: contrato.ativoId }, data: { status: 'RECUPERADO' } });

      // 5. Snapshot final do acerto.
      await tx.rescisaoContrato.update({
        where: { id: r.id },
        data: { ...this.snapshot(acerto, avisos), status: 'EFETIVADA', aprovadaPor: decisorId, efetivadaEm: new Date() },
      });
      await tx.logAuditoria.create({
        data: {
          usuarioId: decisorId,
          acao: 'contrato_rescindido',
          entidade: 'contrato',
          entidadeId: contratoId,
          antes: { status: 'ATIVO' },
          depois: { status: 'ENCERRADO', motivoEncerramento: 'RESCISAO', dataBase, rescisaoId: r.id, acerto: acerto as unknown as Prisma.InputJsonValue, avisos },
        },
      });
    }, { timeout: 60_000 });

    // Como na novação: falha na remoção não propaga (removerCobranca só loga).
    for (const chargeId of cobrancasParaRemover) await this.asaas.removerCobranca(chargeId);
    this.logger.log(`Contrato ${contrato.numero} rescindido (rescisão ${r.id}); ${cobrancasParaRemover.length} cobrança(s) removida(s) do Asaas`);
    return { numero: contrato.numero, acerto, avisos };
  }

  // --- Depois da efetivação --------------------------------------------------------------

  // Devolução ao cliente registrada (placeholder: o pagamento acontece fora do sistema).
  async registrarDevolucao(rescisaoId: string, dto: { data?: string; observacao?: string }, usuarioId: string) {
    const r = await this.prisma.db.rescisaoContrato.findFirst({ where: { id: rescisaoId } });
    if (!r) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Rescisão não encontrada' });
    if (r.status !== 'EFETIVADA') throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'A rescisão ainda não foi efetivada' });
    if (cent(r.valorADevolver) <= 0) throw new UnprocessableEntityException({ erro: 'sem_devolucao', mensagem: 'Esta rescisão não tem valor a devolver' });
    if (r.devolvidoEm) throw new UnprocessableEntityException({ erro: 'ja_devolvido', mensagem: 'Devolução já registrada' });
    const d = this.validarDataBase(dto.data);
    await this.prisma.db.rescisaoContrato.update({ where: { id: r.id }, data: { devolvidoEm: inicioDiaUTC(d), devolucaoObservacao: dto.observacao?.trim() || null } });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'rescisao_devolucao_registrada', entidade: 'contrato', entidadeId: r.contratoId, depois: { rescisaoId: r.id, data: d, valor: cent(r.valorADevolver), observacao: dto.observacao ?? null } },
    });
    return { resultado: 'devolucao_registrada', em: d };
  }

  async listarDoContrato(contratoId: string): Promise<RescisaoApi[]> {
    const [rescisoes, pendente] = await Promise.all([
      this.prisma.db.rescisaoContrato.findMany({ where: { contratoId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.db.aprovacao.findFirst({ where: { referenciaTipo: 'rescisao', referenciaId: contratoId, status: 'PENDENTE' }, select: { id: true } }),
    ]);
    return rescisoes.map((r) => {
      const mem = (r.memoriaJson as unknown as { acerto: AcertoRescisao; avisos?: string[] }) ?? { acerto: null, avisos: [] };
      return {
        id: r.id,
        contratoId: r.contratoId,
        status: r.status.toLowerCase(),
        dataBase: dataCalendarioUTC(r.dataBase),
        observacao: r.observacao,
        solicitanteId: r.solicitanteId,
        aprovadaPor: r.aprovadaPor,
        efetivadaEm: r.efetivadaEm?.toISOString() ?? null,
        devolvidoEm: r.devolvidoEm ? dataCalendarioUTC(r.devolvidoEm) : null,
        devolucaoObservacao: r.devolucaoObservacao,
        acerto: mem.acerto,
        avisos: mem.avisos ?? [],
        aprovacaoId: r.status === 'PENDENTE' ? pendente?.id ?? null : null,
      };
    });
  }

  // Rescisão pendente do contrato (dossiê da Central).
  async pendenteDoContrato(contratoId: string) {
    const r = await this.prisma.db.rescisaoContrato.findFirst({ where: { contratoId, status: 'PENDENTE' }, orderBy: { createdAt: 'desc' } });
    if (!r) return null;
    const mem = r.memoriaJson as unknown as { acerto: AcertoRescisao; avisos?: string[] };
    return { ...r, acerto: mem.acerto };
  }
}
