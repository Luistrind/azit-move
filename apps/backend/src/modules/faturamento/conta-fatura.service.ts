import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  dataCalendarioUTC,
  dataHojeBrasil,
  projetarConta,
  reconstituirFatura,
  saldoNominal,
  saldosPorItem,
  somarDiasISO,
  inicioDiaUTC,
  type AlocacaoMotor,
  type ContaProjetada,
  type FaturaMotor,
  type ItemMotor,
  type ParametrosMotorFatura,
  type SaldoItemFatura,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { tiposDosContratos } from '../contrato/tipo-contrato';
import { apresentarItemFatura, contratosDosItens, INCLUDE_ITEM_FATURA, type ItemFaturaApresentado } from './itens-fatura';
import { parametrosFaturamentoVigentes } from './parametros-faturamento.service';

const cent = (d: Prisma.Decimal | null | undefined): number => (d ? Math.round(Number(d.toString()) * 100) : 0);
const num = (d: Prisma.Decimal): number => Number(d.toString());

// Cliente do banco OU transação — a baixa carrega a conta dentro da transação
// que a trava; a página e a ficha, fora.
// Assinatura relaxada de propósito: o cliente estendido do Prisma e o cliente
// de transação não são estruturalmente atribuíveis um ao outro.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbFaturamento = any;

const INCLUDE_FATURA_CONTA = {
  itensFatura: { orderBy: { createdAt: 'asc' }, include: INCLUDE_ITEM_FATURA },
  parcelas: { select: { id: true, contratoId: true, valorNominal: true, dataVencimento: true, status: true, valorPago: true, valorEncargo: true } },
  pagamentos: { orderBy: [{ dataPagamento: 'asc' }, { createdAt: 'asc' }], include: { alocacoes: true } },
} satisfies Prisma.FaturaInclude;

type FaturaCarregada = Prisma.FaturaGetPayload<{ include: typeof INCLUDE_FATURA_CONTA }>;

export interface PagamentoDaFatura {
  id: string;
  data: string; // YYYY-MM-DD
  pagoEm: Date | null;
  valor: number;
  valorExcedente: number;
  origem: 'GATEWAY' | 'CONFERENCIA' | 'SINISTRO';
  gatewayPaymentId: string | null;
  identificadorPix: string | null;
  intencaoId: string | null;
  alocacoes: AlocacaoMotor[];
}

export interface FaturaDaConta {
  id: string;
  numero: number;
  tokenPublico: string | null;
  status: string;
  vencimento: string; // YYYY-MM-DD
  dataPagamento: Date | null;
  itens: ItemFaturaApresentado[];
  valorPago: number; // acumulado gravado na fatura (centavos)
  parcelas: { id: string; contratoId: string; valorNominal: number; vencimento: string; emAberto: boolean; valorPago: number; valorEncargo: number }[];
  pagamentos: PagamentoDaFatura[];
  motor: FaturaMotor;
}

export interface ContaCarregada {
  contaId: string;
  titular: { id: string; nome: string; cpfCnpj: string };
  // Faturas do modelo AZIT: as em aberto (FECHADA) + as pagas recentes.
  faturas: FaturaDaConta[];
  // Faturas em aberto do modelo ANTIGO (cobrança própria no Asaas). Havendo
  // alguma, a conta é MISTA (§32.4-A, regra provisória).
  abertasModeloAntigo: { id: string; numero: number; vencimento: string; valor: number; tokenPublico: string | null }[];
  parametros: ParametrosMotorFatura & { multaPadraoPct: number; atualizacaoMesPadraoPct: number; tetoIntencoesDia: number };
}

