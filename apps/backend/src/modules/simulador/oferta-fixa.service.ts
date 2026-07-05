import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const cent = (d: unknown): number => Math.round(Number(d?.toString() ?? '0') * 100);
const reais = (c: number) => (c / 100).toFixed(2);

// Oferta fixa (Doc 2 §4-A.3): condição comercial DESENHADA (números redondos),
// com ativos vinculados no cadastro. Vigência opcional ("só esta semana").
@Injectable()
export class OfertaFixaService {
  constructor(private readonly prisma: PrismaService) {}

  private api(o: {
    id: string;
    nome: string;
    valorEntrada: Prisma.Decimal;
    valorParcela: Prisma.Decimal;
    frequencia: string;
    prazoMeses: number;
    ativa: boolean;
    vigenciaInicio: Date | null;
    vigenciaFim: Date | null;
    _count?: { ativos: number };
  }) {
    return {
      id: o.id,
      nome: o.nome,
      valorEntrada: cent(o.valorEntrada),
      valorParcela: cent(o.valorParcela),
      frequencia: o.frequencia.toLowerCase(),
      prazoMeses: o.prazoMeses,
      ativa: o.ativa,
      vigenciaInicio: o.vigenciaInicio?.toISOString() ?? null,
      vigenciaFim: o.vigenciaFim?.toISOString() ?? null,
      ativosVinculados: o._count?.ativos ?? 0,
    };
  }

  // Vigente = ativa e dentro da janela de vigência (quando definida).
  estaVigente(o: { ativa: boolean; vigenciaInicio: Date | null; vigenciaFim: Date | null }): boolean {
    const agora = new Date();
    if (!o.ativa) return false;
    if (o.vigenciaInicio && agora < o.vigenciaInicio) return false;
    if (o.vigenciaFim && agora > o.vigenciaFim) return false;
    return true;
  }

  async listar() {
    const ofertas = await this.prisma.db.ofertaFixa.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { ativos: true } } },
    });
    return ofertas.map((o) => ({ ...this.api(o), vigente: this.estaVigente(o) }));
  }

  async criar(dto: {
    nome: string;
    valorEntrada: number;
    valorParcela: number;
    frequencia: 'mensal' | 'quinzenal' | 'semanal';
    prazoMeses: number;
    vigenciaInicio?: Date;
    vigenciaFim?: Date;
  }) {
    const o = await this.prisma.db.ofertaFixa.create({
      data: {
        nome: dto.nome,
        valorEntrada: reais(dto.valorEntrada),
        valorParcela: reais(dto.valorParcela),
        frequencia: dto.frequencia.toUpperCase() as 'MENSAL' | 'QUINZENAL' | 'SEMANAL',
        prazoMeses: dto.prazoMeses,
        vigenciaInicio: dto.vigenciaInicio,
        vigenciaFim: dto.vigenciaFim,
      },
    });
    return this.api(o);
  }

  async atualizar(
    id: string,
    dto: Partial<{
      nome: string;
      valorEntrada: number;
      valorParcela: number;
      frequencia: 'mensal' | 'quinzenal' | 'semanal';
      prazoMeses: number;
      ativa: boolean;
      vigenciaInicio: Date | null;
      vigenciaFim: Date | null;
    }>,
  ) {
    const existe = await this.prisma.db.ofertaFixa.findFirst({ where: { id } });
    if (!existe) throw new NotFoundException({ erro: 'nao_encontrado' });
    const o = await this.prisma.db.ofertaFixa.update({
      where: { id },
      data: {
        nome: dto.nome,
        valorEntrada: dto.valorEntrada !== undefined ? reais(dto.valorEntrada) : undefined,
        valorParcela: dto.valorParcela !== undefined ? reais(dto.valorParcela) : undefined,
        frequencia: dto.frequencia
          ? (dto.frequencia.toUpperCase() as 'MENSAL' | 'QUINZENAL' | 'SEMANAL')
          : undefined,
        prazoMeses: dto.prazoMeses,
        ativa: dto.ativa,
        vigenciaInicio: dto.vigenciaInicio,
        vigenciaFim: dto.vigenciaFim,
      },
    });
    return this.api(o);
  }
}
