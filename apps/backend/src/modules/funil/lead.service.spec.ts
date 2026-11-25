import { LeadService } from './lead.service';
import { criarLeadSchema } from './dto/lead.dto';

// Lead nascido pelas Conversas do WhatsApp (doc 02 §34.5): CPF opcional e as
// simulações feitas para o número antes do lead passam para ele.
function montar(titularDoCpf: { id: string } | null = null) {
  const prisma = {
    db: {
      titular: { findFirst: jest.fn(async () => (titularDoCpf ? { ...titularDoCpf, nome: 'Já Titular', cpfCnpj: '12345678909', whatsapp: null } : null)) },
      lead: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'lead1', ...data })) },
      simulacao: { updateMany: jest.fn(async () => ({ count: 2 })) },
    },
  };
  return { service: new LeadService(prisma as never), prisma };
}

describe('LeadService — lead do WhatsApp (doc 02 §34.5)', () => {
  it('o DTO aceita lead sem CPF (vazio vira ausente)', () => {
    const dto = criarLeadSchema.parse({ nome: 'Júlio Santos', cpf: '', telefone: '27998124410', canalOrigem: 'whatsapp' });
    expect(dto.cpf).toBeUndefined();
  });

  it('cria o lead sem CPF e adota as simulações sem dono do número', async () => {
    const m = montar();
    const r = await m.service.criar(criarLeadSchema.parse({ nome: 'Júlio Santos', telefone: '5527998124410', canalOrigem: 'whatsapp' }));
    expect(r).toMatchObject({ tipo: 'lead', lead: { id: 'lead1', cpf: null } });
    expect(m.prisma.db.titular.findFirst).not.toHaveBeenCalled();
    expect(m.prisma.db.lead.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cpf: null, canalOrigem: 'WHATSAPP' }) });
    expect(m.prisma.db.simulacao.updateMany).toHaveBeenCalledWith({
      where: { numeroWhatsapp: '5527998124410', leadId: null, titularId: null },
      data: { leadId: 'lead1' },
    });
  });

  it('CPF de titular existente: não cria lead e as simulações do número vão para o titular', async () => {
    const m = montar({ id: 't9' });
    const r = await m.service.criar(criarLeadSchema.parse({ nome: 'X', cpf: '123.456.789-09', telefone: '(27) 99812-4410', canalOrigem: 'whatsapp' }));
    expect(r.tipo).toBe('titular');
    expect(m.prisma.db.lead.create).not.toHaveBeenCalled();
    expect(m.prisma.db.simulacao.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { titularId: 't9' } }));
  });
});
