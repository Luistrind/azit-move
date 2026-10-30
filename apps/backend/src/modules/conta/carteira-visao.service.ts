import { Injectable } from '@nestjs/common';
import {
  agregarVisaoCarteira,
  agregarVisaoMensal,
  dataCalendarioUTC,
  dataHojeBrasil,
  estadoFaturaVisao,
  inicioDiaUTC,
  somarDiasISO,
  FaturaVisao,
  RecebimentoVisao,
  VisaoCarteira,
  VisaoMensal,
  TipoContrato,
} from '@azit/utils';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SELECT_TIPO_CONTRATO, tiposDosContratos } from '../contrato/tipo-contrato';
import { EstadoVisaoQuery } from './dto/visao-carteira.dto';

// Visão da carteira por período (doc 02 §27, decisão Luís 30/10/2026).
// Este service só CARREGA (a) as faturas do período por VENCIMENTO, com o
// contexto de produto (item → parcela → item contratado → contrato), e (b) os
// RECEBIMENTOS do período por DATA DE PAGAMENTO — faturas pagas de qualquer
// vencimento + entradas de contrato/acordo (lançamentos da conta) — e entrega
// tudo à agregação única em @azit/utils (`agregarVisaoCarteira`, Regra 16).
// Cartões, por produto, mês a mês, comparação e lista de clientes saem daqui —
// nenhuma tela refaz.

export interface VisaoPeriodo extends VisaoCarteira {
  periodo: { de: string; ate: string };
  hoje: string;
}

export interface ClienteVisao {
  contaId: string;
  titularId: string;
  titular: string;
  valor: number; // centavos no estado, dentro do período (recebidas: o que entrou)
  faturas: number; // recebidas: recebimentos (faturas + entradas)
  maisAntiga: string; // YYYY-MM-DD — vencimento mais antigo no estado (recebidas: primeiro pagamento)
  ultimoPagamento?: string; // YYYY-MM-DD — só em recebidas
  bloqueada: boolean;
}

interface Conta {
  contaId: string;
  titularId: string;
  titular: string;
  bloqueada: boolean;
}

type FaturaCarregada = FaturaVisao & Conta & { dataPagamento: string | null };
type RecebimentoCarregado = RecebimentoVisao & Conta;

const SELECT_CONTA = {
  select: {
    titularId: true,
    titular: { select: { nome: true } },
    contratosCredito: { select: { veiculoBloqueadoEm: true } },
  },
} as const;

const SELECT_FATURA = {
  id: true,
  contaId: true,
  status: true,
  dataVencimento: true,
  dataPagamento: true,
  valorTotal: true,
  valorPago: true,
  conta: SELECT_CONTA,
  itensFatura: {
    select: {
      tipo: true,
      descricao: true,
      valor: true,
      parcela: {
        select: {
          itemContratado: { select: { origem: true, contrato: { select: SELECT_TIPO_CONTRATO } } },
        },
      },
    },
  },
} satisfies Prisma.FaturaSelect;

type FaturaRow = Prisma.FaturaGetPayload<{ select: typeof SELECT_FATURA }>;

@Injectable()
export class CarteiraVisaoService {
  constructor(private readonly prisma: PrismaService) {}

  private cent(v: unknown): number {
    return Math.round(Number(v?.toString() ?? '0') * 100);
  }

  async visao(de: string, ate: string): Promise<VisaoPeriodo> {
    const hoje = dataHojeBrasil();
    const [faturas, recebimentos] = await Promise.all([this.carregarFaturas(de, ate), this.carregarRecebimentos(de, ate)]);
    return { ...agregarVisaoCarteira(faturas, hoje, { recebimentos, periodo: { de, ate } }), periodo: { de, ate }, hoje };
  }

