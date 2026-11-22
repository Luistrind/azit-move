import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { calcularEncargoAtraso, encargoHojeDaFatura, centavosParaReaisString, imputarPagamento, ItemImputacao, dataHojeBrasil, horaBrasil, diaDeColunaMista, diasCalendarioEntre, inicioHojeBrasilUTC, dataCalendarioUTC, diasAtrasoCalendario, DIA_MS, FUSO_NEGOCIO, inicioDiaUTC, somarDiasISO, situacaoFaturaRuntime, entradaAVista } from '@azit/utils';
import { ConfigService } from '@nestjs/config';
import { mensagemLinkFatura, montarLinkFatura, novoTokenFatura, whatsappParaWaMe } from './fatura-link';
import { PrismaService } from '../../database/prisma.service';
import { AsaasService } from '../asaas/asaas.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { cumprirAcordosSePagos } from '../operacoes/acordo-cumprimento';
import { ParametrosFaturamentoService } from '../faturamento/parametros-faturamento.service';
import { ContaFaturaService } from '../faturamento/conta-fatura.service';
import { IntencaoPagamentoService, type FaturaPretendida } from '../faturamento/intencao-pagamento.service';
import { ROTULO_ENCARGO_FATURA, TipoEncargoFatura, type IntencaoPagamentoOperador, type PagamentoFaturaOperador } from '@azit/types';

const reais = (centavos: number) => centavosParaReaisString(centavos);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

export interface WebhookPagamento {
  faturaId: string; // externalReference
  paymentDate: string;
  dueDate: string;
  valor: number; // centavos (informativo; o sistema recalcula)
}

// Cobrança lida AO VIVO no Asaas (GET /payments/{id}) — o que importa para conciliar.
export interface CobrancaAsaasAoVivo {
  status: string;
  value: number; // reais
  dueDate: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
}

// Job 'conciliar' montado a partir da cobrança lida ao vivo — o MESMO que o
// webhook enfileira. Uma montagem só (Regra 16): "conferir pagamento" da fatura e
// migração do legado (cobrança paga antes de a fatura existir) usam esta função.
// Data: a que o cliente pagou; sem ela, a da compensação; sem nada, hoje (Brasil).
export function eventoConciliacaoDe(faturaId: string, pg: CobrancaAsaasAoVivo): WebhookPagamento {
  return {
    faturaId,
    paymentDate: pg.clientPaymentDate ?? pg.paymentDate ?? pg.confirmedDate ?? dataHojeBrasil(),
    dueDate: pg.dueDate,
    valor: Math.round(pg.value * 100),
  };
}

// Linha de fatura como o banco entrega às listas (ficha do titular, detalhe).
type FaturaDeLista = {
  id: string; numero: number; periodoReferencia: Date; dataVencimento: Date; dataFechamento: Date | null;
  dataPagamento: Date | null; status: string; valorTotal: Prisma.Decimal; valorPago: Prisma.Decimal | null;
  asaasChargeId: string | null;
  modeloEncargo: string;
  tokenPublico?: string | null;
  itensFatura: { descricao: string; tipo: string; valor: Prisma.Decimal; credor: string }[];
};

// Linha de lista com as parcelas da fatura (taxas do contrato) — para o encargo de hoje do modelo antigo.
type FaturaComParcelas = FaturaDeLista & {
  parcelas?: { valorNominal: Prisma.Decimal; dataVencimento: Date; contrato: { taxaMultaAtraso: Prisma.Decimal; taxaJurosAtraso: Prisma.Decimal } }[];
};

// Visões das faturas da conta na ficha do titular (doc 02 §33.2) — calculadas na leitura (Regra 7).
export const VISOES_FATURAS_CONTA = ['agora', 'vencer', 'pagas', 'outras'] as const;
export type VisaoFaturasConta = (typeof VISOES_FATURAS_CONTA)[number];

// Um dinheiro que entrou na conta e para onde ele foi (doc 02 §33.3).
export interface PagamentoDaConta {
  id: string;
  dia: string; // 'AAAA-MM-DD' no fuso do Brasil
  hora: string | null; // 'HH:MM', quando o gateway informa o instante
  tipo: 'pix' | 'cobranca' | 'sinistro' | 'entrada_contrato' | 'entrada_acordo';
  valor: number; // centavos — o dinheiro inteiro, com excedente
  excedente: number;
  descricao: string | null;
  contratoNumero: string | null;
  acordoId: string | null;
  destinos: { faturaId: string; numero: number; valor: number; encargos: number; quitou: boolean }[];
}

@Injectable()
export class FaturaService {
  private readonly logger = new Logger(FaturaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaas: AsaasService,
    private readonly config: ConfigService,
    private readonly notificacao: NotificacaoService,
    private readonly parametrosFaturamento: ParametrosFaturamentoService,
    private readonly contaFatura: ContaFaturaService,
    private readonly intencao: IntencaoPagamentoService,
    @InjectQueue(QUEUE_NAMES.GERAR_COBRANCA_ASAAS)
    private readonly filaCobranca: Queue,
    @InjectQueue(QUEUE_NAMES.FECHAR_FATURA)
    private readonly filaFechamento: Queue,
  ) {}