// Saldo do MOTOR de uma parcela que está numa fatura AZIT em aberto (doc 02
// §32.12 item 12): o que acordo, novação, rescisão e sinistro usam no lugar de
// "nominal cheio + encargo desde o vencimento".
export interface SaldoParcelaAzit {
  parcelaId: string;
  faturaId: string;
  faturaNumero: number;
  face: number; // soma dos itens da parcela (= nominal da parcela)
  saldoNominal: number; // o que falta do valor de face
  saldoProtecao: number; // parte do saldo que é Proteção veicular
  multa: number;
  atualizacao: number;
  encargo: number; // multa + atualizacao atribuídas à parcela
  total: number; // saldoNominal + encargo
  principalPago: number; // já alocado nos itens da parcela, SEM a proteção
  itens: SaldoItemFatura[];
}

export interface SaldoItemSemParcelaAzit extends SaldoItemFatura {
  faturaId: string;
  faturaNumero: number;
  titulo: string;
}

export interface SaldosAzitDaConta {
  // Faturas AZIT FECHADAS (em aberto) da conta.
  faturaIds: Set<string>;
  porParcela: Map<string, SaldoParcelaAzit>;
  // Itens sem parcela (serviço recorrente, intermediária) dessas faturas.
  semParcela: SaldoItemSemParcelaAzit[];
}

// Janela (dias) em que uma fatura AZIT já paga ainda acompanha a conta na
// página do cliente — para "Recebemos R$ X" e o comprovante logo depois do
// pagamento. Apresentação, não regra de negócio.
const DIAS_PAGAS_RECENTES = 7;

// Carrega as faturas do modelo AZIT de uma conta no formato do motor de
// `@azit/utils` (doc 02 §32.4-A: "refazer a conta sobre os itens da fatura e os
// pagamentos registrados"). É o ÚNICO lugar que traduz banco → motor: página
// pública, intenção de pagamento, baixa do webhook e ficha do titular leem daqui.
@Injectable()
export class ContaFaturaService {
  constructor(private readonly prisma: PrismaService) {}

  async carregar(contaId: string, opts: { incluirFaturaId?: string; db?: DbFaturamento } = {}): Promise<ContaCarregada> {
    const db: PrismaService['db'] = opts.db ?? this.prisma.db;
    const hoje = dataHojeBrasil();
    const desde = inicioDiaUTC(somarDiasISO(hoje, -DIAS_PAGAS_RECENTES));
    const [conta, faturas, antigas, vigentes] = await Promise.all([
      db.conta.findFirst({ where: { id: contaId }, select: { id: true, titular: { select: { id: true, nome: true, cpfCnpj: true } } } }),
      db.fatura.findMany({
        where: {
          contaId,
          modeloEncargo: 'AZIT',
          deletedAt: null,
          OR: [
            { status: 'FECHADA' },
            { status: { in: ['PAGA', 'PAGA_EM_ATRASO'] }, dataPagamento: { gte: desde } },
            ...(opts.incluirFaturaId ? [{ id: opts.incluirFaturaId, status: { in: ['PAGA', 'PAGA_EM_ATRASO'] as ('PAGA' | 'PAGA_EM_ATRASO')[] } }] : []),
          ],
        },
        orderBy: [{ dataVencimento: 'asc' }, { numero: 'asc' }],
        include: INCLUDE_FATURA_CONTA,
      }),
      db.fatura.findMany({
        where: { contaId, modeloEncargo: 'ASAAS_NATIVO', status: 'FECHADA', deletedAt: null },
        orderBy: { dataVencimento: 'asc' },
        select: { id: true, numero: true, dataVencimento: true, valorTotal: true, tokenPublico: true },
      }),
      parametrosFaturamentoVigentes(db),
    ]);
    if (!conta) throw new Error(`Conta ${contaId} não encontrada`);

    const todosItens = faturas.flatMap((f) => f.itensFatura);
    const tipos = await tiposDosContratos(db, [...contratosDosItens(todosItens).values()]);
    const padrao = { multaPct: vigentes.multaPadraoPct, atualizacaoMesPct: vigentes.atualizacaoMesPadraoPct };

    return {
      contaId,
      titular: conta.titular,
      faturas: faturas.map((f) => this.montar(f, tipos, padrao)).filter((f) => this.coerente(f)),
      abertasModeloAntigo: antigas.map((a) => ({ id: a.id, numero: a.numero, vencimento: dataCalendarioUTC(a.dataVencimento), valor: cent(a.valorTotal), tokenPublico: a.tokenPublico })),
      parametros: {
        cascata: vigentes.cascata,
        minimoParcialPct: vigentes.minimoParcialPct,
        minimoParcialPiso: vigentes.minimoParcialPiso,
        multaPadraoPct: vigentes.multaPadraoPct,
        atualizacaoMesPadraoPct: vigentes.atualizacaoMesPadraoPct,
        tetoIntencoesDia: vigentes.tetoIntencoesDia,
      },
    };
  }

