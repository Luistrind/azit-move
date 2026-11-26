import { LeadService } from './lead.service';
import { SimulacaoService } from './simulacao.service';
import { criarLeadSchema } from './dto/lead.dto';

// Lead nascido pelas Conversas do WhatsApp (doc 02 §34.5, decisão Luís 25/11):
// pode ser registrado sem CPF, mas o CPF é obrigatório para SIMULAR.
const CPF_VALIDO = '52998224725';

function montar(titularDoCpf: { id: string } | null = null, lead: { id: string; cpf: string | null } | null = { id: 'lead1', cpf: null }) {
  const prisma = {
    db: {
      titular: { findFirst: jest.fn(async () => (titularDoCpf ? { ...titularDoCpf, nome: 'Já Titular', cpfCnpj: CPF_VALIDO, whatsapp: null } : null)) },
      lead: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'lead1', ...data })),
        findFirst: jest.fn(async () => lead),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'lead1', nome: 'Júlio', telefone: '27998124410', ...data })),
      },
    },
  };
  return { service: new LeadService(prisma as never), prisma };
}

describe('LeadService — lead do WhatsApp (doc 02 §34.5)', () => {
  it('o DTO aceita lead sem CPF (vazio vira ausente) e o lead nasce sem CPF', async () => {
    const dto = criarLeadSchema.parse({ nome: 'Júlio Santos', cpf: '', telefone: '27998124410', canalOrigem: 'whatsapp' });
    expect(dto.cpf).toBeUndefined();
    const m = montar();
    const r = await m.service.criar(dto);
    expect(r).toMatchObject({ tipo: 'lead', lead: { id: 'lead1', cpf: null } });
    expect(m.prisma.db.titular.findFirst).not.toHaveBeenCalled();
    expect(m.prisma.db.lead.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cpf: null, canalOrigem: 'WHATSAPP' }) });
  });

  it('informar o CPF depois grava no lead', async () => {
    const m = montar();
    await expect(m.service.informarCpf('lead1', '529.982.247-25')).resolves.toMatchObject({ tipo: 'lead', lead: { cpf: CPF_VALIDO } });
    expect(m.prisma.db.lead.update).toHaveBeenCalledWith({ where: { id: 'lead1' }, data: { cpf: CPF_VALIDO } });
  });

  it('CPF inválido é recusado; CPF de titular não é gravado no lead', async () => {
    await expect(montar().service.informarCpf('lead1', '111.111.111-11')).rejects.toMatchObject({ response: { erro: 'cpf_invalido' } });
    const m = montar({ id: 't9' });
    await expect(m.service.informarCpf('lead1', CPF_VALIDO)).resolves.toMatchObject({ tipo: 'titular', titular: { id: 't9' } });
    expect(m.prisma.db.lead.update).not.toHaveBeenCalled();
  });
});

describe('SimulacaoService — CPF obrigatório para simular (doc 02 §34.5)', () => {
  it('lead sem CPF não simula (422 lead_sem_cpf) e nada é gravado', async () => {
    const m = montar();
    const prisma = { db: { ...m.prisma.db, simulacao: { create: jest.fn() } } };
    const service = new SimulacaoService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.criar({ leadId: 'lead1', valorAvista: 6_000_000 })).rejects.toMatchObject({ response: { erro: 'lead_sem_cpf' } });
    expect(prisma.db.simulacao.create).not.toHaveBeenCalled();
  });
});
