import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DecisaoEnvioWhatsapp } from '@azit/types';
import { ConversaService } from './conversa.service';
import { ResultadoEnvioWhatsapp } from './whatsapp-envio.service';
import { WhatsappMensagensService } from './whatsapp-mensagens.service';

// Conversas do WhatsApp (doc 02 §24) com dublês à mão: banco em memória e
// regra de envio dublada. Cobre a entrada pelo webhook (número canônico,
// vínculo com o titular, reentrega) e a resposta dentro da janela de 24 h.

type Msg = {
  id: string; direcao: 'ENTRADA' | 'SAIDA'; numero: string; titularId: string | null; nomePerfil: string | null; mensagemId: string | null;
  tipo: string; texto: string | null; midiaId: string | null; midiaRef: string | null; midiaTipo: string | null; midiaNome: string | null;
  status: string | null; falhaMotivo: string | null; usuarioId: string | null; momento: Date; lidaEm: Date | null;
};

function montar(opts: { envio?: ResultadoEnvioWhatsapp; lembretes?: Record<string, unknown>[] } = {}) {
  const msgs: Msg[] = [];
  let seq = 0;
  const casa = (m: Msg, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const atual = (m as unknown as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && 'not' in (v as object)) return atual !== (v as { not: unknown }).not;
      if (v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: unknown[] }).in).includes(atual);
      return atual === v;
    });
  const ordenar = (lista: Msg[], orderBy?: { momento?: 'asc' | 'desc' }) =>
    orderBy?.momento ? [...lista].sort((a, b) => (orderBy.momento === 'asc' ? 1 : -1) * (a.momento.getTime() - b.momento.getTime())) : lista;
  const prisma = {
    db: {
      mensagemWhatsapp: {
        findUnique: async ({ where }: { where: { id?: string; mensagemId?: string } }) => msgs.find((m) => (where.id ? m.id === where.id : m.mensagemId === where.mensagemId)) ?? null,
        findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { momento?: 'asc' | 'desc' } }) => ordenar(msgs.filter((m) => casa(m, where)), orderBy)[0] ?? null,
        findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { momento?: 'asc' | 'desc' } }) => ordenar(msgs.filter((m) => casa(m, where)), orderBy),
        count: async ({ where }: { where: Record<string, unknown> }) => msgs.filter((m) => casa(m, where)).length,
        create: async ({ data }: { data: Partial<Msg> }) => {
          if (data.mensagemId && msgs.some((m) => m.mensagemId === data.mensagemId)) throw new Prisma.PrismaClientKnownRequestError('único', { code: 'P2002', clientVersion: 'teste' });
          const m = { id: `m${++seq}`, titularId: null, nomePerfil: null, mensagemId: null, texto: null, midiaId: null, midiaRef: null, midiaTipo: null, midiaNome: null, status: null, falhaMotivo: null, usuarioId: null, lidaEm: null, ...data } as Msg;
          msgs.push(m);
          return m;
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<Msg> }) => Object.assign(msgs.find((m) => m.id === where.id)!, data),
        updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Partial<Msg> }) => { msgs.filter((m) => where.id.in.includes(m.id)).forEach((m) => Object.assign(m, data)); },
        groupBy: async ({ where }: { where?: Record<string, unknown> }) => {
          const numeros = [...new Set(msgs.filter((m) => !where || casa(m, where)).map((m) => m.numero))];
          return numeros.map((numero) => {
            const doNumero = msgs.filter((m) => m.numero === numero && (!where || casa(m, where)));
            return { numero, _max: { momento: new Date(Math.max(...doNumero.map((m) => m.momento.getTime()))) }, _count: { _all: doNumero.length } };
          });
        },
      },
      lembretePagamento: { findMany: async () => opts.lembretes ?? [] },
      contratoCredito: { findMany: async () => [{ id: 'c1', numero: '202611001', ativo: { placa: 'ABC1D23', modelo: 'Onix' } }] },
      usuario: { findMany: async () => [{ id: 'u1', nome: 'Operadora' }] },
      // titularDoNumero: o cadastro guarda o número SEM o nono dígito e com máscara.
      $queryRaw: async (sql: Prisma.Sql) => ((sql.values as string[]).includes('1187654321') ? [{ id: 't1', nome: 'João Pedro' }] : []),
    },
  };
  const alertas = { emitir: jest.fn(async () => undefined) };
  const fila = { add: jest.fn(async () => undefined) };
  const meta = { configurado: () => false, baixarMidia: jest.fn() };
  const mensagens = new WhatsappMensagensService(prisma as never, meta as never, alertas as never, fila as never);
  const envio = {
    enviarTexto: jest.fn(async (): Promise<ResultadoEnvioWhatsapp> => opts.envio ?? { resultado: 'ENVIADO', mensagemId: 'wamid.RESPOSTA' }),
    decidir: jest.fn(async () => ({ decisao: DecisaoEnvioWhatsapp.ENVIA, motivo: null, producao: true, autorizadoTeste: false })),
    confirmarLeitura: jest.fn(async () => undefined),
  };
  const service = new ConversaService(prisma as never, mensagens, envio as never, fila as never);
  return { service, mensagens, msgs, alertas, fila, envio };
}

