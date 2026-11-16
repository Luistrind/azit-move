import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import {
  aplicarPagamentoNaConta,
  dataHojeBrasil,
  fimDoDiaBrasil,
  formatCurrency,
  FUSO_NEGOCIO,
  reconstituirFatura,
  regraParcial,
  validarValorPagamento,
  type ContaProjetada,
  type RegraParcial,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { ContaFaturaService, type ContaCarregada } from './conta-fatura.service';
import { GATEWAY_PIX, referenciaIntencao, type GatewayPix } from './gateway-pix';

const cent = (d: Prisma.Decimal): number => Math.round(Number(d.toString()) * 100);
const reais = (c: number): string => (c / 100).toFixed(2);

export interface FaturaPretendida {
  faturaId: string;
  numero: number;
  vencimento: string; // YYYY-MM-DD
  valor: number; // quanto do Pix iria para esta fatura, pela regra, no dia do pedido
}

export interface IntencaoCriada {
  id: string;
  valor: number;
  validoAte: Date;
  pixCopiaECola: string;
  pixQrCodeImagem: string | null;
  simulado: boolean;
  outroValor: boolean;
  faturas: FaturaPretendida[];
  reaproveitada: boolean;
}

// Job da fila INTENCAO_PAGAMENTO que aplica um Pix recebido (webhook, conferência
// ou cancelamento que encontrou a cobrança paga).
export interface JobBaixaIntencao {
  intencaoId: string;
  pagamentoId: string; // id do pagamento no gateway (idempotência)
  valor: number; // centavos
  dataPagamento: string | null; // 'YYYY-MM-DD'; null = dia em que o job foi criado
  recebidoEm: string; // ISO — quando soubemos do pagamento
  identificadorPix: string | null;
  origem: 'GATEWAY' | 'CONFERENCIA';
}

// Job da mesma fila que descobre DE QUAL intenção é um pagamento Pix que o
// gateway avisou sem a referência `intencao:<id>` — é o caso do QR estático
// (doc 02 §32.4-A, 15/11): a cobrança que o gateway cria ao receber traz o id do
// QR, ou nem isso (aí o worker pergunta ao gateway).
export interface JobIdentificarPix {
  pagamentoId: string;
  gatewayId: string | null; // id do Pix, quando o aviso trouxe
  valor: number; // centavos
  dataPagamento: string | null;
  recebidoEm: string; // ISO
  identificadorPix: string | null;
}

// Job da mesma fila que cancela, no gateway, o Pix de uma intenção que deixou de valer.
export interface JobCancelarPix {
  intencaoId: string;
  gatewayId: string;
}

// O que a conta permite pagar HOJE (regra única para a página e para a criação
// da intenção — o servidor valida com a MESMA função que a tela usou).
export interface OpcoesPagamento {
  projecao: ContaProjetada;
  // Conta MISTA (§32.4-A, provisório): há fatura do modelo antigo em aberto.
  // Só a fatura AZIT mais antiga pode ser paga por Pix sob demanda, sozinha.
  mista: boolean;
  acumuladoPermitido: number[]; // valores exatos "da mais antiga até…"
  regra: RegraParcial | null; // null = "outro valor" não se aplica
}

export function opcoesDePagamento(conta: ContaCarregada, projecao: ContaProjetada): OpcoesPagamento {
  const mista = conta.abertasModeloAntigo.length > 0;
  const regra = regraParcial(projecao, conta.parametros);
  return {
    projecao,
    mista,
    acumuladoPermitido: mista ? projecao.acumulado.slice(0, 1) : projecao.acumulado,
    regra: mista || !regra || regra.tipo === 'sem-parcial' ? null : regra,
  };
}

// Intenção de pagamento (doc 02 §32.4-A): "o cliente pediu um Pix de R$ X para
// a conta Y". VÁRIAS ativas por conta no mesmo dia, UMA POR VALOR (regra Luís
// 15/11: gerar um Pix novo não cancela os anteriores — até pagar, o cliente
// pode voltar a uma opção que já tinha gerado). Reuso por valor, teto diário de
// valores distintos e virada do dia. Quando um pagamento é baixado, as outras
// ativas da conta deixam de valer (BaixaContaService). A intenção só ANUNCIA:
// a baixa é pela regra, na data do pagamento.
@Injectable()
export class IntencaoPagamentoService {
  private readonly logger = new Logger(IntencaoPagamentoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contaFatura: ContaFaturaService,
    @Inject(GATEWAY_PIX) private readonly gateway: GatewayPix,
    @InjectQueue(QUEUE_NAMES.INTENCAO_PAGAMENTO) private readonly fila: Queue,
  ) {}

  // Sem gateway real (modo simulado) não há o que conferir nem cobrar de verdade.
  get gatewaySimulado(): boolean {
    return this.gateway.simulado;
  }

  // Enfileira a baixa de um Pix recebido — jobId pelo pagamento: webhook
  // repetido ou conferência em dobro não geram dois jobs.
  async enfileirarBaixa(job: JobBaixaIntencao): Promise<void> {
    // BullMQ não aceita ":" em jobId — o id simulado carrega a referência.
    await this.fila.add('baixar', job, { jobId: `baixa-${job.pagamentoId.replace(/[^A-Za-z0-9_-]/g, '_')}` });
  }

  // Enfileira a identificação de um pagamento Pix sem referência (Regra 4: o
  // webhook responde e sai; quem pergunta ao gateway é o worker). jobId pelo
  // pagamento: RECEIVED e CONFIRMED do mesmo Pix não geram dois jobs.
  async enfileirarIdentificacao(job: JobIdentificarPix): Promise<void> {
    await this.fila.add('identificar', job, { jobId: `identificar-${job.pagamentoId.replace(/[^A-Za-z0-9_-]/g, '_')}` });
  }

  // Job 'identificar' (worker): liga o pagamento à intenção pelo id do Pix
  // (`gatewayId`) e manda para a MESMA baixa pela conta dos outros caminhos
  // (idempotente pelo id do pagamento). Pagamento que não é de nenhuma intenção
  // daqui (outro ambiente na mesma conta do gateway, Pix avulso na chave) é
  // ignorado — nada é criado nem alterado por causa dele.
  async identificarPagamento(job: JobIdentificarPix): Promise<{ resultado: 'baixa_enfileirada' | 'sem_pix_de_origem' | 'pix_desconhecido'; intencaoId?: string }> {
    const gatewayId = job.gatewayId ?? (await this.gateway.pixDoPagamento(job.pagamentoId));
    if (!gatewayId) return { resultado: 'sem_pix_de_origem' };
    const intencao = await this.prisma.db.intencaoPagamento.findFirst({ where: { gatewayId }, select: { id: true } });
    if (!intencao) return { resultado: 'pix_desconhecido' };
    await this.enfileirarBaixa({
      intencaoId: intencao.id,
      pagamentoId: job.pagamentoId,
      valor: job.valor,
      dataPagamento: job.dataPagamento,
      recebidoEm: job.recebidoEm,
      identificadorPix: job.identificadorPix,
      origem: 'GATEWAY',
    });
    return { resultado: 'baixa_enfileirada', intencaoId: intencao.id };
  }

  // Intenções que ainda valem AGORA para a conta, da mais recente para a mais
  // antiga (o dia é o de hoje no Brasil — a que ficou de ontem está expirada
  // mesmo antes de o job rodar, Regra 7). Pode haver várias: uma por valor.
  async ativasDaConta(contaId: string) {
    return this.prisma.db.intencaoPagamento.findMany({
      where: { contaId, situacao: 'ATIVA', dia: dataHojeBrasil() },
      orderBy: { createdAt: 'desc' },
    });
  }

  // A dívida da conta MUDOU por uma operação (acordo, novação, rescisão,
  // sinistro efetivados): todos os Pix ativos deixam de corresponder ao que se
  // deve. Marca SUBSTITUIDA e manda o cancelamento no gateway para a fila —
  // chamar DEPOIS da transação da operação. Se o cliente pagar um deles antes
  // do cancelamento, o dinheiro é aceito e aplicado no que ainda estiver em aberto.
  async invalidarAtivasDaConta(contaId: string, motivo: string): Promise<number> {
    const ativas = await this.prisma.db.intencaoPagamento.findMany({ where: { contaId, situacao: 'ATIVA' }, select: { id: true, gatewayId: true } });
    if (ativas.length === 0) return 0;
    await this.prisma.db.intencaoPagamento.updateMany({ where: { id: { in: ativas.map((a) => a.id) }, situacao: 'ATIVA' }, data: { situacao: 'SUBSTITUIDA' } });
    for (const a of ativas) await this.enfileirarCancelamento(a.id, a.gatewayId);
    this.logger.log(`Conta ${contaId}: ${ativas.length} Pix ativo(s) cancelado(s) — ${motivo}`);
    return ativas.length;
  }

  // Manda para a fila o cancelamento, no gateway, do Pix de uma intenção que
  // deixou de valer. jobId pelo Pix: pedir duas vezes não gera dois jobs.
  async enfileirarCancelamento(intencaoId: string, gatewayId: string | null): Promise<void> {
    if (!gatewayId) return;
    await this.fila.add('cancelar', { intencaoId, gatewayId } satisfies JobCancelarPix, { jobId: `cancelar-${gatewayId.replace(/[^A-Za-z0-9_-]/g, '_')}` });
  }

  async criar(pedido: { contaId: string; valor: number; origem: 'PAGINA_PUBLICA' | 'OPERADOR'; usuarioId?: string | null }): Promise<IntencaoCriada> {
    const hoje = dataHojeBrasil();
    const conta = await this.contaFatura.carregar(pedido.contaId);
    const opcoes = opcoesDePagamento(conta, this.contaFatura.projetar(conta, hoje));
    const valor = Math.round(pedido.valor);

    // 1) O valor tem que ser um dos que a regra permite HOJE (servidor decide).
    const exato = opcoes.acumuladoPermitido.includes(valor);
    if (!exato) {
      const v = opcoes.mista ? ({ ok: false, motivo: 'sem_parcial' } as const) : validarValorPagamento(opcoes.projecao, conta.parametros, valor);
      if (!v.ok) throw new UnprocessableEntityException({ erro: 'valor_invalido', motivo: v.motivo, mensagem: this.mensagemValorInvalido(v.motivo, opcoes) });
    }

    // 2) Reuso: mesmo valor, mesma conta, mesmo dia → a intenção ativa DESSE
    //    VALOR volta como está (procura entre todas as ativas, não só a última).
    const mesmoValor = (linhas: { valor: Prisma.Decimal; pixCopiaECola: string | null }[]) => linhas.find((l) => cent(l.valor) === valor && l.pixCopiaECola);
    const jaAtiva = mesmoValor(await this.ativasDaConta(pedido.contaId));
    if (jaAtiva) return this.mapear(jaAtiva as Prisma.IntencaoPagamentoGetPayload<object>, true);

    // 3) Teto de VALORES DISTINTOS por conta por dia (página pública não vira
    //    fábrica de cobranças). Valor que já foi pedido hoje não conta de novo.
    const doDia = await this.prisma.db.intencaoPagamento.findMany({ where: { contaId: pedido.contaId, dia: hoje }, select: { valor: true } });
    const distintos = new Set(doDia.map((l) => cent(l.valor)));
    if (!distintos.has(valor) && distintos.size >= conta.parametros.tetoIntencoesDia) {
      throw new HttpException(
        { erro: 'limite_pix_dia', mensagem: 'Você já gerou muitos códigos Pix diferentes hoje. Use o último código gerado ou fale com a gente pelo WhatsApp.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 4) Retrato do que o valor pretende cobrir: a MESMA baixa, simulada hoje.
    const estados = conta.faturas.filter((f) => f.status === 'FECHADA').map((f) => reconstituirFatura(f.motor));
    const { baixas } = aplicarPagamentoNaConta(estados, { data: hoje, valor }, conta.parametros.cascata);
    const faturas: FaturaPretendida[] = baixas.map((b) => {
      const f = conta.faturas.find((x) => x.id === b.faturaId)!;
      return { faturaId: f.id, numero: f.numero, vencimento: f.vencimento, valor: b.valor };
    });

    // 5) Pix no gateway ANTES de gravar: se falhar, nada muda (as ativas continuam valendo).
    const id = `int_${randomBytes(12).toString('hex')}`;
    let pix;
    try {
      pix = await this.gateway.criarPix({
        referencia: referenciaIntencao(id),
        valor,
        dia: hoje,
        descricao: this.descricao(faturas, valor),
        descricaoCurta: this.descricaoCurta(faturas),
        titularId: conta.titular.id,
      });
    } catch (e) {
      this.logger.error(`Falha ao gerar o Pix da conta ${pedido.contaId} (${valor}c): ${(e as Error).message}`);
      throw new ServiceUnavailableException({ erro: 'pix_indisponivel', mensagem: 'Não conseguimos gerar o Pix agora. Tente de novo em alguns segundos.' });
    }

    // 6) Grava a nova SEM tocar nas outras ativas (regra 15/11: nada é cancelado
    //    na criação). A trava da conta garante UMA ativa por valor: se outro
    //    pedido do mesmo valor entrou enquanto o gateway respondia, vale o que
    //    já está gravado e o Pix recém-criado é descartado.
    const { criada, duplicada } = await this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM contas WHERE id = ${pedido.contaId} FOR UPDATE`;
      const concorrente = mesmoValor(await tx.intencaoPagamento.findMany({ where: { contaId: pedido.contaId, situacao: 'ATIVA', dia: hoje } }));
      if (concorrente) return { criada: concorrente as Prisma.IntencaoPagamentoGetPayload<object>, duplicada: true };
      const nova = await tx.intencaoPagamento.create({
        data: {
          id,
          contaId: pedido.contaId,
          valor: reais(valor),
          faturasPretendidas: faturas as unknown as Prisma.InputJsonValue,
          outroValor: !exato,
          dia: hoje,
          validoAte: fimDoDiaBrasil(hoje),
          origem: pedido.origem,
          usuarioId: pedido.usuarioId ?? null,
          situacao: 'ATIVA',
          gatewayId: pix.gatewayId,
          pixCopiaECola: pix.copiaECola,
          pixQrCodeImagem: pix.qrCodeImagem,
          simulado: pix.simulado,
        },
      });
      return { criada: nova, duplicada: false };
    }, { timeout: 20_000 });

    // 7) Só o Pix em dobro (corrida do mesmo valor) é cancelado — pela fila, fora da resposta.
    if (duplicada) await this.enfileirarCancelamento(criada.id, pix.gatewayId);
    return this.mapear(criada, duplicada);
  }

  // Virada do dia (§32.4-A): expira as ativas de dias anteriores e cancela os
  // Pix. Enfileira (Regra 4 das filas: retry/backoff, jobId diário deduplica).
  @Cron('5 0 * * *', { timeZone: FUSO_NEGOCIO })
  async cronExpirar(): Promise<void> {
    await this.fila.add('expirar', {}, { jobId: `expirar-${dataHojeBrasil()}`, removeOnComplete: true, removeOnFail: 50 });
    this.logger.log('[cron] virada do dia: expiração das intenções de pagamento enfileirada');
  }

  async expirarVencidas(hoje: string = dataHojeBrasil()): Promise<{ expiradas: number; pagasEncontradas: number }> {
    const vencidas = await this.prisma.db.intencaoPagamento.findMany({
      where: { situacao: 'ATIVA', dia: { lt: hoje } },
      select: { id: true, gatewayId: true },
    });
    let pagasEncontradas = 0;
    for (const i of vencidas) {
      await this.prisma.db.intencaoPagamento.updateMany({ where: { id: i.id, situacao: 'ATIVA' }, data: { situacao: 'EXPIRADA' } });
      if (await this.cancelarNoGateway(i.id, i.gatewayId)) pagasEncontradas++;
    }
    return { expiradas: vencidas.length, pagasEncontradas };
  }

  // Conferência pelo operador ("o cliente pagou e não baixou"): pergunta ao
  // gateway pelos Pix recentes da conta que não constam como pagos aqui e
  // enfileira a baixa dos que o gateway confirma. Nunca baixa sem o gateway dizer que recebeu.
  async conferirConta(contaId: string): Promise<{ conferidas: number; enfileiradas: number; simulado: boolean }> {
    if (this.gateway.simulado) return { conferidas: 0, enfileiradas: 0, simulado: true };
    const recentes = await this.prisma.db.intencaoPagamento.findMany({
      where: { contaId, situacao: { not: 'PAGA' }, gatewayId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { id: true, gatewayId: true },
    });
    let enfileiradas = 0;
    for (const i of recentes) {
      const pix = await this.gateway.consultarPix(i.gatewayId!);
      if (!pix.pago || !pix.pagamentoId) continue;
      await this.enfileirarBaixa({ intencaoId: i.id, pagamentoId: pix.pagamentoId, valor: pix.valor, dataPagamento: pix.dataPagamento, recebidoEm: new Date().toISOString(), identificadorPix: null, origem: 'CONFERENCIA' });
      enfileiradas++;
    }
    return { conferidas: recentes.length, enfileiradas, simulado: false };
  }

  // Job 'cancelar' (worker): cancela no gateway o Pix de uma intenção que
  // deixou de valer (as outras ativas depois de um pagamento baixado, ou o Pix
  // em dobro de uma corrida). Se o gateway disser que já foi pago, a baixa é
  // enfileirada (o dinheiro manda). Gateway fora do ar ou cancelamento não
  // confirmado LANÇA — o BullMQ repete com backoff, em vez de deixar um Pix
  // antigo pagável.
  async cancelarSubstituida(job: JobCancelarPix): Promise<{ resultado: 'cancelado' | 'ja_pago' }> {
    const r = await this.gateway.cancelarPix(job.gatewayId);
    if (r.pago) {
      const pix = await this.gateway.consultarPix(job.gatewayId);
      if (pix.pago && pix.pagamentoId) {
        await this.enfileirarBaixa({ intencaoId: job.intencaoId, pagamentoId: pix.pagamentoId, valor: pix.valor, dataPagamento: pix.dataPagamento, recebidoEm: new Date().toISOString(), identificadorPix: null, origem: 'GATEWAY' });
        this.logger.warn(`Intenção ${job.intencaoId}: o Pix já estava pago ao cancelar — baixa enfileirada`);
      }
      return { resultado: 'ja_pago' };
    }
    if (!r.cancelado) throw new Error(`O gateway não confirmou o cancelamento do Pix ${job.gatewayId} (intenção ${job.intencaoId})`);
    return { resultado: 'cancelado' };
  }

  // Cancela o Pix de uma intenção que não vale mais. Se o gateway disser que
  // JÁ FOI PAGO (corrida entre cancelar e pagar), o dinheiro é aceito: enfileira
  // a baixa. Devolve true nesse caso.
  private async cancelarNoGateway(intencaoId: string, gatewayId: string | null): Promise<boolean> {
    if (!gatewayId) return false;
    try {
      const r = await this.gateway.cancelarPix(gatewayId);
      if (!r.pago) return false;
      const pix = await this.gateway.consultarPix(gatewayId);
      if (pix.pago && pix.pagamentoId) {
        await this.enfileirarBaixa({ intencaoId, pagamentoId: pix.pagamentoId, valor: pix.valor, dataPagamento: pix.dataPagamento, recebidoEm: new Date().toISOString(), identificadorPix: null, origem: 'GATEWAY' });
        this.logger.warn(`Intenção ${intencaoId}: o Pix já estava pago ao cancelar — baixa enfileirada`);
        return true;
      }
    } catch (e) {
      this.logger.warn(`Intenção ${intencaoId}: não consegui cancelar o Pix ${gatewayId} no gateway: ${(e as Error).message}`);
    }
    return false;
  }

  private mensagemValorInvalido(motivo: string, o: OpcoesPagamento): string {
    const brl = formatCurrency;
    if (motivo === 'nada_em_aberto') return 'Não há fatura em aberto para pagar.';
    if (motivo === 'acima_do_total') return `Esse valor passa do total em aberto. Para pagar tudo use ${brl(o.projecao.totalAberto)}.`;
    if (motivo === 'abaixo_do_minimo' && o.regra) return `O valor mínimo é ${brl(o.regra.minimo)}.`;
    return o.acumuladoPermitido.length ? `Para esta fatura o valor é ${brl(o.acumuladoPermitido[0])}.` : 'Valor não permitido para esta fatura.';
  }

  private descricao(faturas: FaturaPretendida[], valor: number): string {
    const brl = formatCurrency;
    const nums = faturas.map((f) => `#${f.numero}`).join(', ');
    return `Azit Move — pagamento de fatura${faturas.length > 1 ? 's' : ''} ${nums} — ${brl(valor)}`.slice(0, 490);
  }

  // O que aparece para quem paga, no app do banco (o QR tem pouco espaço).
  private descricaoCurta(faturas: FaturaPretendida[]): string {
    const nums = faturas.map((f) => f.numero);
    if (nums.length === 0) return 'Azit Move fatura';
    return nums.length === 1 ? `Azit Move fatura ${nums[0]}` : `Azit Move faturas ${nums[0]} a ${nums[nums.length - 1]}`;
  }

  private mapear(i: Prisma.IntencaoPagamentoGetPayload<object>, reaproveitada: boolean): IntencaoCriada {
    return {
      id: i.id,
      valor: cent(i.valor),
      validoAte: i.validoAte,
      pixCopiaECola: i.pixCopiaECola ?? '',
      pixQrCodeImagem: i.pixQrCodeImagem,
      simulado: i.simulado,
      outroValor: i.outroValor,
      faturas: (i.faturasPretendidas as unknown as FaturaPretendida[]) ?? [],
      reaproveitada,
    };
  }
}
