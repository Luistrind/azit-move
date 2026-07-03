import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface ResultadoAlcada {
  aprovado: boolean;
  ilimitado: boolean;
  limiteMaximo: number | null; // centavos do limite que cobriu (informativo)
  motivo?: string;
}

// Verificação de alçada em runtime (Doc 2 §7.9). Matriz PER PAPEL × tipo de operação,
// configurável pelo admin (nada hardcoded). O usuário pode ter vários papéis — vale a
// alçada mais forte entre eles. limiteMaximo é armazenado em REAIS; a API opera em centavos.
@Injectable()
export class AlcadaService {
  constructor(private readonly prisma: PrismaService) {}

  private reaisParaCentavos(v: unknown): number {
    return Math.round(Number(v?.toString() ?? '0') * 100);
  }

  async verificar(
    usuarioId: string,
    tipoOperacao: string,
    valorCentavos: number,
  ): Promise<ResultadoAlcada> {
    const papeis = (
      await this.prisma.db.usuarioRole.findMany({
        where: { usuarioId },
        select: { role: true },
      })
    ).map((r) => r.role);

    if (papeis.length === 0) {
      return {
        aprovado: false,
        ilimitado: false,
        limiteMaximo: null,
        motivo: 'Usuário sem papel definido — não pode aprovar',
      };
    }

    const alcadas = await this.prisma.db.alcada.findMany({
      where: { papel: { in: papeis }, tipoOperacao, ativo: true },
    });

    if (alcadas.some((a) => a.ilimitado)) {
      return { aprovado: true, ilimitado: true, limiteMaximo: null };
    }

    const cobre = alcadas
      .map((a) => this.reaisParaCentavos(a.limiteMaximo))
      .filter((c) => c >= valorCentavos)
      .sort((a, b) => a - b)[0];

    if (cobre !== undefined) {
      return { aprovado: true, ilimitado: false, limiteMaximo: cobre };
    }
    return {
      aprovado: false,
      ilimitado: false,
      limiteMaximo: null,
      motivo:
        'Operação excede a alçada do papel do usuário para este tipo — requer aprovação superior',
    };
  }

  // ---- Configuração (admin) --------------------------------------------------

  private readonly PAPEIS = ['DIRETOR', 'ADMIN', 'APROVADOR', 'OPERADOR', 'FINANCEIRO'];

  // Matriz completa para a tela de configuração.
  async matriz() {
    const [operacoes, alcadas] = await Promise.all([
      this.prisma.db.tipoOperacaoAlcada.findMany({ orderBy: { nome: 'asc' } }),
      this.prisma.db.alcada.findMany(),
    ]);
    return {
      papeis: this.PAPEIS,
      operacoes: operacoes.map((o) => ({
        chave: o.chave,
        nome: o.nome,
        ativo: o.ativo,
        aprovacoesNecessarias: o.aprovacoesNecessarias,
      })),
      celulas: alcadas.map((a) => ({
        papel: a.papel,
        tipoOperacao: a.tipoOperacao,
        limiteMaximo: this.reaisParaCentavos(a.limiteMaximo), // centavos
        ilimitado: a.ilimitado,
        ativo: a.ativo,
      })),
    };
  }

  // Grava/atualiza uma célula (papel × operação). limiteMaximo em CENTAVOS.
  async salvarCelula(dto: {
    papel: string;
    tipoOperacao: string;
    limiteMaximo?: number;
    ilimitado?: boolean;
    ativo?: boolean;
  }) {
    const op = await this.prisma.db.tipoOperacaoAlcada.findUnique({
      where: { chave: dto.tipoOperacao },
    });
    if (!op) throw new NotFoundException({ erro: 'operacao_inexistente' });

    const limiteReais = ((dto.limiteMaximo ?? 0) / 100).toFixed(2);
    const data = {
      limiteMaximo: limiteReais,
      ilimitado: dto.ilimitado ?? false,
      ativo: dto.ativo ?? true,
    };
    await this.prisma.db.alcada.upsert({
      where: { papel_tipoOperacao: { papel: dto.papel as any, tipoOperacao: dto.tipoOperacao } },
      update: data,
      create: { papel: dto.papel as any, tipoOperacao: dto.tipoOperacao, ...data },
    });
    return this.matriz();
  }

  // Admin ajusta o nº de aprovações exigidas (princípio dos 4 olhos — Doc 2 §7.9-A).
  async salvarOperacao(chave: string, dto: { aprovacoesNecessarias?: number; nome?: string; ativo?: boolean }) {
    const op = await this.prisma.db.tipoOperacaoAlcada.findUnique({ where: { chave } });
    if (!op) throw new NotFoundException({ erro: 'operacao_inexistente' });
    await this.prisma.db.tipoOperacaoAlcada.update({
      where: { chave },
      data: {
        aprovacoesNecessarias: dto.aprovacoesNecessarias,
        nome: dto.nome,
        ativo: dto.ativo,
      },
    });
    return this.matriz();
  }

  async criarOperacao(dto: { chave: string; nome: string }) {
    const chave = dto.chave
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    await this.prisma.db.tipoOperacaoAlcada.upsert({
      where: { chave },
      update: { nome: dto.nome, ativo: true },
      create: { chave, nome: dto.nome },
    });
    return this.matriz();
  }
}
