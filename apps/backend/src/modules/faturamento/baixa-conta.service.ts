import { Injectable, Logger } from '@nestjs/common';
import { aplicarPagamentoNaConta, diaBrasil, formatCurrency, imputarEmNiveis, inicioDiaUTC, reconstituirFatura, type BaixaFatura } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { cumprirAcordosSePagos } from '../operacoes/acordo-cumprimento';
import { ContaFaturaService, type FaturaDaConta } from './conta-fatura.service';
import { IntencaoPagamentoService, type JobBaixaIntencao } from './intencao-pagamento.service';

const reais = (c: number): string => (c / 100).toFixed(2);

export type ResultadoBaixa =
  | 'aplicado' // baixou em uma ou mais faturas
  | 'aplicado_com_excedente' // baixou e sobrou
  | 'so_excedente' // a conta não tinha nada em aberto: tudo registrado como excedente
  | 'ja_aplicado' // idempotência: este pagamento já tinha sido baixado
  | 'intencao_nao_encontrada';

// Baixa PELA CONTA (doc 02 §32.4-A, §32.5, §32.6-A): o Pix de uma intenção é
// dinheiro da conta — aplicado fatura a fatura, da mais antiga para a mais
// nova, com a cascata dentro de cada uma e o encargo calculado na DATA DO
// PAGAMENTO. Grava um PagamentoFatura (com suas AlocacaoPagamento) por fatura
// tocada e mantém os efeitos da conciliação antiga: parcela, recebível,
// encerramento do contrato por quitação, acordo cumprido e status da fatura.
// Só enxerga faturas do modelo AZIT; as ASAAS_NATIVO seguem em
// FaturaService.conciliarPagamento.
@Injectable()
export class BaixaContaService {
  private readonly logger = new Logger(BaixaContaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contaFatura: ContaFaturaService,
    private readonly notificacao: NotificacaoService,
    private readonly intencoes: IntencaoPagamentoService,
  ) {}

