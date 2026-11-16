import { createHmac } from 'crypto';
import { ForbiddenException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegracoesService } from '../integracoes/integracoes.service';
import { ErroMeta, WhatsappMetaService } from './whatsapp-meta.service';
import { WhatsappParametrosService } from './whatsapp-parametros.service';
import { WhatsappEnvioService } from './whatsapp-envio.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappEventosService } from './whatsapp-eventos.service';
import { WhatsappMensagensService } from './whatsapp-mensagens.service';
import { JOB_EVENTO_META } from './whatsapp.processor';

// Canal WhatsApp (doc 02 §23): cliente da Meta, parâmetros versionados, regra
// única de envio e webhook. Dublês à mão — sem banco, sem Redis, sem rede.

const DESTINO = '5511987654321';

function credencial(parcial: Partial<ReturnType<IntegracoesService['whatsapp']>> = {}) {
  return { phoneNumberId: '111', wabaId: '222', accessToken: 'token-de-teste', appSecret: 'segredo-do-app', verifyToken: 'verifica', graphUrl: 'https://graph.exemplo/v23.0', fonte: 'banco' as const, ...parcial };
}
const integracoesCom = (c = credencial()) => ({ whatsapp: () => c }) as unknown as IntegracoesService;
const configDe = (ambiente: string) => ({ get: (k: string) => (k === 'ambiente' ? ambiente : k === 'faturaPublicaUrl' ? 'https://fatura-hml.azitmove.com.br/' : undefined) }) as unknown as ConfigService;

function respostaFetch(status: number, corpo: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo } as unknown as Response;
}

describe('WhatsappMetaService', () => {
  const fetchOriginal = global.fetch;
  afterEach(() => { global.fetch = fetchOriginal; });

  it('envia o modelo com as variáveis do corpo e o final do link do botão', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    global.fetch = jest.fn(async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return respostaFetch(200, { messages: [{ id: 'wamid.ABC' }] }); }) as unknown as typeof fetch;
    const meta = new WhatsappMetaService(integracoesCom(), configDe('producao'));
    const id = await meta.enviarModelo({ destino: DESTINO, destinoAutorizadoTeste: false, modelo: 'azit_fatura_disponivel', idioma: 'pt_BR', variaveisCorpo: ['João', '12', 'R$ 699,00', '16/11/2026'], sufixoBotaoUrl: 'a'.repeat(64) });
    expect(id).toBe('wamid.ABC');
    expect(chamadas[0].url).toBe('https://graph.exemplo/v23.0/111/messages');
    expect((chamadas[0].init.headers as Record<string, string>).Authorization).toBe('Bearer token-de-teste');
    const corpo = JSON.parse(chamadas[0].init.body as string);
    expect(corpo).toEqual({
      messaging_product: 'whatsapp',
      to: DESTINO,
      type: 'template',
      template: {
        name: 'azit_fatura_disponivel',
        language: { code: 'pt_BR' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'João' }, { type: 'text', text: '12' }, { type: 'text', text: 'R$ 699,00' }, { type: 'text', text: '16/11/2026' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'a'.repeat(64) }] },
        ],
      },
    });
  });

  it('segunda camada da trava: fora de produção recusa destino sem autorização explícita, sem chamar a Meta', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const meta = new WhatsappMetaService(integracoesCom(), configDe('homologacao'));
    await expect(meta.enviarTexto({ destino: DESTINO, texto: 'oi', destinoAutorizadoTeste: false })).rejects.toThrow(ErroMeta);
    await expect(meta.enviarModelo({ destino: DESTINO, destinoAutorizadoTeste: false, modelo: 'm', idioma: 'pt_BR', variaveisCorpo: [] })).rejects.toThrow(/não está autorizado/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('traduz a recusa da Meta sem expor o token; 131047 vira "fora da janela de 24 h"', async () => {
    const meta = new WhatsappMetaService(integracoesCom(), configDe('producao'));
    global.fetch = jest.fn(async () => respostaFetch(400, { error: { code: 131047, message: 'Re-engagement message' } })) as unknown as typeof fetch;
    await expect(meta.enviarTexto({ destino: DESTINO, texto: 'oi', destinoAutorizadoTeste: false })).rejects.toThrow(/fora da janela de 24 h/);
    global.fetch = jest.fn(async () => respostaFetch(400, { error: { code: 132001, message: 'Template name does not exist' } })) as unknown as typeof fetch;
    const erro = await meta.enviarModelo({ destino: DESTINO, destinoAutorizadoTeste: false, modelo: 'x', idioma: 'pt_BR', variaveisCorpo: [] }).catch((e: Error) => e);
    expect((erro as Error).message).toContain('Template name does not exist');
    expect((erro as Error).message).not.toContain('token-de-teste');
  });

  it('configurado só com id do número E token', () => {
    expect(new WhatsappMetaService(integracoesCom(), configDe('producao')).configurado()).toBe(true);
    expect(new WhatsappMetaService(integracoesCom(credencial({ accessToken: '' })), configDe('producao')).configurado()).toBe(false);
    expect(new WhatsappMetaService(integracoesCom(credencial({ phoneNumberId: '' })), configDe('producao')).configurado()).toBe(false);
  });

  it('confere a assinatura X-Hub-Signature-256 do corpo cru', () => {
    const meta = new WhatsappMetaService(integracoesCom(), configDe('producao'));
    const corpo = Buffer.from('{"entry":[]}');
    const boa = `sha256=${createHmac('sha256', 'segredo-do-app').update(corpo).digest('hex')}`;
    expect(meta.assinaturaValida(corpo, boa)).toBe(true);
    expect(meta.assinaturaValida(Buffer.from('{"entry":[1]}'), boa)).toBe(false);
    expect(meta.assinaturaValida(corpo, boa.replace('sha256=', 'sha1='))).toBe(false);
    expect(meta.assinaturaValida(corpo, undefined)).toBe(false);
    expect(meta.assinaturaValida(undefined, boa)).toBe(false);
    expect(new WhatsappMetaService(integracoesCom(credencial({ appSecret: '' })), configDe('producao')).assinaturaValida(corpo, boa)).toBe(false);
  });
});

