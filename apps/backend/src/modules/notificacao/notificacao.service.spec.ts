import { NotificacaoService } from './notificacao.service';

// Ponte notificação → e-mail (doc 06 v1.1 §12): só notificação DIRIGIDA, de
// aprovação, com conteúdo próprio de e-mail; preferência por usuário; descarte
// na saída da fila; rastro gravado na própria notificação. Sem banco.

function montar(usuario: Record<string, unknown> | null = { email: 'ana@azit.com.br', preferencias: null }) {
  const prisma = {
    db: {
      notificacao: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'n-1', ...data })),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      notificacaoLida: { findFirst: jest.fn().mockResolvedValue(null) },
      usuario: { findFirst: jest.fn().mockResolvedValue(usuario) },
      aprovacao: { findFirst: jest.fn().mockResolvedValue({ status: 'PENDENTE', decisoes: [] }) },
    },
  };
  const email = { enviar: jest.fn().mockResolvedValue({ jobId: '1' }), registrarOrigem: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('https://app.azitmove.com.br') };
  const service = new NotificacaoService(prisma as never, { areasEfetivas: jest.fn() } as never, email as never, config as never);
  return { service, prisma, email };
}

const conteudo = { assunto: 'Aprovação esperando por você: Acordo', linhas: ['Operação: Acordo', 'Valor: R$ 4.188,00'], aprovacaoPendenteId: 'ap-1' };

describe('NotificacaoService — ponte para o e-mail', () => {
  it('dirigida + aprovação + conteúdo: enfileira com link absoluto e origem notificacao', async () => {
    const { service, email } = montar();
    const id = await service.emitir({ titulo: 'Aprovação esperando por você', corpo: 'Renegociação — Wallace', rota: '/aprovacoes/ap-1', tipo: 'APROVACAO', usuarioId: 'u-1', email: conteudo });
    expect(id).toBe('n-1');
    expect(email.enviar).toHaveBeenCalledTimes(1);
    const chamada = email.enviar.mock.calls[0][0];
    expect(chamada.para).toBe('ana@azit.com.br');
    expect(chamada.assunto).toBe(conteudo.assunto);
    expect(chamada.corpo.texto).toContain('Abrir no Hub: https://app.azitmove.com.br/aprovacoes/ap-1');
    // o corpo do SINO (cita o cliente) NÃO vai para o e-mail
    expect(chamada.corpo.texto).not.toContain('Wallace');
    expect(chamada.origem).toEqual({ tipo: 'notificacao', id: 'n-1', contexto: { usuarioId: 'u-1', aprovacaoPendenteId: 'ap-1' } });
  });

  it('por área, geral, sem conteúdo de e-mail ou de outro tipo: só o sino', async () => {
    const { service, email } = montar();
    await service.emitir({ titulo: 'x', rota: '/a', tipo: 'APROVACAO', area: 'APROVACOES', email: conteudo });
    await service.emitir({ titulo: 'x', rota: '/a', tipo: 'FALHA' });
    await service.emitir({ titulo: 'x', rota: '/a', tipo: 'APROVACAO', usuarioId: 'u-1' });
    await service.emitir({ titulo: 'x', rota: '/a', tipo: 'INFO', usuarioId: 'u-1', email: conteudo });
    expect(email.enviar).not.toHaveBeenCalled();
  });

  it('preferência desligada ou usuário inativo: não enfileira (o sino continua)', async () => {
    const off = montar({ email: 'ana@azit.com.br', preferencias: { emailAlertas: false } });
    await off.service.emitir({ titulo: 'x', rota: '/a', tipo: 'APROVACAO', usuarioId: 'u-1', email: conteudo });
    expect(off.email.enviar).not.toHaveBeenCalled();
    expect(off.prisma.db.notificacao.create).toHaveBeenCalledTimes(1);
    const inativo = montar(null);
    await inativo.service.emitir({ titulo: 'x', rota: '/a', tipo: 'APROVACAO', usuarioId: 'u-1', email: conteudo });
    expect(inativo.email.enviar).not.toHaveBeenCalled();
  });

  it('falha ao enfileirar (Redis fora) não derruba a operação e fica no rastro', async () => {
    const { service, prisma, email } = montar();
    email.enviar.mockRejectedValue(new Error('ECONNREFUSED'));
    const id = await service.emitir({ titulo: 'x', rota: '/a', tipo: 'APROVACAO', usuarioId: 'u-1', email: conteudo });
    expect(id).toBe('n-1');
    expect(prisma.db.notificacao.update).toHaveBeenCalledWith({ where: { id: 'n-1' }, data: { emailFalha: 'nao_enfileirado: ECONNREFUSED' } });
  });
});

