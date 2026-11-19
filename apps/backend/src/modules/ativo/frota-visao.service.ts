import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StatusOcorrenciaVeiculo } from '@prisma/client';
import {
  bloqueioDisponivel,
  dataCalendarioUTC,
  diasAtrasoCalendario,
  inicioHojeBrasilUTC,
  percentualRetornado,
  situacaoDaConta,
  type SituacaoConta,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CentroCustoService } from '../centro-custo/centro-custo.service';
import { ativoParaApi, mapearAtivoEnums, type AtivoApi } from './ativo.mapper';

// ============================================================
// Frota e ficha do veículo (doc 02 §25.7, decisão Luís 19/11/2026 sobre o
// protótipo de 18/11). Tudo aqui é LEITURA calculada (Regra 7): situação do
// contrato, pendências abertas e retornos gerados não são gravados.
// ============================================================

const cent = (d: Prisma.Decimal | null | undefined): number => Math.round(Number(d?.toString() ?? '0') * 100);
const OCORRENCIAS_ABERTAS: StatusOcorrenciaVeiculo[] = ['REGISTRADA', 'EM_RECURSO', 'AGUARDANDO_COMPROVANTE'];
const STATUS_FILTRAVEIS = ['disponivel', 'reservado', 'em_contrato', 'transferido', 'recuperado', 'sinistrado'] as const;
export const FILTROS_FROTA = [...STATUS_FILTRAVEIS, 'com_pendencia'] as const;
export type FiltroFrota = (typeof FILTROS_FROTA)[number];

const INCLUDE_LISTA = {
  estruturaJuridica: { select: { id: true, nome: true } },
  reservadoProposta: { select: { id: true, titular: { select: { nome: true } } } },
  contratosCredito: {
    where: { status: 'ATIVO' as const, deletedAt: null },
    select: { id: true, numero: true, conta: { select: { titular: { select: { id: true, nome: true } } } } },
    take: 1,
  },
};

/** Situação do contrato ativo do veículo — mesma regra da carteira (situacaoDaConta), mais os dias. */
export interface SituacaoDoVeiculo {
  situacao: SituacaoConta;
  diasAtraso: number;
  bloqueioDisponivel: boolean;
  bloqueadoEm: string | null;
}

export interface PendenciasDoVeiculo {
  quantidade: number;
  valor: number; // centavos
  /** O prazo mais próximo entre as pendências abertas (vencimento, indicação de condutor ou comprovante). */
  proximoPrazo: { tipo: 'vencimento' | 'indicacao' | 'comprovante'; data: string } | null;
}

export interface RetornoDoVeiculo {
  investido: number; // aquisição + custos lançados
  recebido: number; // retornos gerados: entrada paga + parcelas pagas
  aReceber: number;
  percentual: number | null;
}

export interface LinhaFrota extends AtivoApi {
  contrato: ({ id: string; numero: string; contaId: string } & SituacaoDoVeiculo) | null;
  pendencias: PendenciasDoVeiculo;
  retorno: RetornoDoVeiculo;
}

