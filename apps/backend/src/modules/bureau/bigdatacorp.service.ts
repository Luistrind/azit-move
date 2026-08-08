import { Injectable, Logger } from '@nestjs/common';

// Provider BigDataCorp (Plataforma de Dados) — Camada 1 da análise (doc 02 §20).
// "BigDataCorp executa, Azit controla": este serviço só busca dados; a decisão
// (eliminatórios/alertas) vive no Camada1Service. Credenciais via ambiente
// (BIGDATACORP_TOKEN_ID + BIGDATACORP_ACCESS_TOKEN — nunca no banco). Sem
// credenciais, responde o provedor SIMULADO (placeholder Regra 12) com a marca
// simulado=true — o sistema roda de ponta a ponta em dev.

export interface DadosBasicosPessoa {
  simulado: boolean;
  encontrado: boolean;
  nomeOficial: string | null;
  situacaoCpf: string | null; // REGULAR | SUSPENSA | CANCELADA | TITULAR FALECIDO...
  dataNascimento: string | null; // ISO yyyy-mm-dd
  idade: number | null;
  indicacaoObito: boolean;
  generoIbge: string | null;
  protocolo: string | null; // QueryId do birô — trilha de auditoria
  bruto?: unknown; // payload original (fica no Json interno da proposta)
}

const URL_PESSOAS = 'https://plataforma.bigdatacorp.com.br/pessoas';

@Injectable()
export class BigDataCorpService {
  private readonly logger = new Logger(BigDataCorpService.name);

  get configurado(): boolean {
    return !!(process.env.BIGDATACORP_TOKEN_ID && process.env.BIGDATACORP_ACCESS_TOKEN);
  }

  async basicData(cpf: string): Promise<DadosBasicosPessoa> {
    if (!this.configurado) return this.simulada(cpf);

    const resp = await fetch(URL_PESSOAS, {
      method: 'POST',
      headers: {
        AccessToken: process.env.BIGDATACORP_ACCESS_TOKEN as string,
        TokenId: process.env.BIGDATACORP_TOKEN_ID as string,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ q: `doc{${cpf}}`, Datasets: 'basic_data' }),
    });
    if (!resp.ok) {
      throw new Error(`BigDataCorp respondeu HTTP ${resp.status}`);
    }
    const corpo = (await resp.json()) as {
      QueryId?: string;
      Result?: { BasicData?: Record<string, unknown> }[];
      Status?: Record<string, { Code: number; Message: string }[]>;
    };
    const basic = corpo.Result?.[0]?.BasicData;
    if (!basic) {
      // Sem resultado (CPF não localizado ou erro de dataset) — não é decisão:
      // quem chamou decide o que fazer com "não encontrado".
      return {
        simulado: false,
        encontrado: false,
        nomeOficial: null,
        situacaoCpf: null,
        dataNascimento: null,
        idade: null,
        indicacaoObito: false,
        generoIbge: null,
        protocolo: corpo.QueryId ?? null,
        bruto: corpo.Status ?? null,
      };
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
    const nasc = str(basic.BirthDate)?.slice(0, 10) ?? null;
    return {
      simulado: false,
      encontrado: true,
      nomeOficial: str(basic.Name),
      situacaoCpf: str(basic.TaxIdStatus)?.toUpperCase() ?? null,
      dataNascimento: nasc,
      idade: typeof basic.Age === 'number' ? basic.Age : nasc ? this.idadeDe(nasc) : null,
      indicacaoObito: basic.HasObitIndication === true,
      generoIbge: str(basic.Gender),
      protocolo: corpo.QueryId ?? null,
      bruto: basic,
    };
  }

  private idadeDe(iso: string): number | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const agora = new Date();
    let idade = agora.getFullYear() - d.getFullYear();
    const aniversarioPassou =
      agora.getMonth() > d.getMonth() ||
      (agora.getMonth() === d.getMonth() && agora.getDate() >= d.getDate());
    if (!aniversarioPassou) idade -= 1;
    return idade;
  }

  // Provedor simulado (dev/homolog sem credenciais): aprova por padrão; CPFs
  // terminados em 00 simulam situação irregular para testar o caminho reprovado.
  private simulada(cpf: string): DadosBasicosPessoa {
    const irregular = cpf.endsWith('00');
    this.logger.warn('BigDataCorp SEM credenciais — usando provedor simulado (placeholder)');
    return {
      simulado: true,
      encontrado: true,
      nomeOficial: null,
      situacaoCpf: irregular ? 'SUSPENSA' : 'REGULAR',
      dataNascimento: '1990-01-15',
      idade: 36,
      indicacaoObito: false,
      generoIbge: null,
      protocolo: `sim_${cpf.slice(-4)}`,
    };
  }
}
