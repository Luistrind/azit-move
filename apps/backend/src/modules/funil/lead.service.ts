import { Injectable } from '@nestjs/common';
import { CanalOrigem } from '@prisma/client';
import { limparDocumento } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CriarLeadDto } from './dto/lead.dto';

// 7.2 — Lead e pré-cadastro (Doc 2 §4-A.1). Reconciliação por CPF: se o CPF já
// pertence a um Titular, NÃO cria Lead — devolve o Titular. Senão cria o Lead.
@Injectable()
export class LeadService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarLeadDto) {
    const cpf = limparDocumento(dto.cpf);

    const titular = await this.prisma.db.titular.findFirst({
      where: { cpfCnpj: cpf },
      select: { id: true, nome: true, cpfCnpj: true, whatsapp: true },
    });
    if (titular) {
      // CPF conhecido → recupera o Titular (não duplica em Lead).
      return { tipo: 'titular' as const, titular };
    }

    const lead = await this.prisma.db.lead.create({
      data: {
        nome: dto.nome,
        cpf,
        dataNascimento: dto.dataNascimento,
        canalOrigem: dto.canalOrigem.toUpperCase() as CanalOrigem,
      },
    });
    return {
      tipo: 'lead' as const,
      lead: { id: lead.id, nome: lead.nome, cpf: lead.cpf },
    };
  }

  async listar() {
    const leads = await this.prisma.db.lead.findMany({
      where: { titularId: null }, // ainda não promovidos
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return leads.map((l) => ({
      id: l.id,
      nome: l.nome,
      cpf: l.cpf,
      canalOrigem: l.canalOrigem.toLowerCase(),
      createdAt: l.createdAt.toISOString(),
    }));
  }
}
