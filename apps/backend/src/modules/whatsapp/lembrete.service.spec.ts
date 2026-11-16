import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DecisaoEnvioWhatsapp } from '@azit/types';
import { JOB_LEMBRETES, LembreteService } from './lembrete.service';
import { ResultadoEnvioWhatsapp } from './whatsapp-envio.service';

// Lembretes de pagamento (doc 02 §28) com dublês à mão: banco em memória, envio
// e Asaas dublados. As regras puras (momento, elegibilidade, texto) têm teste
// próprio em @azit/utils; aqui é o comportamento do serviço.

const TOKEN = 'a'.repeat(64);
// 15/11/2026 12:00 em Brasília (15:00Z) — dentro da janela. Hoje = 2026-11-15.
const MEIO_DIA = new Date('2026-11-15T15:00:00Z');
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type Fatura = {
  id: string; numero: number; status: string; dataVencimento: Date; valorTotal: Prisma.Decimal; valorPago: Prisma.Decimal | null;
  acordoId: string | null; tokenPublico: string | null; parcelas: { acordoId: string | null }[];
  conta: { titular: { id: string; nome: string; whatsapp: string } };
};
type Lembrete = Record<string, unknown> & { id: string; faturaId: string; momento: string; situacao: string; diaReferencia: string; mensagemId: string | null };

function fatura(p: Partial<Fatura> & { id: string; vence: string }): Fatura {
  return {
    numero: 12, status: 'FECHADA', dataVencimento: dia(p.vence), valorTotal: new Prisma.Decimal('699.00'), valorPago: null,
    acordoId: null, tokenPublico: TOKEN, parcelas: [{ acordoId: null }],
    conta: { titular: { id: 't1', nome: 'joão pedro da silva', whatsapp: '(11) 98765-4321' } },
    ...p,
  };
}

