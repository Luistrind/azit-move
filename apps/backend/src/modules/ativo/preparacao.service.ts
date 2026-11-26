import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MotivoPreparacao, Prisma, SituacaoItemPreparacao } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// Preparação do veículo para venda (doc 02 §25.8, decisão Luís 24/11/2026).
// Única exceção ao "status automático" do §25.1: o carro entra em Em preparação
// e sai para Disponível só por estas ações, auditadas.
//   ENTRADA     — carro novo cadastrado no estoque (nasce em preparação)
//   RECUPERACAO — "Liberar para venda" de um carro Recuperado
//   MANUTENCAO  — "Enviar para preparação" de um carro Disponível
// Os itens são cópia do modelo (Configuração › Checklist de preparação) no
// momento da abertura; "Marcar como pronto" exige todos feitos ou "não se aplica".

// Transação do cliente estendido (prisma.db) — mesmo padrão do baixa-conta.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

const MOTIVO_API = { ENTRADA: 'entrada', RECUPERACAO: 'recuperacao', MANUTENCAO: 'manutencao' } as const;
const SITUACAO_API = { FEITO: 'feito', NAO_SE_APLICA: 'nao_se_aplica' } as const;
export type MotivoPreparacaoApi = (typeof MOTIVO_API)[keyof typeof MOTIVO_API];
export type SituacaoItemApi = (typeof SITUACAO_API)[keyof typeof SITUACAO_API];

// Status de onde cada motivo pode partir (o ENTRADA nasce no cadastro).
const ORIGEM_PERMITIDA: Record<Exclude<MotivoPreparacao, 'ENTRADA'>, string> = {
  RECUPERACAO: 'RECUPERADO',
  MANUTENCAO: 'DISPONIVEL',
};

export interface PreparacaoApi {
  id: string;
  motivo: MotivoPreparacaoApi;
  oQueFalta: string | null;
  abertaEm: string;
  abertaPor: string | null;
  concluidaEm: string | null;
  concluidaPor: string | null;
  itens: {
    id: string;
    descricao: string;
    avulso: boolean;
    situacao: SituacaoItemApi | null;
    marcadoEm: string | null;
    marcadoPor: string | null;
  }[];
  pendentes: number;
}