describe('NotificacaoService — descarte na saída da fila (§12.3 item 2) e rastro', () => {
  const origem = { tipo: 'notificacao', id: 'n-1', contexto: { usuarioId: 'u-1', aprovacaoPendenteId: 'ap-1' } };

  it('nada mudou: envia', async () => {
    const { service } = montar();
    expect(await service.antesDeEnviarEmail(origem)).toEqual({ ok: true });
  });
  it('já leu no sino: descarta', async () => {
    const { service, prisma } = montar();
    prisma.db.notificacaoLida.findFirst.mockResolvedValue({ em: new Date() });
    expect(await service.antesDeEnviarEmail(origem)).toEqual({ ok: false, motivo: 'descartado_ja_lida' });
  });
  it('solicitação já saiu de PENDENTE: descarta', async () => {
    const { service, prisma } = montar();
    prisma.db.aprovacao.findFirst.mockResolvedValue({ status: 'APROVADA', decisoes: [] });
    expect(await service.antesDeEnviarEmail(origem)).toEqual({ ok: false, motivo: 'descartado_aprovacao_encerrada' });
  });
  it('a própria pessoa já decidiu: descarta', async () => {
    const { service, prisma } = montar();
    prisma.db.aprovacao.findFirst.mockResolvedValue({ status: 'PENDENTE', decisoes: [{ usuarioId: 'u-1' }] });
    expect(await service.antesDeEnviarEmail(origem)).toEqual({ ok: false, motivo: 'descartado_ja_decidiu' });
  });
  it('sem aprovação no contexto (retorno ao solicitante): só a leitura conta', async () => {
    const { service, prisma } = montar();
    expect(await service.antesDeEnviarEmail({ tipo: 'notificacao', id: 'n-1', contexto: { usuarioId: 'u-1' } })).toEqual({ ok: true });
    expect(prisma.db.aprovacao.findFirst).not.toHaveBeenCalled();
  });
  it('enviado / não enviado gravam na notificação', async () => {
    const { service, prisma } = montar();
    const em = new Date('2026-11-13T15:00:00.000Z');
    await service.registrarEmailEnviado(origem, em);
    expect(prisma.db.notificacao.update).toHaveBeenCalledWith({ where: { id: 'n-1' }, data: { emailEnviadoEm: em, emailFalha: null } });
    await service.registrarEmailNaoEnviado(origem, 'email_nao_configurado');
    expect(prisma.db.notificacao.update).toHaveBeenCalledWith({ where: { id: 'n-1' }, data: { emailFalha: 'email_nao_configurado' } });
  });
  it('alertasEmailDoUsuario: preferência (padrão ligada) + rastro por notificação', async () => {
    const { service, prisma } = montar();
    prisma.db.notificacao.findMany.mockResolvedValue([
      { id: 'n-1', titulo: 'Aprovação esperando por você', rota: '/aprovacoes/1', createdAt: new Date('2026-11-13T15:00:00.000Z'), leituras: [], emailEnviadoEm: new Date('2026-11-13T15:00:05.000Z'), emailFalha: null },
    ]);
    const r = await service.alertasEmailDoUsuario('u-1');
    expect(r).toMatchObject({ email: 'ana@azit.com.br', emailAlertas: true });
    expect(r.itens[0]).toMatchObject({ id: 'n-1', emailEnviadoEm: '2026-11-13T15:00:05.000Z', emailFalha: null, lidaEm: null });
  });
});
