import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { centavosParaReaisString } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { QUEUE_NAMES } from '../queues/queues.module';

const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

// 6.8 — Reajuste anual por IPCA (Doc 2 §7.5, gatilho 10). Gera evento PENDENTE +
// solicitação no motor de aprovação (§7.9-A); a efetivação aprova E aplica nas
// parcelas FUTURAS.
@Injectable()
export class ReajusteService implements OnModuleInit {
  private readonly logger = new Logger(ReajusteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aprovacao: AprovacaoService,
    @InjectQueue(QUEUE_NAMES.NOTIFICAR_CLIENTE) private readonly filaNotificar: Queue,
  ) {}

  onModuleInit() {
    this.aprovacao.registrarEfetivador('reajuste', {
      aprovada: async (a) => {
        await this.aprovar(a.referenciaId, a.decisorId);
        const r = await this.aplicar(a.referenciaId);
        return `Reajuste aplicado em ${r.parcelasAtualizadas} parcela(s) futura(s).`;
      },
      reprovada: async (a) => {
        await this.prisma.db.reajusteIPCA.updateMany({
          where: { id: a.referenciaId, status: 'PENDENTE' },
          data: { status: 'CANCELADO' },
        });
      },
    });
  }

  private hojeUTC(): Date {
    return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  }

  // Gera o evento de reajuste (PENDENTE) + solicitação de aprovação.
  async gerar(contratoId: string, indicePercentual: number, solicitanteId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: {
        id: true,
        numero: true,
        valorParcelaInicial: true,
        conta: { select: { titularId: true } },
      },
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
    await this.aprovacao.criar({
      tipoOperacao: 'reajuste',
      referenciaTipo: 'reajuste',
      referenciaId: reajuste.id,
      titularId: contrato.conta.titularId,
      valorCentavos: novo,
      resumo: `Reajuste IPCA ${indicePercentual.toFixed(2)}% no contrato ${contrato.numero} — parcela R$ ${reais(anterior)} → R$ ${reais(novo)}`,
      solicitanteId,
    });
    return { id: reajuste.id, status: 'aguardando_aprovacao', valorParcelaAnterior: anterior, valorParcelaNovo: novo };
  }

  // Marca aprovado (chamado pela efetivação do motor — a alçada já foi verificada lá).
  private async aprovar(reajusteId: string, aprovadorId: string) {
    const reajuste = await this.prisma.db.reajusteIPCA.findFirst({ where: { id: reajusteId } });
    if (!reajuste) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Reajuste não encontrado' });
    }
    if (reajuste.status !== 'PENDENTE') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'Reajuste não está pendente' });
    }
    await this.prisma.db.reajusteIPCA.update({
      where: { id: reajusteId },
      data: { status: 'APROVADO', aprovadoPor: aprovadorId, dataAprovacao: new Date() },
    });
    return { resultado: 'aprovado' };
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
        where: { contratoId: reajuste.contrato.id, status: null, dataVencimento: { gt: hoje }, acordoId: null },
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
