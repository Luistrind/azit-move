import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const cent = (d: unknown): number => Math.round(Number(d?.toString() ?? '0') * 100);
const reais = (c: number) => (c / 100).toFixed(2);

export interface OfertaPadraoConfig {
  prazoMeses: number;
  frequencia: 'MENSAL' | 'QUINZENAL' | 'SEMANAL';
  valorEntrada: number; // centavos
}

// Parâmetros vigentes já convertidos para uso no cálculo (centavos/frações).
export interface ParametrosVigentes {
  id: string;
  comissaoInicial: number; // centavos
  comissaoRecorrente: number; // centavos
  taxaMensal: number; // fração
  entradaMinima: number; // centavos
  prazoMinMeses: number;
  prazoMaxMeses: number;
  prazosPadronizados: number[];
  fatorPrecificacaoSemanal: number; // parcela exibida (÷4 / ÷2 — reunião 11/07)
  fatorPrecificacaoQuinzenal: number;
  fatorSemanal: number; // nº de parcelas do contrato (4,345)
  fatorQuinzenal: number;
  validadeDias: number;
  ofertasPadrao: OfertaPadraoConfig[];
  vigenteDesde: Date;
}

// Parâmetros do simulador VERSIONADOS (Doc 2 §4-A.2): nova configuração = nova
// versão; a vigente é a de vigenteDesde mais recente. Alteração auditada.
@Injectable()
export class ParametrosService {
  constructor(private readonly prisma: PrismaService) {}

  private mapear(v: {
    id: string;
    comissaoInicial: Prisma.Decimal;
    comissaoRecorrente: Prisma.Decimal;
    taxaMensal: Prisma.Decimal;
    entradaMinima: Prisma.Decimal;
    prazoMinMeses: number;
    prazoMaxMeses: number;
    prazosPadronizados: string;
    fatorPrecificacaoSemanal: Prisma.Decimal;
    fatorPrecificacaoQuinzenal: Prisma.Decimal;
    fatorSemanal: Prisma.Decimal;
    fatorQuinzenal: Prisma.Decimal;
    validadeDias: number;
    ofertasPadrao: Prisma.JsonValue;
    vigenteDesde: Date;
  }): ParametrosVigentes {
    return {
      id: v.id,
      comissaoInicial: cent(v.comissaoInicial),
      comissaoRecorrente: cent(v.comissaoRecorrente),
      taxaMensal: Number(v.taxaMensal.toString()),
      entradaMinima: cent(v.entradaMinima),
      prazoMinMeses: v.prazoMinMeses,
      prazoMaxMeses: v.prazoMaxMeses,
      prazosPadronizados: v.prazosPadronizados
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n)),
      fatorPrecificacaoSemanal: Number(v.fatorPrecificacaoSemanal.toString()),
      fatorPrecificacaoQuinzenal: Number(v.fatorPrecificacaoQuinzenal.toString()),
      fatorSemanal: Number(v.fatorSemanal.toString()),
      fatorQuinzenal: Number(v.fatorQuinzenal.toString()),
      validadeDias: v.validadeDias,
      ofertasPadrao: (v.ofertasPadrao as unknown as OfertaPadraoConfig[]) ?? [],
      vigenteDesde: v.vigenteDesde,
    };
  }

  async vigente(): Promise<ParametrosVigentes> {
    const v = await this.prisma.db.versaoParametrosSimulacao.findFirst({
      orderBy: { vigenteDesde: 'desc' },
    });
    if (!v) {
      throw new UnprocessableEntityException({
        erro: 'sem_parametros',
        mensagem: 'Nenhuma versão de parâmetros do simulador cadastrada',
      });
    }
    return this.mapear(v);
  }

  async listar() {
    const versoes = await this.prisma.db.versaoParametrosSimulacao.findMany({
      orderBy: { vigenteDesde: 'desc' },
      take: 20,
    });
    return versoes.map((v) => this.mapear(v));
  }

  // Nova versão (a anterior é preservada — simulações antigas continuam apontando
  // para a versão que usaram). Auditado.
  async criarVersao(
    dto: {
      comissaoInicial: number;
      comissaoRecorrente: number;
      taxaMensal: number;
      entradaMinima: number;
      prazoMinMeses: number;
      prazoMaxMeses: number;
      prazosPadronizados: number[];
      fatorPrecificacaoSemanal: number;
      fatorPrecificacaoQuinzenal: number;
      fatorSemanal: number;
      fatorQuinzenal: number;
      validadeDias: number;
      ofertasPadrao: OfertaPadraoConfig[];
    },
    usuarioId: string,
  ) {
    const anterior = await this.prisma.db.versaoParametrosSimulacao.findFirst({
      orderBy: { vigenteDesde: 'desc' },
    });
    const nova = await this.prisma.db.versaoParametrosSimulacao.create({
      data: {
        comissaoInicial: reais(dto.comissaoInicial),
        comissaoRecorrente: reais(dto.comissaoRecorrente),
        taxaMensal: dto.taxaMensal.toFixed(6),
        entradaMinima: reais(dto.entradaMinima),
        prazoMinMeses: dto.prazoMinMeses,
        prazoMaxMeses: dto.prazoMaxMeses,
        prazosPadronizados: dto.prazosPadronizados.join(','),
        fatorPrecificacaoSemanal: dto.fatorPrecificacaoSemanal.toFixed(4),
        fatorPrecificacaoQuinzenal: dto.fatorPrecificacaoQuinzenal.toFixed(4),
        fatorSemanal: dto.fatorSemanal.toFixed(4),
        fatorQuinzenal: dto.fatorQuinzenal.toFixed(4),
        validadeDias: dto.validadeDias,
        ofertasPadrao: dto.ofertasPadrao as unknown as Prisma.InputJsonValue,
        criadoPor: usuarioId,
      },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'parametros_simulador_alterados',
        entidade: 'versao_parametros',
        entidadeId: nova.id,
        antes: anterior ? (JSON.parse(JSON.stringify(this.mapear(anterior))) as Prisma.InputJsonValue) : undefined,
        depois: JSON.parse(JSON.stringify(this.mapear(nova))) as Prisma.InputJsonValue,
      },
    });
    return this.mapear(nova);
  }
}
