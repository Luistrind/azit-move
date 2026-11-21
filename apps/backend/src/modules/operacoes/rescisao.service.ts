import { BadGatewayException, Injectable, Logger, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, StatusParcela as StatusParcelaPrisma } from '@prisma/client';
import {
  AcertoRescisao,
  adicionarDiasUteis,
  calcularAcertoRescisao,
  centavosParaReaisString,
  CustoAcerto,
  dataCalendarioUTC,
  dataHojeBrasil,
  diasCalendarioEntre,
  fimDoDiaBrasil,
  formatCurrency,
  formatarDiaBR,
  inicioDiaUTC,
  inicioHojeBrasilUTC,
  reaplicarCustosNoAcerto,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { AsaasService } from '../asaas/asaas.service';
import { ContaFaturaService } from '../faturamento/conta-fatura.service';
import { IntencaoPagamentoService } from '../faturamento/intencao-pagamento.service';
import { ROTULO_TIPO } from '../frota/ocorrencia.service';
import { NotificacaoService } from '../notificacao/notificacao.service';

const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null | undefined): number => (d ? Math.round(Number(d.toString()) * 100) : 0);
const PARCELA_PAGA: StatusParcelaPrisma[] = ['PAGA', 'PAGA_EM_ATRASO', 'PAGA_ANTECIPADA'];
const FATURA_VIVA = ['ABERTA', 'FECHADA', 'RENEGOCIADA'] as const;
// Boleto único do saldo remanescente: prazo em dias ÚTEIS (decisão Luís 20/11, doc 02 §29.3).
export const DIAS_UTEIS_BOLETO_SALDO_RESCISAO = 15;
const PEDIDO_ANTIGO_PENDENTE = 'Há um pedido de rescisão antigo aguardando na Central de Aprovações — decida ou cancele lá antes de rescindir por aqui';

// Uma linha do histórico do saldo depois da rescisão (ajustesJson).
export interface AjusteRescisao {
  em: string; // ISO
  por: string | null; // nome de quem ajustou
  motivo: string;
  saldoAntes: number; // centavos
  saldoDepois: number;
  devolverAntes: number;
  devolverDepois: number;
}

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
  // §29.3 (20–21/11)
  origem: string; // retomada | devolucao
  efetivadaPorNome: string | null;
  ajustes: AjusteRescisao[];
  cobrancaSaldo: {
    valor: number; // centavos
    vencimento: string; // 'YYYY-MM-DD'
    emitidaEm: string;
    link: string | null;
    vencida: boolean; // o Asaas avisou que venceu sem pagamento
    desatualizada: boolean; // o saldo mudou e a troca do boleto falhou
  } | null;
  saldoPagoEm: string | null;
  saldoValorPago: number | null;
}