const entrada = (id: string, texto: string, quando: Date, from = '551187654321') => ({
  contacts: [{ wa_id: from, profile: { name: 'Joãozinho' } }],
  messages: [{ from, id, timestamp: String(Math.floor(quando.getTime() / 1000)), type: 'text', text: { body: texto } }],
});

describe('Conversas do WhatsApp — entrada pelo webhook (doc 02 §24 itens 1, 2 e 5)', () => {
  it('grava com o número canônico (nono dígito), liga ao titular e avisa no sino só na primeira não lida', async () => {
    const m = montar();
    const agora = new Date();
    await expect(m.mensagens.registrarEntradas(entrada('wamid.1', 'pago amanhã', agora))).resolves.toBe(1);
    await m.mensagens.registrarEntradas(entrada('wamid.2', 'pode ser?', new Date(agora.getTime() + 1000)));
    expect(m.msgs.map((x) => [x.numero, x.titularId, x.nomePerfil, x.texto])).toEqual([
      ['5511987654321', 't1', 'Joãozinho', 'pago amanhã'],
      ['5511987654321', 't1', 'Joãozinho', 'pode ser?'],
    ]);
    expect(m.alertas.emitir).toHaveBeenCalledTimes(1);
    expect(m.alertas.emitir).toHaveBeenCalledWith(expect.objectContaining({ titulo: 'WhatsApp: João Pedro respondeu', rota: '/conversas?numero=5511987654321', area: 'CARTEIRA_COBRANCA' }));
  });

  it('reentrega da Meta não duplica; número desconhecido fica sem titular', async () => {
    const m = montar();
    const agora = new Date();
    await m.mensagens.registrarEntradas(entrada('wamid.1', 'oi', agora));
    await expect(m.mensagens.registrarEntradas(entrada('wamid.1', 'oi', agora))).resolves.toBe(0);
    await m.mensagens.registrarEntradas(entrada('wamid.9', 'quem é?', agora, '5521999990000'));
    expect(m.msgs).toHaveLength(2);
    expect(m.msgs[1]).toMatchObject({ numero: '5521999990000', titularId: null });
  });

  it('mídia recebida entra na fila de download (o link da Meta expira)', async () => {
    const m = montar();
    await m.mensagens.registrarEntradas({ messages: [{ from: '551187654321', id: 'wamid.FOTO', type: 'image', image: { id: 'midia-1', mime_type: 'image/jpeg', caption: 'comprovante' } }] });
    expect(m.msgs[0]).toMatchObject({ tipo: 'image', midiaId: 'midia-1', texto: 'comprovante' });
    expect(m.fila.add).toHaveBeenCalledWith('midia-entrada', { id: m.msgs[0].id }, expect.any(Object));
  });
});

