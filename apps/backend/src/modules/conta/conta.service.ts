import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { inicioHojeBrasilUTC, contarPorTipo } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CriarContaDto } from './dto/criar-conta.dto';
import { AtualizarContaDto } from './dto/atualizar-conta.dto';
import { ContaApi, contaParaApi, mapearStatusConta } from './conta.mapper';
import { SELECT_TIPO_CONTRATO, tiposDosContratos } from '../contrato/tipo-contrato';

// Modelo de 3 camadas (doc 02 §5.2, 07/09): vigente = fase ATIVO; bloqueio é
// carimbo (veiculoBloqueadoEm); situação financeira é calculada — inclusive o
// novo estado 'em_acordo' (atraso coberto por acordo ativo).

@Injectable()
export class ContaService {
  constructor(private readonly prisma: PrismaService) {}

  private cent(v: unknown): number {
    return Math.round(Number(v?.toString() ?? '0') * 100);
  }

  // Carteira TITULAR-cêntrica (Doc 2: a arquitetura é centrada no titular): posição
  // consolidada por conta — saldo, atraso, contratos, bloqueio — para a tela Carteira.
  // Decisão Luís 29/10/2026 (doc 02 §5.2 "KPIs da carteira"): mesma régua dos
  // cartões — "Em atraso" e "Faturas vencidas" vêm das FATURAS da conta (vencidas
  // em aberto), a coluna Contratos conta só os de VEÍCULO e marca "+RP" quando há
  // reembolso/crédito em andamento; "em acordo" = nenhuma fatura vencida em aberto
  // (as cobertas viram RENEGOCIADA) e acordo ATIVO na conta.
  async carteira() {
    const hoje = inicioHojeBrasilUTC(); // fuso do negócio (A4, 04/09)
    const contas = await this.prisma.db.conta.findMany({
      where: { titular: { deletedAt: null } },
      include: {
        titular: { select: { id: true, nome: true, cpfCnpj: true } },
        contratosCredito: { select: { ...SELECT_TIPO_CONTRATO, status: true, veiculoBloqueadoEm: true } },
        acordos: { where: { status: 'ATIVO' }, select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Agregados em lote (evita N+1 pesado): parcelas por contrato, faturas por conta.
    const vigentesTodos = contas.flatMap((c) => c.contratosCredito.filter((ct) => ct.status === 'ATIVO'));
    const [tipos, saldos, vencidas] = await Promise.all([
      tiposDosContratos(this.prisma.db, vigentesTodos),
      this.prisma.db.parcela.groupBy({
        by: ['contratoId'],
        where: { contratoId: { in: vigentesTodos.map((ct) => ct.id) }, status: null, acordoId: null },
        _sum: { valorNominal: true },
      }),
      // Fatura vencida em aberto (ABERTA/FECHADA antes de hoje): o que falta
      // pagar é total − pago parcial. RENEGOCIADA/NOVADA ficam fora.
      this.prisma.db.fatura.findMany({
        where: {
          contaId: { in: contas.map((c) => c.id) },
          dataVencimento: { lt: hoje },
          status: { in: ['ABERTA', 'FECHADA'] },
        },
        select: { contaId: true, valorTotal: true, valorPago: true },
      }),
    ]);
    const saldoPorContrato = new Map(saldos.map((s) => [s.contratoId, this.cent(s._sum.valorNominal)]));
    const vencidasPorConta = new Map<string, { quantidade: number; valor: number }>();
    for (const f of vencidas) {
      const atual = vencidasPorConta.get(f.contaId) ?? { quantidade: 0, valor: 0 };
      atual.quantidade += 1;
      atual.valor += Math.max(0, this.cent(f.valorTotal) - this.cent(f.valorPago));
      vencidasPorConta.set(f.contaId, atual);
    }

    return contas
      .map((conta) => {
        const vigentes = conta.contratosCredito.filter((ct) => ct.status === 'ATIVO');
        const porTipo = contarPorTipo(vigentes.map((ct) => tipos.get(ct.id) ?? 'veiculo'));
        const saldoDevedor = vigentes.reduce((s, ct) => s + (saldoPorContrato.get(ct.id) ?? 0), 0);
        const atraso = vencidasPorConta.get(conta.id) ?? { quantidade: 0, valor: 0 };
        const bloqueada = conta.contratosCredito.some((ct) => ct.veiculoBloqueadoEm !== null);
        const emAcordo = conta.acordos.length > 0;
        return {
          contaId: conta.id,
          titularId: conta.titular.id,
          titular: conta.titular.nome,
          cpfCnpj: conta.titular.cpfCnpj,
          // Só contratos de VEÍCULO; os demais vigentes ficam em contratosPorTipo.
          contratosAtivos: porTipo.veiculo,
          contratosPorTipo: porTipo,
          reembolsosAtivos: porTipo.reembolso + porTipo.credito,
          contratosTotal: conta.contratosCredito.length,
          saldoDevedor,
          valorEmAtraso: atraso.valor,
          faturasVencidas: atraso.quantidade,
          bloqueada,
          situacao: bloqueada ? 'bloqueada' : atraso.quantidade > 0 ? 'em_atraso' : emAcordo ? 'em_acordo' : 'em_dia',
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
