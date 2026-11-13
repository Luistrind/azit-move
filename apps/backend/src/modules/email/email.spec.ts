import { Job } from 'bullmq';
import { DadosJobEmail, EmailService, ESPERA_INICIAL_EMAIL_MS, TENTATIVAS_EMAIL } from './email.service';
import { EmailProcessor } from './email.processor';
import { modeloEmailHub, RODAPE_EMAIL_HUB } from './modelo-email';
import {
  criarTransporteEmail,
  lerCredencialContaServico,
  montarMime,
  paraBase64Url,
  SMTP_RELAY_HOST_PADRAO,
  SMTP_RELAY_PORTA_PADRAO,
  TransporteDuble,
  TransporteGmail,
  TransporteNaoConfigurado,
  TransporteSmtpRelay,
  URL_GMAIL_ENVIO,
} from './transporte-email';

// E-mail genérico (doc 06 v1.1 §12.3 item 3, §12.4): enfileira com 3 tentativas,
// transporte injetável, descarte antes do envio e rastro por ganchos da origem.

function filaDuble() {
  return { add: jest.fn().mockResolvedValue({ id: '7' }), getJobs: jest.fn().mockResolvedValue([]) };
}

function jobDe(dados: Partial<DadosJobEmail> = {}, opts: { attemptsMade?: number; attempts?: number } = {}) {
  return {
    id: '1',
    data: { para: 'ana@azit.com.br', assunto: 'Teste', texto: 't', html: '<p>t</p>', origem: { tipo: 'notificacao', id: 'n-1', contexto: { usuarioId: 'u-1' } }, enfileiradoEm: new Date().toISOString(), ...dados },
    attemptsMade: opts.attemptsMade ?? 1,
    opts: { attempts: opts.attempts ?? TENTATIVAS_EMAIL },
  } as unknown as Job<DadosJobEmail>;
}

describe('EmailService.enviar — só enfileira', () => {
  it('job na fila `email` com 3 tentativas e espera crescente', async () => {
    const fila = filaDuble();
    const service = new EmailService(fila as never, new TransporteDuble());
    const r = await service.enviar({ para: 'ana@azit.com.br', assunto: 'Oi', corpo: { texto: 'x' }, origem: { tipo: 'notificacao', id: 'n-1' } });
    expect(r.jobId).toBe('7');
    expect(fila.add).toHaveBeenCalledWith(
      'enviar',
      expect.objectContaining({ para: 'ana@azit.com.br', assunto: 'Oi', texto: 'x', origem: { tipo: 'notificacao', id: 'n-1' } }),
      expect.objectContaining({ attempts: TENTATIVAS_EMAIL, backoff: { type: 'exponential', delay: ESPERA_INICIAL_EMAIL_MS } }),
    );
  });

  it('configuracao() expõe estado, transporte e remetente, nunca credencial', () => {
    expect(new EmailService(filaDuble() as never, new TransporteDuble()).configuracao()).toEqual({ configurado: true, transporte: 'duble', descricao: 'dublê de teste', remetente: 'hub@azitmove.com.br' });
    expect(new EmailService(filaDuble() as never, new TransporteNaoConfigurado()).configuracao()).toMatchObject({ configurado: false, transporte: 'nenhum', remetente: null });
  });

  it('ultimosEnvios lê a fila e classifica cada job', async () => {
    const fila = filaDuble();
    const base = { data: { para: 'a@azit.com.br', assunto: 'A', origem: { tipo: 'notificacao', id: 'n' } }, attemptsMade: 1, timestamp: 1, processedOn: 2 };
    fila.getJobs.mockResolvedValue([
      { ...base, id: 'ok', finishedOn: 10, returnvalue: { resultado: 'enviado' } },
      { ...base, id: 'desc', finishedOn: 20, returnvalue: { resultado: 'descartado', motivo: 'descartado_ja_lida' } },
      { ...base, id: 'nc', finishedOn: 30, returnvalue: { resultado: 'nao_configurado' } },
      { ...base, id: 'falha', finishedOn: 40, failedReason: 'boom', attemptsMade: 3 },
      { ...base, id: 'retry', failedReason: 'oops', attemptsMade: 1 },
      { ...base, id: 'esp', attemptsMade: 0 },
    ]);
    const lista = await new EmailService(fila as never, new TransporteDuble()).ultimosEnvios(10);
    const porId = Object.fromEntries(lista.map((l) => [l.id, l.estado]));
    expect(porId).toEqual({ ok: 'enviado', desc: 'descartado', nc: 'naoConfigurado', falha: 'falhou', retry: 'tentando', esp: 'aguardando' });
    expect(lista[0].id).toBe('falha'); // mais recente primeiro
  });
});

