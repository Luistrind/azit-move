import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface ResultadoAlcada {
  aprovado: boolean;
  limiteMaximo: number | null; // centavos do limite que cobriu (informativo)
  motivo?: string;
}

// 6.1 — Verificação de alçada em runtime no banco (Doc 6 §6, §9.1). Estrutura
// PER USUÁRIO: cada aprovador tem um limite por tipo de operação. Os valores
// vêm de registros Alcada (placeholder/seed até Vicente). Nenhum limite hardcoded.
@Injectable()
export class AlcadaService {
  constructor(private readonly prisma: PrismaService) {}

  async verificar(
    usuarioId: string,
    tipoOperacao: string,
    valorCentavos: number,
  ): Promise<ResultadoAlcada> {
    const alcadas = await this.prisma.db.alcada.findMany({
      where: { usuarioId, tipoOperacao, ativo: true },
      orderBy: { limiteMaximo: 'desc' },
    });
    const cobre = alcadas.find(
      (a) => valorCentavos <= Math.round(Number(a.limiteMaximo.toString()) * 100),
    );
    if (cobre) {
      return {
        aprovado: true,
        limiteMaximo: Math.round(Number(cobre.limiteMaximo.toString()) * 100),
      };
    }
    return {
      aprovado: false,
      limiteMaximo: null,
      motivo:
        'Operação excede a alçada do usuário para este tipo — requer aprovação superior',
    };
  }

  async listar(usuarioId?: string) {
    const alcadas = await this.prisma.db.alcada.findMany({
      where: usuarioId ? { usuarioId } : undefined,
      orderBy: [{ usuarioId: 'asc' }, { tipoOperacao: 'asc' }],
      include: { usuario: { select: { nome: true, email: true } } },
    });
    return alcadas.map((a) => ({
      id: a.id,
      usuarioId: a.usuarioId,
      usuario: a.usuario.nome,
      tipoOperacao: a.tipoOperacao,
      limiteMaximo: Math.round(Number(a.limiteMaximo.toString()) * 100),
      ativo: a.ativo,
    }));
  }
}
