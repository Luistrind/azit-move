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
  VisaoCarteira,
  VisaoMensal,
  TipoContrato,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { SELECT_TIPO_CONTRATO, tiposDosContratos } from '../contrato/tipo-contrato';
import { EstadoVisaoQuery } from './dto/visao-carteira.dto';

// Visão da carteira por período (doc 02 §27, decisão Luís 30/10/2026).
// Este service só CARREGA as faturas do período com o contexto de produto
// (item → parcela → item contratado → contrato) e entrega à agregação única
// em @azit/utils (`agregarVisaoCarteira`, Regra 16). Cartões, por produto,
// mês a mês, comparação e lista de clientes saem daqui — nenhuma tela refaz.

export interface VisaoPeriodo extends VisaoCarteira {
  periodo: { de: string; ate: string };
  hoje: string;
}

export interface ClienteVisao {
  contaId: string;
  titularId: string;
  titular: string;
  valor: number; // centavos das faturas no estado, dentro do período
  faturas: number;
  maisAntiga: string; // YYYY-MM-DD — vencimento mais antigo no estado
  bloqueada: boolean;
}

type FaturaCarregada = FaturaVisao & {
  titularId: string;
  titular: string;
  bloqueada: boolean;
};

@Injectable()
export class CarteiraVisaoService {
  constructor(private readonly prisma: PrismaService) {}

  private cent(v: unknown): number {
    return Math.round(Number(v?.toString() ?? '0') * 100);
  }

  async visao(de: string, ate: string): Promise<VisaoPeriodo> {
    const hoje = dataHojeBrasil();
    const faturas = await this.carregarFaturas(de, ate);
    return { ...agregarVisaoCarteira(faturas, hoje), periodo: { de, ate }, hoje };
  }

  // Mês a mês entre dois meses (YYYY-MM, inclusivos). Meses sem fatura não vêm.
  async mensal(deMes: string, ateMes: string): Promise<VisaoMensal[]> {
    const hoje = dataHojeBrasil();
    const de = `${deMes}-01`;
    const [y, m] = ateMes.split('-').map(Number);
    const ate = somarDiasISO(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
    const faturas = await this.carregarFaturas(de, ate);
    return agregarVisaoMensal(faturas, hoje);
  }

  // Clientes atrás de um cartão: quem tem fatura naquele estado dentro do período.
  async clientes(de: string, ate: string, estado: EstadoVisaoQuery): Promise<ClienteVisao[]> {
    const hoje = dataHojeBrasil();
    const alvo = estado === 'recebidas' ? 'recebida' : estado === 'vencidas' ? 'vencida' : 'a_vencer';
    const faturas = await this.carregarFaturas(de, ate);
    const porConta = new Map<string, ClienteVisao>();
    for (const f of faturas) {
      if (estadoFaturaVisao(f.status, f.vencimento, hoje) !== alvo) continue;
      const c = porConta.get(f.contaId) ?? {
        contaId: f.contaId,
        titularId: f.titularId,
        titular: f.titular,
        valor: 0,
        faturas: 0,
        maisAntiga: f.vencimento,
        bloqueada: f.bloqueada,
      };
      c.valor += f.valorTotal;
      c.faturas += 1;
      if (f.vencimento < c.maisAntiga) c.maisAntiga = f.vencimento;
      porConta.set(f.contaId, c);
    }
    // Vencidas: maior valor primeiro (quem mais pesa); demais, por nome.
    return [...porConta.values()].sort((a, b) =>
      estado === 'vencidas' ? b.valor - a.valor : a.titular.localeCompare(b.titular, 'pt-BR'),
    );
  }

  // Faturas cujo vencimento (data-calendário) cai em [de, ate]. A coluna guarda
  // meia-noite UTC do dia (03:00Z nas gravadas em hora local) — por isso o
  // intervalo vai de 00:00Z de `de` até antes de 00:00Z do dia seguinte a `ate`,
  // e o dia da fatura sai de `dataCalendarioUTC`, nunca de aritmética local.
  private async carregarFaturas(de: string, ate: string): Promise<FaturaCarregada[]> {
    const rows = await this.prisma.db.fatura.findMany({
      where: {
        deletedAt: null,
        dataVencimento: { gte: inicioDiaUTC(de), lt: inicioDiaUTC(somarDiasISO(ate, 1)) },
      },
      select: {
        id: true,
        contaId: true,
        status: true,
        dataVencimento: true,
        valorTotal: true,
        valorPago: true,
        conta: {
          select: {
            titularId: true,
            titular: { select: { nome: true } },
            contratosCredito: { select: { veiculoBloqueadoEm: true } },
          },
        },
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
      },
    });

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