// ---------------------------------------------------------------

type LinhaParametro = { id: string; versao: number; ativo: boolean; numerosAutorizados: string[]; modeloD2Nome: string; modeloD2Idioma: string; modeloD0Nome: string; modeloD0Idioma: string; usuarioId: string | null; createdAt: Date };

function prismaParametros(linhas: LinhaParametro[] = []) {
  const auditoria: unknown[] = [];
  return {
    linhas,
    auditoria,
    db: {
      parametroWhatsapp: {
        findFirst: async () => [...linhas].sort((a, b) => b.versao - a.versao)[0] ?? null,
        create: async ({ data }: { data: Omit<LinhaParametro, 'id' | 'createdAt'> }) => {
          const l = { id: `p${linhas.length + 1}`, createdAt: new Date(), ...data };
          linhas.push(l);
          return l;
        },
      },
      usuario: { findFirst: async () => ({ nome: 'Luís' }) },
      logAuditoria: { create: async (a: unknown) => { auditoria.push(a); } },
    },
  };
}

function parametrosDe(ambiente: string, configurado: boolean, linhas: LinhaParametro[] = []) {
  const prisma = prismaParametros(linhas);
  const meta = { configurado: () => configurado } as unknown as WhatsappMetaService;
  return { prisma, meta, servico: new WhatsappParametrosService(prisma as never, configDe(ambiente), meta) };
}

