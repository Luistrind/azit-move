import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, SituacaoOperacionalAtivo } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// ============================================================
// Controle de frota — situação operacional (doc 02 §25.1, decisão Luís 20/09).
// ONDE o carro está é uma pergunta SEPARADA de "qual a relação dele com um
// contrato" (StatusAtivo, consultado por régua, carteira e venda). As duas
// camadas convivem: um veículo pode estar Em contrato E na oficina.
// ============================================================

export const ROTULO_SITUACAO: Record<SituacaoOperacionalAtivo, string> = {
  COM_CLIENTE: 'Com o cliente',
  EM_OFICINA: 'Em oficina',
  NO_PATIO: 'No pátio',
  EM_VISTORIA: 'Em vistoria',
  EM_PREPARACAO: 'Em preparação',
  EM_ESTOQUE: 'Em estoque',
  BAIXADO: 'Baixado',
};

export const SITUACOES: SituacaoOperacionalAtivo[] = [
  'COM_CLIENTE', 'EM_OFICINA', 'NO_PATIO', 'EM_VISTORIA', 'EM_PREPARACAO', 'EM_ESTOQUE', 'BAIXADO',
];

const DIA_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class FrotaService {
  private readonly logger = new Logger(FrotaService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Quadro da frota: veículos por situação, com dias parado e o contrato vigente.
  async quadro() {
    const ativos = await this.prisma.db.ativo.findMany({
      where: { deletedAt: null, tipo: 'VEICULO' },
      include: {
        contratosCredito: {
          where: { status: 'ATIVO', deletedAt: null },
          select: { id: true, numero: true, conta: { select: { titular: { select: { id: true, nome: true } } } } },
          take: 1,
        },
      },
      orderBy: [{ situacaoOperacional: 'asc' }, { situacaoDesde: 'asc' }],
    });
    const abertas = await this.prisma.db.ocorrenciaVeiculo.groupBy({
      by: ['ativoId'],
      where: { deletedAt: null, status: { in: ['REGISTRADA', 'EM_RECURSO', 'AGUARDANDO_COMPROVANTE'] } },
      _count: { _all: true },
    });
    const porAtivo = new Map(abertas.map((o) => [o.ativoId, o._count._all]));
    const agora = Date.now();

    return ativos.map((a) => {
      const contrato = a.contratosCredito[0] ?? null;
      return {
        id: a.id,
        placa: a.placa,
        descricao: [a.marca, a.modelo].filter(Boolean).join(' ') || a.descricao,
        status: a.status, // relação com o contrato (camada 1)
        situacao: a.situacaoOperacional,
        situacaoRotulo: ROTULO_SITUACAO[a.situacaoOperacional],
        situacaoDesde: a.situacaoDesde?.toISOString() ?? null,
        diasNaSituacao: a.situacaoDesde ? Math.floor((agora - a.situacaoDesde.getTime()) / DIA_MS) : null,
        previsaoRetorno: a.previsaoRetorno?.toISOString() ?? null,
        atrasadoNoRetorno: !!a.previsaoRetorno && a.previsaoRetorno.getTime() < agora,
        contrato: contrato ? { id: contrato.id, numero: contrato.numero, titular: contrato.conta.titular } : null,
        ocorrenciasAbertas: porAtivo.get(a.id) ?? 0,
      };
    });
  }

  // Muda a situação e grava o histórico (quem, quando, por quê).
  async mover(
    ativoId: string,
    dto: { situacao: SituacaoOperacionalAtivo; motivo?: string; previsaoRetorno?: string },
    usuarioId?: string,
  ) {
    const ativo = await this.prisma.db.ativo.findFirst({ where: { id: ativoId, deletedAt: null } });
    if (!ativo) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Veículo não encontrado' });
    if (!SITUACOES.includes(dto.situacao)) {
      throw new UnprocessableEntityException({ erro: 'situacao_invalida', mensagem: 'Situação inválida' });
    }
    if (ativo.situacaoOperacional === dto.situacao) {
      return { resultado: 'sem_mudanca', situacao: dto.situacao };
    }
    const previsao = dto.previsaoRetorno ? new Date(dto.previsaoRetorno) : null;
    if (previsao && Number.isNaN(previsao.getTime())) {
      throw new UnprocessableEntityException({ erro: 'data_invalida', mensagem: 'Previsão de retorno inválida' });
    }
    const agora = new Date();
    await this.prisma.db.$transaction([
      this.prisma.db.ativo.update({
        where: { id: ativoId },
        data: { situacaoOperacional: dto.situacao, situacaoDesde: agora, previsaoRetorno: previsao },
      }),
      this.prisma.db.movimentacaoFrota.create({
        data: {
          ativoId,
          de: ativo.situacaoOperacional,
          para: dto.situacao,
          motivo: dto.motivo?.trim() || null,
          previsaoRetorno: previsao,
          usuarioId,
          em: agora,
        },
      }),
      this.prisma.db.logAuditoria.create({
        data: {
          usuarioId,
          acao: 'frota_situacao_alterada',
          entidade: 'ativo',
          entidadeId: ativoId,
          antes: { situacao: ativo.situacaoOperacional },
          depois: { situacao: dto.situacao, motivo: dto.motivo?.trim() || null, previsaoRetorno: previsao?.toISOString() ?? null } as Prisma.InputJsonValue,
        },
      }),
    ]);
    this.logger.log(`frota: ${ativo.placa ?? ativoId} ${ativo.situacaoOperacional} → ${dto.situacao}`);
    return { resultado: 'movido', de: ativo.situacaoOperacional, para: dto.situacao };
  }

  async historico(ativoId: string) {
    const movs = await this.prisma.db.movimentacaoFrota.findMany({
      where: { ativoId },
      orderBy: { em: 'desc' },
      take: 100,
    });
    const usuarios = new Map(
      (
        await this.prisma.db.usuario.findMany({
          where: { id: { in: movs.map((m) => m.usuarioId).filter(Boolean) as string[] } },
          select: { id: true, nome: true },
        })
      ).map((u) => [u.id, u.nome]),
    );
    return movs.map((m) => ({
      id: m.id,
      em: m.em.toISOString(),
      de: m.de,
      deRotulo: m.de ? ROTULO_SITUACAO[m.de] : null,
      para: m.para,
      paraRotulo: ROTULO_SITUACAO[m.para],
      motivo: m.motivo,
      previsaoRetorno: m.previsaoRetorno?.toISOString() ?? null,
      usuario: m.usuarioId ? usuarios.get(m.usuarioId) ?? null : null,
    }));
  }
}
