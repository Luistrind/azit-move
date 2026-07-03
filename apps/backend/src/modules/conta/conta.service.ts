import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CriarContaDto } from './dto/criar-conta.dto';
import { AtualizarContaDto } from './dto/atualizar-conta.dto';
import { ContaApi, contaParaApi, mapearStatusConta } from './conta.mapper';

const CONTRATOS_VIGENTES = [
  'ATIVO',
  'INADIMPLENTE',
  'BLOQUEADO',
  'SUSPENSO',
  'EM_RECUPERACAO_VEICULO',
] as const;

@Injectable()
export class ContaService {
  constructor(private readonly prisma: PrismaService) {}

  private cent(v: unknown): number {
    return Math.round(Number(v?.toString() ?? '0') * 100);
  }

  // Carteira TITULAR-cêntrica (Doc 2: a arquitetura é centrada no titular): posição
  // consolidada por conta — saldo, atraso, contratos, bloqueio — para a tela Carteira.
  async carteira() {
    const hoje = new Date();
    const contas = await this.prisma.db.conta.findMany({
      where: { titular: { deletedAt: null } },
      include: {
        titular: { select: { id: true, nome: true, cpfCnpj: true } },
        contratosCredito: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Agregados em lote (evita N+1 pesado): parcelas por contrato, faturas por conta.
    const todosContratos = contas.flatMap((c) =>
      c.contratosCredito
        .filter((ct) => (CONTRATOS_VIGENTES as readonly string[]).includes(ct.status))
        .map((ct) => ct.id),
    );
    const [saldos, atrasos, vencidas] = await Promise.all([
      this.prisma.db.parcela.groupBy({
        by: ['contratoId'],
        where: { contratoId: { in: todosContratos }, status: null, acordoId: null },
        _sum: { valorNominal: true },
      }),
      this.prisma.db.parcela.groupBy({
        by: ['contratoId'],
        where: {
          contratoId: { in: todosContratos },
          status: null,
          acordoId: null,
          dataVencimento: { lt: hoje },
        },
        _sum: { valorNominal: true },
      }),
      this.prisma.db.fatura.groupBy({
        by: ['contaId'],
        where: {
          contaId: { in: contas.map((c) => c.id) },
          dataVencimento: { lt: hoje },
          status: { in: ['ABERTA', 'FECHADA', 'VENCIDA'] },
        },
        _count: { _all: true },
      }),
    ]);
    const saldoPorContrato = new Map(saldos.map((s) => [s.contratoId, this.cent(s._sum.valorNominal)]));
    const atrasoPorContrato = new Map(atrasos.map((s) => [s.contratoId, this.cent(s._sum.valorNominal)]));
    const vencidasPorConta = new Map(vencidas.map((v) => [v.contaId, v._count._all]));

    return contas
      .map((conta) => {
        const vigentes = conta.contratosCredito.filter((ct) =>
          (CONTRATOS_VIGENTES as readonly string[]).includes(ct.status),
        );
        const saldoDevedor = vigentes.reduce((s, ct) => s + (saldoPorContrato.get(ct.id) ?? 0), 0);
        const valorEmAtraso = vigentes.reduce((s, ct) => s + (atrasoPorContrato.get(ct.id) ?? 0), 0);
        const bloqueada = conta.contratosCredito.some((ct) => ct.status === 'BLOQUEADO');
        return {
          contaId: conta.id,
          titularId: conta.titular.id,
          titular: conta.titular.nome,
          cpfCnpj: conta.titular.cpfCnpj,
          contratosAtivos: vigentes.length,
          contratosTotal: conta.contratosCredito.length,
          saldoDevedor,
          valorEmAtraso,
          faturasVencidas: vencidasPorConta.get(conta.id) ?? 0,
          bloqueada,
          situacao: bloqueada ? 'bloqueada' : valorEmAtraso > 0 ? 'em_atraso' : 'em_dia',
        };
      })
      .filter((c) => c.contratosTotal > 0);
  }

  async criar(dto: CriarContaDto): Promise<ContaApi> {
    // Titular precisa existir e não estar deletado (findFirst respeita soft delete).
    const titular = await this.prisma.db.titular.findFirst({
      where: { id: dto.titularId },
      select: { id: true },
    });
    if (!titular) {
      throw new NotFoundException({
        erro: 'nao_encontrado',
        mensagem: 'Titular não encontrado',
      });
    }

    // 1:1 — um titular tem no máximo uma conta (titularId @unique).
    const existente = await this.prisma.db.conta.findFirst({
      where: { titularId: dto.titularId },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException({
        erro: 'conta_existente',
        mensagem: 'Este titular já possui uma conta',
      });
    }

    const conta = await this.prisma.db.conta.create({
      data: { titularId: dto.titularId },
    });
    return contaParaApi(conta);
  }

  async buscarPorId(id: string): Promise<ContaApi> {
    const conta = await this.prisma.db.conta.findFirst({ where: { id } });
    if (!conta) throw this.naoEncontrada();
    return contaParaApi(conta);
  }

  async buscarPorTitular(titularId: string): Promise<ContaApi> {
    const conta = await this.prisma.db.conta.findFirst({ where: { titularId } });
    if (!conta) throw this.naoEncontrada();
    return contaParaApi(conta);
  }

  async atualizar(id: string, dto: AtualizarContaDto): Promise<ContaApi> {
    await this.garantirExiste(id);
    const conta = await this.prisma.db.conta.update({
      where: { id },
      data: { status: mapearStatusConta.paraPrisma(dto.status) },
    });
    return contaParaApi(conta);
  }

  private async garantirExiste(id: string): Promise<void> {
    const existe = await this.prisma.db.conta.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw this.naoEncontrada();
  }

  private naoEncontrada(): NotFoundException {
    return new NotFoundException({
      erro: 'nao_encontrado',
      mensagem: 'Conta não encontrada',
    });
  }
}