describe('EmailProcessor', () => {
  function montar(transporte = new TransporteDuble()) {
    const service = new EmailService(filaDuble() as never, transporte);
    const ganchos = {
      antesDeEnviar: jest.fn().mockResolvedValue({ ok: true }),
      enviado: jest.fn().mockResolvedValue(undefined),
      naoEnviado: jest.fn().mockResolvedValue(undefined),
    };
    service.registrarOrigem('notificacao', ganchos);
    const notificacao = { emitir: jest.fn().mockResolvedValue('n-falha') };
    const processor = new EmailProcessor(service, notificacao as never, transporte);
    return { processor, ganchos, notificacao, transporte };
  }

  it('transporte não configurado: termina como nao_configurado, sem enviar e sem retry', async () => {
    const { processor, ganchos } = montar(new TransporteNaoConfigurado() as never);
    const r = await processor.process(jobDe());
    expect(r).toEqual({ resultado: 'nao_configurado' });
    expect(ganchos.naoEnviado).toHaveBeenCalledWith(expect.objectContaining({ id: 'n-1' }), 'email_nao_configurado', true);
    expect(ganchos.antesDeEnviar).not.toHaveBeenCalled();
  });

  it('gancho antesDeEnviar nega: descarta com o motivo, nada sai', async () => {
    const { processor, ganchos, transporte } = montar();
    ganchos.antesDeEnviar.mockResolvedValue({ ok: false, motivo: 'descartado_ja_lida' });
    const r = await processor.process(jobDe());
    expect(r).toEqual({ resultado: 'descartado', motivo: 'descartado_ja_lida' });
    expect(transporte.enviados).toHaveLength(0);
    expect(ganchos.naoEnviado).toHaveBeenCalledWith(expect.anything(), 'descartado_ja_lida', true);
  });

  it('envia e grava o rastro pelo gancho enviado', async () => {
    const { processor, ganchos, transporte } = montar();
    const r = await processor.process(jobDe());
    expect(r.resultado).toBe('enviado');
    expect(transporte.enviados[0]).toMatchObject({ para: 'ana@azit.com.br', assunto: 'Teste' });
    expect(ganchos.enviado).toHaveBeenCalledWith(expect.objectContaining({ id: 'n-1' }), expect.any(Date), 'duble-1');
  });

  it('falha do transporte lança (o BullMQ tenta de novo); a definitiva grava motivo e avisa Configurações', async () => {
    const { processor, ganchos, notificacao, transporte } = montar();
    transporte.falharCom = new Error('Gmail 403 delegation');
    await expect(processor.process(jobDe())).rejects.toThrow('Gmail 403 delegation');
    // 1ª e 2ª falhas: nada definitivo
    await processor.onFailed(jobDe({}, { attemptsMade: 1 }), new Error('Gmail 403 delegation'));
    expect(ganchos.naoEnviado).not.toHaveBeenCalled();
    // 3ª falha: definitiva
    await processor.onFailed(jobDe({}, { attemptsMade: 3 }), new Error('Gmail 403 delegation'));
    expect(ganchos.naoEnviado).toHaveBeenCalledWith(expect.anything(), 'Gmail 403 delegation', true);
    expect(notificacao.emitir).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'FALHA', area: 'CONFIGURACOES', rota: '/configuracoes/integracoes' }));
  });

  it('origem sem ganchos registrados: envia mesmo assim', async () => {
    const transporte = new TransporteDuble();
    const service = new EmailService(filaDuble() as never, transporte);
    const processor = new EmailProcessor(service, { emitir: jest.fn() } as never, transporte);
    const r = await processor.process(jobDe({ origem: { tipo: 'fatura', id: 'f-1' } }));
    expect(r.resultado).toBe('enviado');
  });
});

