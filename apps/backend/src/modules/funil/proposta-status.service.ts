import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StatusProposta } from '@prisma/client';
import { FUSO_NEGOCIO } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { derivarStatusProposta } from './proposta-status';

// Único gravador do status da proposta (04/11/2026). Os fluxos produzem fatos
// (abrem/liberam/encerram a análise, registram parecer, geram contrato) e
// chamam sincronizar(); a varredura na subida e diária corrige o que escapou e
// deixa rastro na auditoria (acao 'proposta_status_sincronizado').
@Injectable()
export class PropostaStatusService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PropostaStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sincronizar(propostaId: string, motivo: string, usuarioId?: string): Promise<StatusProposta | null> {
    const p = await this.prisma.db.proposta.findFirst({
      where: { id: propostaId },
      select: {
        id: true,
        status: true,
        contratoGeradoId: true,
        analiseCadastro: { select: { status: true } },
        parecer: { select: { resultado: true } },
      },
    });
    if (!p) return null;
    const alvo = derivarStatusProposta({
      statusGravado: p.status,
      contratoGeradoId: p.contratoGeradoId,
      analise: p.analiseCadastro,
      parecer: p.parecer,
    });
    if (alvo === p.status) return alvo;
    await this.prisma.db.$transaction([
      this.prisma.db.proposta.update({ where: { id: p.id }, data: { status: alvo } }),
      this.prisma.db.logAuditoria.create({
        data: {
          usuarioId,
          acao: 'proposta_status_sincronizado',
          entidade: 'proposta',
          entidadeId: p.id,
          antes: { status: p.status },
          depois: { status: alvo, motivo },
        },
      }),
    ]);
    return alvo;
  }

  // Varredura: toda proposta viva passa pela função. Correção aqui significa que
  // algum fluxo gravou (ou deixou de gravar) status por fora — o log aponta.
  async sincronizarTodas(motivo: string): Promise<{ conferidas: number; corrigidas: { id: string; de: StatusProposta; para: StatusProposta }[] }> {
    const propostas = await this.prisma.db.proposta.findMany({ where: { deletedAt: null }, select: { id: true, status: true } });
    const corrigidas: { id: string; de: StatusProposta; para: StatusProposta }[] = [];
    for (const p of propostas) {
      const para = await this.sincronizar(p.id, motivo);
      if (para && para !== p.status) corrigidas.push({ id: p.id, de: p.status, para });
    }
    if (corrigidas.length) {
      this.logger.warn(
        `Status de proposta divergente dos fatos em ${corrigidas.length} de ${propostas.length} (${motivo}): ` +
          corrigidas.map((c) => `${c.id} ${c.de}→${c.para}`).join(', ') +
          ' — algum fluxo gravou status fora do PropostaStatusService; ver auditoria proposta_status_sincronizado',
      );
    } else {
      this.logger.log(`Status das ${propostas.length} propostas conferido (${motivo}) — nenhuma divergência`);
    }
    return { conferidas: propostas.length, corrigidas };
  }

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    void this.sincronizarTodas('varredura na subida').catch((e: Error) =>
      this.logger.error(`Varredura de status das propostas falhou: ${e.message}`),
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_5AM, { timeZone: FUSO_NEGOCIO })
  async varreduraDiaria() {
    await this.sincronizarTodas('varredura diária');
  }
}