describe('WhatsappParametrosService (versionado — doc 02 §23.3)', () => {
  it('sem nada salvo valem os padrões: chave geral DESLIGADA e lista vazia', async () => {
    const { servico } = parametrosDe('homologacao', false);
    const p = await servico.vigente();
    expect(p).toMatchObject({ versao: 0, ativo: false, numerosAutorizados: [] });
    expect(p.modelos.D_MENOS_2).toEqual({ nome: 'azit_fatura_disponivel', idioma: 'pt_BR' });
    expect(p.modelos.D_ZERO).toEqual({ nome: 'azit_fatura_vence_hoje', idioma: 'pt_BR' });
  });

  it('cada alteração grava uma versão nova, normaliza os números e audita', async () => {
    const { servico, prisma } = parametrosDe('homologacao', false);
    await servico.salvar({ ativo: true, numerosAutorizados: ['(11) 98765-4321', '551187654321'] }, 'u1');
    await servico.salvar({ modeloD2Nome: 'azit_fatura_disponivel_hml' }, 'u1');
    expect(prisma.linhas.map((l) => l.versao)).toEqual([1, 2]);
    const p = await servico.vigente();
    expect(p).toMatchObject({ versao: 2, ativo: true, numerosAutorizados: [DESTINO] });
    expect(p.modelos.D_MENOS_2.nome).toBe('azit_fatura_disponivel_hml');
    expect(prisma.auditoria).toHaveLength(2);
  });

  it('recusa número inválido e nome de modelo fora do padrão da Meta', async () => {
    const { servico, prisma } = parametrosDe('homologacao', false);
    await expect(servico.salvar({ numerosAutorizados: ['abc'] })).rejects.toThrow(UnprocessableEntityException);
    await expect(servico.salvar({ modeloD0Nome: 'Azit Fatura' })).rejects.toThrow(UnprocessableEntityException);
    await expect(servico.salvar({ modeloD0Idioma: 'portugues' })).rejects.toThrow(UnprocessableEntityException);
    expect(prisma.linhas).toHaveLength(0);
  });

  it('produção não liga a chave geral sem credencial; homologação liga (vira simulado)', async () => {
    await expect(parametrosDe('producao', false).servico.salvar({ ativo: true })).rejects.toMatchObject({ response: { erro: 'sem_credencial' } });
    await expect(parametrosDe('producao', true).servico.salvar({ ativo: true })).resolves.toMatchObject({ ativo: true });
    await expect(parametrosDe('homologacao', false).servico.salvar({ ativo: true })).resolves.toMatchObject({ ativo: true });
  });

  it('a tela mostra o que cadastrar na Meta com o endereço do botão DESTE ambiente, sem segredo', async () => {
    const tela = await parametrosDe('homologacao', true).servico.tela();
    expect(tela.modelos.map((m) => m.cadastro.botaoUrl)).toEqual(['https://fatura-hml.azitmove.com.br/{{1}}', 'https://fatura-hml.azitmove.com.br/{{1}}']);
    expect(tela.ambiente).toEqual({ producao: false, credencialConfigurada: true });
    expect(JSON.stringify(tela)).not.toMatch(/token-de-teste|segredo-do-app/);
  });
});

// ---------------------------------------------------------------

