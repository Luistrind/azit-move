import { Prisma } from '@prisma/client';
import { FormalizacaoService } from './formalizacao.service';

// Pacote da proposta após uma reformalização (caso Tatiana, 27/10/2026): o
// contrato 2026100005 foi cancelado (ENCERRADO/CANCELAMENTO) e a proposta gerou
// o 2026100006. O cancelado não pode aparecer como "pendente" nem bloquear a
// cobrança da entrada do novo. Sem banco.

const dec = (reais: number) => new Prisma.Decimal(reais.toFixed(2));

const cancelado = {
  id: 'c-old', numero: '2026100005', status: 'ENCERRADO', valorEntrada: dec(3000), entradaParcelada: false,
  assinaturaTitularEm: null, assinaturaAzitEm: null, cronogramaGeradoEm: null, dataEncerramento: new Date('2026-10-27T14:00:00.000Z'),
  itensContratados: [{ descricao: 'Fiat Argo 2022' }],
};
const vivo = {
  id: 'c-new', numero: '2026100006', status: 'AGUARDANDO_ASSINATURA', valorEntrada: dec(3000), entradaParcelada: false,
  assinaturaTitularEm: new Date('2026-10-27T15:00:00.000Z'), assinaturaAzitEm: new Date('2026-10-27T15:30:00.000Z'), cronogramaGeradoEm: null,
  itensContratados: [{ descricao: 'Fiat Argo 2022' }],
};

function montar() {
  const prisma = {
    db: {
      contratoCredito: {
        // Simula o filtro do Prisma: devolve conforme o `status` pedido no where.
        findMany: jest.fn().mockImplementation(({ where }: { where: { status?: unknown } }) => {
          const todos = [cancelado, vivo];
          if (where.status === 'ENCERRADO') return Promise.resolve(todos.filter((c) => c.status === 'ENCERRADO'));
          if (where.status && typeof where.status === 'object' && 'not' in (where.status as object)) {
            return Promise.resolve(todos.filter((c) => c.status !== (where.status as { not: string }).not));
          }
          return Promise.resolve(todos);
        }),
        findFirst: jest.fn(),
      },
    },
  };
  const service = new FormalizacaoService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { service, prisma };
}

describe('FormalizacaoService.statusPacote — contrato cancelado sai do pacote (27/10)', () => {
  it('lista só o contrato vivo, fecha todasAssinaturas e cita o anterior cancelado', async () => {
    const { service, prisma } = montar();
    const r = await service.statusPacote('prop-1');

    expect(prisma.db.contratoCredito.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { propostaPacoteId: 'prop-1', status: { not: 'ENCERRADO' } } }));
    expect(r.contratos.map((c) => c.numero)).toEqual(['2026100006']);
    expect(r.ancoraId).toBe('c-new');
    expect(r.entrada).toBe(300_000);
    expect(r.todasAssinaturas).toBe(true);
    expect(r.cronogramaGerado).toBe(false);
    expect(r.contratosCancelados).toEqual([{ id: 'c-old', numero: '2026100005', canceladoEm: '2026-10-27T14:00:00.000Z' }]);
  });

  it('pacote só com cancelado (antes de reformalizar): lista vazia e nada assinado', async () => {
    const { service, prisma } = montar();
    prisma.db.contratoCredito.findMany.mockImplementation(({ where }: { where: { status?: unknown } }) =>
      Promise.resolve(where.status === 'ENCERRADO' ? [cancelado] : []));
    const r = await service.statusPacote('prop-1');
    expect(r.contratos).toEqual([]);
    expect(r.ancoraId).toBeNull();
    expect(r.todasAssinaturas).toBe(false);
    expect(r.contratosCancelados).toHaveLength(1);
  });
});

describe('FormalizacaoService.ativar — gate da entrada ignora contrato encerrado do pacote (27/10)', () => {
  function montarAtivar(pendente: { numero: string } | null, statusDoNovo = 'AGUARDANDO_ASSINATURA') {
    const { service, prisma } = montar();
    prisma.db.contratoCredito.findFirst.mockImplementation(({ where }: { where: { id?: string; propostaPacoteId?: string } }) => {
      if (where.id) return Promise.resolve({ ...vivo, status: statusDoNovo, propostaPacoteId: 'prop-1', ativoId: 'ativo-1', conta: { titular: {} } });
      return Promise.resolve(pendente);
    });
    return { service, prisma };
  }

  it('consulta pendentes SÓ entre os contratos vivos do pacote', async () => {
    // Nenhum pendente vivo, mas o contrato está ATIVO → o gate das assinaturas
    // passou e a rotina parou no gate seguinte (estado), provando o filtro.
    const { service, prisma } = montarAtivar(null, 'ATIVO');
    await expect(service.ativar('c-new')).rejects.toMatchObject({ response: { erro: 'estado_invalido' } });
    expect(prisma.db.contratoCredito.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        propostaPacoteId: 'prop-1',
        status: { not: 'ENCERRADO' },
        OR: [{ assinaturaTitularEm: null }, { assinaturaAzitEm: null }],
      },
    }));
  });

  it('contrato vivo sem assinatura ainda bloqueia a entrada', async () => {
    const { service } = montarAtivar({ numero: '2026100007' });
    await expect(service.ativar('c-new')).rejects.toMatchObject({ response: { erro: 'assinatura_pendente' } });
  });
});
