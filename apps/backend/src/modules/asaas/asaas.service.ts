import { Injectable, Logger } from '@nestjs/common';
import { centavosParaReaisString, dataCalendarioUTC } from '@azit/utils';
import { IntegracoesService } from '../integracoes/integracoes.service';
import { corpoJson, fetchAsaas } from './asaas-http';
import { PrismaService } from '../../database/prisma.service';

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
  invoiceUrl?: string | null; // página da cobrança no Asaas (boleto + Pix)
}

@Injectable()
export class AsaasService {
  private readonly logger = new Logger(AsaasService.name);

  // Credencial EFETIVA via central de integrações (decisão 15/09): banco >
  // env, trocável pela tela sem redeploy — inclusive sandbox → produção.
  constructor(
    private readonly integracoes: IntegracoesService,
    private readonly prisma: PrismaService,
  ) {}

  get simulado(): boolean {
    return !this.integracoes.asaas().apiKey;
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    const cred = this.integracoes.asaas();
    // Com tempo limite (asaas-http): chamada pendurada vira erro claro em ~8 s.
    const resp = await fetchAsaas(
      `${cred.apiUrl}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: cred.apiKey,
        },
        body: JSON.stringify(body),
      },
      `POST ${path}`,
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Asaas ${path} retornou ${resp.status}: ${txt.slice(0, 300)}`);
    }
    return corpoJson<T>(resp, `POST ${path}`);
  }

  // Remove uma cobrança (DELETE /payments/{id}) — usada quando a fatura sai de
  // cobrança (ex.: coberta por acordo). Falha NÃO propaga: a cobrança órfã é
  // menos grave que desfazer a operação de negócio; fica o log para conciliação.
  async removerCobranca(chargeId: string): Promise<boolean> {
    if (this.simulado) {
      this.logger.log(`[simulado] cobrança ${chargeId} removida`);
      return true;
    }
    try {
      const cred = this.integracoes.asaas();
      const resp = await fetchAsaas(`${cred.apiUrl}/payments/${chargeId}`, { method: 'DELETE', headers: { access_token: cred.apiKey } }, 'DELETE /payments/{id}');
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        this.logger.warn(`Asaas DELETE /payments/${chargeId} retornou ${resp.status}: ${txt.slice(0, 200)}`);
        return false;
      }
      this.logger.log(`Cobrança Asaas ${chargeId} removida`);
      return true;
    } catch (e) {
      this.logger.warn(`Falha ao remover cobrança Asaas ${chargeId}: ${(e as Error).message}`);
      return false;
    }
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
      // Id INTEIRO do titular: os 8 primeiros caracteres do cuid se repetem entre
      // cadastros criados juntos (seed, importações) e o id truncado batia na
      // unicidade de Titular.asaasCustomerId — o 2º titular ficava sem cobrança
      // (achado no teste de ponta a ponta do Pix sob demanda, 15/11/2026).
      const id = `cus_sim_${params.titularId}`;
      this.logger.log(`[simulado] cliente ${id} (${params.nome})`);
      return id;
    }
    // "Sem dobro" (doc 02 §28.1): se o operador desligou o aviso do Asaas para
    // este titular, o cliente JÁ NASCE sem notificação (ponto único de criação).
    const semAviso = await this.avisoDesligadoPara(params.titularId);
    const data = await this.call<{ id: string }>('/customers', {
      name: params.nome,
      cpfCnpj: params.cpfCnpj.replace(/\D/g, ''),
      email: params.email ?? undefined,
      mobilePhone: params.telefone ? params.telefone.replace(/\D/g, '') : undefined,
      externalReference: params.titularId,
      ...(semAviso ? { notificationDisabled: true } : {}),
    });
    if (semAviso) {
      await this.prisma.db.lembreteTitular
        .updateMany({ where: { titularId: params.titularId }, data: { asaasAvisoPendente: false } })
        .catch((e) => this.logger.warn(`aviso do Asaas aplicado na criação, mas o registro não foi atualizado: ${(e as Error).message}`));
    }
    this.logger.log(`Cliente Asaas criado ${data.id} (${params.nome})${semAviso ? ' — sem aviso do Asaas' : ''}`);
    return data.id;
  }

  private async avisoDesligadoPara(titularId: string): Promise<boolean> {
    try {
      const l = await this.prisma.db.lembreteTitular.findUnique({ where: { titularId }, select: { asaasAvisoDesligado: true } });
      return !!l?.asaasAvisoDesligado;
    } catch (e) {
      // Nunca impede a criação do cliente (e da cobrança) por causa do lembrete.
      this.logger.warn(`não consegui ler a decisão de aviso do titular ${titularId}: ${(e as Error).message}`);
      return false;
    }
  }

  // Liga/desliga o aviso de cobrança do PRÓPRIO Asaas no cadastro de um cliente
  // existente (PUT /customers/{id}, campo notificationDisabled — doc 02 §28.1).
  // Altera cadastro fora do sistema: só é chamado por ação explícita do operador.
  // Falha PROPAGA: o operador precisa saber que o Asaas não aceitou.
  async definirAvisoCliente(customerId: string, desligado: boolean): Promise<void> {
    if (this.simulado) {
      this.logger.log(`[simulado] cliente ${customerId}: aviso do Asaas ${desligado ? 'desligado' : 'religado'}`);
      return;
    }
    const cred = this.integracoes.asaas();
    // Integração F2 + WhatsApp: mesmo tempo limite das demais chamadas (asaas-http).
    const resp = await fetchAsaas(
      `${cred.apiUrl}/customers/${customerId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', access_token: cred.apiKey },
        body: JSON.stringify({ notificationDisabled: desligado }),
      },
      'PUT /customers/{id}',
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Asaas PUT /customers/${customerId} retornou ${resp.status}: ${txt.slice(0, 300)}`);
    }
    this.logger.log(`Cliente Asaas ${customerId}: aviso ${desligado ? 'desligado' : 'religado'}`);
  }

  // Contato do cliente no Asaas acompanha o cadastro do titular (edição na ficha,
  // 27/11): nome, e-mail e celular — para o aviso do próprio Asaas (SMS/e-mail)
  // ir para o dado novo. Só é chamado pela edição explícita do operador.
  // Falha PROPAGA: quem chama decide (a edição no sistema já valeu).
  async atualizarContatoCliente(customerId: string, contato: { nome?: string; email?: string | null; telefone?: string | null }): Promise<void> {
    const corpo: Record<string, string> = {};
    if (contato.nome) corpo.name = contato.nome;
    if (contato.email !== undefined) corpo.email = contato.email ?? '';
    if (contato.telefone !== undefined) corpo.mobilePhone = (contato.telefone ?? '').replace(/\D/g, '');
    if (!Object.keys(corpo).length) return;
    if (this.simulado) {
      this.logger.log(`[simulado] cliente ${customerId}: contato atualizado (${Object.keys(corpo).join(', ')})`);
      return;
    }
    const cred = this.integracoes.asaas();
    const resp = await fetchAsaas(
      `${cred.apiUrl}/customers/${customerId}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json', access_token: cred.apiKey }, body: JSON.stringify(corpo) },
      'PUT /customers/{id}',
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Asaas PUT /customers/${customerId} retornou ${resp.status}: ${txt.slice(0, 300)}`);
    }
    this.logger.log(`Cliente Asaas ${customerId}: contato atualizado (${Object.keys(corpo).join(', ')})`);
  }

  // Id de cliente gravado em modo SIMULADO não existe no Asaas real (correção
  // 08/09: cus_sim_ reaproveitado em modo real gerava "Customer inválido" e a
  // cobrança morria em silêncio). Descarta para forçar a recriação.
  clienteReutilizavel(id: string | null): string | null {
    if (!id) return null;
    if (!this.simulado && id.startsWith('cus_sim_')) return null;
    return id;
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
    // Data-limite DURA (doc 02 §7.7, 2026-08-18 — entrada do acordo): o Asaas
    // cancela o registro no dia seguinte ao vencimento; pagamento tardio não entra.
    cancelarRegistroAposVencimento?: boolean;
    // Padrão PIX (decisão 23/09). BOLETO só onde o boleto é a regra: o boleto
    // único do saldo da rescisão, que é o que se negativa (doc 02 §29.3).
    formaPagamento?: 'PIX' | 'BOLETO';
  }): Promise<CobrancaAsaas> {
    if (this.simulado) {
      const id = `pay_sim_${params.externalReference}`;
      this.logger.log(
        `[simulado] cobrança ${id} ref=${params.externalReference} valor=${params.valor}c descricao="${params.descricao.replace(/\n/g, ' | ')}"`,
      );
      return {
        id,
        externalReference: params.externalReference,
        status: 'PENDING',
        value: params.valor,
        simulada: true,
        invoiceUrl: `https://sandbox.asaas.com/i/sim_${encodeURIComponent(params.externalReference)}`,
      };
    }

    // Modo real (sandbox/prod) — exercido quando ASAAS_API_KEY existir. O Asaas
    // calcula multa+juros sobre o atraso (opção 2): o valor pago no webhook já vem
    // com o encargo embutido.
    const data = await this.call<{ id: string; status: string; invoiceUrl?: string | null }>('/payments', {
      customer: params.customerId,
      // PIX (decisão Luís 23/09, doc 02 §11.2): toda cobrança do sistema nasce
      // PIX. Antes era UNDEFINED — o cliente escolhia boleto/PIX/cartão na fatura.
      billingType: params.formaPagamento ?? 'PIX',
      value: Number(centavosParaReaisString(params.valor)),
      dueDate: dataCalendarioUTC(params.vencimento), // coluna de data (dia-calendário gravado em UTC)
      externalReference: params.externalReference,
      description: params.descricao,
      ...(params.multaPct ? { fine: { value: params.multaPct, type: 'PERCENTAGE' } } : {}),
      ...(params.jurosPct ? { interest: { value: params.jurosPct } } : {}),
      ...(params.cancelarRegistroAposVencimento ? { daysAfterDueDateToRegistrationCancellation: 1 } : {}),
    });
    return {
      id: data.id,
      externalReference: params.externalReference,
      status: data.status,
      value: params.valor,
      simulada: false,
      invoiceUrl: data.invoiceUrl ?? null,
    };
  }
}
