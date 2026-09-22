import { Injectable, Logger } from '@nestjs/common';
import { IntegracoesService } from '../integracoes/integracoes.service';

// LEITURA do Asaas para a migração do legado (doc 02 §26): clientes,
// assinaturas e cobranças como estão lá. Separado do AsaasService (que só
// executa cobranças novas) porque aqui a direção é a inversa — o Asaas é a
// fonte, o sistema lê. "Asaas executa, Azit controla" continua valendo: o
// que se lê vira CASO de conciliação, nunca contrato direto.
//
// MODO SIMULADO (sem chave): devolve uma base fictícia estável, com os
// mesmos formatos da API, para a bancada funcionar em dev sem rede.

export interface ClienteAsaas {
  id: string;
  name: string;
  cpfCnpj?: string | null;
  email?: string | null;
  mobilePhone?: string | null;
  phone?: string | null;
  deleted?: boolean;
  dateCreated?: string;
  externalReference?: string | null;
  [k: string]: unknown;
}

export interface AssinaturaAsaas {
  id: string;
  customer: string;
  value: number; // reais
  nextDueDate: string; // YYYY-MM-DD
  cycle: string; // WEEKLY | BIWEEKLY | MONTHLY …
  status: string; // ACTIVE | INACTIVE | EXPIRED
  description?: string | null;
  billingType?: string;
  deleted?: boolean;
  dateCreated?: string;
  [k: string]: unknown;
}

export interface CobrancaAsaasLida {
  id: string;
  customer: string;
  subscription?: string | null;
  value: number; // reais
  originalValue?: number | null;
  dueDate: string; // YYYY-MM-DD
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  status: string;
  billingType?: string;
  description?: string | null;
  invoiceUrl?: string | null;
  deleted?: boolean;
  externalReference?: string | null;
  dateCreated?: string;
  [k: string]: unknown;
}

interface Pagina<T> {
  data: T[];
  hasMore: boolean;
  totalCount?: number;
}

const LIMITE = 100;

@Injectable()
export class AsaasLeituraService {
  private readonly logger = new Logger(AsaasLeituraService.name);

  constructor(private readonly integracoes: IntegracoesService) {}

  get simulado(): boolean {
    return !this.integracoes.asaas().apiKey;
  }

  get ambiente(): 'simulado' | 'sandbox' | 'producao' {
    const c = this.integracoes.asaas();
    return c.apiKey ? c.ambiente : 'simulado';
  }