  // 4.2 — Fechamento D-5: fatura ABERTA cujo dataFechamento chegou fecha e
  // dispara a geração de cobrança no Asaas.
  // Job agendado: fecha as faturas que atingiram o D-5 (diário, madrugada). Em dev
  // o operador também pode disparar via /dev/fechar-faturas.
  // ENFILEIRA em vez de rodar in-process (auditoria 15/09, P0-6): o worker da
  // fila tem retry/backoff, e o jobId diário deduplica entre réplicas da API.
  // Horário e chave do job no fuso do negócio (Regra 15): o container roda em UTC.
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: FUSO_NEGOCIO })
  async cronFecharFaturas(): Promise<void> {
    await this.filaFechamento.add(
      'fechar',
      {},
      { jobId: `fechar-${dataHojeBrasil()}`, removeOnComplete: true, removeOnFail: 50 },
    );
    this.logger.log('[cron] D-5: fechamento de faturas enfileirado');
  }

  // Chave do Pix sob demanda (doc 02 §32.4-A, Configurações › Faturamento):
  //   · DESLIGADA (padrão): como sempre — fecha e enfileira a cobrança no Asaas;
  //   · LIGADA: a fatura fecha no modelo AZIT e NÃO ganha cobrança pré-criada;
  //     o Pix nasce quando o cliente vai pagar (intenção de pagamento).
  // A chave é lida UMA vez por rodada: todas as faturas do mesmo fechamento
  // saem no mesmo modelo.
  async fechar(referencia: Date = new Date()): Promise<{ fechadas: number; modelo: 'ASAAS_NATIVO' | 'AZIT' }> {
    const aFechar = await this.prisma.db.fatura.findMany({
      where: { status: 'ABERTA', dataFechamento: { lte: referencia } },
      select: { id: true, tokenPublico: true },
    });
    const pixSobDemanda = await this.parametrosFaturamento.pixSobDemandaLigado();
    for (const f of aFechar) {
      if (pixSobDemanda) {
        await this.prisma.db.fatura.update({
          where: { id: f.id },
          // Sem cobrança pré-criada, o link público é o ÚNICO caminho de pagamento:
          // fatura antiga que por acaso não tenha token ganha um aqui.
          data: { status: 'FECHADA', modeloEncargo: 'AZIT', ...(f.tokenPublico ? {} : { tokenPublico: novoTokenFatura() }) },
        });
        continue;
      }
      await this.prisma.db.fatura.update({
        where: { id: f.id },
        data: { status: 'FECHADA' },
      });
      await this.filaCobranca.add('gerar', { faturaId: f.id });
    }
    return { fechadas: aFechar.length, modelo: pixSobDemanda ? 'AZIT' : 'ASAAS_NATIVO' };
  }

  // Rede de segurança (correção 08/09 — produção: fatura FECHADA sem cobrança
  // no Asaas ficava invisível para sempre; casos Max/Elizabete). Reenfileira as
  // recuperáveis (vencimento ainda no futuro — o gerar é idempotente) e alerta
  // a carteira sobre as que já venceram sem cobrança (reemissão de vencida tem
  // política própria a definir — o Asaas rejeita vencimento no passado).
  @Cron('30 3 * * *', { timeZone: FUSO_NEGOCIO })
  async cronVarrerCobrancas(): Promise<void> {
    const r = await this.varrerCobrancasPendentes();
    if (r.reenfileiradas || r.vencidasSemCobranca) {
      this.logger.log(`[cron] varredura: ${r.reenfileiradas} cobrança(s) reenfileirada(s); ${r.vencidasSemCobranca} vencida(s) sem cobrança`);
    }
  }

  async varrerCobrancasPendentes(): Promise<{ reenfileiradas: number; vencidasSemCobranca: number; possivelFilaParada: number }> {
    const pendentes = await this.prisma.db.fatura.findMany({
      // Só o modelo antigo: fatura AZIT (doc 02 §32.4-A) fecha SEM cobrança de
      // propósito — não é pendência, não se reenfileira e não gera alerta.
      where: { status: 'FECHADA', asaasChargeId: null, modeloEncargo: 'ASAAS_NATIVO', deletedAt: null },
      select: {
        id: true, numero: true, dataVencimento: true, dataFechamento: true,
        conta: { select: { titular: { select: { id: true, nome: true } } } },
      },
      orderBy: { dataVencimento: 'asc' },
    });
    const hoje = dataHojeBrasil();
    let reenfileiradas = 0;
    let filaParada = 0;
    const vencidas: typeof pendentes = [];
    for (const f of pendentes) {
      if (dataCalendarioUTC(f.dataVencimento) >= hoje) {
        await this.filaCobranca.add('gerar', { faturaId: f.id });
        reenfileiradas++;
        // Fechou ONTEM ou antes e segue sem cobrança: o job da véspera não rodou.
        // Detecta worker travado no 1º dia, não só quando a fatura vence
        // (aprendizado de produção 09/09: worker ficou ~2 semanas sem consumir).
        if (dataCalendarioUTC(f.dataFechamento) < hoje) filaParada++;
      } else {
        vencidas.push(f);
      }
    }
    if (filaParada > 0) {
      await this.notificacao.emitir({
        titulo: `${filaParada} cobrança(s) deviam existir no Asaas e não existem`,
        corpo: 'Faturas fechadas desde ontem seguem sem cobrança — foram reenfileiradas agora. Se este aviso repetir amanhã, a fila está parada: reinicie o backend (deploy/update-backend.sh).',
        rota: '/regua',
        tipo: 'FALHA',
        area: 'CARTEIRA_COBRANCA',
      });
    }
    if (vencidas.length) {
      const nomes = vencidas.slice(0, 5).map((f) => `#${f.numero} — ${f.conta.titular.nome}`).join(' · ');
      await this.notificacao.emitir({
        titulo: `${vencidas.length} fatura(s) vencida(s) sem cobrança no Asaas`,
        corpo: `${nomes}${vencidas.length > 5 ? ' · …' : ''}. O Asaas não aceita vencimento no passado — reemita no detalhe da fatura (ficha do titular) ou trate na régua.`,
        // A rota leva à AÇÃO (auditoria 15/09, Bloco D): a reemissão vive na
        // ficha do titular; /regua só quando há vários titulares afetados.
        rota: vencidas.length === 1 ? `/titulares/${vencidas[0].conta.titular.id}` : '/regua',
        tipo: 'FALHA',
        area: 'CARTEIRA_COBRANCA',
      });
    }
    return { reenfileiradas, vencidasSemCobranca: vencidas.length, possivelFilaParada: filaParada };
  }

  // 4.4 — Geração de cobrança no Asaas. O encargo de atraso é nativo do Asaas
  // (multa/juros do contrato): o valor pago no webhook já vem com encargo (opção 2).
  async gerarCobranca(faturaId: string): Promise<void> {
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      include: {
        conta: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true, email: true, whatsapp: true, asaasCustomerId: true } } } },
        parcelas: { include: { contrato: { select: { taxaMultaAtraso: true, taxaJurosAtraso: true } } }, take: 1 },
        itensFatura: { orderBy: { tipo: 'asc' }, select: { descricao: true, valor: true } },
      },
    });
    if (!fatura || fatura.asaasChargeId) return;
    // Fatura do modelo AZIT nunca ganha cobrança pré-criada (doc 02 §32.4-A) —
    // guarda para job antigo na fila ou reenfileiramento indevido.
    if (fatura.modeloEncargo === 'AZIT') return;

    // Garante o cliente no Asaas (idempotente). Id simulado não vale em modo real.
    const titular = fatura.conta.titular;
    let customerId = this.asaas.clienteReutilizavel(titular.asaasCustomerId);
    if (!customerId) {
      customerId = await this.asaas.criarCliente({
        titularId: titular.id, nome: titular.nome, cpfCnpj: titular.cpfCnpj, email: titular.email, telefone: titular.whatsapp,
      });
      await this.prisma.db.titular.update({ where: { id: titular.id }, data: { asaasCustomerId: customerId } });
    }

    const taxas = fatura.parcelas[0]?.contrato;
    const cobranca = await this.asaas.criarCobranca({
      externalReference: fatura.id,
      valor: cent(fatura.valorTotal),
      vencimento: fatura.dataVencimento,
      descricao: this.descricaoCobranca(fatura.numero, cent(fatura.valorTotal), fatura.itensFatura),
      customerId,
      multaPct: taxas ? Number(taxas.taxaMultaAtraso.toString()) : undefined,
      jurosPct: taxas ? Number(taxas.taxaJurosAtraso.toString()) : undefined,
    });
    await this.prisma.db.fatura.update({
      where: { id: fatura.id },
      data: { asaasChargeId: cobranca.id },
    });
  }

  // Descrição da cobrança no Asaas = composição da fatura, espelhada da tela
  // (Luís 08/09): uma linha por item com valor, mais o total. O campo do Asaas
  // aceita até 500 caracteres — acima disso, resume as linhas excedentes.
  private descricaoCobranca(numero: number, totalCent: number, itens: { descricao: string; valor: Prisma.Decimal }[]): string {
    const brl = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const cab = `Fatura #${numero}`;
    const rodape = `Total: ${brl(totalCent)}`;
    if (!itens.length) return `${cab} — ${rodape}`;
    const linhas = itens.map((it) => `${it.descricao} — ${brl(cent(it.valor))}`);
    const LIMITE = 490;
    let usadas = 0;
    let tamanho = cab.length + rodape.length + 2; // quebras de linha do cabeçalho/rodapé
    for (const l of linhas) {
      if (tamanho + l.length + 1 > LIMITE) break;
      tamanho += l.length + 1;
      usadas++;
    }
    const corpo = linhas.slice(0, usadas);
    if (usadas < linhas.length) corpo.push(`… e mais ${linhas.length - usadas} item(ns)`);
    return [cab, ...corpo, rodape].join('\n');
  }

  // 4.6 + 4.7 — Conciliação de pagamento. Baixa fatura + parcelas, calcula
  // encargo de atraso (independente do Asaas) e realiza os recebíveis.
  async conciliarPagamento(p: WebhookPagamento): Promise<{ resultado: string }> {
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { id: p.faturaId },
      include: {
        parcelas: {
          include: {
            contrato: {
              select: { id: true, status: true, taxaMultaAtraso: true, taxaJurosAtraso: true },
            },
          },
        },
      },
    });
    if (!fatura) {
      this.logger.warn(`Conciliação: fatura ${p.faturaId} não encontrada`);
      return { resultado: 'fatura_nao_encontrada' };
    }
    if (fatura.status === 'PAGA' || fatura.status === 'PAGA_EM_ATRASO') {
      return { resultado: 'ja_conciliada' };
    }
    // Fatura do modelo AZIT (doc 02 §32.4-A) NÃO passa por aqui: a baixa dela é
    // pela conta (BaixaContaService), a partir do Pix de uma intenção. Esta
    // conciliação trata o excedente como encargo do Asaas ("Opção 2"), o que não
    // vale para o encargo calculado pela Azit.
    if (fatura.modeloEncargo === 'AZIT') {
      this.logger.warn(`Conciliação antiga ignorada: fatura ${fatura.id} é do modelo AZIT (baixa pela conta)`);
      return { resultado: 'modelo_azit_baixa_pela_conta' };
    }

    const dataPagamento = new Date(p.paymentDate);
    const contratosTocados = new Set<string>();

    // Pré-cálculo (read-only): encargo por parcela + itens-extra (intermediárias da
    // entrada parcelada + serviços recorrentes da cesta) → total devido.
    const extras = await this.prisma.db.itemFatura.findMany({
      // parcelaId NULL: só o que é cobrado ALÉM da parcela (intermediária, serviço
      // recorrente). O item SERVICO ligado a uma parcela é a proteção que já está
      // DENTRO do valor nominal dela (o split é só a composição da fatura, desde
      // 28/08) — somá-lo de novo fazia o pagamento exato parecer PARCIAL
      // (caso real 02/10, Vinicius: pagou R$ 1.096,64 e a fatura não baixou).
      where: { faturaId: fatura.id, parcelaId: null, tipo: { in: ['INTERMEDIARIA', 'SERVICO'] } },
      select: { id: true, valor: true, tipo: true },
    });
    const calc = fatura.parcelas.map((parcela) => {
      // Dias de CALENDÁRIO entre vencimento e pagamento (correção 31/08).
      const diasAtraso = diasAtrasoCalendario(parcela.dataVencimento, dataPagamento);
      const nominal = cent(parcela.valorNominal);
      const encargo =
        diasAtraso > 0
          ? Math.round(
              calcularEncargoAtraso(
                nominal,
                diasAtraso,
                Number(parcela.contrato.taxaMultaAtraso.toString()),
                Number(parcela.contrato.taxaJurosAtraso.toString()),
              ),
            )
          : 0;
      return { parcela, diasAtraso, nominal, encargo };
    });
    const totalExtras = extras.reduce((s, i) => s + cent(i.valor), 0);
    // Opção 2: o encargo de atraso é nativo do Asaas (multa/juros configurados na
    // cobrança), então NÃO entra na base do que define quitação. A base é o devido
    // "limpo" (principal + serviços/intermediárias); o que o cliente pagar acima
    // disso é o encargo cobrado pelo Asaas. Em dev (valor 0) vai sempre ao integral.
    const baseDevida = calc.reduce((s, c) => s + c.nominal, 0) + totalExtras;

    // Pagamento INSUFICIENTE (cobre menos que a base) → imputação parcial (Doc 2 §7.3).
    if (p.valor > 0 && p.valor < baseDevida) {
      return this.conciliarParcial(fatura.id, calc, extras, dataPagamento, p.valor);
    }

    let valorPagoFatura = 0;
    let algumAtraso = false;
    await this.prisma.db.$transaction(async (tx) => {
      for (const { parcela, diasAtraso, nominal, encargo } of calc) {
        const valorPago = nominal + encargo;
        valorPagoFatura += valorPago;
        if (diasAtraso > 0) algumAtraso = true;

        await tx.parcela.update({
          where: { id: parcela.id },
          data: {
            status: diasAtraso > 0 ? 'PAGA_EM_ATRASO' : 'PAGA',
            dataPagamento,
            valorPago: reais(valorPago),
            valorEncargo: reais(encargo),
          },
        });
        // Recebível realizado (breakdown segue placeholder).
        await tx.recebivel.updateMany({
          where: { parcelaId: parcela.id },
          data: {
            status: 'REALIZADO',
            dataRealizada: dataPagamento,
            valorRealizado: reais(nominal),
          },
        });
        contratosTocados.add(parcela.contrato.id);
      }

      // Intermediárias + serviços recorrentes liquidam junto com a fatura.
      valorPagoFatura += totalExtras;
      // Quando o webhook traz o valor real (opção 2), ele já inclui o encargo
      // cobrado pelo Asaas — registramos o que de fato entrou. Em dev (valor 0)
      // usamos o computado internamente.
      const valorRegistrado = p.valor > 0 ? p.valor : valorPagoFatura;

      await tx.fatura.update({
        where: { id: fatura.id },
        data: {
          status: algumAtraso ? 'PAGA_EM_ATRASO' : 'PAGA',
          dataPagamento,
          valorPago: reais(valorRegistrado),
        },
      });

      // Fase do contrato (doc 02 §5.2, 07/09): encerra por QUITAÇÃO quando não
      // restam parcelas em aberto. Inadimplência é situação CALCULADA — não há
      // mais flip de status ao regularizar.
      for (const contratoId of contratosTocados) {
        const emAberto = await tx.parcela.count({
          where: { contratoId, status: null, acordoId: null },
        });
        if (emAberto === 0) {
          await tx.contratoCredito.update({
            where: { id: contratoId },
            data: { status: 'ENCERRADO', motivoEncerramento: 'QUITACAO', dataEncerramento: dataPagamento },
          });
        }
      }
    });

    // Acordo CUMPRIDO quando a última parcela do plano pagar (doc 02 §5.4, 07/09).
    const cumpridos = await cumprirAcordosSePagos(this.prisma.db, [...contratosTocados]);
    if (cumpridos > 0) this.logger.log(`${cumpridos} acordo(s) CUMPRIDO(s) na conciliação`);

    return { resultado: algumAtraso ? 'pago_em_atraso' : 'pago' };
  }

  // Conciliação de pagamento PARCIAL (Doc 2 §7.3): aplica encargo → serviço →
  // principal. Parcela coberta integralmente é baixada; parcialmente coberta
  // registra o valor e segue em aberto. A fatura não vai a PAGA.
  private async conciliarParcial(
    faturaId: string,
    calc: { parcela: { id: string; contrato: { id: string } }; diasAtraso: number; nominal: number; encargo: number }[],
    extras: { id: string; valor: Prisma.Decimal; tipo: string }[],
    dataPagamento: Date,
    valorPagoCent: number,
  ): Promise<{ resultado: string }> {
    const itens: ItemImputacao[] = [];
    for (const c of calc) if (c.encargo > 0) itens.push({ id: `enc:${c.parcela.id}`, tipo: 'encargo', valor: c.encargo });
    // Serviços recorrentes da cesta entram como 'servico' (prioridade após encargo);
    // intermediárias da entrada parcelada são principal.
    for (const e of extras) itens.push({ id: `extra:${e.id}`, tipo: e.tipo === 'SERVICO' ? 'servico' : 'principal', valor: cent(e.valor) });
    for (const c of calc) itens.push({ id: `prin:${c.parcela.id}`, tipo: 'principal', valor: c.nominal });

    const { alocacoes } = imputarPagamento(valorPagoCent, itens);
    const byId = new Map(alocacoes.map((a) => [a.id, a]));

    await this.prisma.db.$transaction(async (tx) => {
      for (const c of calc) {
        const encAlloc = byId.get(`enc:${c.parcela.id}`)?.alocado ?? 0;
        const prinAlloc = byId.get(`prin:${c.parcela.id}`)?.alocado ?? 0;
        const coberta = prinAlloc >= c.nominal && (c.encargo === 0 || encAlloc >= c.encargo);
        if (coberta) {
          await tx.parcela.update({
            where: { id: c.parcela.id },
            data: {
              status: c.diasAtraso > 0 ? 'PAGA_EM_ATRASO' : 'PAGA',
              dataPagamento,
              valorPago: reais(c.nominal + encAlloc),
              valorEncargo: reais(encAlloc),
            },
          });
          await tx.recebivel.updateMany({
            where: { parcelaId: c.parcela.id },
            data: { status: 'REALIZADO', dataRealizada: dataPagamento, valorRealizado: reais(c.nominal) },
          });
        } else {
          // Parcial: registra o alocado; parcela segue em aberto (status null).
          await tx.parcela.update({
            where: { id: c.parcela.id },
            data: { valorPago: reais(prinAlloc + encAlloc), valorEncargo: reais(encAlloc) },
          });
        }
      }
      // Fatura registra o valor parcial recebido; NÃO é marcada PAGA.
      await tx.fatura.update({ where: { id: faturaId }, data: { valorPago: reais(valorPagoCent) } });
    });

    this.logger.warn(`Conciliação PARCIAL fatura ${faturaId}: recebido ${valorPagoCent}c (imputação encargo→serviço→principal)`);
    // A parcial pode ter fechado a ÚLTIMA parcela do plano do acordo.
    await cumprirAcordosSePagos(this.prisma.db, [...new Set(calc.map((c) => c.parcela.contrato.id))]);
    return { resultado: 'pago_parcial' };
  }

  // PAYMENT_OVERDUE: NÃO grava mais estado (Vocabulário 07/09 — "vencida" é
  // SITUAÇÃO calculada por data, mesma cirurgia do INADIMPLENTE do contrato).
  // O webhook continua chegando; o retorno preserva o contrato da fila.
  async marcarVencida(faturaId: string): Promise<{ resultado: string }> {
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      select: { id: true, status: true },
    });
    if (!fatura) return { resultado: 'fatura_nao_encontrada' };
    if (fatura.status === 'PAGA' || fatura.status === 'PAGA_EM_ATRASO') {
      return { resultado: 'ja_paga' };
    }
    return { resultado: 'vencida_calculada' };
  }

  // Lançamentos avulsos da conta (doc 02 §4-A.3, revisão 2026-08-30): entradas
  // de contrato e de acordo — dinheiro fora do ciclo de fatura, exibido no
  // histórico da ficha ao lado das faturas. Entradas AGUARDANDO pagamento
  // (cobrança gerada, dinheiro ainda não entrou) aparecem como pendência
  // CALCULADA em runtime (Regra 7) — pedido do Luís 31/08: a entrada do acordo
  // recém-aprovado precisa de visibilidade antes de ser paga.
  async lancamentosDaConta(contaId: string) {
    const [lancamentos, acordosAguardando, contratosAguardando] = await Promise.all([
      this.prisma.db.lancamentoConta.findMany({
        where: { contaId },
        orderBy: { dataPagamento: 'desc' },
        include: {
          contrato: { select: { id: true, numero: true } },
          acordo: { select: { id: true } },
        },
      }),
      this.prisma.db.acordo.findMany({
        where: { contaId, status: 'AGUARDANDO_ENTRADA', deletedAt: null },
        orderBy: { dataCriacao: 'desc' },
        select: { id: true, valorEntrada: true, snapshotJson: true },
      }),
      this.prisma.db.contratoCredito.findMany({
        where: { contaId, status: 'AGUARDANDO_PAGAMENTO_INICIAL', deletedAt: null, valorEntrada: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, numero: true, valorEntrada: true, entradaParcelada: true },
      }),
    ]);

    const pendentes = [
      ...acordosAguardando.map((a) => {
        const snap = a.snapshotJson as null | { dataPagamentoEntrada?: string };
        return {
          id: `pendente-acordo-${a.id}`,
          tipo: 'entrada_acordo' as const,
          situacao: 'aguardando_pagamento' as const,
          descricao: 'Entrada do acordo de renegociação',
          valor: cent(a.valorEntrada),
          dataPagamento: null as string | null,
          dataLimite: snap?.dataPagamentoEntrada ?? null,
          contratoId: null as string | null,
          contratoNumero: null as string | null,
          acordoId: a.id as string | null,
        };
      }),
      ...contratosAguardando.map((c) => {
        const valor = cent(c.valorEntrada);
        return {
          id: `pendente-contrato-${c.id}`,
          tipo: 'entrada_contrato' as const,
          situacao: 'aguardando_pagamento' as const,
          descricao: `Entrada do contrato ${c.numero}${c.entradaParcelada ? ' (à vista 60%)' : ''}`,
          valor: entradaAVista(valor, c.entradaParcelada),
          dataPagamento: null as string | null,
          dataLimite: null as string | null,
          contratoId: c.id as string | null,
          contratoNumero: c.numero as string | null,
          acordoId: null as string | null,
        };
      }),
    ];

    const pagos = lancamentos.map((l) => ({
      id: l.id,
      tipo: (l.tipo === 'ENTRADA_CONTRATO' ? 'entrada_contrato' : 'entrada_acordo') as 'entrada_contrato' | 'entrada_acordo',
      situacao: 'paga' as const,
      descricao: l.descricao,
      valor: cent(l.valor),
      dataPagamento: l.dataPagamento.toISOString() as string | null,
      dataLimite: null as string | null,
      contratoId: l.contrato?.id ?? null,
      contratoNumero: l.contrato?.numero ?? null,
      acordoId: l.acordo?.id ?? null,
    }));

    // Pendências primeiro (são acionáveis); pagos em ordem cronológica inversa.
    return [...pendentes, ...pagos];
  }

  // 4.9 — Extrato: eventos de pagamento conciliados do contrato.
  async extrato(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, numero: true, dataAssinatura: true, entradaPagaEm: true, valorEntradaPago: true, entradaParcelada: true },
    });
    if (!contrato) return [];

    const pagas = await this.prisma.db.parcela.findMany({
      where: { contratoId, dataPagamento: { not: null } },
      orderBy: { dataPagamento: 'desc' },
      select: {
        display: true,
        dataPagamento: true,
        valorPago: true,
        valorEncargo: true,
        status: true,
      },
    });

    const eventos = pagas.map((p) => ({
      tipo: 'pagamento' as const,
      label: `Pagamento parcela ${p.display}`,
      data: p.dataPagamento!.toISOString(),
      valor: cent(p.valorPago),
      encargo: cent(p.valorEncargo),
      atraso: p.status === 'PAGA_EM_ATRASO',
    }));

    // Entrada materializada (doc 02 §4-A.3, 2026-08-16): o dia zero aparece no
    // extrato como pagamento — antes a entrada não existia em lugar nenhum.
    if (contrato.entradaPagaEm && contrato.valorEntradaPago) {
      eventos.push({
        tipo: 'pagamento',
        label: `Entrada paga${contrato.entradaParcelada ? ' (à vista 60%)' : ''} — dia zero do contrato`,
        data: contrato.entradaPagaEm.toISOString(),
        valor: cent(contrato.valorEntradaPago),
        encargo: 0,
        atraso: false,
      });
    }

    eventos.push({
      tipo: 'pagamento',
      label: `Contrato ${contrato.numero} originado`,
      data: contrato.dataAssinatura.toISOString(),
      valor: 0,
      encargo: 0,
      atraso: false,
    });

    return eventos;
  }

  // Mapeia uma fatura (com itensFatura) para a API; "vencida"/"vence hoje" são
  // calculados em runtime (Regra 7), o status real vai ao banco.
  private mapearFatura(f: FaturaDeLista) {
    // Fuso do negócio (correção 30/08): "hoje" em America/Sao_Paulo comparado
    // com a data-calendário do vencimento — meia-noite LOCAL do servidor fazia
    // a fatura que vence HOJE aparecer como "Vencida".
    const hojeStr = dataHojeBrasil();
    const vencStr = dataCalendarioUTC(f.dataVencimento);
    const statusReal = f.status.toLowerCase();
    // UMA função para a situação (utils) — a página pública usa a mesma.
    const situacao = situacaoFaturaRuntime(f.status, vencStr, hojeStr);
    return {
      id: f.id,
      numero: f.numero,
      periodoReferencia: f.periodoReferencia.toISOString(),
      dataVencimento: f.dataVencimento.toISOString(),
      dataFechamento: f.dataFechamento?.toISOString() ?? null,
      dataPagamento: f.dataPagamento?.toISOString() ?? null,
      status: statusReal,
      situacao,
      valorTotal: cent(f.valorTotal),
      valorPago: cent(f.valorPago),
      // Visível na tela (correção 08/09): fatura fechada SEM cobrança no Asaas
      // é um estado de exceção que o operador precisa enxergar e resolver.
      temCobrancaAsaas: !!f.asaasChargeId,
      // Fatura Azit F2 (doc 02 §32.4-A): 'AZIT' = Pix sob demanda — não ter
      // cobrança é o normal, e "Emitir cobrança" não se aplica.
      modeloEncargo: f.modeloEncargo,
      // Fatura Azit (doc 02 §32.7): o link é atributo da fatura — aparece onde ela aparece.
      linkPublico: this.linkPublico(f.tokenPublico),
      itens: f.itensFatura.map((it) => ({
        descricao: it.descricao,
        tipo: it.tipo.toLowerCase(),
        valor: cent(it.valor),
        credor: it.credor.toLowerCase(),
      })),
    };
  }

  // ── Ficha do titular (doc 02 §33) ─────────────────────────────────────────
  // Faturas da conta em quatro VISÕES — cada fatura agrega itens de todos os
  // contratos do mesmo ciclo (doc 02 §4-A):
  //   agora  = o que o cliente tem para pagar: disponível (FECHADA) ou vencida;
  //   vencer = ainda não disponível (ABERTA, vence de hoje em diante);
  //   pagas  = PAGA / PAGA_EM_ATRASO, da mais recente para a mais antiga;
  //   outras = saíram do cronograma (RENEGOCIADA, NOVADA, RESCINDIDA).
  private whereVisao(contaId: string, visao: VisaoFaturasConta): { where: Prisma.FaturaWhereInput; ordem: 'asc' | 'desc' } {
    const hoje = inicioHojeBrasilUTC();
    switch (visao) {
      case 'vencer':
        return { where: { contaId, status: 'ABERTA', dataVencimento: { gte: hoje } }, ordem: 'asc' };
      case 'pagas':
        return { where: { contaId, status: { in: ['PAGA', 'PAGA_EM_ATRASO'] } }, ordem: 'desc' };
      case 'outras':
        return { where: { contaId, status: { in: ['RENEGOCIADA', 'NOVADA', 'RESCINDIDA'] } }, ordem: 'desc' };
      default:
        return { where: { contaId, OR: [{ status: 'FECHADA' }, { status: 'ABERTA', dataVencimento: { lt: hoje } }] }, ordem: 'asc' };
    }
  }

  // O que falta pagar HOJE em cada fatura em aberto — o MESMO número da página
  // do cliente. Modelo AZIT: o total do motor (uma leitura da conta por chamada).
  // Modelo antigo: o valor da fatura menos o que já entrou, mais a multa e a
  // atualização de hoje pela função única `encargoHojeDaFatura` (correção 18/11:
  // a ficha mostrava o valor de face da vencida e a página do cliente, o atualizado).
  private async comFaltaHoje(contaId: string, faturas: FaturaComParcelas[]) {
    const motor = new Map<string, { totalHoje: number; encargo: number }>();
    if (faturas.some((f) => f.modeloEncargo === 'AZIT' && f.status === 'FECHADA')) {
      const conta = await this.contaFatura.carregar(contaId);
      for (const x of this.contaFatura.projetar(conta).faturas) {
        motor.set(x.id, { totalHoje: x.totalHoje, encargo: x.encargo.multa + x.encargo.atualizacao });
      }
    }
    return faturas.map((f) => {
      const linha = this.mapearFatura(f);
      const emAberto = f.status === 'ABERTA' || f.status === 'FECHADA';
      const m = motor.get(f.id);
      const saldo = Math.max(0, linha.valorTotal - linha.valorPago);
      const antigo = emAberto && !m && f.modeloEncargo !== 'AZIT' ? this.encargoDeHojeModeloAntigo(f, saldo) : 0;
      return {
        ...linha,
        faltaHoje: !emAberto ? null : (m?.totalHoje ?? saldo + antigo),
        encargoHoje: emAberto ? (m?.encargo ?? antigo) : 0,
      };
    });
  }

  private encargoDeHojeModeloAntigo(f: FaturaComParcelas, saldo: number): number {
    const agora = new Date();
    const e = encargoHojeDaFatura(
      (f.parcelas ?? []).map((p) => ({
        valor: cent(p.valorNominal),
        diasAtraso: diasAtrasoCalendario(p.dataVencimento, agora),
        taxaMultaPercent: Number(p.contrato.taxaMultaAtraso.toString()),
        taxaJurosMensalPercent: Number(p.contrato.taxaJurosAtraso.toString()),
      })),
      { saldo, diasAtraso: diasAtrasoCalendario(f.dataVencimento, agora) },
    );
    return e.multa + e.atualizacao;
  }

  // O que falta pagar HOJE nesta fatura — o MESMO número da ficha e da página do
  // cliente (aviso de atraso do WhatsApp, doc 02 §28.6). null = não está em aberto.
  async faltaHojeDaFatura(faturaId: string): Promise<number | null> {
    const f = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      include: {
        itensFatura: { orderBy: { tipo: 'asc' } },
        parcelas: { select: { valorNominal: true, dataVencimento: true, contrato: { select: { taxaMultaAtraso: true, taxaJurosAtraso: true } } } },
      },
    });
    if (!f) return null;
    const [linha] = await this.comFaltaHoje(f.contaId, [f]);
    return linha.faltaHoje;
  }

  // "Agora" vem inteira (é o que está na mesa, e a posição do topo soma sobre
  // ela); as demais chegam em blocos — a tela pede "carregar mais" com offset.
  async faturasDaConta(contaId: string, visao: VisaoFaturasConta = 'agora', offset = 0, limit = 10) {
    const { where, ordem } = this.whereVisao(contaId, visao);
    const inicio = visao === 'agora' ? 0 : Math.max(0, offset);
    const [total, faturas] = await Promise.all([
      this.prisma.db.fatura.count({ where }),
      this.prisma.db.fatura.findMany({
        where,
        orderBy: [{ dataVencimento: ordem }, { numero: ordem }],
        skip: inicio,
        take: visao === 'agora' ? 60 : Math.min(Math.max(1, limit), 50),
        include: {
          itensFatura: { orderBy: { tipo: 'asc' } },
          parcelas: { select: { valorNominal: true, dataVencimento: true, contrato: { select: { taxaMultaAtraso: true, taxaJurosAtraso: true } } } },
        },
      }),
    ]);
    return { visao, total, offset: inicio, data: await this.comFaltaHoje(contaId, faturas) };
  }

  // Posição de hoje (doc 02 §33.1): o que está vencido e quanto falta, a próxima
  // fatura, o último dinheiro que entrou e o cronograma em três números. Tudo
  // calculado na leitura — nada disso é gravado (Regra 7).
  async posicaoDaConta(contaId: string) {
    const hojeISO = dataHojeBrasil();
    const [agora, contagens, aVencer, ultimos] = await Promise.all([
      this.faturasDaConta(contaId, 'agora'),
      Promise.all(VISOES_FATURAS_CONTA.map((v) => this.prisma.db.fatura.count({ where: this.whereVisao(contaId, v).where }))),
      this.prisma.db.fatura.aggregate({
        where: { contaId, status: { in: ['ABERTA', 'FECHADA'] }, dataVencimento: { gte: inicioHojeBrasilUTC() } },
        _sum: { valorTotal: true, valorPago: true },
        _count: { _all: true },
      }),
      this.pagamentosDaConta(contaId, 0, 1),
    ]);
    const vencidas = agora.data.filter((f) => f.situacao === 'vencida');
    // Próxima: a primeira disponível que ainda não venceu; sem ela, a primeira ainda não emitida.
    let proxima = agora.data.find((f) => f.situacao !== 'vencida') ?? null;
    if (!proxima) proxima = (await this.faturasDaConta(contaId, 'vencer', 0, 1)).data[0] ?? null;
    const valorEmAtraso = vencidas.reduce((s, f) => s + (f.faltaHoje ?? 0), 0);
    return {
      hoje: hojeISO,
      atraso: {
        faturas: vencidas.length,
        valorHoje: valorEmAtraso,
        encargos: vencidas.reduce((s, f) => s + f.encargoHoje, 0),
        diasMaisAntiga: vencidas.length ? diasCalendarioEntre(dataCalendarioUTC(new Date(vencidas[0].dataVencimento)), hojeISO) : 0,
      },
      proxima: proxima
        ? {
            id: proxima.id,
            numero: proxima.numero,
            dataVencimento: proxima.dataVencimento,
            valor: proxima.faltaHoje ?? proxima.valorTotal,
            disponivel: proxima.status === 'fechada',
          }
        : null,
      ultimoPagamento: ultimos.data[0] ?? null,
      // Fatura cujo link o operador manda ao cliente: a mais antiga em aberto que tem link.
      faturaComLinkId: agora.data.find((f) => f.linkPublico)?.id ?? null,
      trilho: {
        pagas: contagens[VISOES_FATURAS_CONTA.indexOf('pagas')],
        emAtraso: vencidas.length,
        valorEmAtraso,
        aVencer: aVencer._count._all,
        valorAVencer: Math.max(0, cent(aVencer._sum.valorTotal) - cent(aVencer._sum.valorPago)),
      },
      contagem: Object.fromEntries(VISOES_FATURAS_CONTA.map((v, i) => [v, contagens[i]])) as Record<VisaoFaturasConta, number>,
    };
  }

  // Pagamentos da conta (doc 02 §33.3): cada dinheiro que entrou, do mais
  // recente para o mais antigo, com a fatura que ele quitou. Três origens:
  //   1. PagamentoFatura (Pix sob demanda, conferência, sinistro) — um Pix que
  //      cobre mais de uma fatura aparece UMA vez, com os destinos;
  //   2. fatura paga pela cobrança do Asaas (modelo antigo), que não tem
  //      registro de pagamento próprio: vale o que a fatura guarda;
  //   3. lançamentos da conta (entrada de contrato e de acordo, doc 02 §4-A.3).
  async pagamentosDaConta(contaId: string, offset = 0, limit = 10): Promise<{ total: number; offset: number; data: PagamentoDaConta[] }> {
    const [registrados, semRegistro, lancamentos] = await Promise.all([
      this.prisma.db.pagamentoFatura.findMany({
        where: { fatura: { contaId } },
        include: {
          fatura: { select: { id: true, numero: true, status: true } },
          alocacoes: { select: { tipoEncargo: true, valor: true } },
        },
      }),
      this.prisma.db.fatura.findMany({
        where: { contaId, valorPago: { gt: 0 }, dataPagamento: { not: null }, pagamentos: { none: {} } },
        select: { id: true, numero: true, status: true, valorPago: true, dataPagamento: true, parcelas: { select: { valorEncargo: true } } },
      }),
      this.prisma.db.lancamentoConta.findMany({ where: { contaId }, include: { contrato: { select: { numero: true } } } }),
    ]);
    const quitada = (status: string) => status === 'PAGA' || status === 'PAGA_EM_ATRASO';
    const instante = (p: { pagoEm: Date | null; createdAt: Date }) => (p.pagoEm ?? p.createdAt).getTime();

    // O último pagamento de cada fatura é o que a quitou (quando ela está quitada).
    const ultimoDaFatura = new Map<string, string>();
    for (const p of [...registrados].sort((a, b) => a.dataPagamento.getTime() - b.dataPagamento.getTime() || instante(a) - instante(b))) {
      ultimoDaFatura.set(p.faturaId, p.id);
    }

    const itens: (PagamentoDaConta & { ordem: number })[] = [];
    const porPix = new Map<string, PagamentoDaConta & { ordem: number }>();
    for (const p of registrados) {
      const chave = p.gatewayPaymentId ?? p.id;
      let item = porPix.get(chave);
      if (!item) {
        item = {
          id: chave,
          dia: dataCalendarioUTC(p.dataPagamento),
          hora: p.pagoEm ? horaBrasil(p.pagoEm) : null,
          tipo: p.origem === 'SINISTRO' ? 'sinistro' : 'pix',
          valor: 0,
          excedente: 0,
          descricao: null,
          contratoNumero: null,
          acordoId: null,
          destinos: [],
          ordem: instante(p),
        };
        porPix.set(chave, item);
        itens.push(item);
      }
      const valor = cent(p.valor);
      const excedente = cent(p.valorExcedente);
      item.valor += valor + excedente;
      item.excedente += excedente;
      if (valor > 0) {
        item.destinos.push({
          faturaId: p.fatura.id,
          numero: p.fatura.numero,
          valor,
          encargos: p.alocacoes.filter((a) => a.tipoEncargo !== null).reduce((s, a) => s + cent(a.valor), 0),
          quitou: quitada(p.fatura.status) && ultimoDaFatura.get(p.faturaId) === p.id,
        });
      }
    }
    for (const item of porPix.values()) item.destinos.sort((a, b) => a.numero - b.numero);

    for (const f of semRegistro) {
      const valor = cent(f.valorPago);
      itens.push({
        id: `fatura-${f.id}`,
        dia: diaDeColunaMista(f.dataPagamento!),
        hora: null,
        tipo: 'cobranca',
        valor,
        excedente: 0,
        descricao: null,
        contratoNumero: null,
        acordoId: null,
        destinos: [
          {
            faturaId: f.id,
            numero: f.numero,
            valor,
            encargos: Math.min(valor, f.parcelas.reduce((s, x) => s + cent(x.valorEncargo), 0)),
            quitou: quitada(f.status),
          },
        ],
        ordem: f.dataPagamento!.getTime(),
      });
    }
    for (const l of lancamentos) {
      itens.push({
        id: `lancamento-${l.id}`,
        dia: diaDeColunaMista(l.dataPagamento),
        hora: null,
        tipo: l.tipo === 'ENTRADA_CONTRATO' ? 'entrada_contrato' : 'entrada_acordo',
        valor: cent(l.valor),
        excedente: 0,
        descricao: l.descricao,
        contratoNumero: l.contrato?.numero ?? null,
        acordoId: l.acordoId,
        destinos: [],
        ordem: l.dataPagamento.getTime(),
      });
    }
    itens.sort((a, b) => (a.dia === b.dia ? b.ordem - a.ordem : a.dia < b.dia ? 1 : -1));
    const inicio = Math.max(0, offset);
    return {
      total: itens.length,
      offset: inicio,
      data: itens.slice(inicio, inicio + Math.min(Math.max(1, limit), 50)).map(({ ordem: _ordem, ...item }) => item),
    };
  }

  // Detalhe de uma fatura (modal): composição completa + datas + valores.
  // Fatura FECHADA sem cobrança traz o encargo corrido até hoje, para o
  // operador decidir a reemissão com o número na mão (correção 08/09).
  async detalheFatura(faturaId: string) {
    const f = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      include: {
        itensFatura: { orderBy: { tipo: 'asc' } },
        conta: { include: { titular: { select: { id: true, nome: true, whatsapp: true } } } },
        parcelas: { include: { contrato: { select: { taxaMultaAtraso: true, taxaJurosAtraso: true } } } },
        enviosLink: { orderBy: { createdAt: 'desc' }, take: 20, include: { usuario: { select: { nome: true } } } },
      },
    });
    if (!f) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fatura não encontrada' });
    // Fatura do modelo AZIT (doc 02 §32.4-A): saldo, encargo, pagamentos e Pix
    // ativo saem da conta refeita pelo motor — a mesma que a página do cliente mostra.
    const azit = f.modeloEncargo === 'AZIT' ? await this.detalheAzit(f.contaId, f.id) : null;
    const encargoAtual = azit
      ? azit.multa + azit.atualizacao
      : f.status === 'FECHADA' || f.status === 'ABERTA'
        ? this.encargoDeHojeModeloAntigo(f, Math.max(0, cent(f.valorTotal) - cent(f.valorPago)))
        : 0;
    const base = this.mapearFatura(f);
    // Fatura Azit (doc 02 §32.7): link, WhatsApp do titular (para o wa.me) e a
    // mensagem pronta — o texto é montado aqui, uma vez, não na tela.
    const link = base.linkPublico;
    const mensagemWhatsapp = link
      ? mensagemLinkFatura({ nomeTitular: f.conta.titular.nome, numero: f.numero, vencimentoISO: dataCalendarioUTC(f.dataVencimento), valorCentavos: azit ? azit.totalHoje : cent(f.valorTotal) + encargoAtual, situacao: base.situacao, link })
      : null;
    return {
      ...base,
      titular: { id: f.conta.titular.id, nome: f.conta.titular.nome },
      encargoAtual,
      whatsappTitular: whatsappParaWaMe(f.conta.titular.whatsapp),
      mensagemWhatsapp,
      enviosLink: f.enviosLink.map((e) => ({ id: e.id, canal: e.canal.toLowerCase(), usuario: e.usuario.nome, em: e.createdAt.toISOString() })),
      azit,
    };
  }

  // Leitura do operador para fatura AZIT: o que falta hoje, cada pagamento com
  // o que quitou (mesmos nomes da página do cliente) e os Pix ativos da conta.
  private async detalheAzit(contaId: string, faturaId: string) {
    const [conta, ativas] = await Promise.all([this.contaFatura.carregar(contaId, { incluirFaturaId: faturaId }), this.intencao.ativasDaConta(contaId)]);
    const f = conta.faturas.find((x) => x.id === faturaId);
    const projetada = this.contaFatura.projetar(conta).faturas.find((x) => x.id === faturaId);
    if (!f || !projetada) return null;
    const nomeDoItem = new Map(f.itens.map((it) => [it.id, it.titulo]));
    const divisao = await this.contaFatura.divisaoDosPix(faturaId, f.pagamentos.map((p) => p.gatewayPaymentId));
    const pagamentos: PagamentoFaturaOperador[] = f.pagamentos.map((p) => ({
      id: p.id,
      data: p.data,
      pagoEm: p.pagoEm?.toISOString() ?? null,
      valor: p.valor,
      valorExcedente: p.valorExcedente,
      valorPix: (p.gatewayPaymentId && divisao.get(p.gatewayPaymentId)?.valorPix) || p.valor + p.valorExcedente,
      outrasFaturas: (p.gatewayPaymentId && divisao.get(p.gatewayPaymentId)?.outrasFaturas) || [],
      origem: p.origem as PagamentoFaturaOperador['origem'],
      identificadorPix: p.identificadorPix,
      intencaoId: p.intencaoId,
      alocacoes: p.alocacoes.map((a) => ({
        nome:
          a.alvo === 'MULTA'
            ? ROTULO_ENCARGO_FATURA[TipoEncargoFatura.MULTA]
            : a.alvo === 'ATUALIZACAO'
              ? ROTULO_ENCARGO_FATURA[TipoEncargoFatura.ATUALIZACAO]
              : (nomeDoItem.get(a.itemId ?? '') ?? 'Item da fatura'),
        valor: a.valor,
        nivel: a.nivel,
        quitou: a.quitou,
        encargo: a.alvo !== 'ITEM',
      })),
    }));
    // Pode haver vários Pix ativos hoje, um por valor (regra 15/11).
    const intencoesAtivas: IntencaoPagamentoOperador[] = ativas.map((ativa) => ({
      id: ativa.id,
      valor: cent(ativa.valor),
      situacao: ativa.situacao as IntencaoPagamentoOperador['situacao'],
      origem: ativa.origem as IntencaoPagamentoOperador['origem'],
      dia: ativa.dia,
      validoAte: ativa.validoAte.toISOString(),
      criadaEm: ativa.createdAt.toISOString(),
      faturas: ((ativa.faturasPretendidas as unknown as FaturaPretendida[]) ?? []).map((x) => ({ numero: x.numero, vencimento: x.vencimento, valor: x.valor })),
      outroValor: ativa.outroValor,
      simulado: ativa.simulado,
    }));
    return {
      situacao: projetada.situacao, // paga | parcial | vencida | hoje | aberta (calculada)
      totalHoje: projetada.totalHoje,
      saldoNominal: projetada.saldoNominal,
      multa: projetada.encargo.multa,
      atualizacao: projetada.encargo.atualizacao,
      diasAtualizacao: projetada.encargo.dias,
      atualizacaoDesde: projetada.encargo.desde,
      diasAtraso: projetada.diasAtraso,
      pagoTotal: projetada.pagoTotal,
      pagamentos,
      intencoesAtivas,
      // Conta mista (§32.4-A, provisório): há fatura do modelo antigo em aberto.
      contaMista: conta.abertasModeloAntigo.length > 0,
      // Gateway em modo simulado: "Conferir Pix no gateway" não se aplica (a tela esconde).
      gatewaySimulado: this.intencao.gatewaySimulado,
    };
  }

  private linkPublico(token: string | null | undefined): string | null {
    return montarLinkFatura(this.config.get<string>('faturaPublicaUrl') ?? '', token);
  }

  // Registra o envio MANUAL do link pelo operador (doc 02 §32.7): "link enviado
  // por <usuário> em <data>", sem prova de entrega. Copiar também registra — é o
  // rastro de que o cliente recebeu o link por algum canal.
  async registrarEnvioLink(faturaId: string, usuarioId: string, canal: 'whatsapp' | 'copia') {
    const f = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId, deletedAt: null },
      include: { conta: { include: { titular: { select: { whatsapp: true } } } } },
    });
    if (!f) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fatura não encontrada' });
    if (!f.tokenPublico) throw new UnprocessableEntityException({ erro: 'sem_link', mensagem: 'Esta fatura ainda não tem link público.' });
    await this.prisma.db.envioLinkFatura.create({
      data: {
        faturaId,
        usuarioId,
        canal: canal === 'whatsapp' ? 'WHATSAPP' : 'COPIA',
        destino: canal === 'whatsapp' ? whatsappParaWaMe(f.conta.titular.whatsapp) : null,
      },
    });
    return this.detalheFatura(faturaId);
  }

  private encargoAteHoje(
    parcelas: { valorNominal: Prisma.Decimal; dataVencimento: Date; contrato: { taxaMultaAtraso: Prisma.Decimal; taxaJurosAtraso: Prisma.Decimal } }[],
  ): number {
    const agora = new Date();
    let total = 0;
    for (const p of parcelas) {
      const dias = diasAtrasoCalendario(p.dataVencimento, agora);
      if (dias <= 0) continue;
      total += Math.round(
        calcularEncargoAtraso(
          cent(p.valorNominal),
          dias,
          Number(p.contrato.taxaMultaAtraso.toString()),
          Number(p.contrato.taxaJurosAtraso.toString()),
        ),
      );
    }
    return total;
  }

  // Reemissão MANUAL pela tela (correção 08/09 — plano de contingência): quando a
  // cobrança automática falhou, o operador emite daqui — NUNCA pelo painel do
  // Asaas, porque só a emissão pelo sistema carrega o externalReference que faz
  // o webhook conciliar sozinho. O Asaas rejeita vencimento no passado, então a
  // fatura vencida sai com vencimento >= hoje, com ou sem o encargo corrido
  // (escolha do operador, caso a caso).
  async emitirCobrancaManual(
    faturaId: string,
    dto: { vencimento?: string; incluirEncargo?: boolean },
  ): Promise<{ chargeId: string; valorCobrado: number; vencimento: string; encargoIncluido: number }> {
    const fatura = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      include: {
        conta: { include: { titular: { select: { id: true, nome: true, cpfCnpj: true, email: true, whatsapp: true, asaasCustomerId: true } } } },
        parcelas: { include: { contrato: { select: { taxaMultaAtraso: true, taxaJurosAtraso: true } } } },
        itensFatura: { orderBy: { tipo: 'asc' }, select: { descricao: true, valor: true } },
      },
    });
    if (!fatura) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fatura não encontrada' });
    if (fatura.asaasChargeId) {
      throw new UnprocessableEntityException({ erro: 'ja_tem_cobranca', mensagem: 'Esta fatura já tem cobrança no Asaas' });
    }
    if (fatura.modeloEncargo === 'AZIT') {
      throw new UnprocessableEntityException({ erro: 'fatura_pix_sob_demanda', mensagem: 'Esta fatura é do modelo de Pix sob demanda: não tem cobrança pré-criada. O Pix é gerado pela página da fatura, no valor do dia.' });
    }
    if (fatura.status !== 'FECHADA') {
      throw new UnprocessableEntityException({ erro: 'fatura_nao_fechada', mensagem: 'Só fatura FECHADA recebe cobrança (a aberta fecha no D-5)' });
    }
    const hoje = dataHojeBrasil();
    const vencStr = dto.vencimento ?? (dataCalendarioUTC(fatura.dataVencimento) >= hoje ? dataCalendarioUTC(fatura.dataVencimento) : hoje);
    if (vencStr < hoje) {
      throw new UnprocessableEntityException({ erro: 'vencimento_passado', mensagem: 'O Asaas não aceita vencimento no passado — informe hoje ou uma data futura' });
    }

    const encargo = dto.incluirEncargo ? this.encargoAteHoje(fatura.parcelas) : 0;
    const valorCobrado = cent(fatura.valorTotal) + encargo;
    const itens = [...fatura.itensFatura];
    if (encargo > 0) {
      itens.push({ descricao: 'Encargo de atraso (até a emissão)', valor: new Prisma.Decimal(reais(encargo)) });
    }

    const titular = fatura.conta.titular;
    let customerId = this.asaas.clienteReutilizavel(titular.asaasCustomerId);
    if (!customerId) {
      customerId = await this.asaas.criarCliente({
        titularId: titular.id, nome: titular.nome, cpfCnpj: titular.cpfCnpj, email: titular.email, telefone: titular.whatsapp,
      });
      await this.prisma.db.titular.update({ where: { id: titular.id }, data: { asaasCustomerId: customerId } });
    }

    const taxas = fatura.parcelas[0]?.contrato;
    const cobranca = await this.asaas.criarCobranca({
      externalReference: fatura.id,
      valor: valorCobrado,
      vencimento: new Date(`${vencStr}T12:00:00.000Z`),
      descricao: this.descricaoCobranca(fatura.numero, valorCobrado, itens),
      customerId,
      multaPct: taxas ? Number(taxas.taxaMultaAtraso.toString()) : undefined,
      jurosPct: taxas ? Number(taxas.taxaJurosAtraso.toString()) : undefined,
    });
    await this.prisma.db.fatura.update({ where: { id: fatura.id }, data: { asaasChargeId: cobranca.id } });
    return { chargeId: cobranca.id, valorCobrado, vencimento: vencStr, encargoIncluido: encargo };
  }

  // Dev: simula atraso "dia a dia" — cada clique deixa a fatura +N dias vencida.
  // Coloca o vencimento (fatura + parcelas) em hoje-(atrasoAtual+N), de modo que
  // o atraso aumente de forma determinística mesmo partindo de uma fatura futura.
  async envelhecerFatura(faturaId: string, dias = 1) {
    const f = await this.prisma.db.fatura.findFirst({
      where: { id: faturaId },
      include: { parcelas: { select: { id: true } } },
    });
    if (!f) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Fatura não encontrada' });
    // Dias de calendário no fuso do negócio; vencimento/fechamento gravados em UTC-midnight.
    const hoje = dataHojeBrasil();
    const atrasoAtual = diasAtrasoCalendario(f.dataVencimento, inicioDiaUTC(hoje));
    const diasAtraso = atrasoAtual + dias;
    const novoVenc = inicioDiaUTC(somarDiasISO(hoje, -diasAtraso));
    const novoFech = inicioDiaUTC(somarDiasISO(hoje, -diasAtraso - 5));
    await this.prisma.db.$transaction(async (tx) => {
      await tx.fatura.update({ where: { id: faturaId }, data: { dataVencimento: novoVenc, dataFechamento: novoFech } });
      for (const p of f.parcelas) {
        await tx.parcela.update({ where: { id: p.id }, data: { dataVencimento: novoVenc } });
        await tx.recebivel.updateMany({ where: { parcelaId: p.id }, data: { dataPrevista: novoVenc } });
      }
    });
    return { faturaId, dataVencimento: novoVenc.toISOString(), diasAtraso };
  }
}
