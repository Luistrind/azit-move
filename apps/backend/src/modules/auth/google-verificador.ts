import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

// O que o AuthService precisa saber de um ID token do Google (doc 06 §2.2, passo 4).
export interface IdentidadeGoogle {
  sub: string;
  email: string;
  emailVerificado: boolean;
  hd?: string; // domínio hospedado (só contas Workspace trazem)
  nome?: string;
}

// Porta do verificador: o AuthService depende DESTA interface, e os testes
// trocam a implementação por um dublê — nunca saem para a rede do Google.
export interface VerificadorGoogle {
  configurado(): boolean;
  clientId(): string | null;
  verificar(credential: string): Promise<IdentidadeGoogle>;
}
export const VERIFICADOR_GOOGLE = Symbol('VERIFICADOR_GOOGLE');

// Implementação real com a biblioteca oficial (google-auth-library):
// assinatura, `iss` do Google, `exp` e `aud` = GOOGLE_CLIENT_ID (§11.3).
// Não há client secret neste fluxo — o id do cliente é público por natureza.
@Injectable()
export class GoogleIdTokenVerificador implements VerificadorGoogle {
  private readonly logger = new Logger(GoogleIdTokenVerificador.name);
  private readonly id: string;
  private cliente: OAuth2Client | null = null;

  constructor(config: ConfigService) {
    this.id = (config.get<string>('google.clientId') ?? '').trim();
    if (!this.id) this.logger.warn('GOOGLE_CLIENT_ID ausente — entrada pelo Google desligada neste ambiente (doc 06 §2.2)');
  }

  configurado(): boolean {
    return this.id.length > 0;
  }

  clientId(): string | null {
    return this.configurado() ? this.id : null;
  }

  async verificar(credential: string): Promise<IdentidadeGoogle> {
    if (!this.configurado()) throw new Error('google_nao_configurado');
    this.cliente ??= new OAuth2Client(this.id);
    const ticket = await this.cliente.verifyIdToken({ idToken: credential, audience: this.id });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('token_sem_identidade');
    return { sub: p.sub, email: p.email, emailVerificado: p.email_verified === true, hd: p.hd, nome: p.name };
  }
}