describe('WhatsappEnvioService (regra única — doc 02 §23.1 e §23.2)', () => {
  function montar(ambiente: string, configurado: boolean, autorizados: string[]) {
    const meta = {
      configurado: () => configurado,
      enviarModelo: jest.fn(async () => 'wamid.MODELO'),
      enviarTexto: jest.fn(async () => 'wamid.TEXTO'),
      marcarComoLida: jest.fn(async () => undefined),
    };
    const parametros = { vigente: async () => ({ numerosAutorizados: autorizados }), producao: () => ambiente === 'producao' };
    return { meta, envio: new WhatsappEnvioService(meta as never, parametros as never) };
  }
  const modelo = { destino: DESTINO, modelo: 'm', idioma: 'pt_BR', variaveisCorpo: ['a'] };

  it('produção sem credencial RETÉM e não chama a Meta', async () => {
    const { envio, meta } = montar('producao', false, []);
    await expect(envio.enviarModelo(modelo)).resolves.toMatchObject({ resultado: 'RETIDO' });
    expect(meta.enviarModelo).not.toHaveBeenCalled();
  });

  it('produção com credencial envia para qualquer destino', async () => {
    const { envio, meta } = montar('producao', true, []);
    await expect(envio.enviarModelo(modelo)).resolves.toEqual({ resultado: 'ENVIADO', mensagemId: 'wamid.MODELO' });
    expect(meta.enviarModelo).toHaveBeenCalledWith(expect.objectContaining({ destinoAutorizadoTeste: false }));
  });

  it('fora de produção: número não autorizado vira SIMULADO; autorizado envia', async () => {
    const fora = montar('homologacao', true, ['5521999990000']);
    await expect(fora.envio.enviarTexto({ destino: DESTINO, texto: 'oi' })).resolves.toMatchObject({ resultado: 'SIMULADO' });
    expect(fora.meta.enviarTexto).not.toHaveBeenCalled();
    const dentro = montar('homologacao', true, [DESTINO]);
    await expect(dentro.envio.enviarTexto({ destino: DESTINO, texto: 'oi' })).resolves.toEqual({ resultado: 'ENVIADO', mensagemId: 'wamid.TEXTO' });
    expect(dentro.meta.enviarTexto).toHaveBeenCalledWith(expect.objectContaining({ destinoAutorizadoTeste: true }));
  });

  it('recusa da Meta vira FALHOU com o motivo (não estoura)', async () => {
    const { envio, meta } = montar('producao', true, []);
    meta.enviarModelo.mockRejectedValueOnce(new ErroMeta('envio recusado pela Meta (400): modelo inexistente'));
    await expect(envio.enviarModelo(modelo)).resolves.toEqual({ resultado: 'FALHOU', motivo: 'envio recusado pela Meta (400): modelo inexistente' });
  });

  it('visto azul só sai quando um envio real seria permitido', async () => {
    const fora = montar('homologacao', true, []);
    await fora.envio.confirmarLeitura(DESTINO, 'wamid.X');
    expect(fora.meta.marcarComoLida).not.toHaveBeenCalled();
    const prod = montar('producao', true, []);
    await prod.envio.confirmarLeitura(DESTINO, 'wamid.X');
    expect(prod.meta.marcarComoLida).toHaveBeenCalledWith('wamid.X');
  });
});

// ---------------------------------------------------------------

