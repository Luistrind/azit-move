import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  agregarVisaoCarteira,
  dataCalendarioUTC,
  dataHojeBrasil,
  diaBrasil,
  explicarMudancaDesdeFoto,
  FaturaAgora,
  FaturaFoto,
  FUSO_NEGOCIO,
  GrupoMudancaFoto,
  ItemFaturaVisao,
  periodoDoMes,
  ResumoEstado,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CarteiraVisaoService } from './carteira-visao.service';

// Foto do início do mês da Carteira (doc 02 §27.12, decisão Luís 27/11/2026):
// UMA por mês, no dia 1 à 0h (America/Sao_Paulo, Regra 15), com nova tentativa
// às 6h. Guarda fatura a fatura o que vence no mês, como estava naquele momento.
// A comparação (`comparar`) roda a MESMA agregação da tela sobre a foto e a
// ponte única de `@azit/utils` (Regra 16) entre a foto e agora.

export interface ContaMudancaNomeada { contaId: string; titularId: string; titular: string; valor: number; faturas: number }
export interface ComparacaoFoto {
  mes: string;
  foto: null | {
    tiradaEm: string; // ISO
    inicio: { teto: ResumoEstado; porProduto: { chave: string; rotulo: string; teto: number }[] };
    ponte: {
      tetoFoto: number;
      tetoAgora: number;
      diferenca: number;
      grupos: (Omit<GrupoMudancaFoto, 'contas'> & { contas: ContaMudancaNomeada[] })[];
    };
  };
}

@Injectable()
export class FotoCarteiraService {
  private readonly logger = new Logger(FotoCarteiraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly visao: CarteiraVisaoService,
  ) {}

  private cent(v: unknown): number {
    return Math.round(Number(v?.toString() ?? '0') * 100);
  }

  private reais(c: number): string {
    return (c / 100).toFixed(2);
  }

  // Dia 1 à 0h05 e, se não rodou, às 6h — idempotente pelo mês (única por mês).
  @Cron('5 0 1 * *', { timeZone: FUSO_NEGOCIO })
  async cronFoto(): Promise<void> {
    await this.tirarAgendada();
  }

  @Cron('0 6 1 * *', { timeZone: FUSO_NEGOCIO })
  async cronFotoRetry(): Promise<void> {
    await this.tirarAgendada();
  }

  private async tirarAgendada(): Promise<void> {
    const mes = dataHojeBrasil().slice(0, 7);
    try {
      const r = await this.tirarFoto(mes);
      if (r.criada) this.logger.log(`[cron] foto da carteira de ${mes}: ${r.faturas} fatura(s)`);
    } catch (e) {
      this.logger.error(`[cron] foto da carteira de ${mes} falhou: ${(e as Error).message}`);
    }
  }

  // Tira a foto do mês (YYYY-MM). Já existe → não mexe (é foto). `refazer` só
  // pela ferramenta de teste fora de produção.
  async tirarFoto(mes: string, opts: { refazer?: boolean } = {}): Promise<{ criada: boolean; faturas: number; tiradaEm: string }> {
    const existente = await this.prisma.db.fotoCarteira.findUnique({ where: { mes }, include: { _count: { select: { faturas: true } } } });
    if (existente && !opts.refazer) return { criada: false, faturas: existente._count.faturas, tiradaEm: existente.tiradaEm.toISOString() };
    if (existente) await this.prisma.db.fotoCarteira.delete({ where: { mes } });

    const { de, ate } = periodoDoMes(mes);
    const faturas = await this.visao.faturasDoPeriodo(de, ate);
    try {
      const foto = await this.prisma.db.fotoCarteira.create({
        data: {
          mes,
          faturas: {
            create: faturas.map((f) => ({
              faturaId: f.id,
              contaId: f.contaId,
              status: f.status,
              vencimento: new Date(`${f.vencimento}T00:00:00.000Z`),
              valorTotal: this.reais(f.valorTotal),
              valorPago: f.valorPago == null ? null : this.reais(f.valorPago),
              itens: f.itens as unknown as Prisma.InputJsonValue,
            })),
          },
        },
      });
      return { criada: true, faturas: faturas.length, tiradaEm: foto.tiradaEm.toISOString() };
    } catch (e) {
      // Outra réplica tirou a foto no mesmo instante.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const f = await this.prisma.db.fotoCarteira.findUnique({ where: { mes }, include: { _count: { select: { faturas: true } } } });
        return { criada: false, faturas: f?._count.faturas ?? 0, tiradaEm: f?.tiradaEm.toISOString() ?? new Date().toISOString() };
      }
      throw e;
    }
  }

  async comparar(mes: string): Promise<ComparacaoFoto> {
    const foto = await this.prisma.db.fotoCarteira.findUnique({ where: { mes }, include: { faturas: true } });
    if (!foto) return { mes, foto: null };

    const { de, ate } = periodoDoMes(mes);
    const doFoto: FaturaFoto[] = foto.faturas.map((f) => ({
      id: f.faturaId,
      contaId: f.contaId,
      status: f.status,
      vencimento: dataCalendarioUTC(f.vencimento),
      valorTotal: this.cent(f.valorTotal),
      valorPago: f.valorPago == null ? null : this.cent(f.valorPago),
      itens: (f.itens as unknown as ItemFaturaVisao[]) ?? [],
    }));

    const doMes = await this.visao.faturasDoPeriodo(de, ate);
    const ids = new Set(doMes.map((f) => f.id));
    const sairam = await this.visao.faturasPorIds(doFoto.map((f) => f.id).filter((id) => !ids.has(id)));
    const atuais = [...doMes, ...sairam];
    const agora: FaturaAgora[] = atuais.map((f) => ({ ...f, noMes: f.vencimento >= de && f.vencimento <= ate }));

    // O dia da foto no fuso do negócio (dia 1; na ferramenta de teste, o dia em que foi tirada).
    const diaFoto = diaBrasil(foto.tiradaEm);
    const ponte = explicarMudancaDesdeFoto(doFoto, agora, foto.tiradaEm.toISOString(), diaFoto, dataHojeBrasil());
    const inicio = agregarVisaoCarteira(doFoto, diaFoto);

    // Nomes: das faturas de agora; quem só aparece na foto (fatura removida), pela conta.
    const quem = new Map(atuais.map((f) => [f.contaId, { titularId: f.titularId, titular: f.titular }]));
    const faltam = [...new Set(ponte.grupos.flatMap((g) => g.contas.map((c) => c.contaId)))].filter((id) => !quem.has(id));
    if (faltam.length) {
      const contas = await this.prisma.db.conta.findMany({ where: { id: { in: faltam } }, select: { id: true, titularId: true, titular: { select: { nome: true } } } });
      for (const c of contas) quem.set(c.id, { titularId: c.titularId, titular: c.titular.nome });
    }

    return {
      mes,
      foto: {
        tiradaEm: foto.tiradaEm.toISOString(),
        inicio: {
          teto: inicio.teto,
          porProduto: inicio.porProduto.filter((p) => p.teto).map((p) => ({ chave: p.chave, rotulo: p.rotulo, teto: p.teto })),
        },
        ponte: {
          ...ponte,
          grupos: ponte.grupos.map((g) => ({
            ...g,
            contas: g.contas.map((c) => ({ ...c, titularId: quem.get(c.contaId)?.titularId ?? '', titular: quem.get(c.contaId)?.titular ?? '—' })),
          })),
        },
      },
    };
  }
}
