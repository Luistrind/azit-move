import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, RoleUsuario } from '@prisma/client';
import { centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AlcadaService } from '../alcada/alcada.service';
import { QUEUE_NAMES } from '../queues/queues.module';

const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

// 6.8 — Reajuste anual por IPCA (Doc 2 §7.5, gatilho 10). Gera evento PENDENTE,
// que passa por aprovação humana (alçada) e só então atualiza as parcelas FUTURAS.
@Injectable()
export class ReajusteService {
  private readonly logger = new Logger(ReajusteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alcada: AlcadaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICAR_CLIENTE) private readonly filaNotificar: Queue,
  ) {}

  private hojeUTC(): Date {
    return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  }

  // Gera o evento de reajuste (PENDENTE) — não aplica ainda.
  async gerar(contratoId: string, indicePercentual: number) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, valorParcelaInicial: true },
    });
    if (!contrato) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    }
    const anterior = cent(contrato.valorParcelaInicial);
    const novo = Math.round(anterior * (1 + indicePercentual / 100));
    const reajuste = await this.prisma.db.reajusteIPCA.create({
      data: {
        contratoId,
        dataAniversario: this.hojeUTC(),
        indiceAplicado: indicePercentual.toFixed(4),
        valorParcelaAnterior: reais(anterior),
        valorParcelaNovo: reais(novo),
      },
    });
    return { id: reajuste.id, status: 'pendente', valorParcelaAnterior: anterior, valorParcelaNovo: novo };
  }

  // Aprovação humana via alçada (tipo REAJUSTE).
  async aprovar(reajusteId: string, aprovadorId: string, roles: RoleUsuario[]) {
    const reajuste = await this.prisma.db.reajusteIPCA.findFirst({ where: { id: reajusteId } });
    if (!reajuste) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Reajuste não encontrado' });
    }
    if (reajuste.status !== 'PENDENTE') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Reajuste não está pendente' });
    }
    const alcada = await this.alcada.verificar('REAJUSTE', cent(reajuste.valorParcelaNovo), roles);
    if (!alcada.aprovado) {
      throw new ForbiddenException({ erro: 'fora_da_alcada', mensagem: alcada.motivo });
    }
    await this.prisma.db.reajusteIPCA.update({
      where: { id: reajusteId },
      data: { status: 'APROVADO', aprovadoPor: aprovadorId, dataAprovacao: new Date() },
    });
    return { resultado: 'aprovado', nivelAlcada: alcada.nivel };
  }

  // Aplica o reajuste nas parcelas FUTURAS (status null, vencimento > hoje) e
  // atualiza a parcela-base do contrato. Cliente notificado (30 dias de antecedência).
  async aplicar(reajusteId: string) {
    const reajuste = await this.prisma.db.reajusteIPCA.findFirst({
      where: { id: reajusteId },
      include: { contrato: { select: { id: true } } },
    });
    if (!reajuste) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Reajuste não encontrado' });
    }
    if (reajuste.status !== 'APROVADO') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Reajuste precisa estar aprovado' });
    }
    const anterior = cent(reajuste.valorParcelaAnterior);
    const novo = cent(reajuste.valorParcelaNovo);
    const fator = anterior > 0 ? novo / anterior : 1;
    const hoje = this.hojeUTC();

    let parcelasAtualizadas = 0;
    await this.prisma.db.$transaction(async (tx) => {
      const futuras = await tx.parcela.findMany({
        where: { contratoId: reajuste.contrato.id, status: null, dataVencimento: { gt: hoje } },
        select: { id: true, valorNominal: true },
      });
      for (const p of futuras) {
        const novoValor = Math.round(cent(p.valorNominal) * fator);
        await tx.parcela.update({ where: { id: p.id }, data: { valorNominal: reais(novoValor) } });
        await tx.recebivel.updateMany({
          where: { parcelaId: p.id },
          data: { valorPrevisto: reais(novoValor) },
        });
      }
      parcelasAtualizadas = futuras.length;
      await tx.contratoCredito.update({
        where: { id: reajuste.contrato.id },
        data: { valorParcelaInicial: reais(novo) },
      });
      await tx.reajusteIPCA.update({
        where: { id: reajusteId },
        data: { status: 'APLICADO', dataAplicacao: new Date(), dataNotificacaoCliente: new Date() },
      });
    });
    await this.filaNotificar.add('reajuste', { contratoId: reajuste.contrato.id });
    this.logger.log(`Reajuste ${reajusteId} aplicado: ${parcelasAtualizadas} parcelas futuras`);
    return { resultado: 'aplicado', parcelasAtualizadas };
  }

  async listar(contratoId: string) {
    const reajustes = await this.prisma.db.reajusteIPCA.findMany({
      where: { contratoId },
      orderBy: { createdAt: 'desc' },
    });
    return reajustes.map((r) => ({
      id: r.id,
      status: r.status.toLowerCase(),
      indiceAplicado: Number(r.indiceAplicado.toString()),
      valorParcelaAnterior: cent(r.valorParcelaAnterior),
      valorParcelaNovo: cent(r.valorParcelaNovo),
      dataAniversario: r.dataAniversario.toISOString(),
      dataAplicacao: r.dataAplicacao ? r.dataAplicacao.toISOString() : null,
    }));
  }
}
