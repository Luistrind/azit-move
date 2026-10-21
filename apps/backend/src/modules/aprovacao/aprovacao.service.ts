import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { rotuloAtivo, inicioHojeBrasilUTC } from '@azit/utils';
import { VezAprovacao } from '@azit/types';
import { PrismaService } from '../../database/prisma.service';
import { AlcadaService } from '../alcada/alcada.service';
import { NotificacaoService } from '../notificacao/notificacao.service';

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
  // Pedir complemento (doc 02 §7.9-A, decisão Luís 21/10): o domínio que já tem pendência
  // própria (análise de cadastro, RF-15) se integra a ela — não há fila paralela.
  complementoPedido?: (a: AprovacaoEfetivacao, pergunta: string, usuarioId: string) => Promise<void>;
  complementoRespondido?: (a: AprovacaoEfetivacao, resposta: string, usuarioId: string) => Promise<void>;
}


// Vigente = fase ATIVO (doc 02 §5.2, 07/09).

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
    private readonly notificacao: NotificacaoService,
  ) {}

  // Sino §16.1 (07/09): toda notificação leva ao OCORRIDO — a rota depende do
  // tipo de operação aprovada.
  private rotaDoOcorrido(a: { tipoOperacao: string; referenciaId: string; titularId: string | null }): string {
    switch (a.tipoOperacao) {
      case 'analise_cadastro':
        return `/analises/${a.referenciaId}`;
      case 'acordo':
      case 'novacao':
        return '/acordos';
      case 'reajuste':
        return `/contratos/${a.referenciaId}`;
      case 'condicao_fora_parametro':
        return `/propostas/${a.referenciaId}`;
      case 'credito_avulso':
      case 'reembolso_parcelado':
        return a.titularId ? `/titulares/${a.titularId}` : '/carteira';
      // Auditoria 15/09 (Bloco D): as chaves eram 'despesa'/'orcamento', que
      // NÃO existem como tipoOperacao — as notificações caíam no default.
      case 'despesa_contas_pagar':
      case 'orcamento_contas_pagar':
      case 'lote_pagamento':
      case 'reabertura_titulo':
      case 'fornecedor_dados_bancarios':
        return '/contas-a-pagar';
      default:
        return '/aprovacoes';
    }
  }

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
    // Sino §16.1: quem decide (área Aprovações) fica sabendo na hora — e o
    // link abre o dossiê da solicitação (21/10), não a lista.
    await this.notificacao.emitir({
      titulo: 'Aprovação aguardando decisão',
      corpo: params.resumo,
      rota: `/aprovacoes/${aprovacao.id}`,
      tipo: 'APROVACAO',
      area: 'APROVACOES',
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
      include: { operacao: true, decisoes: true, complementos: { where: { respondidoEm: null } } },
    });
    if (!aprovacao) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Solicitação não encontrada' });
    }
    // Parecer obrigatório para reprovar (protótipo 14/10): quem pediu precisa
    // saber o porquê — vai na trilha e na notificação.
    if (decisao === 'reprovar' && !parecer?.trim()) {
      throw new UnprocessableEntityException({ erro: 'parecer_obrigatorio', mensagem: 'Escreva o parecer — reprovar exige o motivo' });
    }
    // Complemento aberto (doc 02 §7.9-A, 21/10): ninguém aprova nem recomenda
    // até a resposta; reprovar continua possível para não prender a fila.
    if (aprovacao.complementos.length > 0 && decisao !== 'reprovar') {
      throw new UnprocessableEntityException({
        erro: 'aguardando_complemento',
        mensagem: 'Há um pedido de complemento aguardando a resposta de quem solicitou — decida depois da resposta (ou reprove com parecer)',
      });
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
      // Sino §16.1: o solicitante fica sabendo, com rota para o ocorrido.
      await this.notificacao.emitir({
        titulo: 'Sua solicitação foi reprovada',
        corpo: `${aprovacao.resumo} — ${parecer}`,
        rota: this.rotaDoOcorrido(aprovacao),
        tipo: 'APROVACAO',
        usuarioId: aprovacao.solicitanteId,
      });
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
    // Sino §16.1: o solicitante fica sabendo, com rota para o ocorrido.
    await this.notificacao.emitir({
      titulo: 'Sua solicitação foi aprovada',
      corpo: mensagem ?? aprovacao.resumo,
      rota: this.rotaDoOcorrido(aprovacao),
      tipo: 'APROVACAO',
      usuarioId: aprovacao.solicitanteId,
    });
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

  // --- Pedir complemento (doc 02 §7.9-A, decisão Luís 21/10) -----------------
  // Pergunta de quem pode decidir ao solicitante — SEM prazo: o alerta a quem
  // pediu basta; fica aberto até a resposta. Não é voto.
  async pedirComplemento(aprovacaoId: string, usuarioId: string, pergunta: string) {
    const aprovacao = await this.prisma.db.aprovacao.findFirst({
      where: { id: aprovacaoId },
      include: { complementos: { where: { respondidoEm: null } } },
    });
    if (!aprovacao) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Solicitação não encontrada' });
    if (aprovacao.status !== 'PENDENTE') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Solicitação já foi decidida' });
    }
    if (aprovacao.solicitanteId === usuarioId) {
      throw new ForbiddenException({ erro: 'segregacao', mensagem: 'Quem solicita não pede complemento da própria solicitação' });
    }
    if (aprovacao.complementos.length > 0) {
      throw new ConflictException({ erro: 'complemento_aberto', mensagem: 'Já há um pedido de complemento aguardando resposta nesta solicitação' });
    }
    const c = await this.prisma.db.aprovacaoComplemento.create({
      data: { aprovacaoId, pergunta, pedidoPorId: usuarioId },
    });
    const ef = this.efetivadores.get(aprovacao.tipoOperacao);
    if (ef?.complementoPedido) await ef.complementoPedido(this.efetivacaoDe(aprovacao, usuarioId), pergunta, usuarioId);
    await this.notificacao.emitir({
      titulo: 'Pediram complemento na sua solicitação',
      corpo: pergunta,
      rota: `/aprovacoes/${aprovacaoId}`,
      tipo: 'APROVACAO',
      usuarioId: aprovacao.solicitanteId,
    });
    this.logger.log(`Aprovação ${aprovacaoId}: complemento pedido por ${usuarioId}`);
    return { id: c.id };
  }

  // Resposta do solicitante — fecha o complemento e devolve a solicitação à fila.
  async responderComplemento(aprovacaoId: string, usuarioId: string, resposta: string) {
    const aprovacao = await this.prisma.db.aprovacao.findFirst({
      where: { id: aprovacaoId },
      include: { complementos: { where: { respondidoEm: null } } },
    });
    if (!aprovacao) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Solicitação não encontrada' });
    if (aprovacao.solicitanteId !== usuarioId) {
      throw new ForbiddenException({ erro: 'nao_solicitante', mensagem: 'Só quem solicitou responde o complemento' });
    }
    const aberto = aprovacao.complementos[0];
    if (!aberto) throw new UnprocessableEntityException({ erro: 'sem_complemento', mensagem: 'Não há complemento aguardando resposta' });
    await this.fecharComplemento(aberto.id, usuarioId, resposta);
    const ef = this.efetivadores.get(aprovacao.tipoOperacao);
    if (ef?.complementoRespondido) await ef.complementoRespondido(this.efetivacaoDe(aprovacao, usuarioId), resposta, usuarioId);
    return { status: 'respondido' };
  }

  // Fecha o complemento aberto quando o domínio resolve a pendência por conta
  // própria (ex.: analista cumpre a pendência na tela da análise). Idempotente.
  async fecharComplementoAberto(aprovacaoId: string, usuarioId: string | undefined, resposta: string) {
    const aberto = await this.prisma.db.aprovacaoComplemento.findFirst({ where: { aprovacaoId, respondidoEm: null } });
    if (aberto) await this.fecharComplemento(aberto.id, usuarioId, resposta);
  }

  private async fecharComplemento(complementoId: string, usuarioId: string | undefined, resposta: string) {
    const c = await this.prisma.db.aprovacaoComplemento.update({
      where: { id: complementoId },
      data: { resposta, respondidoPorId: usuarioId, respondidoEm: new Date() },
    });
    await this.notificacao.emitir({
      titulo: 'Complemento respondido',
      corpo: resposta,
      rota: `/aprovacoes/${c.aprovacaoId}`,
      tipo: 'APROVACAO',
      usuarioId: c.pedidoPorId,
    });
  }

  private efetivacaoDe(
    a: { id: string; referenciaTipo: string; referenciaId: string; valor: Prisma.Decimal; payload: Prisma.JsonValue },
    usuarioId: string,
  ): AprovacaoEfetivacao {
    return { id: a.id, referenciaTipo: a.referenciaTipo, referenciaId: a.referenciaId, valorCentavos: this.cent(a.valor), payload: a.payload, decisorId: usuarioId };
  }

  // Uma solicitação no mesmo formato da lista (dossiê da Central, 21/10).
  async obter(aprovacaoId: string, usuarioId: string) {
    const [item] = await this.listar({ id: aprovacaoId }, usuarioId, 1);
    if (!item) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Solicitação não encontrada' });
    return item;
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
        complementos: {
          include: { pedidoPor: { select: { nome: true } }, respondidoPor: { select: { nome: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const titularIds = Array.from(new Set(rows.map((r) => r.titularId).filter(Boolean))) as string[];
    const [titulares, contextos, contextosAnalise, fornecedores] = await Promise.all([
      this.prisma.db.titular.findMany({
        where: { id: { in: titularIds } },
        select: { id: true, nome: true },
      }),
      this.contextos(titularIds),
      this.contextosAnalise(rows.filter((r) => r.tipoOperacao === 'analise_cadastro').map((r) => r.referenciaId)),
      this.contrapartesFinanceiras(rows),
    ]);
    const nomePorTitular = new Map(titulares.map((t) => [t.id, t.nome]));

    return Promise.all(
      rows.map(async (r) => {
        const valorCentavos = this.cent(r.valor);
        const podeAprovar =
          r.status === 'PENDENTE'
            ? (await this.alcada.verificar(usuarioId, r.tipoOperacao, valorCentavos)).aprovado
            : false;
        const ehSolicitante = r.solicitanteId === usuarioId;
        const jaDecidiu = r.decisoes.some((d) => d.usuarioId === usuarioId);
        const complementos = r.complementos.map((c) => ({
          id: c.id,
          pergunta: c.pergunta,
          pedidoPor: c.pedidoPor.nome,
          pedidoPorId: c.pedidoPorId,
          pedidoEm: c.createdAt.toISOString(),
          resposta: c.resposta,
          respondidoPor: c.respondidoPor?.nome ?? (c.respondidoEm ? 'sistema' : null),
          respondidoEm: c.respondidoEm?.toISOString() ?? null,
        }));
        const complementoAberto = complementos.find((c) => !c.respondidoEm) ?? null;
        // De quem é a vez, do ponto de vista de quem olha (calculada — Regra 7).
        let vez: VezAprovacao | null = null;
        if (r.status === 'PENDENTE') {
          if (ehSolicitante) vez = complementoAberto ? VezAprovacao.RESPONDER_COMPLEMENTO : VezAprovacao.VOCE_SOLICITOU;
          else if (complementoAberto) vez = VezAprovacao.AGUARDANDO_COMPLEMENTO;
          else if (jaDecidiu) vez = VezAprovacao.VOCE_DECIDIU;
          else vez = podeAprovar ? VezAprovacao.DECIDIR : VezAprovacao.RECOMENDAR;
        }
        return {
        id: r.id,
        tipoOperacao: r.tipoOperacao,
        tipoOperacaoNome: r.operacao.nome,
        resumo: r.resumo,
        // Motivos por extenso (Central legível, 07/09): payload.motivos nas
        // aprovações novas; exceções da renegociação valem como motivos.
        motivos: (() => {
          const p = r.payload as null | { motivos?: string[]; excecoes?: string[] };
          return p?.motivos?.length ? p.motivos : (p?.excecoes ?? []);
        })(),
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
        // Com quem é a operação (coluna "Titular / fornecedor" da lista, 21/10).
        contraparte: r.titularId
          ? { tipo: 'titular' as const, id: r.titularId, nome: nomePorTitular.get(r.titularId) ?? '—' }
          : (fornecedores.get(r.id) ?? null),
        complementos,
        complementoAberto,
        aprovacoesFaltando: r.status === 'PENDENTE'
          ? Math.max(0, r.operacao.aprovacoesNecessarias - r.decisoes.filter((d) => d.decisao === 'APROVADA').length)
          : 0,
        // Feedback 09/08: aprovação de ANÁLISE DE CADASTRO é sobre a proposta —
        // KPIs de conta (contratos/saldo/atraso) não fazem sentido para cliente
        // novo; o contexto certo é o da análise.
        contexto:
          r.tipoOperacao === 'analise_cadastro'
            ? null
            : r.titularId
              ? (contextos.get(r.titularId) ?? null)
              : null,
        contextoAnalise:
          r.tipoOperacao === 'analise_cadastro' ? (contextosAnalise.get(r.referenciaId) ?? null) : null,
        minha: {
          podeAprovar,
          ehSolicitante,
          jaDecidiu,
          vez,
        },
        };
      }),
    );
  }

  // Fornecedor das solicitações do contas a pagar (não têm titular): título,
  // orçamento (cotação escolhida), fornecedor e lote.
  private async contrapartesFinanceiras(rows: { id: string; referenciaTipo: string; referenciaId: string; titularId: string | null }[]) {
    const mapa = new Map<string, { tipo: 'fornecedor' | 'lote'; id: string | null; nome: string }>();
    const ids = (tipo: string) => rows.filter((r) => !r.titularId && r.referenciaTipo === tipo).map((r) => r.referenciaId);
    const [titulos, cotacoes, fornecedores, lotes] = await Promise.all([
      ids('titulo_pagar').length
        ? this.prisma.db.tituloPagar.findMany({ where: { id: { in: ids('titulo_pagar') } }, select: { id: true, fornecedor: { select: { id: true, nome: true } } } })
        : [],
      ids('solicitacao_orcamento').length
        ? this.prisma.db.orcamentoFornecedor.findMany({ where: { solicitacaoId: { in: ids('solicitacao_orcamento') }, selecionado: true }, select: { solicitacaoId: true, fornecedorId: true, nomeFornecedor: true } })
        : [],
      ids('fornecedor_financeiro').length
        ? this.prisma.db.fornecedorFin.findMany({ where: { id: { in: ids('fornecedor_financeiro') } }, select: { id: true, nome: true } })
        : [],
      ids('lote_pagamento').length
        ? this.prisma.db.lotePagamento.findMany({ where: { id: { in: ids('lote_pagamento') } }, select: { id: true, totalItens: true } })
        : [],
    ]);
    const idsFornCotacao = cotacoes.map((c) => c.fornecedorId).filter((x): x is string => !!x);
    const fornCotacao = idsFornCotacao.length
      ? await this.prisma.db.fornecedorFin.findMany({ where: { id: { in: idsFornCotacao } }, select: { id: true, nome: true } })
      : [];
    for (const r of rows) {
      if (r.titularId) continue;
      if (r.referenciaTipo === 'titulo_pagar') {
        const t = titulos.find((x) => x.id === r.referenciaId);
        if (t) mapa.set(r.id, { tipo: 'fornecedor', id: t.fornecedor.id, nome: t.fornecedor.nome });
      } else if (r.referenciaTipo === 'solicitacao_orcamento') {
        const c = cotacoes.find((x) => x.solicitacaoId === r.referenciaId);
        if (c) mapa.set(r.id, { tipo: 'fornecedor', id: c.fornecedorId, nome: c.nomeFornecedor ?? fornCotacao.find((f) => f.id === c.fornecedorId)?.nome ?? 'fornecedor da cotação' });
      } else if (r.referenciaTipo === 'fornecedor_financeiro') {
        const f = fornecedores.find((x) => x.id === r.referenciaId);
        if (f) mapa.set(r.id, { tipo: 'fornecedor', id: f.id, nome: f.nome });
      } else if (r.referenciaTipo === 'lote_pagamento') {
        const l = lotes.find((x) => x.id === r.referenciaId);
        if (l) mapa.set(r.id, { tipo: 'lote', id: null, nome: `Lote de pagamento · ${l.totalItens} título(s)` });
      }
    }
    return mapa;
  }

  // Contexto da ANÁLISE DE CADASTRO para a decisão do COCAD (feedback 09/08):
  // proposta nova não tem contratos/faturas — o que importa é a análise em si.
  private async contextosAnalise(analiseIds: string[]) {
    const mapa = new Map<
      string,
      {
        analiseId: string;
        propostaId: string;
        ativo: string;
        valorParcela: number;
        frequencia: string | null;
        rendaDeclarada: number | null;
        rendaPresumida: number | null;
        rendaApurada: number | null;
        // Parecer do analista (caso real 22/09: o aprovador via só "Ver parecer"
        // e não tinha onde ler o texto). Vem da trilha de auditoria.
        parecer: { texto: string; tipo: string | null; emitidoPor: string; emitidoEm: string } | null;
        // Veículo da proposta (pedido Luís 14/10): quilometragem e quantos contratos
        // o carro já teve dizem o quanto ele está "rodado" — pesa na decisão.
        veiculo: { quilometragem: number | null; ano: string | null; contratosAnteriores: number } | null;
      }
    >();
    if (analiseIds.length === 0) return mapa;
    const logs = await this.prisma.db.logAuditoria.findMany({
      where: { entidade: 'analise_cadastro', entidadeId: { in: analiseIds }, acao: 'analise_parecer_emitido' },
      orderBy: { createdAt: 'desc' },
    });
    const usuarioIds = [...new Set(logs.map((l) => l.usuarioId).filter((x): x is string => !!x))];
    const usuarios = usuarioIds.length ? await this.prisma.db.usuario.findMany({ where: { id: { in: usuarioIds } }, select: { id: true, nome: true } }) : [];
    const nomeDe = new Map(usuarios.map((u) => [u.id, u.nome]));
    const pareceres = new Map<string, { texto: string; tipo: string | null; emitidoPor: string; emitidoEm: string }>();
    for (const l of logs) {
      if (!l.entidadeId || pareceres.has(l.entidadeId)) continue; // o mais recente de cada análise
      const d = (l.depois ?? {}) as { tipo?: string; texto?: string };
      pareceres.set(l.entidadeId, { texto: d.texto ?? '', tipo: d.tipo ?? null, emitidoPor: l.usuarioId ? (nomeDe.get(l.usuarioId) ?? 'usuário removido') : 'sistema', emitidoEm: l.createdAt.toISOString() });
    }
    const analises = await this.prisma.db.analiseCadastro.findMany({
      where: { id: { in: analiseIds } },
      select: {
        id: true,
        propostaId: true,
        proposta: {
          select: {
            valorParcela: true,
            frequencia: true,
            ativo: { select: { descricao: true, placa: true, quilometragemEntrada: true, anoFabricacao: true, anoModelo: true, _count: { select: { contratosCredito: true } } } },
          },
        },
        participantes: {
          where: { papel: 'COMPRADOR_PRINCIPAL' },
          select: { rendaDeclarada: true, rendaPresumida: true, rendaApurada: true },
        },
      },
    });
    for (const a of analises) {
      const p = a.participantes[0];
      mapa.set(a.id, {
        analiseId: a.id,
        propostaId: a.propostaId,
        ativo: rotuloAtivo(a.proposta.ativo),
        valorParcela: this.cent(a.proposta.valorParcela),
        frequencia: a.proposta.frequencia ? a.proposta.frequencia.toLowerCase() : null,
        rendaDeclarada: p?.rendaDeclarada ? this.cent(p.rendaDeclarada) : null,
        rendaPresumida: p?.rendaPresumida && this.cent(p.rendaPresumida) > 0 ? this.cent(p.rendaPresumida) : null,
        rendaApurada: p?.rendaApurada ? this.cent(p.rendaApurada) : null,
        parecer: pareceres.get(a.id) ?? null,
        veiculo: a.proposta.ativo
          ? {
              quilometragem: a.proposta.ativo.quilometragemEntrada ?? null,
              ano: a.proposta.ativo.anoFabricacao || a.proposta.ativo.anoModelo ? `${a.proposta.ativo.anoFabricacao ?? '?'}/${a.proposta.ativo.anoModelo ?? '?'}` : null,
              contratosAnteriores: a.proposta.ativo._count.contratosCredito,
            }
          : null,
      });
    }
    return mapa;
  }

  // Contexto financeiro do titular para a decisão (Doc 2 §7.9-A: aprovar às cegas não é aprovar).
  private async contextos(titularIds: string[]) {
    const mapa = new Map<
      string,
      { contratosAtivos: number; saldoDevedor: number; valorEmAtraso: number; faturasVencidas: number }
    >();
    if (titularIds.length === 0) return mapa;

    const hoje = inicioHojeBrasilUTC(); // fuso do negócio (A4, 04/09)
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
        c.status === 'ATIVO',
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
            status: { in: ['ABERTA', 'FECHADA'] },
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
