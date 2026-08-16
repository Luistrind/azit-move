import { Injectable, Logger } from '@nestjs/common';

// Provider ZapSign (doc 02 §21 — F1). "ZapSign executa, Azit controla": este
// serviço só conversa com a API; decisão e estado vivem no AssinaturaService.
// Chave de virada = credencial no ambiente: sem ZAPSIGN_API_TOKEN o provedor
// SIMULADO responde (placeholder Regra 12) e o mock por botão continua valendo.
// URL padrão = SANDBOX (sem validade jurídica); produção via ZAPSIGN_API_URL.

export interface SignatarioEntrada {
  papel: 'titular' | 'solidario' | 'garantidor' | 'azit';
  nome: string;
  cpf?: string;
  telefone?: string; // DDD+numero (sem código do país)
  email?: string;
  ordem: number; // 1 = assina primeiro
}

export interface SignatarioCriado {
  papel: string;
  nome: string;
  signerToken: string;
  signUrl: string;
}

export interface DocumentoCriado {
  simulado: boolean;
  docToken: string;
  signatarios: SignatarioCriado[];
}

const URL_SANDBOX = 'https://sandbox.api.zapsign.com.br/api/v1';

@Injectable()
export class ZapSignService {
  private readonly logger = new Logger(ZapSignService.name);

  get configurado(): boolean {
    return !!process.env.ZAPSIGN_API_TOKEN;
  }

  private get baseUrl(): string {
    return process.env.ZAPSIGN_API_URL || URL_SANDBOX;
  }

  // Cria o documento a partir do TEXTO do motor de templates (markdown_text —
  // a ZapSign monta o PDF; encaixe direto com o snapshot congelado).
  async criarDocumento(params: {
    nome: string;
    markdown: string;
    externalId: string; // contratoId — volta nos webhooks
    signatarios: SignatarioEntrada[];
  }): Promise<DocumentoCriado> {
    if (!this.configurado) return this.simulado(params);

    const ordenados = [...params.signatarios].sort((a, b) => a.ordem - b.ordem);
    const resp = await fetch(`${this.baseUrl}/docs/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.ZAPSIGN_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: params.nome,
        markdown_text: params.markdown,
        external_id: params.externalId,
        lang: 'pt-br',
        folder_path: '/contratos/',
        // Ordem: cliente(s) assinam antes da Azit (doc 02 §21).
        signature_order_active: true,
        // Placeholder F1: link compartilhado PELO OPERADOR — sem envio
        // automático pago da ZapSign.
        disable_signer_emails: true,
        signers: ordenados.map((s) => ({
          name: s.nome,
          ...(s.email ? { email: s.email } : { blank_email: true }),
          ...(s.telefone ? { phone_country: '55', phone_number: s.telefone } : { blank_phone: true }),
          // Placeholder F1: autenticação grátis — assinatura na tela + CPF.
          auth_mode: 'assinaturaTela',
          ...(s.cpf ? { require_cpf: true, cpf: s.cpf } : {}),
          qualification: s.papel === 'azit' ? 'vendedora' : s.papel === 'garantidor' ? 'garantidor' : s.papel === 'solidario' ? 'comprador solidário' : 'comprador',
          external_id: s.papel,
          order_group: s.ordem,
          send_automatic_email: false,
          lock_name: true,
        })),
      }),
    });
    if (!resp.ok) {
      const corpo = await resp.text();
      throw new Error(`ZapSign respondeu HTTP ${resp.status}: ${corpo.slice(0, 300)}`);
    }
    const doc = (await resp.json()) as {
      token: string;
      signers: { token: string; sign_url: string; name: string; external_id?: string }[];
    };
    return {
      simulado: false,
      docToken: doc.token,
      signatarios: doc.signers.map((sg, i) => ({
        papel: sg.external_id || ordenados[i]?.papel || 'titular',
        nome: sg.name,
        signerToken: sg.token,
        signUrl: sg.sign_url,
      })),
    };
  }

  // Detalhe do documento — fonte dos links VÁLIDOS do arquivo (expiram em 60min).
  async detalharDocumento(docToken: string): Promise<{ status: string; signedFileUrl: string | null }> {
    if (!this.configurado) return { status: 'signed', signedFileUrl: null };
    const resp = await fetch(`${this.baseUrl}/docs/${docToken}/`, {
      headers: { Authorization: `Bearer ${process.env.ZAPSIGN_API_TOKEN}` },
    });
    if (!resp.ok) throw new Error(`ZapSign respondeu HTTP ${resp.status}`);
    const doc = (await resp.json()) as { status: string; signed_file: string | null };
    return { status: doc.status, signedFileUrl: doc.signed_file };
  }

  // Baixa o PDF assinado (o link expira em 60 minutos — gargalo G1 do desenho).
  async baixarArquivo(url: string): Promise<Buffer> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download do PDF assinado falhou: HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }

  // Provedor simulado (dev/sem credencial): tokens determinísticos por contrato.
  private simulado(params: { externalId: string; signatarios: SignatarioEntrada[] }): DocumentoCriado {
    this.logger.warn('ZapSign SEM credenciais — documento SIMULADO (placeholder Regra 12)');
    const sufixo = params.externalId.slice(-6);
    return {
      simulado: true,
      docToken: `simdoc_${sufixo}`,
      signatarios: params.signatarios
        .sort((a, b) => a.ordem - b.ordem)
        .map((s) => ({
          papel: s.papel,
          nome: s.nome,
          signerToken: `sim_${s.papel}_${sufixo}`,
          signUrl: `https://sandbox.app.zapsign.com.br/verificar/sim_${s.papel}_${sufixo}`,
        })),
    };
  }
}