describe('WhatsappWebhookController (doc 02 §23.4)', () => {
  function montar(ambiente: string, c = credencial()) {
    const fila = { add: jest.fn(async () => undefined) };
    const integracoes = integracoesCom(c);
    const meta = new WhatsappMetaService(integracoes, configDe(ambiente));
    return { fila, controller: new WhatsappWebhookController(integracoes, meta, configDe(ambiente), fila as never) };
  }
  const corpo = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] }] };
  const cru = Buffer.from(JSON.stringify(corpo));
  const assinar = (segredo: string) => `sha256=${createHmac('sha256', segredo).update(cru).digest('hex')}`;

  it('GET devolve o desafio só com o token de verificação certo', () => {
    const { controller } = montar('producao');
    const enviado: string[] = [];
    const res = { header: () => res, send: (b: string) => { enviado.push(b); } };
    controller.verificar('subscribe', 'verifica', '12345', res);
    expect(enviado).toEqual(['12345']);
    expect(() => controller.verificar('subscribe', 'errado', '12345', res)).toThrow(ForbiddenException);
    expect(() => controller.verificar('outro', 'verifica', '12345', res)).toThrow(ForbiddenException);
    const semToken = montar('producao', credencial({ verifyToken: '' }));
    expect(() => semToken.controller.verificar('subscribe', '', '12345', res)).toThrow(ForbiddenException);
  });

  it('POST com assinatura válida responde na hora e SÓ enfileira (Regra 4)', async () => {
    const { controller, fila } = montar('producao');
    await expect(controller.receber({ rawBody: cru }, assinar('segredo-do-app'), corpo)).resolves.toEqual({ recebido: true });
    expect(fila.add).toHaveBeenCalledTimes(1);
    expect(fila.add).toHaveBeenCalledWith(JOB_EVENTO_META, corpo, expect.any(Object));
  });

  it('POST com assinatura errada ou ausente é recusado e nada é enfileirado', async () => {
    const { controller, fila } = montar('producao');
    await expect(controller.receber({ rawBody: cru }, assinar('outro-segredo'), corpo)).rejects.toThrow(UnauthorizedException);
    await expect(controller.receber({ rawBody: cru }, undefined, corpo)).rejects.toThrow(UnauthorizedException);
    await expect(controller.receber({}, assinar('segredo-do-app'), corpo)).rejects.toThrow(UnauthorizedException);
    expect(fila.add).not.toHaveBeenCalled();
  });

  it('produção recusa webhook sem segredo configurado; ambiente de teste aceita', async () => {
    const prod = montar('producao', credencial({ appSecret: '' }));
    await expect(prod.controller.receber({ rawBody: cru }, undefined, corpo)).rejects.toThrow(UnauthorizedException);
    expect(prod.fila.add).not.toHaveBeenCalled();
    const hml = montar('homologacao', credencial({ appSecret: '' }));
    await expect(hml.controller.receber({ rawBody: cru }, undefined, corpo)).resolves.toEqual({ recebido: true });
    expect(hml.fila.add).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------

describe('WhatsappEventosService', () => {
  it('separa mensagens recebidas de situações de entrega e consulta os receptores na ordem', async () => {
    const mensagens = {
      registrarEntradas: jest.fn(async () => 1),
      aplicarStatusSaida: jest.fn(async (id: string) => id === 'wamid.RESPOSTA'),
    } as unknown as WhatsappMensagensService;
    const eventos = new WhatsappEventosService(mensagens);
    const lembretes = { aplicarStatusMeta: jest.fn(async (s: { mensagemId: string }) => s.mensagemId === 'wamid.LEMBRETE') };
    eventos.registrarReceptor(lembretes);
    const r = await eventos.processar({
      entry: [{
        changes: [{
          value: {
            messages: [{ from: '551187654321', id: 'wamid.IN', type: 'text', text: { body: 'pago amanhã' } }],
            statuses: [
              { id: 'wamid.LEMBRETE', status: 'delivered', timestamp: '1794000000' },
              { id: 'wamid.RESPOSTA', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] },
              { id: 'wamid.DE-OUTRO-AMBIENTE', status: 'read' },
            ],
          },
        }],
      }],
    });
    expect(r).toEqual({ mensagens: 1, status: 2, ignorados: 1 });
    expect(lembretes.aplicarStatusMeta).toHaveBeenCalledWith({ mensagemId: 'wamid.LEMBRETE', status: 'delivered', quando: new Date(1794000000 * 1000), motivoFalha: undefined });
    expect(mensagens.aplicarStatusSaida).toHaveBeenCalledWith('wamid.RESPOSTA', 'failed', '131026 · Message undeliverable');
    expect(mensagens.aplicarStatusSaida).not.toHaveBeenCalledWith('wamid.LEMBRETE', expect.anything(), expect.anything());
  });

  it('corpo vazio ou estranho não estoura', async () => {
    const eventos = new WhatsappEventosService({ registrarEntradas: jest.fn(), aplicarStatusSaida: jest.fn() } as unknown as WhatsappMensagensService);
    await expect(eventos.processar(null)).resolves.toEqual({ mensagens: 0, status: 0, ignorados: 0 });
    await expect(eventos.processar({ entry: [{ changes: [{}] }] })).resolves.toEqual({ mensagens: 0, status: 0, ignorados: 0 });
  });
});
