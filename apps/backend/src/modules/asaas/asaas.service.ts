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

  async criarCobranca(params: {
    externalReference: string; // id da fatura
    valor: number; // centavos
    vencimento: Date;
    descricao: string;
    customerId?: string;
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

    // Modo real (sandbox/prod) — exercido quando ASAAS_API_KEY existir.
    const resp = await fetch(`${this.config.get('asaas.apiUrl')}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: this.config.get<string>('asaas.apiKey') ?? '',
      },
      body: JSON.stringify({
        customer: params.customerId,
        billingType: 'UNDEFINED',
        value: Number(centavosParaReaisString(params.valor)),
        dueDate: params.vencimento.toISOString().slice(0, 10),
        externalReference: params.externalReference,
        description: params.descricao,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Asaas retornou ${resp.status} ao criar cobrança`);
    }
    const data = (await resp.json()) as { id: string; status: string };
    return {
      id: data.id,
      externalReference: params.externalReference,
      status: data.status,
      value: params.valor,
      simulada: false,
    };
  }
}