@Injectable()
export class FrotaVisaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly centroCusto: CentroCustoService,
  ) {}

  private whereLista(f: { filtro?: FiltroFrota; busca?: string }): Prisma.AtivoWhereInput {
    // A frota é de VEÍCULOS: o ativo sintético do crédito avulso não entra (08/09).
    const where: Prisma.AtivoWhereInput = { tipo: 'VEICULO' };
    if (f.filtro === 'com_pendencia') {
      where.ocorrencias = { some: { deletedAt: null, status: { in: OCORRENCIAS_ABERTAS } } };
    } else if (f.filtro) {
      where.status = mapearAtivoEnums.statusParaPrisma(f.filtro);
    }
    if (f.busca?.trim()) {
      const b = f.busca.trim();
      const termo = b.replace(/[\s-]/g, '');
      where.OR = [
        { placa: { contains: termo, mode: 'insensitive' } },
        { chassi: { contains: termo, mode: 'insensitive' } },
        { descricao: { contains: b, mode: 'insensitive' } },
        { marca: { contains: b, mode: 'insensitive' } },
        { modelo: { contains: b, mode: 'insensitive' } },
        // Busca pelo cliente do contrato ativo ou pelo número do contrato.
        { contratosCredito: { some: { status: 'ATIVO', deletedAt: null, OR: [{ numero: { contains: b } }, { conta: { titular: { nome: { contains: b, mode: 'insensitive' } } } }] } } },
      ];
    }
    return where;
  }

  // ---------------- Lista ----------------

  async lista(f: { filtro?: FiltroFrota; busca?: string; offset: number; limit: number }) {
    const where = this.whereLista(f);
    const [total, ativos] = await Promise.all([
      this.prisma.db.ativo.count({ where }),
      this.prisma.db.ativo.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: f.offset,
        take: f.limit,
        include: INCLUDE_LISTA,
      }),
    ]);
    const ids = ativos.map((a) => a.id);
    const [situacoes, pendencias, retornos] = await Promise.all([
      this.situacoesDosContratos(ids),
      this.pendenciasDosAtivos(ids),
      this.retornosDosAtivos(ids),
    ]);
    const linhas: LinhaFrota[] = ativos.map((a) => ({
      ...ativoParaApi(a),
      contrato: situacoes.get(a.id) ?? null,
      pendencias: pendencias.get(a.id) ?? { quantidade: 0, valor: 0, proximoPrazo: null },
      retorno: retornos.get(a.id) ?? { investido: 0, recebido: 0, aReceber: 0, percentual: null },
    }));
    return { total, offset: f.offset, limit: f.limit, data: linhas };
  }

  // ---------------- Indicadores do topo ----------------

  async resumo() {
    const [porStatus, comPendencia, abertas, posicoes] = await Promise.all([
      this.prisma.db.ativo.groupBy({ by: ['status'], where: { tipo: 'VEICULO', deletedAt: null }, _count: { _all: true } }),
      this.prisma.db.ativo.count({
        where: { tipo: 'VEICULO', ocorrencias: { some: { deletedAt: null, status: { in: OCORRENCIAS_ABERTAS } } } },
      }),
      this.prisma.db.ocorrenciaVeiculo.findMany({
        where: { deletedAt: null, status: { in: OCORRENCIAS_ABERTAS }, ativo: { tipo: 'VEICULO', deletedAt: null } },
        select: { valor: true, valorComDesconto: true },
      }),
      this.centroCusto.posicaoDosAtivos(),
    ]);
    const contagem: Record<string, number> = {};
    for (const s of porStatus) contagem[s.status.toLowerCase()] = s._count._all;
    const investido = posicoes.reduce((s, p) => s + p.totalGasto, 0);
    const recebido = posicoes.reduce((s, p) => s + p.recebido, 0);
    return {
      total: Object.values(contagem).reduce((s, n) => s + n, 0),
      porStatus: contagem,
      comPendencia: { veiculos: comPendencia, ocorrencias: abertas.length, valor: abertas.reduce((s, o) => s + cent(o.valorComDesconto ?? o.valor), 0) },
      investido,
      recebido,
      percentual: percentualRetornado(recebido, investido),
    };
  }

  // ---------------- Ficha do veículo ----------------

  async ficha(id: string) {
    const ativo = await this.prisma.db.ativo.findFirst({
      where: { id },
      include: { ...INCLUDE_LISTA, ofertaFixa: { select: { id: true, nome: true } } },
    });
    if (!ativo) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Veículo não encontrado' });

    const [situacoes, pendencias, retornos, custos, ultimaObs] = await Promise.all([
      this.situacoesDosContratos([id]),
      this.pendenciasDosAtivos([id]),
      this.retornosDosAtivos([id]),
      this.centroCusto.detalheAtivo(id),
      this.prisma.db.logAuditoria.findFirst({
        where: { entidade: 'ativo', entidadeId: id, acao: 'ativo_observacao_alterada' },
        orderBy: { createdAt: 'desc' },
        select: { usuarioId: true, createdAt: true },
      }),
    ]);

    // "De onde veio" de cada custo: quem lançou, ou a multa que a Azit assumiu.
    const lancamentos = await this.prisma.db.lancamentoCustoAtivo.findMany({
      where: { id: { in: custos.lancamentos.map((l) => l.id) } },
      select: { id: true, criadoPor: true, ocorrencia: { select: { id: true, tipo: true, numeroAuto: true } } },
    });
    const idsUsuarios = [...new Set([...lancamentos.map((l) => l.criadoPor), ultimaObs?.usuarioId].filter((u): u is string => !!u))];
    const usuarios = idsUsuarios.length
      ? await this.prisma.db.usuario.findMany({ where: { id: { in: idsUsuarios } }, select: { id: true, nome: true } })
      : [];
    const nomeUsuario = new Map(usuarios.map((u) => [u.id, u.nome]));
    const origemLancamento = new Map(
      lancamentos.map((l) => [
        l.id,
        l.ocorrencia
          ? { tipo: 'ocorrencia' as const, ocorrenciaId: l.ocorrencia.id, rotulo: `assumida pela Azit${l.ocorrencia.numeroAuto ? ` · ${l.ocorrencia.numeroAuto}` : ''}` }
          : { tipo: 'manual' as const, ocorrenciaId: null, rotulo: l.criadoPor ? `lançado por ${nomeUsuario.get(l.criadoPor) ?? 'usuário removido'}` : 'lançado' },
      ]),
    );

    const situacao = situacoes.get(id) ?? null;
    const contratoAtivo = ativo.contratosCredito[0] ?? null;
    const detalheContratoAtivo = contratoAtivo ? custos.contratos.find((c) => c.contratoId === contratoAtivo.id) : null;

    return {
      ativo: {
        ...ativoParaApi(ativo),
        ofertaFixa: ativo.ofertaFixa ? { id: ativo.ofertaFixa.id, nome: ativo.ofertaFixa.nome } : null,
        fipe: ativo.fipeModelo || ativo.fipeReferencia
          ? { modelo: ativo.fipeModelo, referencia: ativo.fipeReferencia, consultadaEm: ativo.fipeConsultadaEm?.toISOString() ?? null }
          : null,
      },
      comQuemEsta: contratoAtivo && situacao
        ? {
            titular: contratoAtivo.conta.titular,
            contrato: { id: contratoAtivo.id, numero: contratoAtivo.numero, desde: detalheContratoAtivo?.inicio ?? null },
            ...situacao,
          }
        : null,
      pendencias: pendencias.get(id) ?? { quantidade: 0, valor: 0, proximoPrazo: null },
      retorno: retornos.get(id) ?? { investido: 0, recebido: 0, aReceber: 0, percentual: null },
      observacao: {
        texto: ativo.observacao,
        alteradaEm: ultimaObs?.createdAt.toISOString() ?? null,
        alteradaPor: ultimaObs?.usuarioId ? nomeUsuario.get(ultimaObs.usuarioId) ?? null : null,
      },
      custos: {
        aquisicao: custos.aquisicao,
        cadastradoEm: ativo.createdAt.toISOString(),
        custosExtras: custos.custosExtras,
        totalInvestido: custos.totalGasto,
        lancamentos: custos.lancamentos.map((l) => ({ ...l, origem: origemLancamento.get(l.id) ?? null })),
      },
      contratos: custos.contratos,
    };
  }

  // ---------------- Cálculos em lote ----------------

  // Situação do contrato ATIVO de cada veículo. O atraso segue a régua (doc 02
  // §7.6, correção de 18/11): parcela vencida mais antiga do contrato do carro
  // OU de contrato sem veículo da mesma conta (reembolso, crédito, termo), que
  // vive na mesma fatura. Acordo e bloqueio vêm da conta e do contrato.
  private async situacoesDosContratos(ativoIds: string[]) {
    const mapa = new Map<string, { id: string; numero: string; contaId: string } & SituacaoDoVeiculo>();
    if (!ativoIds.length) return mapa;
    const contratosCarro = await this.prisma.db.contratoCredito.findMany({
      where: { ativoId: { in: ativoIds }, status: 'ATIVO', deletedAt: null },
      select: { id: true, numero: true, ativoId: true, contaId: true, veiculoBloqueadoEm: true },
    });
    if (!contratosCarro.length) return mapa;
    const contaIds = [...new Set(contratosCarro.map((c) => c.contaId))];
    const [semVeiculo, acordos] = await Promise.all([
      this.prisma.db.contratoCredito.findMany({
        where: { contaId: { in: contaIds }, ativoId: null, status: 'ATIVO', deletedAt: null },
        select: { id: true, contaId: true },
      }),
      this.prisma.db.acordo.findMany({ where: { contaId: { in: contaIds }, status: 'ATIVO' }, select: { contaId: true } }),
    ]);
    const hoje = inicioHojeBrasilUTC();
    const vencidas = await this.prisma.db.parcela.groupBy({
      by: ['contratoId'],
      where: {
        contratoId: { in: [...contratosCarro.map((c) => c.id), ...semVeiculo.map((c) => c.id)] },
        status: null,
        acordoId: null,
        dataVencimento: { lt: hoje },
      },
      _min: { dataVencimento: true },
    });
    const maisAntigaPorContrato = new Map(vencidas.map((v) => [v.contratoId, v._min.dataVencimento]));
    const contasEmAcordo = new Set(acordos.map((a) => a.contaId));

    for (const c of contratosCarro) {
      if (!c.ativoId) continue;
      const ligados = [c.id, ...semVeiculo.filter((s) => s.contaId === c.contaId).map((s) => s.id)];
      const datas = ligados.map((id) => maisAntigaPorContrato.get(id)).filter((d): d is Date => !!d);
      const maisAntiga = datas.length ? new Date(Math.min(...datas.map((d) => d.getTime()))) : null;
      const diasAtraso = maisAntiga ? diasAtrasoCalendario(maisAntiga) : 0;
      mapa.set(c.ativoId, {
        id: c.id,
        numero: c.numero,
        contaId: c.contaId,
        situacao: situacaoDaConta({
          contratosAtivos: 1,
          bloqueada: c.veiculoBloqueadoEm !== null,
          valorEmAtraso: diasAtraso > 0 ? 1 : 0,
          emAcordo: contasEmAcordo.has(c.contaId),
        }),
        diasAtraso,
        bloqueioDisponivel: bloqueioDisponivel(diasAtraso),
        bloqueadoEm: c.veiculoBloqueadoEm?.toISOString() ?? null,
      });
    }
    return mapa;
  }

  private async pendenciasDosAtivos(ativoIds: string[]) {
    const mapa = new Map<string, PendenciasDoVeiculo>();
    if (!ativoIds.length) return mapa;
    const abertas = await this.prisma.db.ocorrenciaVeiculo.findMany({
      where: { ativoId: { in: ativoIds }, deletedAt: null, status: { in: OCORRENCIAS_ABERTAS } },
      select: { ativoId: true, status: true, valor: true, valorComDesconto: true, dataVencimento: true, prazoIndicacao: true, prazoComprovante: true },
    });
    for (const o of abertas) {
      const atual = mapa.get(o.ativoId) ?? { quantidade: 0, valor: 0, proximoPrazo: null };
      atual.quantidade += 1;
      atual.valor += cent(o.valorComDesconto ?? o.valor);
      const prazos: { tipo: 'vencimento' | 'indicacao' | 'comprovante'; data: Date | null }[] = [
        { tipo: 'vencimento', data: o.dataVencimento },
        { tipo: 'indicacao', data: o.status === 'REGISTRADA' ? o.prazoIndicacao : null },
        { tipo: 'comprovante', data: o.status === 'AGUARDANDO_COMPROVANTE' ? o.prazoComprovante : null },
      ];
      for (const p of prazos) {
        if (!p.data) continue;
        const iso = dataCalendarioUTC(p.data);
        if (!atual.proximoPrazo || iso < atual.proximoPrazo.data) atual.proximoPrazo = { tipo: p.tipo, data: iso };
      }
      mapa.set(o.ativoId, atual);
    }
    return mapa;
  }

  private async retornosDosAtivos(ativoIds: string[]) {
    const mapa = new Map<string, RetornoDoVeiculo>();
    if (!ativoIds.length) return mapa;
    for (const p of await this.centroCusto.posicaoDosAtivos(ativoIds)) {
      mapa.set(p.ativoId, {
        investido: p.totalGasto,
        recebido: p.recebido,
        aReceber: p.aReceber,
        percentual: percentualRetornado(p.recebido, p.totalGasto),
      });
    }
    return mapa;
  }
}