// Rescisão do contrato (doc 02 §29; fluxo revisto pelo Luís em 20–21/11/2026,
// §29.3). A CONTA do acerto é calcularAcertoRescisao em @azit/utils (Regra 16);
// aqui carregamos os fatos (parcelas, custos da recuperação, multas do veículo),
// validamos e EFETIVAMOS NA HORA — sem aprovação, só ADMIN/DIRETOR (a rota
// garante). Depois da rescisão: ajuste de custos recalcula o saldo, e o saldo
// remanescente vira um boleto único (15 dias úteis) que serve para negativar.
// O efetivador do motor de aprovação continua registrado só para concluir
// pedido antigo que ainda estivesse pendente na Central.
@Injectable()
export class RescisaoService implements OnModuleInit {
  private readonly logger = new Logger(RescisaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aprovacao: AprovacaoService,
    private readonly asaas: AsaasService,
    // Fatura Azit F2 (doc 02 §32.12 item 12): saldo do motor na data-base e
    // cancelamento dos Pix ativos ao efetivar.
    private readonly contaFatura: ContaFaturaService,
    private readonly intencoes: IntencaoPagamentoService,
    private readonly alertas: NotificacaoService,
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

    // Parcela em fatura do modelo AZIT: a dívida é o SALDO do motor na data-base
    // (o já pago em parte não é cobrado de novo) e o principal que esse parcial
    // quitou entra na base dos 20%, mesmo com a parcela ainda em aberto.
    const azit = await this.contaFatura.saldosEmAberto(contrato.contaId, dataBase);
    const saldoMotor = (parcelaId: string) => azit.porParcela.get(parcelaId);
    const principalParcial = abertas.reduce((s, p) => s + (saldoMotor(p.id)?.principalPago ?? 0), 0);

    // §29.3: custos da recuperação que o cliente paga (orçados e pagos) e multas
    // do veículo deste contrato, do cliente, ainda sem desfecho, com fato até a
    // data-base. Em recurso / aguardando comprovante ficam de fora (o acerto avisa).
    const filtroMulta = { contratoId, deletedAt: null, responsavel: 'CLIENTE' as const, dataFato: { lte: fimDoDiaBrasil(dataBase) } };
    const [custos, ocorrencias, multasFora] = await Promise.all([
      this.custosDoCliente(contratoId),
      this.prisma.db.ocorrenciaVeiculo.findMany({
        where: { ...filtroMulta, status: 'REGISTRADA' },
        orderBy: { dataFato: 'asc' },
        select: { id: true, tipo: true, numeroAuto: true, dataFato: true, valor: true, valorComDesconto: true },
      }),
      this.prisma.db.ocorrenciaVeiculo.count({ where: { ...filtroMulta, status: { in: ['EM_RECURSO', 'AGUARDANDO_COMPROVANTE'] } } }),
    ]);
    const multas = ocorrencias
      .map((o) => ({
        id: o.id,
        descricao: `${ROTULO_TIPO[o.tipo]}${o.numeroAuto ? ` ${o.numeroAuto}` : ''} · fato em ${formatarDiaBR(o.dataFato)}`,
        valor: cent(o.valorComDesconto ?? o.valor),
      }))
      .filter((m) => m.valor > 0);

    const acerto = calcularAcertoRescisao({
      dataBase,
      principalParcial,
      entradaPaga: cent(contrato.valorEntradaPago),
      parcelasPagas: pagas.map((p) => ({
        display: p.display,
        valorNominal: cent(p.valorNominal),
        valorPago: p.valorPago === null ? null : cent(p.valorPago),
        valorEncargo: p.valorEncargo === null ? null : cent(p.valorEncargo),
        // Proteção veicular embutida: item SERVICO da própria parcela (mesma regra da decomposição da novação).
        protecao: Math.min(cent(p.valorNominal), p.itensFatura.filter((i) => i.tipo === 'SERVICO').reduce((s, i) => s + cent(i.valor), 0)),
      })),
      parcelasAbertas: abertas.map((p) => {
        const s = saldoMotor(p.id);
        return {
          id: p.id,
          display: p.display,
          valorNominal: cent(p.valorNominal),
          dataVencimento: dataCalendarioUTC(p.dataVencimento),
          ...(s ? { saldoNominal: s.saldoNominal, encargoCalculado: s.encargo } : {}),
        };
      }),
      taxaMultaPercent: Number(contrato.taxaMultaAtraso.toString()),
      taxaJurosMensalPercent: Number(contrato.taxaJurosAtraso.toString()),
      custos,
      multas,
    });
    const maisAntiga = abertas[0]?.dataVencimento;
    const diasAtraso = maisAntiga ? Math.max(0, diasCalendarioEntre(dataCalendarioUTC(maisAntiga), dataHojeBrasil())) : 0;
    const saldoEmAberto = abertas.reduce((s, p) => s + (saldoMotor(p.id)?.saldoNominal ?? cent(p.valorNominal)), 0);
    return { contrato, acerto, diasAtraso, saldoEmAberto, multasFora };
  }

