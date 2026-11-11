import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

// Recorte da requisição do Fastify que o guard usa (sem depender dos tipos do pacote).
type Requisicao = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  url: string;
  params?: { token?: string };
};

// Limite de requisições das rotas PÚBLICAS da Fatura Azit (doc 02 §32.2): por
// IP e por token, janela deslizante de 1 minuto, em memória. A API roda em uma
// réplica; se escalar, este guard vira Redis (mesma interface). Objetivo:
// frear varredura de tokens e abuso de PDF, não controle fino.
@Injectable()
export class LimitePublicoGuard implements CanActivate {
  private static readonly JANELA_MS = 60_000;
  private static readonly POR_IP = 90; // ~1 página + polling de 30 s de várias faturas
  private static readonly POR_TOKEN = 60;
  private static readonly POR_IP_PDF = 10;
  private readonly janelas = new Map<string, number[]>();
  private ultimaLimpeza = Date.now();

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Requisicao>();
    const ip = this.ipDe(req);
    const token = req.params?.token ?? '';
    const ehPdf = req.url.endsWith('/pdf');
    this.limparSePreciso();
    if (!this.permitir(`ip:${ip}`, LimitePublicoGuard.POR_IP)) this.negar();
    if (ehPdf && !this.permitir(`pdf:${ip}`, LimitePublicoGuard.POR_IP_PDF)) this.negar();
    if (token && !this.permitir(`tk:${token}`, LimitePublicoGuard.POR_TOKEN)) this.negar();
    return true;
  }

  private ipDe(req: Requisicao): string {
    // Atrás do Traefik o IP real vem no X-Forwarded-For (primeiro da lista).
    const xff = req.headers['x-forwarded-for'];
    const primeiro = Array.isArray(xff) ? xff[0] : xff?.split(',')[0];
    return (primeiro ?? req.ip ?? 'desconhecido').trim();
  }

  private permitir(chave: string, limite: number): boolean {
    const agora = Date.now();
    const lista = (this.janelas.get(chave) ?? []).filter((t) => agora - t < LimitePublicoGuard.JANELA_MS);
    if (lista.length >= limite) {
      this.janelas.set(chave, lista);
      return false;
    }
    lista.push(agora);
    this.janelas.set(chave, lista);
    return true;
  }

  private limparSePreciso(): void {
    const agora = Date.now();
    if (agora - this.ultimaLimpeza < LimitePublicoGuard.JANELA_MS) return;
    this.ultimaLimpeza = agora;
    for (const [k, lista] of this.janelas) {
      const viva = lista.filter((t) => agora - t < LimitePublicoGuard.JANELA_MS);
      if (viva.length === 0) this.janelas.delete(k);
      else this.janelas.set(k, viva);
    }
  }

  private negar(): never {
    throw new HttpException({ erro: 'muitas_requisicoes', mensagem: 'Muitas requisições. Aguarde um instante e tente de novo.' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
