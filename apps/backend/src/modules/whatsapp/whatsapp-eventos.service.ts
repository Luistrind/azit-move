import { Injectable, Logger } from '@nestjs/common';
import { ValorMensagensMeta, WhatsappMensagensService } from './whatsapp-mensagens.service';

// O que o webhook da Meta entrega (doc 02 §23.4), já fora da requisição: a
// fila chama `processar` com o corpo recebido. Dois assuntos por evento —
// mensagens dos clientes (viram conversa, §24) e situação de entrega dos
// envios (entregue, lida, falhou).

export type StatusMeta = {
  id: string; // id da mensagem na Meta
  status: string; // sent | delivered | read | failed
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
};

type ValorMeta = { statuses?: StatusMeta[] } & ValorMensagensMeta;
export type EventoMeta = { entry?: { changes?: { field?: string; value?: ValorMeta }[] }[] };

// Quem sabe aplicar a situação de entrega a um envio seu. Devolve true quando
// o id da mensagem é dele (os demais nem são consultados). Os lembretes de
// pagamento (§28) se registram aqui; as respostas do operador vêm por último.
export interface ReceptorStatusMeta {
  aplicarStatusMeta(s: { mensagemId: string; status: string; quando: Date; motivoFalha?: string }): Promise<boolean>;
}

export function motivoFalhaMeta(s: StatusMeta): string | undefined {
  const er = s.errors?.[0];
  return [er?.code, er?.title, er?.message, er?.error_data?.details].filter(Boolean).join(' · ') || undefined;
}

@Injectable()
export class WhatsappEventosService {
  private readonly logger = new Logger(WhatsappEventosService.name);
  private readonly receptores: ReceptorStatusMeta[] = [];

  constructor(private readonly mensagens: WhatsappMensagensService) {}

  registrarReceptor(r: ReceptorStatusMeta) {
    this.receptores.push(r);
  }

  async processar(payload: unknown): Promise<{ mensagens: number; status: number; ignorados: number }> {
    const p = (payload ?? {}) as EventoMeta;
    let mensagens = 0;
    let status = 0;
    let ignorados = 0;
    for (const entry of p.entry ?? []) {
      for (const ch of entry.changes ?? []) {
        const valor = ch.value;
        if (!valor) continue;
        if (valor.messages?.length) mensagens += await this.mensagens.registrarEntradas(valor);
        for (const s of valor.statuses ?? []) {
          if (!s?.id || !s.status) continue;
          const quando = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
          const motivoFalha = s.status === 'failed' ? (motivoFalhaMeta(s) ?? 'falha informada pela Meta') : undefined;
          let aplicado = false;
          for (const r of this.receptores) {
            if (await r.aplicarStatusMeta({ mensagemId: s.id, status: s.status, quando, motivoFalha })) {
              aplicado = true;
              break;
            }
          }
          if (!aplicado) aplicado = await this.mensagens.aplicarStatusSaida(s.id, s.status, motivoFalha);
          if (aplicado) status += 1;
          else ignorados += 1; // mensagem de outro ambiente (o número é um só — §23.2)
        }
      }
    }
    if (mensagens || status || ignorados) this.logger.log(`evento da Meta: ${mensagens} mensagem(ns), ${status} situação(ões), ${ignorados} ignorada(s)`);
    return { mensagens, status, ignorados };
  }
}