describe('Modelo e transporte Gmail (sem rede)', () => {
  it('modeloEmailHub: texto e HTML com botão, link e rodapé; HTML escapado', () => {
    const m = modeloEmailHub({ titulo: 'Aprovação esperando por você: Acordo', linhas: ['Valor: R$ 1,00', 'Obs: <b>x</b>'], url: 'https://app.azitmove.com.br/aprovacoes/1' });
    expect(m.texto).toContain('Abrir no Hub: https://app.azitmove.com.br/aprovacoes/1');
    expect(m.texto).toContain(RODAPE_EMAIL_HUB);
    expect(m.html).toContain('href="https://app.azitmove.com.br/aprovacoes/1"');
    expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(m.html).not.toMatch(/<img/);
  });

  it('lerCredencialContaServico: JSON inline, inválido e vazio', () => {
    expect(lerCredencialContaServico('{"client_email":"sa@p.iam.gserviceaccount.com","private_key":"-----BEGIN"}')).toEqual({ clientEmail: 'sa@p.iam.gserviceaccount.com', privateKey: '-----BEGIN' });
    // base64 de uma linha (forma recomendada no stack.env do servidor)
    const b64 = Buffer.from('{"client_email":"sa@p.iam.gserviceaccount.com","private_key":"-----BEGIN"}').toString('base64');
    expect(lerCredencialContaServico(b64)?.clientEmail).toBe('sa@p.iam.gserviceaccount.com');
    expect(lerCredencialContaServico('{"client_email":"x"}')).toBeNull();
    expect(lerCredencialContaServico('')).toBeNull();
    expect(lerCredencialContaServico('/caminho/que/nao/existe.json')).toBeNull();
  });

  it('montarMime: cabeçalhos UTF-8, duas partes e base64url do raw', () => {
    const mime = montarMime({ de: 'hub@azitmove.com.br', nomeDe: 'Azit Hub', para: 'ana@azit.com.br', assunto: 'Aprovação', texto: 'olá', html: '<p>olá</p>' });
    expect(mime).toContain('From: Azit Hub <hub@azitmove.com.br>');
    expect(mime).toContain('To: ana@azit.com.br');
    expect(mime).toContain('Subject: =?UTF-8?B?' + Buffer.from('Aprovação').toString('base64') + '?=');
    expect(mime).toContain('Content-Type: multipart/alternative');
    expect(mime).toContain('Content-Type: text/html');
    expect(paraBase64Url('a+b/c==')).not.toMatch(/[+/=]/);
  });

  it('TransporteSmtpRelay: envia pelo relay sem autenticação, com remetente da caixa do domínio', async () => {
    const enviados: Record<string, unknown>[] = [];
    let opcoes: { host: string; port: number } | null = null;
    const t = new TransporteSmtpRelay('hub@azitmove.com.br', SMTP_RELAY_HOST_PADRAO, SMTP_RELAY_PORTA_PADRAO, (o) => {
      opcoes = o;
      return { sendMail: async (m: Record<string, unknown>) => { enviados.push(m); return { messageId: '<id-1@azitmove.com.br>' }; } } as never;
    });
    expect(t.tipo()).toBe('smtp-relay');
    expect(t.configurado()).toBe(true);
    expect(t.descricao()).toContain('smtp-relay.gmail.com:587');
    const r = await t.enviar({ para: 'ana@azit.com.br', assunto: 'Aprovação', texto: 't', html: '<p>t</p>' });
    expect(r.idProvedor).toBe('<id-1@azitmove.com.br>');
    expect(opcoes).toEqual({ host: 'smtp-relay.gmail.com', port: 587 });
    expect(enviados[0]).toMatchObject({ from: { name: 'Azit Hub', address: 'hub@azitmove.com.br' }, to: 'ana@azit.com.br', subject: 'Aprovação', text: 't', html: '<p>t</p>' });
    expect(enviados[0]).not.toHaveProperty('auth');
  });

  it('criarTransporteEmail: escolhe pelo EMAIL_TRANSPORTE e cai em "nenhum" quando falta o essencial', () => {
    const cfg = (v: Record<string, unknown>) => ({ get: (k: string) => v[k] }) as never;
    const logger = { warn: jest.fn(), log: jest.fn() } as never;
    expect(criarTransporteEmail(cfg({}), logger).tipo()).toBe('nenhum');
    expect(criarTransporteEmail(cfg({ 'email.transporte': 'nenhum', 'email.remetente': 'hub@azitmove.com.br' }), logger).tipo()).toBe('nenhum');
    expect(criarTransporteEmail(cfg({ 'email.transporte': 'smtp-relay' }), logger).tipo()).toBe('nenhum'); // sem remetente
    const relay = criarTransporteEmail(cfg({ 'email.transporte': 'smtp-relay', 'email.remetente': 'hub@azitmove.com.br', 'email.smtpHost': '', 'email.smtpPort': 587 }), logger);
    expect(relay.tipo()).toBe('smtp-relay');
    expect(relay.remetente()).toBe('hub@azitmove.com.br');
    expect(criarTransporteEmail(cfg({ 'email.transporte': 'gmail-api', 'email.remetente': 'hub@azitmove.com.br', 'email.serviceAccountJson': '' }), logger).tipo()).toBe('nenhum');
    const gmail = criarTransporteEmail(cfg({ 'email.transporte': 'gmail-api', 'email.remetente': 'hub@azitmove.com.br', 'email.serviceAccountJson': '{"client_email":"sa@p.iam.gserviceaccount.com","private_key":"k"}' }), logger);
    expect(gmail.tipo()).toBe('gmail-api');
    expect(gmail.descricao()).toContain('sa@p.iam.gserviceaccount.com');
    expect(gmail.descricao()).not.toContain('"k"');
  });

  it('TransporteGmail: impersona o remetente e chama users.messages.send com `raw`', async () => {
    const chamadas: { url?: string; subject?: string; raw?: string }[] = [];
    const t = new TransporteGmail('hub@azitmove.com.br', { clientEmail: 'sa@p.iam.gserviceaccount.com', privateKey: 'k' }, async (cliente, corpo) => {
      chamadas.push({ url: URL_GMAIL_ENVIO, subject: (cliente as unknown as { subject?: string }).subject, raw: corpo.raw });
      return { id: 'gm-1' };
    });
    expect(t.configurado()).toBe(true);
    expect(t.remetente()).toBe('hub@azitmove.com.br');
    const r = await t.enviar({ para: 'ana@azit.com.br', assunto: 'Teste', texto: 't' });
    expect(r.idProvedor).toBe('gm-1');
    expect(chamadas[0].subject).toBe('hub@azitmove.com.br');
    expect(Buffer.from(chamadas[0].raw!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).toContain('To: ana@azit.com.br');
  });
});