  // Custos da recuperação repassados ao cliente (lançamentos de custo do veículo
  // ligados ao contrato) — o que entra na dívida do acerto.
  private async custosDoCliente(contratoId: string): Promise<CustoAcerto[]> {
    const linhas = await this.prisma.db.lancamentoCustoAtivo.findMany({
      where: { contratoId, deletedAt: null, quemPaga: 'CLIENTE' },
      orderBy: [{ data: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, tipo: true, descricao: true, valor: true, situacao: true },
    });
    return linhas.map((l) => ({ id: l.id, tipo: l.tipo, descricao: l.descricao, valor: cent(l.valor), orcado: l.situacao === 'ORCADO' }));
  }

  private validarDataBase(dataBase?: string): string {
    const hoje = dataHojeBrasil();
    const d = dataBase ?? hoje;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(inicioDiaUTC(d).getTime())) {
      throw new UnprocessableEntityException({ erro: 'data_invalida', mensagem: 'Data inválida (use AAAA-MM-DD)' });
    }
    if (d > hoje) throw new UnprocessableEntityException({ erro: 'data_futura', mensagem: 'A data em que o carro voltou não pode ser futura' });
    return d;
  }

  // §29.3: não exige mais parcela vencida — o carro devolvido de boa-fé também
  // é rescindido aqui, e a conta dos 20% considera o custo de reparo.
  private motivoInelegivel(c: { status: string; ativoId: string | null }): string | null {
    if (c.status !== 'ATIVO') return `Só contrato em vida pode ser rescindido (fase atual: ${c.status})`;
    if (!c.ativoId) return 'A rescisão é do contrato do veículo (este contrato não tem veículo)';
    return null;
  }

  // Prévia do acerto para a tela (sem gravar nada).
  async previa(contratoId: string, dataBase?: string) {
    const d = this.validarDataBase(dataBase);
    const { contrato, acerto, diasAtraso, saldoEmAberto, multasFora } = await this.carregar(contratoId, d);
    const pendente = await this.prisma.db.rescisaoContrato.findFirst({ where: { contratoId, status: 'PENDENTE' }, select: { id: true } });
    const motivo = pendente ? PEDIDO_ANTIGO_PENDENTE : this.motivoInelegivel(contrato);
    // O que a confirmação precisa dizer antes de efetivar (decisão Luís 21/11).
    const [cobrancasNoAr, outrosContratosAtivos] = await Promise.all([
      this.prisma.db.fatura.count({
        where: { contaId: contrato.contaId, deletedAt: null, status: { in: [...FATURA_VIVA] }, asaasChargeId: { not: null }, itensFatura: { some: { parcela: { contratoId } } } },
      }),
      this.prisma.db.contratoCredito.count({ where: { contaId: contrato.contaId, id: { not: contratoId }, status: 'ATIVO' } }),
    ]);
    return {
      contrato: {
        id: contrato.id, numero: contrato.numero, status: contrato.status, titular: contrato.conta.titular.nome,
        ativo: contrato.ativo, diasAtraso, saldoEmAberto, recuperacaoIniciadaEm: contrato.recuperacaoIniciadaEm?.toISOString() ?? null,
      },
      acerto,
      consequencias: { cobrancasNoAr, outrosContratosAtivos, multasFora },
      elegivel: !motivo,
      motivoInelegivel: motivo,
    };
  }

  // --- Rescindir (efetiva na hora, sem aprovação — §29.3) --------------------------------