@Injectable()
export class PreparacaoService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- leitura (ficha do veículo) ----------------

  async doAtivo(ativoId: string): Promise<{ aberta: PreparacaoApi | null; anteriores: PreparacaoApi[] }> {
    const linhas = await this.prisma.db.preparacaoAtivo.findMany({
      where: { ativoId },
      include: { itens: { orderBy: { ordem: 'asc' } } },
      orderBy: { abertaEm: 'desc' },
    });
    const nomes = await this.nomesUsuarios(linhas.flatMap((p) => [p.abertaPor, p.concluidaPor, ...p.itens.map((i) => i.marcadoPor)]));
    const api = linhas.map((p) => this.paraApi(p, nomes));
    return { aberta: api.find((p) => !p.concluidaEm) ?? null, anteriores: api.filter((p) => !!p.concluidaEm) };
  }

  // ---------------- abertura ----------------

  // Usado pelo cadastro do ativo (motivo ENTRADA) dentro da mesma transação.
  async abrirNaTransacao(tx: Tx, ativoId: string, motivo: MotivoPreparacao, oQueFalta: string | null, usuarioId?: string) {
    const modelo: { descricao: string }[] = await tx.checklistPreparacaoModelo.findMany({ where: { deletedAt: null }, orderBy: { ordem: 'asc' } });
    const prep = await tx.preparacaoAtivo.create({
      data: {
        ativoId,
        motivo,
        oQueFalta: oQueFalta?.trim() || null,
        abertaPor: usuarioId ?? null,
        itens: { create: modelo.map((m, i) => ({ descricao: m.descricao, ordem: i + 1 })) },
      },
    });
    await tx.ativo.update({ where: { id: ativoId }, data: { status: 'EM_PREPARACAO' } });
    await tx.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'ativo_preparacao_aberta',
        entidade: 'ativo',
        entidadeId: ativoId,
        depois: { preparacaoId: prep.id, motivo, oQueFalta: prep.oQueFalta, itens: modelo.map((m) => m.descricao) },
      },
    });
    return prep;
  }

  // "Liberar para venda" (Recuperado) e "Enviar para preparação" (Disponível).
  async abrir(ativoId: string, motivo: 'RECUPERACAO' | 'MANUTENCAO', oQueFalta: string | undefined, usuarioId?: string) {
    const ativo = await this.prisma.db.ativo.findFirst({ where: { id: ativoId }, select: { id: true, status: true, tipo: true } });
    if (!ativo) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Veículo não encontrado' });
    if (ativo.tipo !== 'VEICULO') {
      throw new UnprocessableEntityException({ erro: 'nao_e_veiculo', mensagem: 'Só veículo do estoque passa por preparação' });
    }
    if (ativo.status !== ORIGEM_PERMITIDA[motivo]) {
      throw new UnprocessableEntityException({
        erro: 'status_invalido',
        mensagem: motivo === 'RECUPERACAO'
          ? 'Liberar para venda vale só para veículo Recuperado'
          : 'Só um veículo Disponível pode ser enviado para preparação',
      });
    }
    await this.garantirSemAberta(ativoId);
    await this.prisma.db.$transaction((tx) => this.abrirNaTransacao(tx, ativoId, motivo, oQueFalta ?? null, usuarioId));
    return this.doAtivo(ativoId);
  }

  // ---------------- checklist ----------------

  async marcarItem(itemId: string, situacao: SituacaoItemApi | null, usuarioId?: string) {
    const item = await this.prisma.db.preparacaoItem.findFirst({ where: { id: itemId }, include: { preparacao: true } });
    if (!item) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Item do checklist não encontrado' });
    this.garantirAberta(item.preparacao);
    const nova: SituacaoItemPreparacao | null = situacao === 'feito' ? 'FEITO' : situacao === 'nao_se_aplica' ? 'NAO_SE_APLICA' : null;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.preparacaoItem.update({
        where: { id: itemId },
        data: { situacao: nova, marcadoEm: nova ? new Date() : null, marcadoPor: nova ? usuarioId ?? null : null },
      });
      await tx.logAuditoria.create({
        data: {
          usuarioId,
          acao: 'ativo_preparacao_item',
          entidade: 'ativo',
          entidadeId: item.preparacao.ativoId,
          antes: { item: item.descricao, situacao: item.situacao },
          depois: { item: item.descricao, situacao: nova },
        },
      });
    });
    return this.doAtivo(item.preparacao.ativoId);
  }

  async adicionarItem(ativoId: string, descricao: string, usuarioId?: string) {
    const prep = await this.prisma.db.preparacaoAtivo.findFirst({ where: { ativoId, concluidaEm: null }, include: { itens: { select: { ordem: true } } } });
    if (!prep) throw new UnprocessableEntityException({ erro: 'sem_preparacao', mensagem: 'O veículo não está em preparação' });
    const ordem = Math.max(0, ...prep.itens.map((i) => i.ordem)) + 1;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.preparacaoItem.create({ data: { preparacaoId: prep.id, descricao: descricao.trim(), ordem, avulso: true } });
      await tx.logAuditoria.create({
        data: { usuarioId, acao: 'ativo_preparacao_item', entidade: 'ativo', entidadeId: ativoId, depois: { item: descricao.trim(), incluido: true } },
      });
    });
    return this.doAtivo(ativoId);
  }

  // Item incluído só para este carro pode sair; os do modelo se marcam "não se aplica".
  async removerItem(itemId: string, usuarioId?: string) {
    const item = await this.prisma.db.preparacaoItem.findFirst({ where: { id: itemId }, include: { preparacao: true } });
    if (!item) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Item do checklist não encontrado' });
    this.garantirAberta(item.preparacao);
    if (!item.avulso) {
      throw new UnprocessableEntityException({ erro: 'item_do_modelo', mensagem: 'Item do modelo não sai do checklist — marque "não se aplica"' });
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.preparacaoItem.delete({ where: { id: itemId } });
      await tx.logAuditoria.create({
        data: { usuarioId, acao: 'ativo_preparacao_item', entidade: 'ativo', entidadeId: item.preparacao.ativoId, antes: { item: item.descricao }, depois: { removido: true } },
      });
    });
    return this.doAtivo(item.preparacao.ativoId);
  }

  // ---------------- conclusão ----------------

  async concluir(ativoId: string, usuarioId?: string) {
    const prep = await this.prisma.db.preparacaoAtivo.findFirst({ where: { ativoId, concluidaEm: null }, include: { itens: true } });
    if (!prep) throw new UnprocessableEntityException({ erro: 'sem_preparacao', mensagem: 'O veículo não está em preparação' });
    const pendentes = prep.itens.filter((i) => !i.situacao);
    if (pendentes.length) {
      throw new UnprocessableEntityException({
        erro: 'checklist_incompleto',
        mensagem: `Falta concluir no checklist: ${pendentes.map((i) => i.descricao).join(', ')}`,
      });
    }
    await this.prisma.db.$transaction(async (tx) => {
      await tx.preparacaoAtivo.update({ where: { id: prep.id }, data: { concluidaEm: new Date(), concluidaPor: usuarioId ?? null } });
      // Reservado (lista de espera) continua preso à proposta; só o Em preparação vira Disponível.
      await tx.ativo.updateMany({ where: { id: ativoId, status: 'EM_PREPARACAO' }, data: { status: 'DISPONIVEL' } });
      await tx.logAuditoria.create({
        data: {
          usuarioId,
          acao: 'ativo_preparacao_concluida',
          entidade: 'ativo',
          entidadeId: ativoId,
          depois: { preparacaoId: prep.id, itens: prep.itens.map((i) => ({ item: i.descricao, situacao: i.situacao })) },
        },
      });
    });
    return this.doAtivo(ativoId);
  }

  // ---------------- modelo do checklist (Configuração) ----------------

  async modelo() {
    const itens = await this.prisma.db.checklistPreparacaoModelo.findMany({ where: { deletedAt: null }, orderBy: { ordem: 'asc' } });
    return itens.map((i) => ({ id: i.id, descricao: i.descricao }));
  }

  // Salva a lista inteira na ordem dada. Itens que saíram são desativados (não
  // apagados) — preparações já abertas guardam a própria cópia e não mudam.
  async salvarModelo(itens: { id?: string; descricao: string }[], usuarioId?: string) {
    const limpos = itens.map((i) => ({ id: i.id, descricao: i.descricao.trim() })).filter((i) => i.descricao);
    if (!limpos.length) throw new UnprocessableEntityException({ erro: 'modelo_vazio', mensagem: 'O checklist precisa de pelo menos um item' });
    const antes = await this.modelo();
    await this.prisma.db.$transaction(async (tx) => {
      const manter = new Set(limpos.map((i) => i.id).filter((x): x is string => !!x));
      await tx.checklistPreparacaoModelo.updateMany({ where: { deletedAt: null, id: { notIn: [...manter] } }, data: { deletedAt: new Date() } });
      for (const [n, i] of limpos.entries()) {
        if (i.id && antes.some((a) => a.id === i.id)) {
          await tx.checklistPreparacaoModelo.update({ where: { id: i.id }, data: { descricao: i.descricao, ordem: n + 1 } });
        } else {
          await tx.checklistPreparacaoModelo.create({ data: { descricao: i.descricao, ordem: n + 1 } });
        }
      }
      await tx.logAuditoria.create({
        data: {
          usuarioId,
          acao: 'checklist_preparacao_alterado',
          entidade: 'checklist_preparacao',
          entidadeId: 'modelo',
          antes: { itens: antes.map((a) => a.descricao) },
          depois: { itens: limpos.map((i) => i.descricao) },
        },
      });
    });
    return this.modelo();
  }

  // ---------------- apoio ----------------

  private async garantirSemAberta(ativoId: string) {
    const aberta = await this.prisma.db.preparacaoAtivo.findFirst({ where: { ativoId, concluidaEm: null }, select: { id: true } });
    if (aberta) throw new UnprocessableEntityException({ erro: 'ja_em_preparacao', mensagem: 'O veículo já está em preparação' });
  }

  private garantirAberta(p: { concluidaEm: Date | null }) {
    if (p.concluidaEm) {
      throw new UnprocessableEntityException({ erro: 'preparacao_concluida', mensagem: 'Esta preparação já foi concluída' });
    }
  }

  private async nomesUsuarios(ids: (string | null)[]) {
    const unicos = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unicos.length) return new Map<string, string>();
    const us = await this.prisma.db.usuario.findMany({ where: { id: { in: unicos } }, select: { id: true, nome: true } });
    return new Map(us.map((u) => [u.id, u.nome]));
  }

  private paraApi(
    p: Prisma.PreparacaoAtivoGetPayload<{ include: { itens: true } }>,
    nomes: Map<string, string>,
  ): PreparacaoApi {
    const nome = (id: string | null) => (id ? nomes.get(id) ?? null : null);
    return {
      id: p.id,
      motivo: MOTIVO_API[p.motivo],
      oQueFalta: p.oQueFalta,
      abertaEm: p.abertaEm.toISOString(),
      abertaPor: nome(p.abertaPor),
      concluidaEm: p.concluidaEm?.toISOString() ?? null,
      concluidaPor: nome(p.concluidaPor),
      itens: p.itens.map((i) => ({
        id: i.id,
        descricao: i.descricao,
        avulso: i.avulso,
        situacao: i.situacao ? SITUACAO_API[i.situacao] : null,
        marcadoEm: i.marcadoEm?.toISOString() ?? null,
        marcadoPor: nome(i.marcadoPor),
      })),
      pendentes: p.itens.filter((i) => !i.situacao).length,
    };
  }
}
