import { Injectable } from '@nestjs/common';
import { CanalOrigem } from '@prisma/client';
import { limparDocumento, normalizarWhatsapp } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CriarLeadDto } from './dto/lead.dto';

// 7.2 — Lead e pré-cadastro (Doc 2 §4-A.1). Reconciliação por CPF: se o CPF já
// pertence a um Titular, NÃO cria Lead — devolve o Titular. Senão cria o Lead.
// Desde 25/11 (§34.5) o CPF é opcional: o lead que nasce pelas Conversas do
// WhatsApp só tem nome e número, e recebe as simulações feitas para aquele
// número antes de existir.
@Injectable()
export class LeadService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarLeadDto) {
    const cpf = dto.cpf ? limparDocumento(dto.cpf) : null;
    const numero = normalizarWhatsapp(dto.telefone);

    const titular = cpf
      ? await this.prisma.db.titular.findFirst({
          where: { cpfCnpj: cpf },
          select: { id: true, nome: true, cpfCnpj: true, whatsapp: true },
        })
      : null;
    if (titular) {
      // CPF conhecido → recupera o Titular (não duplica em Lead).
      await this.adotarSimulacoesDoNumero(numero, { titularId: titular.id });
      return { tipo: 'titular' as const, titular };
    }

    const lead = await this.prisma.db.lead.create({
      data: {
        nome: dto.nome,
        cpf,
        telefone: dto.telefone,
        dataNascimento: dto.dataNascimento,
        canalOrigem: dto.canalOrigem.toUpperCase() as CanalOrigem,
      },
    });
    await this.adotarSimulacoesDoNumero(numero, { leadId: lead.id });
    return {
      tipo: 'lead' as const,
      lead: { id: lead.id, nome: lead.nome, cpf: lead.cpf, telefone: lead.telefone },
    };
  }

  // Simulação feita pelas Conversas antes do lead existir (§34.5) passa a ser
  // do lead (ou do titular) que nasce daquele número. Só as sem dono.
  private async adotarSimulacoesDoNumero(numero: string | null, dono: { leadId: string } | { titularId: string }) {
    if (!numero) return;
    await this.prisma.db.simulacao.updateMany({
      where: { numeroWhatsapp: numero, leadId: null, titularId: null },
      data: dono,
    });
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