  async rescindir(
    contratoId: string,
    dto: { dataBase?: string; origem?: 'RETOMADA' | 'DEVOLUCAO'; observacao?: string },
    usuarioId: string,
  ) {
    const d = this.validarDataBase(dto.dataBase);
    const { contrato, acerto } = await this.carregar(contratoId, d);
    const motivo = this.motivoInelegivel(contrato);
    if (motivo) throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: motivo });
    const pendente = await this.prisma.db.rescisaoContrato.findFirst({ where: { contratoId, status: 'PENDENTE' }, select: { id: true } });
    if (pendente) throw new UnprocessableEntityException({ erro: 'ja_pendente', mensagem: PEDIDO_ANTIGO_PENDENTE });

    const origem = dto.origem ?? 'RETOMADA';
    const rescisao = await this.prisma.db.rescisaoContrato.create({
      data: { ...this.snapshot(acerto, []), contratoId, dataBase: inicioDiaUTC(d), origem, observacao: dto.observacao?.trim() || null, solicitanteId: usuarioId },
    });
    try {
      const r = await this.efetivar(contratoId, usuarioId);
      if (!r) throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'A rescisão não pôde ser efetivada' });
      return { id: rescisao.id, status: 'efetivada', numero: r.numero, acerto: r.acerto, avisos: r.avisos };
    } catch (e) {
      // Nada foi efetivado (a transação é única): o registro não pode ficar
      // pendente travando a próxima tentativa.
      await this.prisma.db.rescisaoContrato.updateMany({ where: { id: rescisao.id, status: 'PENDENTE' }, data: { status: 'CANCELADA' } });
      throw e;
    }
  }

  private snapshot(acerto: AcertoRescisao, avisos: string[]) {
    return {
      principalEntrada: reais(acerto.entradaPaga),
      principalParcelas: reais(acerto.principalParcelas),
      percentualCredito: acerto.percentualCredito.toFixed(2),
      valorCredito: reais(acerto.valorCredito),
      dividaVencida: reais(acerto.dividaVencida),
      encargosVencidos: reais(acerto.encargosVencidos),
      custosCliente: reais(acerto.custosCliente ?? 0),
      multasVeiculo: reais(acerto.multasVeiculo ?? 0),
      valorCompensado: reais(acerto.valorCompensado),
      valorADevolver: reais(acerto.valorADevolver),
      saldoRemanescente: reais(acerto.saldoRemanescente),
      memoriaJson: { acerto, avisos } as unknown as Prisma.InputJsonValue,
    };
  }

  // --- Efetivação ------------------------------------------------------------------------

  async efetivar(contratoId: string, decisorId: string) {
    const r = await this.prisma.db.rescisaoContrato.findFirst({ where: { contratoId, status: 'PENDENTE' }, orderBy: { createdAt: 'desc' } });
    if (!r) return null;
    const dataBase = dataCalendarioUTC(r.dataBase);
    // Recalcula na MESMA data-base: pagamento entre o pedido e a aprovação muda o acerto.
    const { contrato, acerto, multasFora } = await this.carregar(contratoId, dataBase);
    if (contrato.status !== 'ATIVO') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: `Contrato já não está em vida (fase ${contrato.status})` });
    }
    const avisos: string[] = [];
    if (multasFora > 0) {
      avisos.push(`${multasFora} ocorrência(s) do veículo em recurso ou aguardando comprovante não entraram no acerto — se virarem dívida do cliente, lance como custo.`);
    }
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
        // Mista: tira os itens deste contrato e recalcula o total. Item que JÁ
        // RECEBEU pagamento (AlocacaoPagamento da Fatura Azit) NÃO é apagado — o
        // rastro do Pix sumiria (a FK é SET NULL): ele fica na fatura pelo valor
        // que foi pago, e só o que ainda faltava dele sai.
        const alocado = new Map<string, number>(
          (await tx.alocacaoPagamento.groupBy({ by: ['itemFaturaId'], where: { itemFaturaId: { in: deste.map((i) => i.id) } }, _sum: { valor: true } }))
            .map((a: { itemFaturaId: string | null; _sum: { valor: Prisma.Decimal | null } }) => [a.itemFaturaId ?? '', cent(a._sum.valor)] as [string, number])
            .filter(([, v]: [string, number]) => v > 0),
        );
        const semPagamento = deste.filter((i) => !alocado.has(i.id));
        const comPagamento = deste.filter((i) => alocado.has(i.id));
        const mantido = comPagamento.reduce((s, i) => s + (alocado.get(i.id) ?? 0), 0);
        const retirado = deste.reduce((s, i) => s + cent(i.valor), 0) - mantido;
        if (semPagamento.length) await tx.itemFatura.deleteMany({ where: { id: { in: semPagamento.map((i) => i.id) } } });
        for (const i of comPagamento) await tx.itemFatura.update({ where: { id: i.id }, data: { valor: reais(alocado.get(i.id) ?? 0) } });
        if (comPagamento.length) avisos.push(`Fatura #${f.numero}: ${formatCurrency(mantido)} já pagos em itens deste contrato continuam registrados nela (o pagamento não é apagado); só o que faltava saiu.`);
        const restante = f.itensFatura.filter((i) => !deste.some((d) => d.id === i.id)).reduce((s, i) => s + cent(i.valor), 0) + mantido;
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

      // 4-A. Multas do veículo que entraram na dívida (§29.3): repassadas ao cliente
      //      pelo acerto — não podem mais ir para fatura.
      const idsMultas = (acerto.multas ?? []).map((m) => m.id);
      if (idsMultas.length) {
        await tx.ocorrenciaVeiculo.updateMany({
          where: { id: { in: idsMultas }, status: 'REGISTRADA' },
          data: { status: 'REPASSADA', rescisaoId: r.id, desfechoEm: new Date(), desfechoPor: decisorId, desfechoObs: `Incluída no acerto da rescisão do contrato ${contrato.numero}` },
        });
      }

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
    // A dívida da conta mudou: os Pix sob demanda ativos deixam de valer (cancelados pela fila).
    await this.intencoes.invalidarAtivasDaConta(contrato.contaId, `rescisão do contrato ${contrato.numero}`);
    this.logger.log(`Contrato ${contrato.numero} rescindido (rescisão ${r.id}); ${cobrancasParaRemover.length} cobrança(s) removida(s) do Asaas`);
    return { numero: contrato.numero, acerto, avisos };
  }

  // --- Ajuste de custos depois da rescisão (§29.3) ----------------------------------------

  private async rescisaoEfetivada(contratoId: string) {
    return this.prisma.db.rescisaoContrato.findFirst({ where: { contratoId, status: 'EFETIVADA' }, orderBy: { createdAt: 'desc' } });
  }

  // Custo do cliente só muda enquanto o dinheiro do acerto não andou: depois que
  // a devolução foi feita ou o saldo foi pago, o resultado está liquidado.
  // Devolve o motivo do bloqueio (null = pode) — a tela usa para não mostrar a ação.
  async motivoCustosTravados(contratoId: string): Promise<string | null> {
    const r = await this.rescisaoEfetivada(contratoId);
    if (!r) return null;
    if (r.devolvidoEm) return 'A devolução ao cliente já foi registrada como feita — o acerto está liquidado e os custos do cliente não mudam mais';
    if (r.saldoPagoEm) return 'O saldo da rescisão já foi pago — o acerto está liquidado e os custos do cliente não mudam mais';
    return null;
  }

  // Chamado pelo serviço de custos depois de lançar/alterar/retirar um custo de
  // contrato JÁ rescindido: mesmo crédito, mesmas parcelas, só os custos mudam.
  // Sem aprovação (decisão Luís 20/11) — histórico em ajustesJson + auditoria.
  async recalcularAposCusto(contratoId: string, usuarioId: string, motivo: string) {
    const r = await this.rescisaoEfetivada(contratoId);
    if (!r) return null;
    const mem = r.memoriaJson as unknown as { acerto: AcertoRescisao; avisos?: string[] };
    const antes = mem.acerto;
    const depois = reaplicarCustosNoAcerto(antes, await this.custosDoCliente(contratoId));
    const mudou = antes.saldoRemanescente !== depois.saldoRemanescente || antes.valorADevolver !== depois.valorADevolver;
    const ajustes = [...((r.ajustesJson as unknown as AjusteRescisao[] | null) ?? [])];
    if (mudou) {
      const autor = await this.prisma.db.usuario.findFirst({ where: { id: usuarioId }, select: { nome: true } });
      ajustes.push({
        em: new Date().toISOString(),
        por: autor?.nome ?? null,
        motivo,
        saldoAntes: antes.saldoRemanescente,
        saldoDepois: depois.saldoRemanescente,
        devolverAntes: antes.valorADevolver,
        devolverDepois: depois.valorADevolver,
      });
    }
    await this.prisma.db.rescisaoContrato.update({
      where: { id: r.id },
      data: { ...this.snapshot(depois, mem.avisos ?? []), ajustesJson: ajustes as unknown as Prisma.InputJsonValue },
    });
    if (mudou) {
      await this.prisma.db.logAuditoria.create({
        data: {
          usuarioId, acao: 'rescisao_acerto_ajustado', entidade: 'contrato', entidadeId: contratoId,
          antes: { saldoRemanescente: antes.saldoRemanescente, valorADevolver: antes.valorADevolver, custosCliente: antes.custosCliente ?? 0 },
          depois: { rescisaoId: r.id, motivo, saldoRemanescente: depois.saldoRemanescente, valorADevolver: depois.valorADevolver, custosCliente: depois.custosCliente ?? 0 },
        },
      });
    }
    // Boleto do saldo no ar com valor antigo: troca pelo valor novo (ou só retira,
    // se não sobrou saldo). Falha na troca não desfaz o ajuste — a ficha avisa.
    if (r.cobrancaChargeId && !r.saldoPagoEm && cent(r.cobrancaValor) !== depois.saldoRemanescente) {
      try {
        await this.asaas.removerCobranca(r.cobrancaChargeId);
        if (depois.saldoRemanescente > 0) {
          await this.emitirBoletoSaldo(r.id, depois.saldoRemanescente, usuarioId, 'substituído porque o saldo mudou');
        } else {
          await this.prisma.db.rescisaoContrato.update({
            where: { id: r.id },
            data: { cobrancaChargeId: null, cobrancaValor: null, cobrancaVencimento: null, cobrancaEmitidaEm: null, cobrancaLink: null, cobrancaVencidaEm: null },
          });
        }
      } catch (e) {
        this.logger.error(`Rescisão ${r.id}: saldo mudou mas a troca do boleto falhou — ${(e as Error).message}`);
      }
    }
    return { acerto: depois, mudou };
  }

  // --- Boleto único do saldo remanescente (§29.3) -----------------------------------------

  // Botão "Gerar boleto do saldo": só com rescisão efetivada, saldo > 0 e não pago.
  async gerarBoletoSaldo(rescisaoId: string, usuarioId: string) {
    const r = await this.prisma.db.rescisaoContrato.findFirst({ where: { id: rescisaoId } });
    if (!r) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Rescisão não encontrada' });
    if (r.status !== 'EFETIVADA') throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'A rescisão ainda não foi efetivada' });
    if (r.saldoPagoEm) throw new UnprocessableEntityException({ erro: 'ja_pago', mensagem: 'O saldo desta rescisão já foi pago' });
    const saldo = cent(r.saldoRemanescente);
    if (saldo <= 0) throw new UnprocessableEntityException({ erro: 'sem_saldo', mensagem: 'Esta rescisão não tem saldo remanescente a cobrar' });
    if (r.cobrancaChargeId && cent(r.cobrancaValor) === saldo) {
      throw new UnprocessableEntityException({ erro: 'ja_emitido', mensagem: 'O boleto do saldo já está no ar com este valor' });
    }
    if (r.cobrancaChargeId) await this.asaas.removerCobranca(r.cobrancaChargeId);
    return this.emitirBoletoSaldo(r.id, saldo, usuarioId, r.cobrancaChargeId ? 'substituído' : 'emitido');
  }

  private async emitirBoletoSaldo(rescisaoId: string, saldo: number, usuarioId: string, como: string) {
    const r = await this.prisma.db.rescisaoContrato.findFirst({
      where: { id: rescisaoId },
      select: {
        id: true, contratoId: true,
        contrato: { select: { numero: true, conta: { select: { titular: { select: { id: true, nome: true, cpfCnpj: true, email: true, whatsapp: true, asaasCustomerId: true } } } } } },
      },
    });
    if (!r) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Rescisão não encontrada' });
    const titular = r.contrato.conta.titular;
    let customerId = this.asaas.clienteReutilizavel(titular.asaasCustomerId);
    if (!customerId) {
      customerId = await this.asaas
        .criarCliente({ titularId: titular.id, nome: titular.nome, cpfCnpj: titular.cpfCnpj, email: titular.email, telefone: titular.whatsapp })
        .catch((e: Error) => {
          this.logger.error(`Rescisão ${r.id}: Asaas recusou o cadastro do cliente — ${e.message}`);
          throw new BadGatewayException({ erro: 'asaas_recusou', mensagem: 'O Asaas não aceitou cadastrar o cliente para emitir o boleto. Confira a integração do Asaas em Configuração e os dados do titular (CPF).' });
        });
      await this.prisma.db.titular.update({ where: { id: titular.id }, data: { asaasCustomerId: customerId } });
    }
    const vencimento = adicionarDiasUteis(inicioHojeBrasilUTC(), DIAS_UTEIS_BOLETO_SALDO_RESCISAO);
    const cobranca = await this.asaas
      .criarCobranca({
        externalReference: `rescisao:${r.id}`,
        valor: saldo,
        vencimento,
        descricao: `Saldo da rescisão do contrato ${r.contrato.numero} — ${titular.nome}`,
        customerId,
        formaPagamento: 'BOLETO', // é o boleto que se negativa no Asaas
      })
      .catch((e: Error) => {
        // O operador precisa saber que foi o Asaas (e não um "não permitido" genérico).
        this.logger.error(`Rescisão ${r.id}: Asaas recusou o boleto do saldo — ${e.message}`);
        throw new BadGatewayException({ erro: 'asaas_recusou', mensagem: 'O Asaas não aceitou emitir o boleto agora. Confira a integração do Asaas em Configuração e tente de novo — o saldo continua registrado.' });
      });
    await this.prisma.db.rescisaoContrato.update({
      where: { id: r.id },
      data: { cobrancaChargeId: cobranca.id, cobrancaValor: reais(saldo), cobrancaVencimento: vencimento, cobrancaEmitidaEm: new Date(), cobrancaLink: cobranca.invoiceUrl ?? null, cobrancaVencidaEm: null },
    });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'rescisao_boleto_saldo_emitido', entidade: 'contrato', entidadeId: r.contratoId, depois: { rescisaoId: r.id, como, valor: saldo, vencimento: dataCalendarioUTC(vencimento), cobrancaId: cobranca.id } },
    });
    this.logger.log(`Rescisão ${r.id}: boleto do saldo ${como} (${cobranca.id}, ${formatCurrency(saldo)}, vence ${dataCalendarioUTC(vencimento)})`);
    return { resultado: 'boleto_emitido', valor: saldo, vencimento: dataCalendarioUTC(vencimento), link: cobranca.invoiceUrl ?? null };
  }

  // Webhook (fila): o boleto do saldo foi pago. Idempotente.
  async saldoRecebido(rescisaoId: string, paymentDate: string, recebido: { valorRecebido?: number; pagamentoId?: string }) {
    const r = await this.prisma.db.rescisaoContrato.findFirst({
      where: { id: rescisaoId },
      include: { contrato: { select: { numero: true, contaId: true, conta: { select: { titular: { select: { nome: true } } } } } } },
    });
    if (!r) return { resultado: 'rescisao_nao_encontrada' };
    if (r.saldoPagoEm) return { resultado: 'ja_registrado' };
    const dia = /^\d{4}-\d{2}-\d{2}/.test(paymentDate) ? paymentDate.slice(0, 10) : dataHojeBrasil();
    const valor = recebido.valorRecebido ?? cent(r.cobrancaValor ?? r.saldoRemanescente);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.rescisaoContrato.update({ where: { id: r.id }, data: { saldoPagoEm: inicioDiaUTC(dia), saldoValorPago: reais(valor), cobrancaVencidaEm: null } });
      // Entra no caixa da Carteira como lançamento da conta (como as entradas).
      await tx.lancamentoConta.create({
        data: {
          contaId: r.contrato.contaId, contratoId: r.contratoId, tipo: 'SALDO_RESCISAO',
          descricao: `Saldo da rescisão do contrato ${r.contrato.numero}`,
          valor: reais(valor), dataPagamento: inicioDiaUTC(dia), asaasChargeId: recebido.pagamentoId ?? r.cobrancaChargeId,
        },
      });
      await tx.logAuditoria.create({
        data: { acao: 'rescisao_saldo_pago', entidade: 'contrato', entidadeId: r.contratoId, depois: { rescisaoId: r.id, valor, em: dia, pagamentoId: recebido.pagamentoId ?? null } },
      });
    });
    await this.alertas.emitir({
      titulo: `Saldo da rescisão pago — ${r.contrato.conta.titular.nome}`,
      corpo: `Contrato ${r.contrato.numero}: ${formatCurrency(valor)} recebidos em ${dia.split('-').reverse().join('/')}.`,
      rota: `/contratos/${r.contratoId}`,
      tipo: 'COBRANCA',
      area: 'CARTEIRA_COBRANCA',
    });
    return { resultado: 'saldo_pago', valor };
  }

  // Webhook (fila): o boleto do saldo venceu sem pagamento → a carteira é avisada;
  // a negativação é feita à mão no painel do Asaas, sobre este boleto.
  async saldoVencido(rescisaoId: string, pagamentoId?: string) {
    const r = await this.prisma.db.rescisaoContrato.findFirst({
      where: { id: rescisaoId },
      include: { contrato: { select: { numero: true, conta: { select: { titular: { select: { nome: true } } } } } } },
    });
    if (!r || r.saldoPagoEm || !r.cobrancaChargeId) return { resultado: 'ignorado' };
    if (pagamentoId && pagamentoId !== r.cobrancaChargeId) return { resultado: 'boleto_antigo' }; // já substituído
    if (r.cobrancaVencidaEm) return { resultado: 'ja_avisado' };
    await this.prisma.db.rescisaoContrato.update({ where: { id: r.id }, data: { cobrancaVencidaEm: new Date() } });
    await this.alertas.emitir({
      titulo: `Boleto do saldo da rescisão venceu — ${r.contrato.conta.titular.nome}`,
      corpo: `Contrato ${r.contrato.numero}: ${formatCurrency(cent(r.cobrancaValor))} sem pagamento. Se for o caso, negative este boleto no painel do Asaas.`,
      rota: `/contratos/${r.contratoId}`,
      tipo: 'COBRANCA',
      area: 'CARTEIRA_COBRANCA',
    });
    return { resultado: 'vencido_avisado' };
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
    const idsUsuarios = [...new Set(rescisoes.map((r) => r.aprovadaPor).filter((u): u is string => !!u))];
    const usuarios = idsUsuarios.length ? await this.prisma.db.usuario.findMany({ where: { id: { in: idsUsuarios } }, select: { id: true, nome: true } }) : [];
    const nomeUsuario = new Map(usuarios.map((u) => [u.id, u.nome]));
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
        origem: r.origem.toLowerCase(),
        efetivadaPorNome: r.aprovadaPor ? nomeUsuario.get(r.aprovadaPor) ?? null : null,
        ajustes: (r.ajustesJson as unknown as AjusteRescisao[] | null) ?? [],
        cobrancaSaldo: r.cobrancaChargeId && r.cobrancaVencimento && r.cobrancaEmitidaEm
          ? {
              valor: cent(r.cobrancaValor),
              vencimento: dataCalendarioUTC(r.cobrancaVencimento),
              emitidaEm: r.cobrancaEmitidaEm.toISOString(),
              link: r.cobrancaLink,
              vencida: !!r.cobrancaVencidaEm,
              desatualizada: !r.saldoPagoEm && cent(r.cobrancaValor) !== cent(r.saldoRemanescente),
            }
          : null,
        saldoPagoEm: r.saldoPagoEm ? dataCalendarioUTC(r.saldoPagoEm) : null,
        saldoValorPago: r.saldoValorPago ? cent(r.saldoValorPago) : null,
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