function montar(opts: { faturas?: Fatura[]; ativo?: boolean; envio?: ResultadoEnvioWhatsapp | ((n: number) => ResultadoEnvioWhatsapp); titular?: { whatsapp: string; asaasCustomerId: string | null } | null } = {}) {
  const lembretes: Lembrete[] = [];
  const cfgs = new Map<string, Record<string, unknown>>();
  const auditoria: { acao: string; depois: unknown }[] = [];
  let seq = 0;
  let envios = 0;
  const faturas = opts.faturas ?? [];
  const prisma = {
    db: {
      fatura: {
        findMany: async () => faturas.map((f) => ({ ...f, lembretes: lembretes.filter((l) => l.faturaId === f.id) })),
        findFirst: async ({ where }: { where: { id: string } }) => faturas.find((f) => f.id === where.id) ?? null,
      },
      lembretePagamento: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (lembretes.some((l) => l.faturaId === data.faturaId && l.momento === data.momento)) {
            throw new Prisma.PrismaClientKnownRequestError('único', { code: 'P2002', clientVersion: 'teste' });
          }
          const l = { id: `l${++seq}`, mensagemId: null, motivo: null, enviadoEm: null, entregueEm: null, lidoEm: null, falhaEm: null, createdAt: new Date(), ...data } as Lembrete;
          lembretes.push(l);
          return l;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(lembretes.find((l) => l.id === where.id)!, data),
        findUnique: async ({ where }: { where: { id?: string; mensagemId?: string } }) =>
          lembretes.find((l) => (where.id ? l.id === where.id : l.mensagemId === where.mensagemId)) ?? null,
        count: async ({ where }: { where: { situacao: string; diaReferencia: string } }) =>
          lembretes.filter((l) => l.situacao === where.situacao && l.diaReferencia === where.diaReferencia).length,
        findMany: async () => [],
      },
      lembreteTitular: {
        findUnique: async ({ where }: { where: { titularId: string } }) => cfgs.get(where.titularId) ?? null,
        upsert: async ({ where, create, update }: { where: { titularId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const novo = cfgs.has(where.titularId) ? { ...cfgs.get(where.titularId), ...update } : { ativo: false, asaasAvisoDesligado: false, asaasAvisoPendente: false, ...create };
          cfgs.set(where.titularId, novo);
          return novo;
        },
      },
      titular: {
        findFirst: async () => (opts.titular === null ? null : { id: 't1', nome: 'João Pedro', whatsapp: '11987654321', asaasCustomerId: null, ...opts.titular }),
      },
      usuario: { findMany: async () => [{ id: 'u1', nome: 'Operadora' }] },
      logAuditoria: { create: async ({ data }: { data: { acao: string; depois: unknown } }) => { auditoria.push(data); } },
    },
  };
  const modelos = { D_MENOS_2: { nome: 'azit_fatura_disponivel_hml', idioma: 'pt_BR' }, D_ZERO: { nome: 'azit_fatura_vence_hoje_hml', idioma: 'pt_BR' } };
  const parametros = { vigente: async () => ({ ativo: opts.ativo ?? true, numerosAutorizados: [], modelos }), producao: () => false };
  const envio = {
    enviarModelo: jest.fn(async (): Promise<ResultadoEnvioWhatsapp> => {
      envios += 1;
      const r = opts.envio ?? { resultado: 'SIMULADO', motivo: 'ambiente sem credencial do WhatsApp — nada foi enviado' };
      return typeof r === 'function' ? r(envios) : r;
    }),
    decidir: jest.fn(async () => ({ decisao: DecisaoEnvioWhatsapp.SIMULADO, motivo: 'ambiente sem credencial', producao: false, autorizadoTeste: false })),
  };
  const eventos = { registrarReceptor: jest.fn() };
  const processor = { registrarTratador: jest.fn() };
  const asaas = {
    clienteReutilizavel: (id: string | null) => (id && !id.startsWith('cus_sim_') ? id : null),
    definirAvisoCliente: jest.fn(async () => undefined),
  };
  const alertas = { emitir: jest.fn(async () => undefined) };
  const fila = { add: jest.fn(async () => undefined) };
  const service = new LembreteService(prisma as never, parametros as never, envio as never, eventos as never, processor as never, asaas as never, alertas as never, fila as never);
  return { service, lembretes, cfgs, auditoria, envio, eventos, processor, asaas, alertas, fila };
}

describe('LembreteService — varredura (doc 02 §28.1)', () => {
  it('chave geral desligada: nada é gerado', async () => {
    const m = montar({ ativo: false, faturas: [fatura({ id: 'f1', vence: '2026-11-17' })] });
    const r = await m.service.varrer({ agora: MEIO_DIA });
    expect(r).toMatchObject({ executada: false, candidatas: 0 });
    expect(r.motivo).toMatch(/desligados/);
    expect(m.lembretes).toHaveLength(0);
  });

  it('fora da janela das 9h às 20h não envia; a ferramenta de teste pode ignorar a janela', async () => {
    const m = montar({ faturas: [fatura({ id: 'f1', vence: '2026-11-17' })] });
    const cedo = new Date('2026-11-15T11:30:00Z'); // 08:30 em Brasília
    const r = await m.service.varrer({ agora: cedo });
    expect(r.executada).toBe(false);
    expect(r.motivo).toMatch(/fora da janela/);
    expect((await m.service.varrer({ agora: cedo, ignorarJanela: true })).simulados).toBe(1);
  });

  it('D-2 e D0 saem com o modelo do momento, o saldo, o destino canônico e o código da fatura no botão', async () => {
    const m = montar({
      faturas: [
        fatura({ id: 'fD2', numero: 21, vence: '2026-11-17' }),
        fatura({ id: 'fD0', numero: 20, vence: '2026-11-15', valorPago: new Prisma.Decimal('200.00') }),
        fatura({ id: 'fD1', numero: 22, vence: '2026-11-16' }), // D-1: nenhum momento
      ],
    });
    const r = await m.service.varrer({ agora: MEIO_DIA });
    expect(r).toMatchObject({ dia: '2026-11-15', executada: true, candidatas: 3, simulados: 2, ignoradas: 1 });
    const d2 = m.lembretes.find((l) => l.faturaId === 'fD2')!;
    const d0 = m.lembretes.find((l) => l.faturaId === 'fD0')!;
    expect(d2).toMatchObject({ momento: 'D_MENOS_2', situacao: 'SIMULADO', destino: '5511987654321', modeloNome: 'azit_fatura_disponivel_hml', diaReferencia: '2026-11-15', titularId: 't1' });
    expect(d2.texto).toBe('Olá, João! Aqui é da Azit Move. Sua fatura nº 21, de R$ 699,00, vence em 17/11/2026. Toque no botão abaixo para ver os itens e pagar com Pix. O valor da página é atualizado em tempo real.');
    expect(d2.motivo).toMatch(/nada foi enviado/);
    expect(d0).toMatchObject({ momento: 'D_ZERO', modeloNome: 'azit_fatura_vence_hoje_hml' });
    expect(d0.texto).toContain('de R$ 499,00, vence hoje (15/11/2026)'); // saldo, não o valor cheio
    expect(m.envio.enviarModelo).toHaveBeenCalledWith({
      destino: '5511987654321', modelo: 'azit_fatura_disponivel_hml', idioma: 'pt_BR',
      variaveisCorpo: ['João', '21', 'R$ 699,00', '17/11/2026'], sufixoBotaoUrl: TOKEN,
    });
  });

  it('um lembrete por fatura por momento: a rodada seguinte não repete', async () => {
    const m = montar({ faturas: [fatura({ id: 'f1', vence: '2026-11-17' })] });
    await m.service.varrer({ agora: MEIO_DIA });
    const r2 = await m.service.varrer({ agora: new Date('2026-11-15T16:00:00Z') });
    expect(r2).toMatchObject({ simulados: 0, ignoradas: 1 });
    expect(m.lembretes).toHaveLength(1);
    expect(m.envio.enviarModelo).toHaveBeenCalledTimes(1);
  });

  it('só manda se ainda devo: paga, coberta por acordo, sem saldo ou sem link não recebem', async () => {
    const m = montar({
      faturas: [
        fatura({ id: 'paga', vence: '2026-11-15', status: 'PAGA' }),
        fatura({ id: 'renegociada', vence: '2026-11-15', status: 'RENEGOCIADA' }),
        fatura({ id: 'novada', vence: '2026-11-17', status: 'NOVADA' }),
        fatura({ id: 'acordo', vence: '2026-11-17', parcelas: [{ acordoId: 'ac1' }] }),
        fatura({ id: 'quitada-parcial', vence: '2026-11-15', valorPago: new Prisma.Decimal('699.00') }),
        fatura({ id: 'sem-link', vence: '2026-11-17', tokenPublico: null }),
      ],
    });
    const r = await m.service.varrer({ agora: MEIO_DIA });
    expect(r).toMatchObject({ candidatas: 6, ignoradas: 6, simulados: 0, enviados: 0 });
    expect(m.lembretes).toHaveLength(0);
    expect(m.envio.enviarModelo).not.toHaveBeenCalled();
  });

  it('envio real grava o id da mensagem e o carimbo de envio', async () => {
    const m = montar({ faturas: [fatura({ id: 'f1', vence: '2026-11-15' })], envio: { resultado: 'ENVIADO', mensagemId: 'wamid.REAL' } });
    expect((await m.service.varrer({ agora: MEIO_DIA })).enviados).toBe(1);
    expect(m.lembretes[0]).toMatchObject({ situacao: 'ENVIADO', mensagemId: 'wamid.REAL', motivo: null });
    expect(m.lembretes[0].enviadoEm).toBeInstanceOf(Date);
  });

  it('titular sem WhatsApp válido: registra a falha, avisa a carteira e não chama o envio', async () => {
    const f = fatura({ id: 'f1', vence: '2026-11-17' });
    f.conta.titular.whatsapp = '123';
    const m = montar({ faturas: [f] });
    expect((await m.service.varrer({ agora: MEIO_DIA })).falhas).toBe(1);
    expect(m.lembretes[0]).toMatchObject({ situacao: 'FALHOU', destino: null, motivo: 'titular sem WhatsApp válido no cadastro' });
    expect(m.envio.enviarModelo).not.toHaveBeenCalled();
    expect(m.alertas.emitir).toHaveBeenCalledWith(expect.objectContaining({ rota: '/titulares/t1', area: 'CARTEIRA_COBRANCA', tipo: 'FALHA' }));
  });

  it('recusa da Meta vira FALHOU com alerta e NÃO é reenviada na rodada seguinte', async () => {
    const m = montar({ faturas: [fatura({ id: 'f1', vence: '2026-11-17' })], envio: { resultado: 'FALHOU', motivo: 'envio recusado pela Meta (400): modelo inexistente' } });
    expect((await m.service.varrer({ agora: MEIO_DIA })).falhas).toBe(1);
    expect(m.lembretes[0]).toMatchObject({ situacao: 'FALHOU', motivo: 'envio recusado pela Meta (400): modelo inexistente' });
    expect(m.alertas.emitir).toHaveBeenCalledTimes(1);
    await m.service.varrer({ agora: new Date('2026-11-15T17:00:00Z') });
    expect(m.envio.enviarModelo).toHaveBeenCalledTimes(1);
  });

  it('RETIDO é tentado de novo só no mesmo dia; o alerta de retido sai uma vez', async () => {
    const m = montar({
      faturas: [fatura({ id: 'f1', vence: '2026-11-17' }), fatura({ id: 'f2', numero: 13, vence: '2026-11-15' })],
      envio: (n) => (n <= 3 ? { resultado: 'RETIDO', motivo: 'WhatsApp sem credencial em produção — nada foi enviado' } : { resultado: 'ENVIADO', mensagemId: `wamid.${n}` }),
    });
    expect((await m.service.varrer({ agora: MEIO_DIA })).retidos).toBe(2); // envios 1 e 2
    expect(m.alertas.emitir).toHaveBeenCalledTimes(1);
    expect(m.alertas.emitir).toHaveBeenCalledWith(expect.objectContaining({ rota: '/configuracoes/whatsapp', area: 'CONFIGURACOES' }));
    const r2 = await m.service.varrer({ agora: new Date('2026-11-15T16:00:00Z') }); // envio 3 retido, envio 4 sai
    expect(r2).toMatchObject({ retidos: 1, enviados: 1 });
    expect(m.lembretes).toHaveLength(2); // o mesmo registro, não um novo
    // Virou o dia: a fatura de D0 de ontem não tem mais momento; a de D-2 virou D-1 — nada é enviado com atraso.
    const amanha = await m.service.varrer({ agora: new Date('2026-11-16T15:00:00Z') });
    expect(amanha).toMatchObject({ enviados: 0, retidos: 0 });
    expect(m.lembretes.filter((l) => l.situacao === 'RETIDO')).toHaveLength(1);
  });

  it('o job diário entra na fila com a chave do dia e da hora no fuso do Brasil, e o serviço se registra na fila e no webhook', async () => {
    const m = montar();
    m.service.onModuleInit();
    expect(m.eventos.registrarReceptor).toHaveBeenCalledWith(m.service);
    expect(m.processor.registrarTratador).toHaveBeenCalledWith(JOB_LEMBRETES, expect.any(Function));
    jest.useFakeTimers().setSystemTime(new Date('2026-11-16T01:30:00Z')); // 22:30 de 15/11 em Brasília
    try {
      await m.service.cronLembretes();
    } finally {
      jest.useRealTimers();
    }
    expect(m.fila.add).toHaveBeenCalledWith(JOB_LEMBRETES, {}, expect.objectContaining({ jobId: 'lembretes-2026-11-15-22' }));
  });
});

describe('LembreteService — situação de entrega (webhook)', () => {
  it('ENVIADO → ENTREGUE → LIDO com os carimbos da Meta, sem regredir', async () => {
    const m = montar({ faturas: [fatura({ id: 'f1', vence: '2026-11-15' })], envio: { resultado: 'ENVIADO', mensagemId: 'wamid.REAL' } });
    await m.service.varrer({ agora: MEIO_DIA });
    const t1 = new Date('2026-11-15T15:01:00Z');
    const t2 = new Date('2026-11-15T15:05:00Z');
    await expect(m.service.aplicarStatusMeta({ mensagemId: 'wamid.REAL', status: 'read', quando: t2 })).resolves.toBe(true);
    await m.service.aplicarStatusMeta({ mensagemId: 'wamid.REAL', status: 'delivered', quando: t1 }); // chegou fora de ordem
    expect(m.lembretes[0]).toMatchObject({ situacao: 'LIDO', lidoEm: t2, entregueEm: t2 });
  });

  it('falha informada pela Meta depois do envio marca FALHOU e avisa', async () => {
    const m = montar({ faturas: [fatura({ id: 'f1', vence: '2026-11-15' })], envio: { resultado: 'ENVIADO', mensagemId: 'wamid.REAL' } });
    await m.service.varrer({ agora: MEIO_DIA });
    await m.service.aplicarStatusMeta({ mensagemId: 'wamid.REAL', status: 'failed', quando: new Date(), motivoFalha: '131026 · Message undeliverable' });
    expect(m.lembretes[0]).toMatchObject({ situacao: 'FALHOU', motivo: '131026 · Message undeliverable' });
    expect(m.alertas.emitir).toHaveBeenCalledTimes(1);
  });

  it('lembrete SIMULADO guarda o carimbo do teste mas continua SIMULADO; id desconhecido não é dele', async () => {
    const m = montar({ faturas: [fatura({ id: 'f1', vence: '2026-11-15' })] });
    await m.service.varrer({ agora: MEIO_DIA });
    const id = m.lembretes[0].mensagemId as string;
    expect(id).toBe(`wamid.SIMULADO.${m.lembretes[0].id}`);
    await expect(m.service.aplicarStatusMeta({ mensagemId: id, status: 'delivered', quando: new Date() })).resolves.toBe(true);
    expect(m.lembretes[0].situacao).toBe('SIMULADO');
    expect(m.lembretes[0].entregueEm).toBeInstanceOf(Date);
    await expect(m.service.aplicarStatusMeta({ mensagemId: 'wamid.OUTRO', status: 'read', quando: new Date() })).resolves.toBe(false);
  });

  it('a ferramenta de teste passa pela MESMA fila do webhook', async () => {
    const m = montar({ faturas: [fatura({ id: 'f1', vence: '2026-11-15' })] });
    await m.service.varrer({ agora: MEIO_DIA });
    await m.service.simularStatus(m.lembretes[0].id, 'read');
    expect(m.fila.add).toHaveBeenCalledWith('evento-meta', { entry: [{ changes: [{ field: 'messages', value: { statuses: [expect.objectContaining({ id: m.lembretes[0].mensagemId, status: 'read' })] } }] }] }, expect.any(Object));
    await expect(m.service.simularStatus('nao-existe', 'read')).rejects.toThrow(NotFoundException);
  });
});

describe('LembreteService — lembrete por titular e aviso do Asaas (doc 02 §28.1 e §28.3)', () => {
  it('nasce desligado; ligar registra quem e quando e audita', async () => {
    const m = montar();
    const antes = await m.service.doTitular('t1');
    expect(antes.lembrete.ativo).toBe(false);
    expect(antes.avisoAsaas.desligado).toBe(false);
    const depois = await m.service.ligar('t1', 'u1');
    expect(depois.lembrete).toMatchObject({ ativo: true, ligadoPor: 'Operadora' });
    expect(depois.lembrete.ligadoEm).not.toBeNull();
    expect(m.auditoria.map((a) => a.acao)).toEqual(['lembrete_whatsapp_ligado']);
    expect(m.asaas.definirAvisoCliente).not.toHaveBeenCalled(); // ligar NÃO mexe no Asaas
  });

  it('não liga para titular sem WhatsApp válido nem para titular inexistente', async () => {
    await expect(montar({ titular: { whatsapp: '123', asaasCustomerId: null } }).service.ligar('t1', 'u1')).rejects.toThrow(UnprocessableEntityException);
    await expect(montar({ titular: null }).service.ligar('t1', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('desligar o aviso do Asaas exige o lembrete ligado', async () => {
    const m = montar({ titular: { whatsapp: '11987654321', asaasCustomerId: 'cus_000123' } });
    await expect(m.service.definirAvisoAsaas('t1', true, 'u1')).rejects.toMatchObject({ response: { erro: 'lembrete_desligado' } });
    expect(m.asaas.definirAvisoCliente).not.toHaveBeenCalled();
  });

  it('com cliente no Asaas altera o cadastro na hora; religar segue o mesmo caminho', async () => {
    const m = montar({ titular: { whatsapp: '11987654321', asaasCustomerId: 'cus_000123' } });
    await m.service.ligar('t1', 'u1');
    const r = await m.service.definirAvisoAsaas('t1', true, 'u1');
    expect(m.asaas.definirAvisoCliente).toHaveBeenCalledWith('cus_000123', true);
    expect(r.avisoAsaas).toMatchObject({ desligado: true, pendente: false, clienteNoAsaas: true, alteradoPor: 'Operadora' });
    await m.service.definirAvisoAsaas('t1', false, 'u1');
    expect(m.asaas.definirAvisoCliente).toHaveBeenLastCalledWith('cus_000123', false);
    expect(m.auditoria.map((a) => a.acao)).toEqual(['lembrete_whatsapp_ligado', 'aviso_asaas_desligado', 'aviso_asaas_religado']);
  });

  it('sem cliente no Asaas (ou com id simulado) a decisão fica pendente para a criação', async () => {
    const m = montar({ titular: { whatsapp: '11987654321', asaasCustomerId: 'cus_sim_abc' } });
    await m.service.ligar('t1', 'u1');
    const r = await m.service.definirAvisoAsaas('t1', true, 'u1');
    expect(m.asaas.definirAvisoCliente).not.toHaveBeenCalled();
    expect(r.avisoAsaas).toMatchObject({ desligado: true, pendente: true, clienteNoAsaas: false });
  });

  it('se o Asaas recusar, nada é gravado e o operador é avisado', async () => {
    const m = montar({ titular: { whatsapp: '11987654321', asaasCustomerId: 'cus_000123' } });
    await m.service.ligar('t1', 'u1');
    m.asaas.definirAvisoCliente.mockRejectedValueOnce(new Error('Asaas PUT /customers/cus_000123 retornou 500'));
    await expect(m.service.definirAvisoAsaas('t1', true, 'u1')).rejects.toMatchObject({ response: { erro: 'asaas_recusou' } });
    expect(m.cfgs.get('t1')).toMatchObject({ asaasAvisoDesligado: false });
  });

  it('destaca o titular que ficou sem aviso nenhum (lembrete desligado com o Asaas desligado)', async () => {
    const m = montar({ titular: { whatsapp: '11987654321', asaasCustomerId: 'cus_000123' } });
    await m.service.ligar('t1', 'u1');
    await m.service.definirAvisoAsaas('t1', true, 'u1');
    expect((await m.service.doTitular('t1')).semAvisoNenhum).toBe(false);
    const r = await m.service.desligar('t1', 'u1');
    expect(r.semAvisoNenhum).toBe(true);
    expect(m.asaas.definirAvisoCliente).toHaveBeenCalledTimes(1); // desligar o lembrete não religa o Asaas sozinho
  });
});
