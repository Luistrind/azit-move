import { Injectable } from '@nestjs/common';
import { RoleUsuario, TipoAlcada } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface ResultadoAlcada {
  aprovado: boolean;
  nivel: number | null;
  motivo?: string;
}

// 6.1 — Verificação de alçada em runtime no banco (Doc 6 §4.1, §6). A estrutura é
// configurável; os limites vêm de registros Alcada (placeholder até Vicente).
// Nenhum limite é hardcoded.
@Injectable()
export class AlcadaService {
  constructor(private readonly prisma: PrismaService) {}

  async verificar(
    tipo: TipoAlcada,
    valorCentavos: number,
    roles: RoleUsuario[],
  ): Promise<ResultadoAlcada> {
    const alcadas = await this.prisma.db.alcada.findMany({
      where: { tipo, ativo: true, role: { in: roles } },
      orderBy: { nivel: 'asc' },
    });
    // Cobre quando não há limite (ilimitado) ou o valor cabe no limite.
    const cobre = alcadas.filter(
      (a) =>
        a.limiteValor === null ||
        valorCentavos <= Math.round(Number(a.limiteValor.toString()) * 100),
    );
    if (cobre.length > 0) {
      return { aprovado: true, nivel: cobre[0].nivel };
    }
    return {
      aprovado: false,
      nivel: null,
      motivo: 'Operação excede a alçada dos roles do usuário — requer aprovação superior',
    };
  }

  async listar() {
    const alcadas = await this.prisma.db.alcada.findMany({
      orderBy: [{ tipo: 'asc' }, { nivel: 'asc' }],
    });
    return alcadas.map((a) => ({
      id: a.id,
      tipo: a.tipo.toLowerCase(),
      role: a.role,
      limiteValor: a.limiteValor ? Math.round(Number(a.limiteValor.toString()) * 100) : null,
      nivel: a.nivel,
      ativo: a.ativo,
    }));
  }
}
