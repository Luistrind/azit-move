import { TitularService } from './titular.service';

// Edição do cadastro vivo pela ficha (27/11, caso João Rios Neto: lembrete
// "131026 Message undeliverable" — número errado no cadastro).
describe('Titular — edição do cadastro', () => {
  const base = {
    id: 't1', nome: 'João Rios Neto', tipoPessoa: 'PF', cpfCnpj: '01481392646', rg: null, estadoCivil: null, profissao: null,
    whatsapp: '27994711501', email: 'joao@exemplo.com', endereco: null, bairro: null, cidade: null, estado: null, cep: null,
    status: 'ATIVO', asaasCustomerId: 'cus_123', createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
  const montar = (asaasFalha?: Error) => {
    let atual = { ...base };
    const auditoria: unknown[] = [];
    const prisma = {
      db: {
        titular: {
          findFirst: jest.fn(async () => ({ ...atual })),
          update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            atual = { ...atual, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) } as typeof atual;
            return { ...atual };
          }),
        },
        logAuditoria: { create: jest.fn(async ({ data }: { data: unknown }) => auditoria.push(data)) },
      },
    };
    const asaas = {
      clienteReutilizavel: jest.fn((id: string | null) => id),
      atualizarContatoCliente: jest.fn(async () => { if (asaasFalha) throw asaasFalha; }),
    };
    return { service: new TitularService(prisma as never, asaas as never), asaas, auditoria, prisma };
  };

  it('troca o WhatsApp, audita e leva o celular novo ao cliente no Asaas', async () => {
    const m = montar();
    const r = await m.service.atualizar('t1', { whatsapp: '(27) 99888-7766' }, 'u-luis');
    expect(r.whatsapp).toBe('(27) 99888-7766');
    expect(r.asaas).toEqual({ situacao: 'atualizado' });
    expect(m.asaas.atualizarContatoCliente).toHaveBeenCalledWith('cus_123', { telefone: '(27) 99888-7766' });
    expect(m.auditoria).toHaveLength(1);
  });

  it('WhatsApp inválido é recusado e nada é gravado', async () => {
    const m = montar();
    await expect(m.service.atualizar('t1', { whatsapp: '1234' }, 'u-luis')).rejects.toMatchObject({ response: { erro: 'whatsapp_invalido' } });
    expect(m.prisma.db.titular.update).not.toHaveBeenCalled();
  });

  it('Asaas recusou: a edição no sistema vale e a resposta diz o que faltou', async () => {
    const m = montar(new Error('Asaas PUT /customers/cus_123 retornou 400'));
    const r = await m.service.atualizar('t1', { email: 'novo@exemplo.com' }, 'u-luis');
    expect(r.email).toBe('novo@exemplo.com');
    expect(r.asaas).toMatchObject({ situacao: 'falhou', motivo: expect.stringContaining('400') });
  });

  it('sem mudança de contato (ex.: só profissão), o Asaas não é chamado', async () => {
    const m = montar();
    const r = await m.service.atualizar('t1', { profissao: 'Motorista de aplicativo' }, 'u-luis');
    expect(r.asaas).toEqual({ situacao: 'sem_mudanca' });
    expect(m.asaas.atualizarContatoCliente).not.toHaveBeenCalled();
  });
});
