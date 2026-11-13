import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { JWT } from 'google-auth-library';
import { createTransport, Transporter } from 'nodemailer';

// ============================================================
// Transporte de e-mail (doc 06 v1.1 §12.4). O EmailService só enfileira; o
// processor da fila `email` chama ESTA porta. Implementações, escolhidas por
// EMAIL_TRANSPORTE (deploy/AMBIENTES.md §1.7):
//   - TransporteSmtpRelay ('smtp-relay', o ESCOLHIDO): relay SMTP do Workspace
//     (smtp-relay.gmail.com:587, STARTTLS, sem autenticação — liberado pelo IP
//     do servidor no Admin do Workspace), remetente = EMAIL_REMETENTE;
//   - TransporteGmail ('gmail-api', alternativa): API do Gmail com conta de
//     serviço e delegação de domínio — exige a chave JSON, que a política da
//     organização (iam.managed.disableServiceAccountKeyCreation) bloqueia hoje;
//   - TransporteNaoConfigurado ('nenhum', padrão): o job termina como
//     `email_nao_configurado`, sem tentar de novo, e o sino segue funcionando;
//   - TransporteDuble: testes (guarda o que "enviou", pode falhar sob comando).
// Credencial NUNCA aparece em log nem em resposta de API.
// ============================================================

export type TipoTransporteEmail = 'smtp-relay' | 'gmail-api' | 'nenhum' | 'duble';

export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
  html?: string;
}

export interface TransporteEmail {
  tipo(): TipoTransporteEmail;
  configurado(): boolean;
  remetente(): string | null;
  // Para a tela: o que está por trás (host:porta do relay; conta de serviço do Gmail). Nunca segredo.
  descricao(): string;
  enviar(mensagem: MensagemEmail): Promise<{ idProvedor?: string }>;
}
export const TRANSPORTE_EMAIL = Symbol('TRANSPORTE_EMAIL');

export const SMTP_RELAY_HOST_PADRAO = 'smtp-relay.gmail.com';
export const SMTP_RELAY_PORTA_PADRAO = 587;

export const ESCOPO_GMAIL_ENVIO = 'https://www.googleapis.com/auth/gmail.send';
export const URL_GMAIL_ENVIO = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
export const NOME_REMETENTE = 'Azit Hub';

// Conta de serviço: o valor da variável é o CONTEÚDO do JSON (começa com "{"),
// o mesmo JSON em BASE64 (uma linha, cabe no stack.env — forma recomendada no
// servidor) ou o CAMINHO de um arquivo. Devolve só o que o cliente JWT precisa;
// qualquer problema vira `null` (transporte não configurado).
export interface CredencialContaServico {
  clientEmail: string;
  privateKey: string;
}
export function lerCredencialContaServico(valor: string): CredencialContaServico | null {
  const v = (valor ?? '').trim();
  if (!v) return null;
  try {
    const bruto = v.startsWith('{')
      ? v
      : existsSync(v)
        ? readFileSync(v, 'utf8')
        : Buffer.from(v, 'base64').toString('utf8');
    const json = JSON.parse(bruto) as { client_email?: string; private_key?: string };
    if (!json.client_email || !json.private_key) return null;
    return { clientEmail: json.client_email, privateKey: json.private_key };
  } catch {
    return null;
  }
}