  // Saldo do motor POR PARCELA das faturas AZIT em aberto da conta, na data
  // pedida (hoje, ou a data-base de uma rescisão). UMA leitura para os fluxos
  // que olham a dívida por parcela — a conta é a do motor (`saldosPorItem`).
  async saldosEmAberto(contaId: string, data: string = dataHojeBrasil(), db?: DbFaturamento): Promise<SaldosAzitDaConta> {
    const conta = await this.carregar(contaId, { db });
    const r: SaldosAzitDaConta = { faturaIds: new Set(), porParcela: new Map(), semParcela: [] };
    for (const f of conta.faturas) {
      if (f.status !== 'FECHADA') continue;
      r.faturaIds.add(f.id);
      const saldos = saldosPorItem(f.motor, data);
      for (const s of saldos.itens) {
        const item = f.itens.find((i) => i.id === s.itemId);
        if (!item?.parcelaId) {
          if (item) r.semParcela.push({ ...s, faturaId: f.id, faturaNumero: f.numero, titulo: item.titulo });
          continue;
        }
        const p: SaldoParcelaAzit = r.porParcela.get(item.parcelaId) ?? {
          parcelaId: item.parcelaId, faturaId: f.id, faturaNumero: f.numero,
          face: 0, saldoNominal: 0, saldoProtecao: 0, multa: 0, atualizacao: 0, encargo: 0, total: 0, principalPago: 0, itens: [],
        };
        p.face += s.face;
        p.saldoNominal += s.saldo;
        if (s.grupo === 'PROTECAO') p.saldoProtecao += s.saldo;
        else p.principalPago += s.pago;
        p.multa += s.multa;
        p.atualizacao += s.atualizacao;
        p.encargo = p.multa + p.atualizacao;
        p.total = p.saldoNominal + p.encargo;
        p.itens.push(s);
        r.porParcela.set(item.parcelaId, p);
      }
    }
    return r;
  }

  // Fatura que o BANCO diz paga mas que, pelos pagamentos registrados, o motor
  // ainda vê em aberto (baixada por um caminho antigo que marcava PAGA sem
  // registrar o pagamento) NÃO entra na conta: senão reapareceria em aberto na
  // página do cliente e ele poderia gerar Pix de uma fatura já quitada.
  private readonly logger = new Logger(ContaFaturaService.name);
  private coerente(f: FaturaDaConta): boolean {
    if (f.status === 'FECHADA') return true;
    const e = reconstituirFatura(f.motor);
    const quitadaNoMotor = saldoNominal(e) === 0 && e.pendente.multa === 0 && e.pendente.atualizacao === 0;
    if (!quitadaNoMotor) this.logger.warn(`Fatura ${f.id} (#${f.numero}) está ${f.status} sem os pagamentos que a quitam — fora da conta do Pix sob demanda`);
    return quitadaNoMotor;
  }

  // Projeção do dia (saldo, encargo, situação, acumulado, seleção padrão).
  projetar(conta: ContaCarregada, hoje: string = dataHojeBrasil()): ContaProjetada {
    return projetarConta(conta.faturas.map((f) => f.motor), hoje, [], conta.parametros.cascata);
  }