  async aplicarPagamentoDeIntencao(job: JobBaixaIntencao): Promise<{ resultado: ResultadoBaixa; faturas: number; excedente: number }> {
    const intencao = await this.prisma.db.intencaoPagamento.findFirst({
      where: { id: job.intencaoId },
      select: { id: true, contaId: true, situacao: true, conta: { select: { titular: { select: { id: true, nome: true } } } } },
    });
    if (!intencao) {
      // Dinheiro com referência que não conhecemos: nunca some em silêncio.
      await this.notificacao.emitir({
        titulo: 'Pix recebido com referência desconhecida',
        corpo: `Pagamento ${job.pagamentoId} de ${formatCurrency(job.valor)} chegou com a referência intencao:${job.intencaoId}, que não existe no sistema. Confira no gateway.`,
        rota: '/regua',
        tipo: 'FALHA',
        area: 'CARTEIRA_COBRANCA',
      });
      return { resultado: 'intencao_nao_encontrada', faturas: 0, excedente: 0 };
    }

    // Data do pagamento: a que o gateway informou; sem ela, o dia (Brasil) em que soubemos.
    const dia = job.dataPagamento ?? diaBrasil(new Date(job.recebidoEm));
    const dataPagamento = inicioDiaUTC(dia);
    const pagoEm = job.origem === 'GATEWAY' ? new Date(job.recebidoEm) : null;
    const contaId = intencao.contaId;

    const r = await this.prisma.db.$transaction(async (tx) => {
      // Trava a conta: duas baixas da mesma conta nunca rodam ao mesmo tempo.
      await tx.$queryRaw`SELECT id FROM contas WHERE id = ${contaId} FOR UPDATE`;

      // Idempotência pelo id do pagamento no gateway.
      const jaAplicado = await tx.pagamentoFatura.findFirst({ where: { gatewayPaymentId: job.pagamentoId }, select: { id: true } });
      if (jaAplicado) return { resultado: 'ja_aplicado' as const, baixas: [] as BaixaFatura[], excedente: 0, contratos: [] as string[], outrasAtivas: [] as { id: string; gatewayId: string | null }[] };

      const conta = await this.contaFatura.carregar(contaId, { db: tx });
      const abertas = conta.faturas.filter((f) => f.status === 'FECHADA');
      const estados = abertas.map((f) => reconstituirFatura(f.motor));
      const { baixas, excedente } = aplicarPagamentoNaConta(estados, { data: dia, valor: job.valor }, conta.parametros.cascata);

      const contratosQuitados = new Set<string>();
      for (const [i, baixa] of baixas.entries()) {
        const fatura = abertas.find((f) => f.id === baixa.faturaId)!;
        const estado = estados.find((e) => e.id === baixa.faturaId)!;
        const ultima = i === baixas.length - 1;
        await tx.pagamentoFatura.create({
          data: {
            faturaId: fatura.id,
            intencaoId: intencao.id,
            valor: reais(baixa.valor),
            dataPagamento,
            pagoEm,
            origem: job.origem,
            gatewayPaymentId: job.pagamentoId,
            identificadorPix: job.identificadorPix,
            // A sobra fica registrada na ÚLTIMA fatura tocada (§32.5).
            valorExcedente: reais(ultima ? excedente : 0),
            alocacoes: {
              create: baixa.alocacoes.map((a) => ({
                itemFaturaId: a.alvo === 'ITEM' && a.itemId && !a.itemId.startsWith('fatura:') ? a.itemId : null,
                tipoEncargo: a.alvo === 'MULTA' ? ('MULTA' as const) : a.alvo === 'ATUALIZACAO' ? ('ATUALIZACAO' as const) : null,
                valor: reais(a.valor),
                nivel: a.nivel,
                quitou: a.quitou,
              })),
            },
          },
        });

        // Fatura: acumula o recebido; quitada vira PAGA / PAGA_EM_ATRASO (algum
        // pagamento depois do vencimento). Parcial segue FECHADA — "paga
        // parcialmente" é situação calculada (Regra 7).
        const algumAtraso = baixa.emAtraso || fatura.motor.pagamentos.some((p) => p.data > fatura.vencimento);
        await tx.fatura.update({
          where: { id: fatura.id },
          data: {
            valorPago: reais(fatura.valorPago + baixa.valor),
            ...(baixa.quitouFatura ? { status: algumAtraso ? ('PAGA_EM_ATRASO' as const) : ('PAGA' as const), dataPagamento } : {}),
          },
        });

        for (const p of await this.baixarParcelas(tx, fatura, baixa, (itemId) => estado.saldos.get(itemId) ?? 0, dia, dataPagamento)) contratosQuitados.add(p);
      }

      // Conta sem NADA em aberto (Pix de intenção antiga pago depois de tudo
      // quitado): o valor inteiro é excedente, registrado na fatura AZIT mais
      // recente da conta para não ficar sem rastro (§32.4-A: nunca se recusa).
      if (baixas.length === 0) {
        const ultimaFatura = await tx.fatura.findFirst({ where: { contaId, modeloEncargo: 'AZIT' }, orderBy: { dataVencimento: 'desc' }, select: { id: true } });
        if (!ultimaFatura) throw new Error(`Conta ${contaId} sem fatura do modelo AZIT para registrar o pagamento ${job.pagamentoId}`);
        await tx.pagamentoFatura.create({
          data: {
            faturaId: ultimaFatura.id,
            intencaoId: intencao.id,
            valor: reais(0),
            dataPagamento,
            pagoEm,
            origem: job.origem,
            gatewayPaymentId: job.pagamentoId,
            identificadorPix: job.identificadorPix,
            valorExcedente: reais(excedente),
          },
        });
      }

      // Encerramento por QUITAÇÃO (doc 02 §5.2): contrato sem parcela em aberto.
      for (const contratoId of contratosQuitados) {
        const emAberto = await tx.parcela.count({ where: { contratoId, status: null, acordoId: null } });
        if (emAberto === 0) {
          await tx.contratoCredito.update({ where: { id: contratoId }, data: { status: 'ENCERRADO', motivoEncerramento: 'QUITACAO', dataEncerramento: dataPagamento } });
        }
      }

      // A intenção paga vira PAGA — mesmo que estivesse EXPIRADA ou SUBSTITUIDA
      // (o dinheiro manda). O saldo da conta mudou: TODAS as outras intenções
      // ativas da conta (pode haver várias, uma por valor — regra 15/11) deixam
      // de valer: o valor delas já não corresponde ao que se deve. É o único
      // ponto em que uma intenção vira SUBSTITUIDA; o Pix delas é cancelado no
      // gateway pela fila, depois da transação. Se o cliente pagar outra antes
      // do cancelamento, ela é aplicada normalmente (próxima fatura ou excedente).
      await tx.intencaoPagamento.update({ where: { id: intencao.id }, data: { situacao: 'PAGA', pagoEm: pagoEm ?? new Date(job.recebidoEm), valorRecebido: reais(job.valor) } });
      const outrasAtivas = await tx.intencaoPagamento.findMany({ where: { contaId, situacao: 'ATIVA', id: { not: intencao.id } }, select: { id: true, gatewayId: true } });
      if (outrasAtivas.length) await tx.intencaoPagamento.updateMany({ where: { id: { in: outrasAtivas.map((o) => o.id) } }, data: { situacao: 'SUBSTITUIDA' } });

      const resultado: ResultadoBaixa = baixas.length === 0 ? 'so_excedente' : excedente > 0 ? 'aplicado_com_excedente' : 'aplicado';
      return { resultado, baixas, excedente, contratos: [...contratosQuitados], outrasAtivas };
    }, { timeout: 30_000 });

    if (r.resultado === 'ja_aplicado') return { resultado: r.resultado, faturas: 0, excedente: 0 };

    // Acordo CUMPRIDO quando a última parcela do plano pagar (doc 02 §5.4).
    const cumpridos = await cumprirAcordosSePagos(this.prisma.db, r.contratos);
    if (cumpridos > 0) this.logger.log(`${cumpridos} acordo(s) CUMPRIDO(s) na baixa pela conta`);

    // Cancelamento no gateway das outras ativas: pela fila (repete se o gateway falhar).
    for (const o of r.outrasAtivas) await this.intencoes.enfileirarCancelamento(o.id, o.gatewayId);

    if (r.excedente > 0 || intencao.situacao !== 'ATIVA') {
      const titular = intencao.conta.titular;
      const partes: string[] = [];
      if (intencao.situacao !== 'ATIVA') partes.push(`o Pix era de um pedido que já não valia (${intencao.situacao === 'EXPIRADA' ? 'expirado' : intencao.situacao === 'SUBSTITUIDA' ? 'cancelado depois de outro pagamento' : 'já pago'}) e foi aceito mesmo assim`);
      if (r.excedente > 0) partes.push(`sobraram ${formatCurrency(r.excedente)} além do que a conta devia (registrado como excedente; ainda não vira crédito)`);
      await this.notificacao.emitir({
        titulo: `Pix de ${titular.nome} precisa de atenção`,
        corpo: `Recebemos ${formatCurrency(job.valor)}: ${partes.join('; ')}.`,
        rota: `/titulares/${titular.id}`,
        tipo: 'DINHEIRO',
        area: 'CARTEIRA_COBRANCA',
      });
    }
    return { resultado: r.resultado, faturas: r.baixas.length, excedente: r.excedente };
  }

