import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CanalOrigem } from '@prisma/client';
import { limparDocumento, validarCPF } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CriarLeadDto } from './dto/lead.dto';

// 7.2 — Lead e pré-cadastro (Doc 2 §4-A.1). Reconciliação por CPF: se o CPF já
// pertence a um Titular, NÃO cria Lead — devolve o Titular. Senão cria o Lead.
// Desde 25/11 (§34.5) o lead que nasce pelas Conversas do WhatsApp pode ser
// registrado sem CPF; o CPF é exigido para SIMULAR (SimulacaoService) e pode
// ser informado depois (informarCpf).
@Injectable()
export class LeadService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarLeadDto) {
    const cpf = dto.cpf ? limparDocumento(dto.cpf) : null;

    const titular = cpf
      ? await this.prisma.db.titular.findFirst({
          where: { cpfCnpj: cpf },
          select: { id: true, nome: true, cpfCnpj: true, whatsapp: true },
        })
      : null;
    if (titular) {
      // CPF conhecido → recupera o Titular (não duplica em Lead).
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
    return {
      tipo: 'lead' as const,
      lead: { id: lead.id, nome: lead.nome, cpf: lead.cpf, telefone: lead.telefone },
    };
  }

  // CPF do lead que nasceu sem ele (§34.5), antes de simular. CPF de titular
  // não é gravado no lead: devolve o titular para o operador acertar o cadastro.
  async informarCpf(leadId: string, cpfBruto: string) {
    const cpf = limparDocumento(cpfBruto ?? '');
    if (!validarCPF(cpf)) throw new UnprocessableEntityException({ erro: 'cpf_invalido', mensagem: 'CPF inválido' });
    const lead = await this.prisma.db.lead.findFirst({ where: { id: leadId }, select: { id: true } });
    if (!lead) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Lead não encontrado' });
    const titular = await this.prisma.db.titular.findFirst({ where: { cpfCnpj: cpf }, select: { id: true, nome: true } });
    if (titular) return { tipo: 'titular' as const, titular };
    const atualizado = await this.prisma.db.lead.update({ where: { id: leadId }, data: { cpf } });
    return { tipo: 'lead' as const, lead: { id: atualizado.id, nome: atualizado.nome, cpf: atualizado.cpf, telefone: atualizado.telefone } };
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