  // Requisição genérica (credencial efetiva da central de integrações).
  //
  // RITMO: o Asaas bloqueia temporariamente quem passa do limite de
  // requisições por minuto (429/403 "exceder o limite" — visto no sandbox em
  // 21/09 com ~230 chamadas em um minuto). Uma coleta de 107 clientes faz
  // mais de 200 chamadas, então: pausa curta entre chamadas e, ao ser
  // bloqueado, espera e repete em vez de derrubar a coleta inteira.
  async requisicao<T>(metodo: 'GET' | 'POST' | 'DELETE' | 'PUT', path: string, body?: unknown): Promise<T> {
    const cred = this.integracoes.asaas();
    const esperas = [30_000, 60_000, 120_000];
    for (let tentativa = 0; ; tentativa++) {
      await this.compassar();
      const resp = await fetch(`${cred.apiUrl}${path}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', access_token: cred.apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (resp.ok) return (await resp.json()) as T;
      const txt = await resp.text().catch(() => '');
      const bloqueado = resp.status === 429 || (resp.status === 403 && /limite de requisi/i.test(txt));
      if (bloqueado && tentativa < esperas.length) {
        this.logger.warn(`Asaas limitou as requisições (${resp.status}); esperando ${esperas[tentativa] / 1000}s para continuar`);
        await new Promise((r) => setTimeout(r, esperas[tentativa]));
        continue;
      }
      throw new Error(`Asaas ${metodo} ${path} retornou ${resp.status}: ${txt.slice(0, 300)}`);
    }
  }

  // Garante um intervalo mínimo entre chamadas (compartilhado pela instância).
  private ultimaChamada = 0;
  private async compassar(): Promise<void> {
    const INTERVALO_MS = 250; // ~4 chamadas/s
    const agora = Date.now();
    const falta = this.ultimaChamada + INTERVALO_MS - agora;
    if (falta > 0) await new Promise((r) => setTimeout(r, falta));
    this.ultimaChamada = Date.now();
  }

  private async todasAsPaginas<T>(path: string): Promise<T[]> {
    const tudo: T[] = [];
    let offset = 0;
    for (;;) {
      const sep = path.includes('?') ? '&' : '?';
      const pag = await this.requisicao<Pagina<T>>('GET', `${path}${sep}limit=${LIMITE}&offset=${offset}`);
      tudo.push(...pag.data);
      if (!pag.hasMore || pag.data.length === 0) break;
      offset += pag.data.length;
    }
    return tudo;
  }

  // ---- leituras ----

  async listarClientes(): Promise<ClienteAsaas[]> {
    if (this.simulado) return BASE_SIMULADA.clientes;
    return this.todasAsPaginas<ClienteAsaas>('/customers');
  }

  async buscarClientePorCpfCnpj(cpfCnpj: string): Promise<ClienteAsaas | null> {
    const doc = cpfCnpj.replace(/\D/g, '');
    if (this.simulado) return BASE_SIMULADA.clientes.find((c) => c.cpfCnpj === doc) ?? null;
    const pag = await this.requisicao<Pagina<ClienteAsaas>>('GET', `/customers?cpfCnpj=${doc}&limit=1`);
    return pag.data[0] ?? null;
  }

  async listarAssinaturas(customerId: string): Promise<AssinaturaAsaas[]> {
    if (this.simulado) return BASE_SIMULADA.assinaturas.filter((a) => a.customer === customerId);
    return this.todasAsPaginas<AssinaturaAsaas>(`/subscriptions?customer=${customerId}`);
  }

  async listarCobrancas(customerId: string): Promise<CobrancaAsaasLida[]> {
    if (this.simulado) return BASE_SIMULADA.cobrancas.filter((c) => c.customer === customerId);
    return this.todasAsPaginas<CobrancaAsaasLida>(`/payments?customer=${customerId}`);
  }
}

// ============================================================
// Base fictícia do modo simulado — cobre as três situações da triagem e os
// padrões de descrição que a F2 vai interpretar (seguro, taxa, entrada
// diluída, acordo). Datas relativas a hoje para a triagem não envelhecer.
// ============================================================
function dia(deslocamento: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + deslocamento);
  return d.toISOString().slice(0, 10);
}

function semanais(params: {
  customer: string;
  assinatura: string;
  valor: number;
  pagas: number; // semanas pagas para trás
  abertas: number; // semanas em aberto para frente (a partir da próxima)
  vencidasSemPagar?: number; // semanas para trás sem pagamento
  descricao: string;
}): CobrancaAsaasLida[] {
  const lista: CobrancaAsaasLida[] = [];
  const vencidas = params.vencidasSemPagar ?? 0;
  let n = 0;
  for (let s = params.pagas + vencidas; s >= 1; s--) {
    const venc = dia(-7 * s);
    const paga = s > vencidas;
    n += 1;
    lista.push({
      id: `pay_sim_${params.customer}_${n}`,
      customer: params.customer,
      subscription: params.assinatura,
      value: params.valor,
      dueDate: venc,
      paymentDate: paga ? venc : null,
      confirmedDate: paga ? venc : null,
      status: paga ? 'RECEIVED' : 'OVERDUE',
      billingType: 'BOLETO',
      description: params.descricao,
      invoiceUrl: `https://sandbox.asaas.com/i/sim_${params.customer}_${n}`,
      deleted: false,
    });
  }
  for (let s = 0; s < params.abertas; s++) {
    n += 1;
    lista.push({
      id: `pay_sim_${params.customer}_${n}`,
      customer: params.customer,
      subscription: params.assinatura,
      value: params.valor,
      dueDate: dia(7 * (s + 1)),
      paymentDate: null,
      status: 'PENDING',
      billingType: 'BOLETO',
      description: params.descricao,
      invoiceUrl: `https://sandbox.asaas.com/i/sim_${params.customer}_${n}`,
      deleted: false,
    });
  }
  return lista;
}

const DESC_HB20 = 'Parcela semanal HB20 - R$ 942,00 parcela + R$ 50,00 seguro + R$ 5,00 taxa';
const DESC_MOBI = 'Parcela semanal Mobi - R$ 642,00 + seguro R$ 50 + taxa R$ 5';