  private montar(
    f: FaturaCarregada,
    tipos: Awaited<ReturnType<typeof tiposDosContratos>>,
    padrao: { multaPct: number; atualizacaoMesPct: number },
  ): FaturaDaConta {
    const itens = f.itensFatura.map((it) => apresentarItemFatura(it, tipos));
    // Percentuais do CONTRATO do item (§32.4). Item sem parcela (serviço
    // recorrente, intermediária) segue o primeiro contrato da fatura; fatura
    // sem contrato nenhum usa o padrão de Configurações › Faturamento.
    const taxaDoContrato = (c: { taxaMultaAtraso: Prisma.Decimal; taxaJurosAtraso: Prisma.Decimal } | null | undefined) =>
      c ? { multaPct: num(c.taxaMultaAtraso), atualizacaoMesPct: num(c.taxaJurosAtraso) } : null;
    const primeira = taxaDoContrato(f.itensFatura.find((it) => it.parcela)?.parcela?.itemContratado.contrato) ?? padrao;
    let itensMotor: ItemMotor[] = f.itensFatura.map((it, i) => {
      const taxa = taxaDoContrato(it.parcela?.itemContratado.contrato) ?? primeira;
      return { id: it.id, grupo: itens[i].grupo, valor: itens[i].valor, multaPct: taxa.multaPct, atualizacaoMesPct: taxa.atualizacaoMesPct };
    });
    // Fatura sem itens gravados (não deveria existir no modelo AZIT): o total
    // vira um item único de Principal, para o saldo nunca aparecer zerado.
    if (itensMotor.length === 0 && cent(f.valorTotal) > 0) {
      itensMotor = [{ id: `fatura:${f.id}`, grupo: 'PRINCIPAL', valor: cent(f.valorTotal), multaPct: padrao.multaPct, atualizacaoMesPct: padrao.atualizacaoMesPct }];
    }
    const pagamentos: PagamentoDaFatura[] = f.pagamentos.map((p) => ({
      id: p.id,
      data: dataCalendarioUTC(p.dataPagamento),
      pagoEm: p.pagoEm,
      valor: cent(p.valor),
      valorExcedente: cent(p.valorExcedente),
      origem: p.origem,
      gatewayPaymentId: p.gatewayPaymentId,
      identificadorPix: p.identificadorPix,
      intencaoId: p.intencaoId,
      alocacoes: p.alocacoes.map((a) => ({
        alvo: a.tipoEncargo === 'MULTA' ? 'MULTA' : a.tipoEncargo === 'ATUALIZACAO' ? 'ATUALIZACAO' : 'ITEM',
        itemId: a.tipoEncargo ? null : a.itemFaturaId,
        valor: cent(a.valor),
        nivel: a.nivel,
        quitou: a.quitou,
      })),
    }));
    const vencimento = dataCalendarioUTC(f.dataVencimento);
    return {
      id: f.id,
      numero: f.numero,
      tokenPublico: f.tokenPublico,
      status: f.status,
      vencimento,
      dataPagamento: f.dataPagamento,
      itens,
      valorPago: cent(f.valorPago),
      parcelas: f.parcelas.map((p) => ({
        id: p.id,
        contratoId: p.contratoId,
        valorNominal: cent(p.valorNominal),
        vencimento: dataCalendarioUTC(p.dataVencimento),
        emAberto: p.status === null,
        valorPago: cent(p.valorPago),
        valorEncargo: cent(p.valorEncargo),
      })),
      pagamentos,
      motor: {
        id: f.id,
        vencimento,
        itens: itensMotor,
        // Pagamento com valor zero é só registro de excedente (conta sem nada em
        // aberto): não entra na conta da fatura.
        pagamentos: pagamentos.filter((p) => p.valor > 0).map((p) => ({ data: p.data, valor: p.valor, alocacoes: p.alocacoes })),
      },
    };
  }
}