describe('Conversas do WhatsApp — tela (doc 02 §24 itens 3, 4 e 5)', () => {
  it('lista por número, com não lidas primeiro, prévia e titular', async () => {
    const m = montar();
    const t0 = new Date(Date.now() - 60_000);
    await m.mensagens.registrarEntradas(entrada('wamid.A', 'conversa antiga', t0, '5521999990000'));
    await m.service.marcarLida('5521999990000', 'u1');
    await m.mensagens.registrarEntradas(entrada('wamid.B', 'pago amanhã', new Date(t0.getTime() - 30_000)));
    const lista = await m.service.listar();
    expect(lista.map((c) => [c.numero, c.naoLidas, c.titular?.nome ?? null, c.ultimaPrevia])).toEqual([
      ['5511987654321', 1, 'João Pedro', 'pago amanhã'], // não lida vem primeiro, mesmo sendo mais antiga
      ['5521999990000', 0, null, 'conversa antiga'],
    ]);
  });

  it('a conversa junta mensagens e lembretes enviados ao número, em ordem, sem duplicar registro', async () => {
    const ontem = new Date(Date.now() - 20 * 3_600_000);
    const m = montar({
      lembretes: [{ id: 'l1', momento: 'D_MENOS_2', texto: 'Olá, João! Sua fatura nº 12…', situacao: 'ENTREGUE', motivo: null, enviadoEm: ontem, createdAt: ontem, fatura: { numero: 12 } }],
    });
    await m.mensagens.registrarEntradas(entrada('wamid.1', 'pago amanhã', new Date(Date.now() - 3_600_000)));
    const c = await m.service.conversa('(11) 98765-4321');
    expect(c.numero).toBe('5511987654321');
    expect(c.titular).toEqual({ id: 't1', nome: 'João Pedro' });
    expect(c.contratos).toHaveLength(1);
    expect(c.itens.map((i) => [i.origem, i.direcao, i.situacao])).toEqual([
      ['lembrete', 'SAIDA', 'ENTREGUE'],
      ['mensagem', 'ENTRADA', null],
    ]);
    expect(c.itens[0].autor).toBe('lembrete automático · fatura nº 12');
    expect(c.janela.aberta).toBe(true);
    expect(c.envio).toMatchObject({ enviaDeVerdade: true });
  });

  it('abrir a conversa marca como lida e manda o visto pela regra de envio', async () => {
    const m = montar();
    await m.mensagens.registrarEntradas(entrada('wamid.1', 'oi', new Date()));
    await expect(m.service.marcarLida('5511987654321', 'u1')).resolves.toEqual({ marcadas: 1 });
    expect(m.msgs[0].lidaEm).toBeInstanceOf(Date);
    expect(m.envio.confirmarLeitura).toHaveBeenCalledWith('5511987654321', 'wamid.1');
    await expect(m.service.marcarLida('5511987654321', 'u1')).resolves.toEqual({ marcadas: 0 });
  });

  it('resposta dentro da janela sai pela regra de envio e fica registrada com o operador', async () => {
    const m = montar();
    await m.mensagens.registrarEntradas(entrada('wamid.1', 'pago amanhã', new Date(Date.now() - 3_600_000)));
    await expect(m.service.responder('11987654321', '  Combinado, obrigado!  ', 'u1')).resolves.toEqual({ resultado: 'enviada' });
    expect(m.envio.enviarTexto).toHaveBeenCalledWith({ destino: '5511987654321', texto: 'Combinado, obrigado!' });
    expect(m.msgs[1]).toMatchObject({ direcao: 'SAIDA', status: 'enviada', mensagemId: 'wamid.RESPOSTA', usuarioId: 'u1', titularId: 't1' });
    const c = await m.service.conversa('5511987654321');
    expect(c.itens[1]).toMatchObject({ direcao: 'SAIDA', situacao: 'enviada', autor: 'Operadora' });
    // A situação de entrega da resposta chega pelo webhook.
    await expect(m.mensagens.aplicarStatusSaida('wamid.RESPOSTA', 'read')).resolves.toBe(true);
    expect(m.msgs[1].status).toBe('lida');
    await expect(m.mensagens.aplicarStatusSaida('wamid.1', 'read')).resolves.toBe(false); // entrada não tem situação de entrega
  });

  it('fora da janela de 24 h a resposta é recusada e nada é enviado nem gravado', async () => {
    const m = montar();
    await m.mensagens.registrarEntradas(entrada('wamid.1', 'oi', new Date(Date.now() - 25 * 3_600_000)));
    await expect(m.service.responder('5511987654321', 'olá', 'u1')).rejects.toMatchObject({ response: { erro: 'janela_fechada' } });
    await expect(montar().service.responder('5511987654321', 'olá', 'u1')).rejects.toMatchObject({ response: { erro: 'janela_fechada' } }); // cliente nunca escreveu
    expect(m.envio.enviarTexto).not.toHaveBeenCalled();
    expect(m.msgs).toHaveLength(1);
    expect((await m.service.conversa('5511987654321')).janela.aberta).toBe(false);
  });

  it('texto vazio ou número inválido são recusados', async () => {
    const m = montar();
    await m.mensagens.registrarEntradas(entrada('wamid.1', 'oi', new Date()));
    await expect(m.service.responder('5511987654321', '   ', 'u1')).rejects.toThrow(UnprocessableEntityException);
    await expect(m.service.responder('123', 'olá', 'u1')).rejects.toMatchObject({ response: { erro: 'numero_invalido' } });
  });

  it('fora de produção a resposta para número não autorizado fica SIMULADA, com o motivo', async () => {
    const m = montar({ envio: { resultado: 'SIMULADO', motivo: '(11) 98765-4321 não está entre os números autorizados deste ambiente de teste — nada foi enviado' } });
    await m.mensagens.registrarEntradas(entrada('wamid.1', 'oi', new Date()));
    const r = await m.service.responder('5511987654321', 'olá', 'u1');
    expect(r).toMatchObject({ resultado: 'simulada' });
    expect(m.msgs[1]).toMatchObject({ status: 'simulada', mensagemId: null });
    expect(m.msgs[1].falhaMotivo).toMatch(/nada foi enviado/);
  });

  it('a ferramenta de teste simula a mensagem recebida pela MESMA fila do webhook', async () => {
    const m = montar();
    await expect(m.service.simularEntrada('(11) 8765-4321', 'pago amanhã')).resolves.toMatchObject({ enfileirado: true, numero: '5511987654321' });
    expect(m.fila.add).toHaveBeenCalledWith('evento-meta', expect.objectContaining({ entry: expect.any(Array) }), expect.any(Object));
    await expect(m.service.simularEntrada('abc', 'x')).rejects.toThrow(UnprocessableEntityException);
  });
});