const BASE_SIMULADA: { clientes: ClienteAsaas[]; assinaturas: AssinaturaAsaas[]; cobrancas: CobrancaAsaasLida[] } = {
  clientes: [
    { id: 'cus_sim_L01', name: 'Antônio Legado Silva', cpfCnpj: '12345678909', email: 'antonio.legado@exemplo.com', mobilePhone: '11999990001', deleted: false, dateCreated: '2025-11-03' },
    { id: 'cus_sim_L02', name: 'Beatriz Legado Souza', cpfCnpj: '98765432100', email: 'beatriz.legado@exemplo.com', mobilePhone: '11999990002', deleted: false, dateCreated: '2026-01-19' },
    { id: 'cus_sim_L03', name: 'Cláudio Legado Pereira', cpfCnpj: '11122233396', email: null, mobilePhone: '11999990003', deleted: false, dateCreated: '2025-08-11' },
    { id: 'cus_sim_L04', name: 'Débora Legado Antiga', cpfCnpj: '44455566677', email: null, mobilePhone: null, deleted: false, dateCreated: '2024-05-06' },
    { id: 'cus_sim_L05', name: 'Eduardo Legado Entrada Diluída', cpfCnpj: '55566677788', email: 'edu.legado@exemplo.com', mobilePhone: '11999990005', deleted: false, dateCreated: '2026-03-02' },
  ],
  assinaturas: [
    { id: 'sub_sim_L01', customer: 'cus_sim_L01', value: 997, nextDueDate: dia(7), cycle: 'WEEKLY', status: 'ACTIVE', description: DESC_HB20, billingType: 'BOLETO', deleted: false },
    { id: 'sub_sim_L02', customer: 'cus_sim_L02', value: 697, nextDueDate: dia(7), cycle: 'WEEKLY', status: 'ACTIVE', description: DESC_MOBI, billingType: 'BOLETO', deleted: false },
    { id: 'sub_sim_L03', customer: 'cus_sim_L03', value: 997, nextDueDate: dia(7), cycle: 'WEEKLY', status: 'ACTIVE', description: DESC_HB20, billingType: 'BOLETO', deleted: false },
    { id: 'sub_sim_L04', customer: 'cus_sim_L04', value: 697, nextDueDate: dia(-200), cycle: 'WEEKLY', status: 'INACTIVE', description: DESC_MOBI, billingType: 'BOLETO', deleted: false },
    { id: 'sub_sim_L05', customer: 'cus_sim_L05', value: 1097, nextDueDate: dia(7), cycle: 'WEEKLY', status: 'ACTIVE', description: 'Parcela semanal HB20 R$ 997 + R$ 100 entrada diluida (20x)', billingType: 'BOLETO', deleted: false },
  ],
  cobrancas: [
    // L01 — HB20 em dia, 40 pagas, 2 abertas
    ...semanais({ customer: 'cus_sim_L01', assinatura: 'sub_sim_L01', valor: 997, pagas: 40, abertas: 2, descricao: DESC_HB20 }),
    // L02 — Mobi em dia, 30 pagas, 1 aberta
    ...semanais({ customer: 'cus_sim_L02', assinatura: 'sub_sim_L02', valor: 697, pagas: 30, abertas: 1, descricao: DESC_MOBI }),
    // L03 — HB20 com 3 vencidas sem pagar + um acordo pontual
    ...semanais({ customer: 'cus_sim_L03', assinatura: 'sub_sim_L03', valor: 997, pagas: 50, vencidasSemPagar: 3, abertas: 1, descricao: DESC_HB20 }),
    {
      id: 'pay_sim_cus_sim_L03_acordo', customer: 'cus_sim_L03', subscription: null, value: 1500, dueDate: dia(-60),
      paymentDate: dia(-59), confirmedDate: dia(-59), status: 'RECEIVED', billingType: 'PIX',
      description: 'ACORDO - 2 parcelas em atraso (venc. anteriores) com desconto de juros', invoiceUrl: null, deleted: false,
    },
    // L04 — sem movimento há meses, assinatura inativa
    ...semanais({ customer: 'cus_sim_L04', assinatura: 'sub_sim_L04', valor: 697, pagas: 0, abertas: 0, descricao: DESC_MOBI }).concat(
      Array.from({ length: 12 }, (_, i) => ({
        id: `pay_sim_cus_sim_L04_${i + 1}`, customer: 'cus_sim_L04', subscription: 'sub_sim_L04', value: 697,
        dueDate: dia(-300 + 7 * i), paymentDate: dia(-300 + 7 * i), confirmedDate: dia(-300 + 7 * i),
        status: 'RECEIVED', billingType: 'BOLETO', description: DESC_MOBI, invoiceUrl: null, deleted: false,
      })),
    ),
    // L05 — entrada diluída: parcela 1.097 (997 + 100), 12 pagas, 2 abertas
    ...semanais({ customer: 'cus_sim_L05', assinatura: 'sub_sim_L05', valor: 1097, pagas: 12, abertas: 2, descricao: 'Parcela semanal HB20 R$ 997 + R$ 100 entrada diluida (20x)' }),
    {
      id: 'pay_sim_cus_sim_L05_entrada', customer: 'cus_sim_L05', subscription: null, value: 3000, dueDate: dia(-91),
      paymentDate: dia(-91), confirmedDate: dia(-91), status: 'RECEIVED', billingType: 'PIX',
      description: 'ENTRADA HB20 - parte a vista (restante diluido em 20 parcelas de R$ 100)', invoiceUrl: null, deleted: false,
    },
  ],
};