  // Mês a mês entre dois meses (YYYY-MM, inclusivos). Meses sem nada não vêm.
  async mensal(deMes: string, ateMes: string): Promise<VisaoMensal[]> {
    const hoje = dataHojeBrasil();
    const de = `${deMes}-01`;
    const [y, m] = ateMes.split('-').map(Number);
    const ate = somarDiasISO(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
    const [faturas, recebimentos] = await Promise.all([this.carregarFaturas(de, ate), this.carregarRecebimentos(de, ate)]);
    return agregarVisaoMensal(faturas, hoje, recebimentos);
  }

  // Clientes atrás de um cartão. Vencidas/a vencer: quem tem fatura naquele estado
  // com vencimento no período. Recebidas: quem PAGOU no período (caixa), de
  // qualquer vencimento — faturas e entradas.
  async clientes(de: string, ate: string, estado: EstadoVisaoQuery): Promise<ClienteVisao[]> {
    const hoje = dataHojeBrasil();
    const porConta = new Map<string, ClienteVisao>();
    const abrir = (c: Conta, data: string): ClienteVisao =>
      porConta.get(c.contaId) ?? { contaId: c.contaId, titularId: c.titularId, titular: c.titular, valor: 0, faturas: 0, maisAntiga: data, bloqueada: c.bloqueada };

    if (estado === 'recebidas') {
      for (const r of await this.carregarRecebimentos(de, ate)) {
        const c = abrir(r, r.dataPagamento);
        c.valor += r.valor;
        c.faturas += 1;
        if (r.dataPagamento < c.maisAntiga) c.maisAntiga = r.dataPagamento;
        if (!c.ultimoPagamento || r.dataPagamento > c.ultimoPagamento) c.ultimoPagamento = r.dataPagamento;
        porConta.set(c.contaId, c);
      }
      return [...porConta.values()].sort((a, b) => a.titular.localeCompare(b.titular, 'pt-BR'));
    }

    const alvo = estado === 'vencidas' ? 'vencida' : 'a_vencer';
    for (const f of await this.carregarFaturas(de, ate)) {
      if (estadoFaturaVisao(f.status, f.vencimento, hoje) !== alvo) continue;
      const c = abrir(f, f.vencimento);
      c.valor += f.valorTotal;
      c.faturas += 1;
      if (f.vencimento < c.maisAntiga) c.maisAntiga = f.vencimento;
      porConta.set(c.contaId, c);
    }
    // Vencidas: maior valor primeiro (quem mais pesa); demais, por nome.
    return [...porConta.values()].sort((a, b) =>
      estado === 'vencidas' ? b.valor - a.valor : a.titular.localeCompare(b.titular, 'pt-BR'),
    );
  }

  // Colunas de DATA (vencimento, pagamento) guardam meia-noite UTC do dia (03:00Z
  // nas gravadas em hora local) — por isso o intervalo vai de 00:00Z de `de` até
  // antes de 00:00Z do dia seguinte a `ate`, e o dia sai de `dataCalendarioUTC`,
  // nunca de aritmética local (Regra 15).
  private janela(de: string, ate: string) {
    return { gte: inicioDiaUTC(de), lt: inicioDiaUTC(somarDiasISO(ate, 1)) };
  }

  // Faturas cujo VENCIMENTO cai em [de, ate] — teto, pagas, vencidas, a vencer.
  private async carregarFaturas(de: string, ate: string): Promise<FaturaCarregada[]> {
    const rows = await this.prisma.db.fatura.findMany({
      where: { deletedAt: null, dataVencimento: this.janela(de, ate) },
      select: SELECT_FATURA,
    });
    return this.mapearFaturas(rows);
  }

  // Caixa: faturas PAGAS em [de, ate] (qualquer vencimento) + entradas de
  // contrato/acordo lançadas na conta com pagamento em [de, ate].
  private async carregarRecebimentos(de: string, ate: string): Promise<RecebimentoCarregado[]> {
    const [faturas, lancamentos] = await Promise.all([
      this.prisma.db.fatura.findMany({
        where: { deletedAt: null, status: { in: ['PAGA', 'PAGA_EM_ATRASO'] }, dataPagamento: this.janela(de, ate) },
        select: SELECT_FATURA,
      }),
      this.prisma.db.lancamentoConta.findMany({
        where: { dataPagamento: this.janela(de, ate) },
        select: { contaId: true, tipo: true, valor: true, dataPagamento: true, conta: SELECT_CONTA },
      }),
    ]);
    const pagas = await this.mapearFaturas(faturas);
    const recs: RecebimentoCarregado[] = pagas.map((f) => ({
      contaId: f.contaId, titularId: f.titularId, titular: f.titular, bloqueada: f.bloqueada,
      origem: 'fatura',
      dataPagamento: f.dataPagamento ?? f.vencimento,
      valor: f.valorPago ?? f.valorTotal,
      vencimento: f.vencimento,
      valorTotal: f.valorTotal,
      itens: f.itens,
    }));
    for (const l of lancamentos) {
      recs.push({
        contaId: l.contaId,
        titularId: l.conta.titularId,
        titular: l.conta.titular.nome,
        bloqueada: l.conta.contratosCredito.some((c) => c.veiculoBloqueadoEm !== null),
        origem: l.tipo === 'ENTRADA_ACORDO' ? 'entrada_acordo' : 'entrada_contrato',
        dataPagamento: dataCalendarioUTC(l.dataPagamento),
        valor: this.cent(l.valor),
      });
    }
    return recs;
  }

  private async mapearFaturas(rows: FaturaRow[]): Promise<FaturaCarregada[]> {
    // Tipo de cada contrato envolvido — uma classificação por contrato, não por item.
    const contratos = new Map<string, Parameters<typeof tiposDosContratos>[1][number]>();
    for (const f of rows) for (const it of f.itensFatura) {
      const c = it.parcela?.itemContratado.contrato;
      if (c && !contratos.has(c.id)) contratos.set(c.id, c);
    }
    const tipos: Map<string, TipoContrato> = await tiposDosContratos(this.prisma.db, [...contratos.values()]);

    return rows.map((f) => ({
      contaId: f.contaId,
      titularId: f.conta.titularId,
      titular: f.conta.titular.nome,
      bloqueada: f.conta.contratosCredito.some((c) => c.veiculoBloqueadoEm !== null),
      status: f.status,
      vencimento: dataCalendarioUTC(f.dataVencimento),
      dataPagamento: f.dataPagamento ? dataCalendarioUTC(f.dataPagamento) : null,
      valorTotal: this.cent(f.valorTotal),
      valorPago: f.valorPago === null ? null : this.cent(f.valorPago),
      itens: f.itensFatura.map((it) => ({
        tipo: it.tipo,
        descricao: it.descricao,
        valor: this.cent(it.valor),
        origemItem: it.parcela?.itemContratado.origem ?? null,
        tipoContrato: it.parcela ? (tipos.get(it.parcela.itemContratado.contrato.id) ?? null) : null,
      })),
    }));
  }
}
