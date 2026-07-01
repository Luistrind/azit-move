import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { centavosParaReaisString } from '@azit/utils';

// Cliente Asaas (Doc 7 item 4.3). "Asaas executa, Azit controla" (Regra nº 1):
// toda lógica é nossa; o Asaas só cria/recebe cobranças.
//
// MODO SIMULADO: sem ASAAS_API_KEY configurada, não há rede — retorna respostas
// determinísticas (ids estáveis) e loga. Quando houver chave (sandbox/prod), o
// mesmo código passa a falar com a API real.
export interface CobrancaAsaas {
  id: string;
  externalReference: string;
  status: string;
  value: number; // centavos
  simulada: boolean;
}

@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);

  constructor(private readonly config: ConfigService) {}

  get simulado(): boolean {
    return !this.config.get<string>('asaas.apiKey');
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(`${this.config.get('asaas.apiUrl')}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: this.config.get<string>('asaas.apiKey') ?? '',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Asaas ${path} retornou ${resp.status}: ${txt.slice(0, 300)}`);
    }
    return (await resp.json()) as T;
  }

  // Cadastro do cliente no Asaas (POST /customers). No modo simulado devolve um id
  // determinístico. Pré-requisito para criar qualquer cobrança real.
  async criarCliente(params: {
    titularId: string;
    nome: string;
    cpfCnpj: string;
    email?: string | null;
    telefone?: string | null;
  }): Promise<string> {
    if (this.simulado) {
      const id = `cus_sim_${params.titularId.slice(0, 8)}`;
      this.logger.log(`[simulado] cliente ${id} (${params.nome})`);
      return id;
    }
    const data = await this.call<{ id: string }>('/customers', {
      name: params.nome,
      cpfCnpj: params.cpfCnpj.replace(/\D/g, ''),
      email: params.email ?? undefined,
      mobilePhone: params.telefone ? params.telefone.replace(/\D/g, '') : undefined,
      externalReference: params.titularId,
    });
    this.logger.log(`Cliente Asaas criado ${data.id} (${params.nome})`);
    return data.id;
  }

  async criarCobranca(params: {
    externalReference: string; // id da fatura (ou ativacao:/acordo:)
    valor: number; // centavos
    vencimento: Date;
    descricao: string;
    customerId?: string;
    // Encargo nativo do Asaas (Regra de domínio escolhida): multa (% única) e juros (% a.m.).
    multaPct?: number;
    jurosPct?: number;
  }): Promise<CobrancaAsaas> {
    if (this.simulado) {
      const id = `pay_sim_${params.externalReference}`;
      this.logger.log(
        `[simulado] cobrança ${id} ref=${params.externalReference} valor=${params.valor}c`,
      );
      return {
        id,
        externalReference: params.externalReference,
        status: 'PENDING',
        value: params.valor,
        simulada: true,
      };
    }

    // Modo real (sandbox/prod) — exercido quando ASAAS_API_KEY existir. O Asaas
    // calcula multa+juros sobre o atraso (opção 2): o valor pago no webhook já vem
    // com o encargo embutido.
    const data = await this.call<{ id: string; status: string }>('/payments', {
      customer: params.customerId,
      billingType: 'UNDEFINED',
      value: Number(centavosParaReaisString(params.valor)),
      dueDate: params.vencimento.toISOString().slice(0, 10),
      externalReference: params.externalReference,
      description: params.descricao,
      ...(params.multaPct ? { fine: { value: params.multaPct, type: 'PERCENTAGE' } } : {}),
      ...(params.jurosPct ? { interest: { value: params.jurosPct } } : {}),
    });
    return {
      id: data.id,
      externalReference: params.externalReference,
      status: data.status,
      value: params.valor,
      simulada: false,
    };
  }
}