// Base64 "URL safe" sem padding, como a API do Gmail exige no campo `raw`.
export function paraBase64Url(conteudo: string | Buffer): string {
  return Buffer.from(conteudo).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Cabeçalho com acento/UTF-8 (RFC 2047) — assunto e nome de exibição.
function cabecalhoUtf8(valor: string): string {
  return /^[\x20-\x7e]*$/.test(valor) ? valor : `=?UTF-8?B?${Buffer.from(valor, 'utf8').toString('base64')}?=`;
}

function base64Quebrado(texto: string): string {
  return Buffer.from(texto, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
}

// Mensagem RFC 2822 (multipart/alternative: texto + HTML). Pura — testada sem rede.
export function montarMime(m: MensagemEmail & { de: string; nomeDe?: string }): string {
  const fronteira = `azit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const de = m.nomeDe ? `${cabecalhoUtf8(m.nomeDe)} <${m.de}>` : m.de;
  const linhas = [
    `From: ${de}`,
    `To: ${m.para}`,
    `Subject: ${cabecalhoUtf8(m.assunto)}`,
    'MIME-Version: 1.0',
    'X-Mailer: Azit Hub',
  ];
  if (!m.html) {
    linhas.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', base64Quebrado(m.texto));
    return linhas.join('\r\n');
  }
  linhas.push(
    `Content-Type: multipart/alternative; boundary="${fronteira}"`,
    '',
    `--${fronteira}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Quebrado(m.texto),
    `--${fronteira}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Quebrado(m.html),
    `--${fronteira}--`,
    '',
  );
  return linhas.join('\r\n');
}

export class TransporteNaoConfigurado implements TransporteEmail {
  constructor(private readonly motivo = 'EMAIL_TRANSPORTE=nenhum') {}
  tipo(): TipoTransporteEmail { return 'nenhum'; }
  configurado() { return false; }
  remetente() { return null; }
  descricao() { return this.motivo; }
  async enviar(): Promise<{ idProvedor?: string }> {
    throw new Error('email_nao_configurado');
  }
}

// Relay SMTP do Workspace (o escolhido): sem usuário/senha — o Admin do Workspace
// libera o IP do servidor (Gmail › Roteamento › Serviço de relay SMTP), exige TLS
// e só aceita remetente dos domínios da empresa. Em dev local o IP não está
// liberado: usar 'nenhum'. `criarTransportador` é injetável para o teste.
export class TransporteSmtpRelay implements TransporteEmail {
  private transportador: Transporter | null = null;

  constructor(
    private readonly caixaRemetente: string,
    private readonly host: string = SMTP_RELAY_HOST_PADRAO,
    private readonly porta: number = SMTP_RELAY_PORTA_PADRAO,
    private readonly criarTransportador: (opcoes: { host: string; port: number }) => Pick<Transporter, 'sendMail'> = (o) =>
      createTransport({ host: o.host, port: o.port, secure: false, requireTLS: true, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 }),
  ) {}

  tipo(): TipoTransporteEmail { return 'smtp-relay'; }
  configurado() { return true; }
  remetente() { return this.caixaRemetente; }
  descricao() { return `${this.host}:${this.porta} · STARTTLS · sem autenticação (IP liberado no Admin do Workspace)`; }

  async enviar(mensagem: MensagemEmail): Promise<{ idProvedor?: string }> {
    this.transportador ??= this.criarTransportador({ host: this.host, port: this.porta }) as Transporter;
    const info = await this.transportador.sendMail({
      from: { name: NOME_REMETENTE, address: this.caixaRemetente },
      to: mensagem.para,
      subject: mensagem.assunto,
      text: mensagem.texto,
      html: mensagem.html,
      headers: { 'X-Mailer': 'Azit Hub' },
    });
    return { idProvedor: info?.messageId };
  }
}

// API do Gmail com delegação de domínio: o JWT da conta de serviço pede token
// EM NOME da caixa remetente (`subject`), com o único escopo gmail.send.
export class TransporteGmail implements TransporteEmail {
  private cliente: JWT | null = null;

  constructor(
    private readonly caixaRemetente: string,
    private readonly credencial: CredencialContaServico,
    private readonly solicitar: (cliente: JWT, corpo: { raw: string }) => Promise<{ id?: string }> = async (cliente, corpo) => {
      const r = await cliente.request<{ id?: string }>({ url: URL_GMAIL_ENVIO, method: 'POST', data: corpo });
      return r.data ?? {};
    },
  ) {}

  tipo(): TipoTransporteEmail { return 'gmail-api'; }
  configurado() { return true; }
  remetente() { return this.caixaRemetente; }
  descricao() { return `API do Gmail · conta de serviço ${this.credencial.clientEmail} · delegação de domínio`; }

  async enviar(mensagem: MensagemEmail): Promise<{ idProvedor?: string }> {
    this.cliente ??= new JWT({
      email: this.credencial.clientEmail,
      key: this.credencial.privateKey,
      scopes: [ESCOPO_GMAIL_ENVIO],
      subject: this.caixaRemetente,
    });
    const raw = paraBase64Url(montarMime({ ...mensagem, de: this.caixaRemetente, nomeDe: NOME_REMETENTE }));
    const r = await this.solicitar(this.cliente, { raw });
    return { idProvedor: r.id };
  }
}

// Dublê para testes: nunca sai para a rede.
export class TransporteDuble implements TransporteEmail {
  enviados: MensagemEmail[] = [];
  falharCom: Error | null = null;
  constructor(private readonly caixa: string | null = 'hub@azitmove.com.br') {}
  tipo(): TipoTransporteEmail { return 'duble'; }
  configurado() { return this.caixa !== null; }
  remetente() { return this.caixa; }
  descricao() { return 'dublê de teste'; }
  async enviar(m: MensagemEmail) {
    if (this.falharCom) throw this.falharCom;
    this.enviados.push(m);
    return { idProvedor: `duble-${this.enviados.length}` };
  }
}

// Fábrica usada pelo módulo: decide pela configuração do ambiente, uma vez no boot.
// Pura em relação ao ambiente (só lê o ConfigService) — testada sem rede.
export function criarTransporteEmail(config: ConfigService, logger = new Logger('TransporteEmail')): TransporteEmail {
  const transporte = (config.get<string>('email.transporte') ?? 'nenhum').trim() || 'nenhum';
  const remetente = (config.get<string>('email.remetente') ?? '').trim();
  const naoConfigurado = (motivo: string) => {
    logger.warn(`E-mail NÃO configurado (${motivo}) — a fila registra "email_nao_configurado" e o sino segue (doc 06 §12.4)`);
    return new TransporteNaoConfigurado(motivo);
  };
  if (transporte === 'nenhum') return naoConfigurado('EMAIL_TRANSPORTE=nenhum ou ausente');
  if (!remetente) return naoConfigurado(`EMAIL_TRANSPORTE=${transporte} sem EMAIL_REMETENTE`);
  if (transporte === 'smtp-relay') {
    const host = (config.get<string>('email.smtpHost') ?? '').trim() || SMTP_RELAY_HOST_PADRAO;
    const porta = Number(config.get<number>('email.smtpPort')) || SMTP_RELAY_PORTA_PADRAO;
    logger.log(`E-mail configurado: remetente ${remetente} via relay SMTP ${host}:${porta} (STARTTLS, sem autenticação)`);
    return new TransporteSmtpRelay(remetente, host, porta);
  }
  if (transporte === 'gmail-api') {
    const credencial = lerCredencialContaServico(config.get<string>('email.serviceAccountJson') ?? '');
    if (!credencial) return naoConfigurado('EMAIL_TRANSPORTE=gmail-api sem GOOGLE_SERVICE_ACCOUNT_JSON válida');
    logger.log(`E-mail configurado: remetente ${remetente} via API do Gmail (conta de serviço ${credencial.clientEmail})`);
    return new TransporteGmail(remetente, credencial);
  }
  return naoConfigurado(`EMAIL_TRANSPORTE=${transporte} desconhecido (use smtp-relay, gmail-api ou nenhum)`);
}