  // Efeitos nas PARCELAS da fatura (os mesmos da conciliação antiga): a parcela
  // cujos itens zeraram é baixada (PAGA / PAGA_EM_ATRASO) e o recebível é
  // realizado; coberta em parte fica em aberto com o alocado registrado. O
  // encargo pago é rateado entre as parcelas pelo valor nominal — número
  // informativo do extrato; a verdade do encargo é a AlocacaoPagamento.
  // Devolve os contratos que tiveram parcela quitada.
  private async baixarParcelas(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    fatura: FaturaDaConta,
    baixa: BaixaFatura,
    saldoDoItem: (itemId: string) => number,
    dia: string,
    dataPagamento: Date,
  ): Promise<string[]> {
    const emAberto = fatura.parcelas.filter((p) => p.emAberto);
    if (emAberto.length === 0) return [];
    const encargoPago = baixa.alocacoes.filter((a) => a.alvo !== 'ITEM').reduce((s, a) => s + a.valor, 0);
    const rateio = new Map(
      imputarEmNiveis(encargoPago, emAberto.map((p) => ({ id: p.id, nivel: 1, saldo: p.valorNominal }))).alocacoes.map((a) => [a.id, a.alocado]),
    );
    const contratos: string[] = [];
    for (const p of emAberto) {
      const itens = fatura.itens.filter((it) => it.parcelaId === p.id);
      const alocadoItens = baixa.alocacoes.filter((a) => a.alvo === 'ITEM' && itens.some((it) => it.id === a.itemId)).reduce((s, a) => s + a.valor, 0);
      const encargo = rateio.get(p.id) ?? 0;
      // Parcela sem item próprio na fatura (legado) acompanha a quitação da fatura.
      const quitada = itens.length > 0 ? itens.every((it) => saldoDoItem(it.id) === 0) : baixa.quitouFatura;
      if (!quitada && alocadoItens === 0 && encargo === 0) continue;
      await tx.parcela.update({
        where: { id: p.id },
        data: {
          valorPago: reais(p.valorPago + alocadoItens + encargo),
          valorEncargo: reais(p.valorEncargo + encargo),
          ...(quitada ? { status: dia > p.vencimento ? 'PAGA_EM_ATRASO' : 'PAGA', dataPagamento } : {}),
        },
      });
      if (quitada) {
        await tx.recebivel.updateMany({ where: { parcelaId: p.id }, data: { status: 'REALIZADO', dataRealizada: dataPagamento, valorRealizado: reais(p.valorNominal) } });
        contratos.push(p.contratoId);
      }
    }
    return contratos;
  }
}
