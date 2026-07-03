import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AlcadaService } from '../alcada/alcada.service';

// Registro passado ao efetivador quando a solicitação completa (ou é reprovada).
export interface AprovacaoEfetivacao {
  id: string;
  referenciaTipo: string;
  referenciaId: string;
  valorCentavos: number;
  payload: unknown;
  decisorId: string; // último aprovador (auditoria)
}

// Cada operação registra como se efetiva quando aprovada/reprovada. Registry evita
// dependência circular: os módulos de domínio importam o motor, nunca o contrário.
export interface EfetivadorAprovacao {
  aprovada: (a: AprovacaoEfetivacao) => Promise<string | void>; // retorna mensagem p/ UI
  reprovada?: (a: AprovacaoEfetivacao) => Promise<void>;
}

const CONTRATOS_VIGENTES = [
  'ATIVO',
  'INADIMPLENTE',
  'BLOQUEADO',
  'SUSPENSO',
  'EM_RECUPERACAO_VEICULO',
] as const;

// Motor de aprovação unificado (Doc 2 §7.9-A): propor e aprovar são atos distintos.
// Solicitação → decisões (aprovar exige alçada; recomendar escala; reprovar encerra)
// → N aprovações (configurável por operação) → efetivação via registry.
@Injectable()
export class AprovacaoService {
  private readonly logger = new Logger(AprovacaoService.name);
  private readonly efetivadores = new Map<string, EfetivadorAprovacao>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly alcada: AlcadaService,
  ) {}

  private cent(v: unknown): number {
    return Math.round(Number(v?.toString() ?? '0') * 100);
  }

  registrarEfetivador(tipoOperacao: string, efetivador: EfetivadorAprovacao) {
    this.efetivadores.set(tipoOperacao, efetivador);
  }

  // Abre uma solicitação de aprovação. Chamado pelos módulos de domínio ao "propor".
  async criar(params: {
    tipoOperacao: string;
    referenciaTipo: string;
    referenciaId: string;
    titularId?: string;
    valorCentavos: number;
    resumo: string;
    payload?: unknown;
    solicitanteId: string;
  }) {
    const aprovacao = await this.prisma.db.aprovacao.create({
      data: {
        tipoOperacao: params.tipoOperacao,
        referenciaTipo: params.referenciaTipo,
        referenciaId: params.referenciaId,
        titularId: params.titularId,
        valor: (params.valorCentavos / 100).toFixed(2),
        resumo: params.resumo,
        payload: params.payload as Prisma.InputJsonValue | undefined,
        solicitanteId: params.solicitanteId,
      },
    });
    return { id: aprovacao.id, status: 'pendente' };
  }

  // Decisão de um usuário sobre a solicitação (com segregação e alçada).
  async decidir(
    aprovacaoId: string,
    usuarioId: string,
    decisao: 'aprovar' | 'recomendar' | 'reprovar',
    parecer?: string,
  ) {
    const aprovacao = await this.prisma.db.aprovacao.findFirst({
      where: { id: aprovacaoId },
      include: { operacao: true, decisoes: true },
    });
    if (!aprovacao) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Solicitação não encontrada' });
    }
    if (aprovacao.status !== 'PENDENTE') {
      throw new UnprocessableEntityException({
        erro: 'estado_invalido',
        mensagem: 'Solicitação já foi decidida',
      });
    }
    // Segregação (Doc 2 §7.9-A): o solicitante não decide a própria solicitação.
    if (aprovacao.solicitanteId === usuarioId) {
      throw new ForbiddenException({
        erro: 'segregacao',
        mensagem: 'Quem solicita não decide a própria solicitação',
      });
    }
    if (aprovacao.decisoes.some((d) => d.usuarioId === usuarioId)) {
      throw new ConflictException({
        erro: 'ja_decidiu',
        mensagem: 'Você já registrou sua decisão nesta solicitação',
      });
    }

    const valorCentavos = this.cent(aprovacao.valor);
    if (decisao === 'aprovar' || decisao === 'reprovar') {
      const alc = await this.alcada.verificar(usuarioId, aprovacao.tipoOperacao, valorCentavos);
      if (!alc.aprovado) {
        throw new ForbiddenException({
          erro: 'fora_da_alcada',
          mensagem: 'Sua alçada não cobre este valor — use "Recomendar" para endossar e escalar',
        });
      }
    }

    const mapa = { aprovar: 'APROVADA', recomendar: 'RECOMENDADA', reprovar: 'REPROVADA' } as const;
    await this.prisma.db.aprovacaoDecisao.create({
      data: { aprovacaoId, usuarioId, decisao: mapa[decisao], parecer },
    });

    const efetivacao: AprovacaoEfetivacao = {
      id: aprovacao.id,
      referenciaTipo: aprovacao.referenciaTipo,
      referenciaId: aprovacao.referenciaId,
      valorCentavos,
      payload: aprovacao.payload,
      decisorId: usuarioId,
    };

    if (decisao === 'reprovar') {
      await this.prisma.db.aprovacao.update({
        where: { id: aprovacaoId },
        data: { status: 'REPROVADA' },
      });
      const ef = this.efetivadores.get(aprovacao.tipoOperacao);
      if (ef?.reprovada) await ef.reprovada(efetivacao);
      this.logger.log(`Aprovação ${aprovacaoId} (${aprovacao.tipoOperacao}) REPROVADA por ${usuarioId}`);
      return { status: 'reprovada', efetivada: false };
    }

    if (decisao === 'recomendar') {
      return { status: 'pendente', efetivada: false };
    }

    // Aprovar: completa quando N usuários distintos com alçada aprovaram (§7.9-A).
    const aprovadas = aprovacao.decisoes.filter((d) => d.decisao === 'APROVADA').length + 1;
    if (aprovadas < aprovacao.operacao.aprovacoesNecessarias) {
      this.logger.log(
        `Aprovação ${aprovacaoId}: ${aprovadas}/${aprovacao.operacao.aprovacoesNecessarias} aprovações`,
      );
      return { status: 'pendente', efetivada: false, aprovacoesFeitas: aprovadas };
    }

    await this.prisma.db.aprovacao.update({
      where: { id: aprovacaoId },
      data: { status: 'APROVADA' },
    });
    const ef = this.efetivadores.get(aprovacao.tipoOperacao);
    let mensagem: string | undefined;
    if (ef) {
      const r = await ef.aprovada(efetivacao);
      if (typeof r === 'string') mensagem = r;
    } else {
      this.logger.warn(`Sem efetivador registrado para ${aprovacao.tipoOperacao}`);
    }
    this.logger.log(`Aprovação ${aprovacaoId} (${aprovacao.tipoOperacao}) APROVADA e efetivada`);
    return { status: 'aprovada', efetivada: true, mensagem };
  }

  // Cancela solicitações pendentes de uma referência (ex: operação retirada pelo solicitante).
  async cancelarPorReferencia(referenciaTipo: string, referenciaId: string) {
    await this.prisma.db.aprovacao.updateMany({
      where: { referenciaTipo, referenciaId, status: 'PENDENTE' },
      data: { status: 'CANCELADA' },
    });
  }

  async pendentes(usuarioId: string) {
    return this.listar({ status: 'PENDENTE' }, usuarioId);
  }

  async historico(usuarioId: string) {
    return this.listar({ status: { not: 'PENDENTE' } }, usuarioId, 50);
  }

  async contagem() {
    const pendentes = await this.prisma.db.aprovacao.count({ where: { status: 'PENDENTE' } });
    return { pendentes };
  }

  private async listar(
    where: Prisma.AprovacaoWhereInput,
    usuarioId: string,
    limit = 200,
  ) {
    const rows = await this.prisma.db.aprovacao.findMany({
      where,
      include: {
        operacao: { select: { nome: true, aprovacoesNecessarias: true } },
        solicitante: { select: { nome: true } },
        decisoes: {
          include: { usuario: { select: { nome: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const titularIds = Array.from(new Set(rows.map((r) => r.titularId).filter(Boolean))) as string[];
    const [titulares, contextos] = await Promise.all([
      this.prisma.db.titular.findMany({
        where: { id: { in: titularIds } },
        select: { id: true, nome: true },
      }),
      this.contextos(titularIds),
    ]);
    const nomePorTitular = new Map(titulares.map((t) => [t.id, t.nome]));

    return Promise.all(
      rows.map(async (r) => {
        const valorCentavos = this.cent(r.valor);
        const podeAprovar =
          r.status === 'PENDENTE'
            ? (await this.alcada.verificar(usuarioId, r.tipoOperacao, valorCentavos)).aprovado
            : false;
        return {
        id: r.id,
        tipoOperacao: r.tipoOperacao,
        tipoOperacaoNome: r.operacao.nome,
        resumo: r.resumo,
        valor: valorCentavos,
        status: r.status,
        solicitanteId: r.solicitanteId,
        solicitante: r.solicitante.nome,
        solicitadoEm: r.createdAt,
        aprovacoesNecessarias: r.operacao.aprovacoesNecessarias,
        aprovacoesFeitas: r.decisoes.filter((d) => d.decisao === 'APROVADA').length,
        decisoes: r.decisoes.map((d) => ({
          usuarioId: d.usuarioId,
          usuario: d.usuario.nome,
          decisao: d.decisao,
          parecer: d.parecer,
          em: d.createdAt,
        })),
        titular: r.titularId
          ? { id: r.titularId, nome: nomePorTitular.get(r.titularId) ?? '—' }
          : null,
        contexto: r.titularId ? (contextos.get(r.titularId) ?? null) : null,
        minha: {
          podeAprovar,
          ehSolicitante: r.solicitanteId === usuarioId,
          jaDecidiu: r.decisoes.some((d) => d.usuarioId === usuarioId),
        },
        };
      }),
    );
  }

  // Contexto financeiro do titular para a decisão (Doc 2 §7.9-A: aprovar às cegas não é aprovar).
  private async contextos(titularIds: string[]) {
    const mapa = new Map<
      string,
      { contratosAtivos: number; saldoDevedor: number; valorEmAtraso: number; faturasVencidas: number }
    >();
    if (titularIds.length === 0) return mapa;

    const hoje = new Date();
    const contas = await this.prisma.db.conta.findMany({
      where: { titularId: { in: titularIds } },
      select: {
        id: true,
        titularId: true,
        contratosCredito: { select: { id: true, status: true } },
      },
    });

    for (const conta of contas) {
      const vigentes = conta.contratosCredito.filter((c) =>
        (CONTRATOS_VIGENTES as readonly string[]).includes(c.status),
      );
      const idsContratos = vigentes.map((c) => c.id);
      const [saldo, atraso, faturasVencidas] = await Promise.all([
        this.prisma.db.parcela.aggregate({
          where: { contratoId: { in: idsContratos }, status: null, acordoId: null },
          _sum: { valorNominal: true },
        }),
        this.prisma.db.parcela.aggregate({
          where: {
            contratoId: { in: idsContratos },
            status: null,
            acordoId: null,
            dataVencimento: { lt: hoje },
          },
          _sum: { valorNominal: true },
        }),
        this.prisma.db.fatura.count({
          where: {
            contaId: conta.id,
            dataVencimento: { lt: hoje },
            status: { in: ['ABERTA', 'FECHADA', 'VENCIDA'] },
          },
        }),
      ]);
      mapa.set(conta.titularId, {
        contratosAtivos: vigentes.length,
        saldoDevedor: this.cent(saldo._sum.valorNominal),
        valorEmAtraso: this.cent(atraso._sum.valorNominal),
        faturasVencidas,
      });
    }
    return mapa;
  }
}
