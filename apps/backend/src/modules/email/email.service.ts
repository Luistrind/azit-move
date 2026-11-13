import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { EstadoEnvioEmail } from '@azit/types';
import { QUEUE_NAMES } from '../queues/queues.module';
import { TipoTransporteEmail, TRANSPORTE_EMAIL, TransporteEmail } from './transporte-email';

// ============================================================
// Serviço GENÉRICO de e-mail (doc 06 v1.1 §12.4). `enviar` só ENFILEIRA (fila
// `email`, 3 tentativas, espera crescente) — nunca chama o Gmail na requisição
// (Regra 4: nada síncrono). Quem usa hoje: a ponte da notificação dirigida
// (NotificacaoService). Amanhã: Fatura Azit (doc 02 §32), com remetente e
// modelo próprios, pela MESMA fila.
//
// Origem + ganchos: cada módulo que envia registra a sua "origem" (ex.
// 'notificacao') com ganchos que o processor chama ANTES de enviar (descartar
// se não faz mais sentido), no sucesso (gravar o rastro) e no não-envio
// (descarte, não configurado, falha definitiva). Registry evita dependência
// circular: a notificação importa o e-mail, nunca o contrário.
// ============================================================

export const TENTATIVAS_EMAIL = 3;
export const ESPERA_INICIAL_EMAIL_MS = 60_000; // 1 min → 2 min → 4 min

export interface OrigemEmail {
  tipo: string; // 'notificacao' | 'fatura' | ...
  id: string;
  contexto?: Record<string, unknown>;
}

export interface EnviarEmail {
  para: string;
  assunto: string;
  corpo: { texto: string; html?: string };
  origem: OrigemEmail;
}

export type VereditoAntesDeEnviar = { ok: true } | { ok: false; motivo: string };

export interface GanchosOrigemEmail {
  antesDeEnviar?(origem: OrigemEmail): Promise<VereditoAntesDeEnviar>;
  enviado?(origem: OrigemEmail, em: Date, idProvedor?: string): Promise<void>;
  // `definitivo` = não haverá nova tentativa (descarte, não configurado, 3ª falha).
  naoEnviado?(origem: OrigemEmail, motivo: string, definitivo: boolean): Promise<void>;
}

export interface DadosJobEmail {
  para: string;
  assunto: string;
  texto: string;
  html?: string;
  origem: OrigemEmail;
  enfileiradoEm: string;
}

export interface ResultadoJobEmail {
  resultado: 'enviado' | 'descartado' | 'nao_configurado';
  motivo?: string;
  idProvedor?: string;
}

export interface EnvioListado {
  id: string;
  para: string;
  assunto: string;
  origem: OrigemEmail;
  estado: EstadoEnvioEmail;
  motivo: string | null;
  tentativas: number;
  em: string; // ISO do último evento (fim ou enfileiramento)
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly origens = new Map<string, GanchosOrigemEmail>();

  constructor(
    @InjectQueue(QUEUE_NAMES.EMAIL) private readonly fila: Queue<DadosJobEmail, ResultadoJobEmail>,
    @Inject(TRANSPORTE_EMAIL) private readonly transporte: TransporteEmail,
  ) {}

  registrarOrigem(tipo: string, ganchos: GanchosOrigemEmail) {
    this.origens.set(tipo, ganchos);
  }

  ganchos(tipo: string): GanchosOrigemEmail | undefined {
    return this.origens.get(tipo);
  }

  configuracao(): { configurado: boolean; transporte: TipoTransporteEmail; descricao: string; remetente: string | null } {
    return {
      configurado: this.transporte.configurado(),
      transporte: this.transporte.tipo(),
      descricao: this.transporte.descricao(),
      remetente: this.transporte.remetente(),
    };
  }

  // Enfileira e devolve na hora. Falha de Redis é do chamador decidir (a ponte
  // da notificação engole e registra; a operação de negócio nunca cai por isso).
  async enviar(d: EnviarEmail): Promise<{ jobId: string }> {
    const job = await this.fila.add(
      'enviar',
      { para: d.para, assunto: d.assunto, texto: d.corpo.texto, html: d.corpo.html, origem: d.origem, enfileiradoEm: new Date().toISOString() },
      {
        attempts: TENTATIVAS_EMAIL,
        backoff: { type: 'exponential', delay: ESPERA_INICIAL_EMAIL_MS },
        removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    );
    this.logger.log(`e-mail enfileirado (${d.origem.tipo}:${d.origem.id}) para ${d.para}: "${d.assunto}"`);
    return { jobId: String(job.id) };
  }

  // Últimos envios/falhas da fila (Central de integrações) — lê o BullMQ, sem tabela própria.
  async ultimosEnvios(limite = 5): Promise<EnvioListado[]> {
    const jobs = await this.fila.getJobs(['completed', 'failed', 'active', 'waiting', 'delayed'], 0, Math.max(limite * 4, 20));
    const itens = jobs.filter((j): j is Job<DadosJobEmail, ResultadoJobEmail> => !!j?.data?.origem).map((j) => this.descrever(j));
    return itens.sort((a, b) => (a.em < b.em ? 1 : -1)).slice(0, limite);
  }

  private descrever(j: Job<DadosJobEmail, ResultadoJobEmail>): EnvioListado {
    const r = j.returnvalue;
    let estado: EstadoEnvioEmail;
    let motivo: string | null = null;
    if (j.finishedOn && j.failedReason && !r) {
      estado = 'falhou';
      motivo = j.failedReason;
    } else if (r?.resultado === 'enviado') {
      estado = 'enviado';
    } else if (r?.resultado === 'descartado') {
      estado = 'descartado';
      motivo = r.motivo ?? null;
    } else if (r?.resultado === 'nao_configurado') {
      estado = 'naoConfigurado';
      motivo = 'email_nao_configurado';
    } else if (j.attemptsMade > 0) {
      estado = 'tentando';
      motivo = j.failedReason || null;
    } else {
      estado = 'aguardando';
    }
    const em = new Date(j.finishedOn ?? j.processedOn ?? j.timestamp).toISOString();
    return { id: String(j.id), para: j.data.para, assunto: j.data.assunto, origem: j.data.origem, estado, motivo, tentativas: j.attemptsMade, em };
  }
}
