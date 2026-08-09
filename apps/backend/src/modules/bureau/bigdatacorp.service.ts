import { Injectable, Logger } from '@nestjs/common';

// Provider BigDataCorp (Plataforma de Dados) — Camada 1 da análise (doc 02 §20).
// A PLATAFORMA é uma só: /pessoas com o parâmetro Datasets variando por camada
// (decisão 08/08 — nada de birô manual quando o dataset existe na plataforma):
//   basic_data      → identidade, situação do CPF, nascimento, óbito (R$0,04)
//   financial_data  → renda estimada (faixas de SM) e patrimônio (R$0,06)
//   processes       → processos judiciais/administrativos
// O que fica FORA (por ora) são as chamadas de PARCEIROS via Marketplace
// (ex.: score) — pagas por chamada e ainda não contratadas.
// Credenciais via ambiente (BIGDATACORP_TOKEN_ID + BIGDATACORP_ACCESS_TOKEN —
// nunca no banco). Sem credenciais, responde o provedor SIMULADO (placeholder
// Regra 12) com a marca simulado=true — o sistema roda de ponta a ponta em dev.

export interface DadosBasicosPessoa {
  simulado: boolean;
  encontrado: boolean;
  nomeOficial: string | null;
  situacaoCpf: string | null; // REGULAR | SUSPENSA | CANCELADA | TITULAR FALECIDO...
  dataNascimento: string | null; // ISO yyyy-mm-dd
  idade: number | null;
  indicacaoObito: boolean;
  generoIbge: string | null;
  // financial_data — faixas, como o birô devolve (nunca inventamos número):
  faixaRendaPresumida: string | null; // ex.: "2 A 4 SM"
  faixaPatrimonio: string | null; // ex.: "100K A 250K"
  // processes:
  processosTotal: number | null;
  processosComoReu: number | null;
  protocolo: string | null; // QueryId do birô — trilha de auditoria
  bruto?: unknown; // payload original (fica no Json interno da proposta)
}

const URL_PESSOAS = 'https://plataforma.bigdatacorp.com.br/pessoas';
const DATASETS_CAMADA1 = 'basic_data,financial_data,processes';
// Camada 2 — MARKETPLACE da própria plataforma (mesma API/token; pago por
// chamada, FORA da franquia de 500/mês — motivo da escolha da BigDataCorp):
const DATASET_SCORE_QUOD = 'partner_quod_credit_score_person'; // ~R$ 2,41/consulta
const DATASET_RESTRITIVOS_QUOD = 'partner_quod_credit_risk_details_person'; // ~R$ 2,41/consulta

export interface ScoreQuodRetorno {
  simulado: boolean;
  score: number | null; // 300–1000
  capacidadePagamento: number | null; // 0–100
  protocolo: string | null;
  statusApi: string | null; // mensagens de erro/aviso da própria API
  bruto?: unknown;
}

export interface RestritivosQuodRetorno {
  simulado: boolean;
  apontamentosAtivos: number | null;
  endividamentoTotal: number | null; // centavos
  protestosQuantidade: number | null;
  protestosValor: number | null; // centavos
  protocolo: string | null;
  statusApi: string | null; // mensagens de erro/aviso da própria API
  bruto?: unknown;
}

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
      body: JSON.stringify({ q: `doc{${cpf}}`, Datasets: DATASETS_CAMADA1 }),
    });
    if (!resp.ok) {
      throw new Error(`BigDataCorp respondeu HTTP ${resp.status}`);
    }
    const corpo = (await resp.json()) as {
      QueryId?: string;
      Result?: {
        BasicData?: Record<string, unknown>;
        FinancialData?: Record<string, unknown>;
        Processes?: Record<string, unknown>;
        Lawsuits?: Record<string, unknown>;
      }[];
      Status?: Record<string, { Code: number; Message: string }[]>;
    };
    const r0 = corpo.Result?.[0];
    const basic = r0?.BasicData;
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
        faixaRendaPresumida: null,
        faixaPatrimonio: null,
        processosTotal: null,
        processosComoReu: null,
        protocolo: corpo.QueryId ?? null,
        bruto: corpo.Status ?? null,
      };
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    const nasc = str(basic.BirthDate)?.slice(0, 10) ?? null;

    // financial_data: IncomeEstimates vem por metodologia (IBGE/MTE/BIGDATA…) —
    // preferimos a BIGDATA quando existe; guardamos a FAIXA, nunca um número.
    const fin = r0?.FinancialData ?? {};
    const estimates = (fin.IncomeEstimates ?? {}) as Record<string, unknown>;
    const faixaRenda =
      str(estimates['BIGDATA_V2']) ?? str(estimates['BIGDATA']) ?? str(estimates['IBGE']) ??
      str(estimates['MTE']) ?? str(Object.values(estimates).find((v) => typeof v === 'string' && v.trim() !== '')) ?? null;

    // processes: totais defensivos (nomes variam entre versões do dataset).
    const proc = (r0?.Processes ?? r0?.Lawsuits ?? {}) as Record<string, unknown>;
    const processosTotal =
      num(proc.TotalLawsuits) ?? num(proc.TotalProcesses) ??
      (Array.isArray(proc.Lawsuits) ? proc.Lawsuits.length : null);
    const processosComoReu = num(proc.TotalLawsuitsAsDefendant) ?? num(proc.TotalAsDefendant) ?? null;

    return {
      simulado: false,
      encontrado: true,
      nomeOficial: str(basic.Name),
      situacaoCpf: str(basic.TaxIdStatus)?.toUpperCase() ?? null,
      dataNascimento: nasc,
      idade: typeof basic.Age === 'number' ? basic.Age : nasc ? this.idadeDe(nasc) : null,
      indicacaoObito: basic.HasObitIndication === true,
      generoIbge: str(basic.Gender),
      faixaRendaPresumida: faixaRenda,
      faixaPatrimonio: str(fin.TotalAssets),
      processosTotal,
      processosComoReu,
      protocolo: corpo.QueryId ?? null,
      bruto: { basic, financial: fin, processes: proc },
    };
  }

  // Camada 2 — Score Quod via Marketplace (pago por chamada, fora da franquia).
  async scoreQuod(cpf: string): Promise<ScoreQuodRetorno> {
    if (!this.configurado) {
      this.logger.warn('BigDataCorp SEM credenciais — score Quod SIMULADO');
      return { simulado: true, score: 650, capacidadePagamento: 70, protocolo: `sim_score_${cpf.slice(-4)}`, statusApi: null };
    }
    const corpo = await this.consultar(cpf, DATASET_SCORE_QUOD);
    const r0 = (corpo.Result?.[0] ?? {}) as Record<string, unknown>;
    // O bloco do parceiro pode vir com nomes diferentes — varre por candidatas e,
    // no último caso, procura QUALQUER objeto com campo Score em 1 nível.
    const bloco =
      this.acharBloco(r0, ['Score', 'QuodScore', 'CreditScore', 'QuodCreditScore', 'PartnerQuodCreditScore']) ??
      this.acharBlocoComCampo(r0, 'Score') ?? {};
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
    return {
      simulado: false,
      score: num(bloco.Score) ?? num(r0.Score),
      capacidadePagamento: num(bloco.PaymentCapacityScore) ?? num(bloco.PaymentCommitmentScore),
      protocolo: corpo.QueryId ?? null,
      statusApi: this.resumirStatus(corpo.Status),
      bruto: { result: r0, status: corpo.Status ?? null },
    };
  }

  // Camada 2 — Restritivos Quod via Marketplace (pago por chamada).
  async restritivosQuod(cpf: string): Promise<RestritivosQuodRetorno> {
    if (!this.configurado) {
      this.logger.warn('BigDataCorp SEM credenciais — restritivos Quod SIMULADOS');
      return {
        simulado: true, apontamentosAtivos: 0, endividamentoTotal: 0,
        protestosQuantidade: 0, protestosValor: 0, protocolo: `sim_restr_${cpf.slice(-4)}`, statusApi: null,
      };
    }
    const corpo = await this.consultar(cpf, DATASET_RESTRITIVOS_QUOD);
    const r0 = (corpo.Result?.[0] ?? {}) as Record<string, unknown>;
    const bloco =
      this.acharBloco(r0, ['CreditRiskDetails', 'QuodCreditRisk', 'QuodCreditRiskDetails', 'NegativeData', 'PartnerQuodCreditRiskDetails']) ??
      this.acharBlocoComCampo(r0, 'TotalIndebtedness') ?? r0;
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
    const reais = (v: unknown) => {
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^[\d.,]+$/.test(v) ? Number(v.replace(',', '.')) : null;
      return n !== null && Number.isFinite(n) ? Math.round(n * 100) : null;
    };
    return {
      simulado: false,
      apontamentosAtivos: num(bloco.ActiveNegativeAppointments) ?? num(bloco.TotalActiveAppointments) ?? num(bloco.TotalAppointments),
      endividamentoTotal: reais(bloco.TotalIndebtedness) ?? reais(bloco.TotalDebtAmount) ?? reais(bloco.TotalDebt),
      protestosQuantidade: num(bloco.TotalProtests) ?? num(bloco.ProtestsCount) ?? num(bloco.Protests),
      protestosValor: reais(bloco.TotalProtestsValue) ?? reais(bloco.ProtestsValue),
      protocolo: corpo.QueryId ?? null,
      statusApi: this.resumirStatus(corpo.Status),
      bruto: { result: r0, status: corpo.Status ?? null },
    };
  }

  private async consultar(cpf: string, datasets: string) {
    const resp = await fetch(URL_PESSOAS, {
      method: 'POST',
      headers: {
        AccessToken: process.env.BIGDATACORP_ACCESS_TOKEN as string,
        TokenId: process.env.BIGDATACORP_TOKEN_ID as string,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ q: `doc{${cpf}}`, Datasets: datasets }),
    });
    if (!resp.ok) throw new Error(`BigDataCorp respondeu HTTP ${resp.status}`);
    return (await resp.json()) as {
      QueryId?: string;
      Result?: Record<string, unknown>[];
      Status?: Record<string, { Code?: number; Message?: string }[]>;
    };
  }

  // Resume as mensagens do bloco Status da API (ex.: dataset não habilitado,
  // documento inválido, saldo on-demand) — é o diagnóstico real da falha.
  private resumirStatus(status?: Record<string, { Code?: number; Message?: string }[]>): string | null {
    if (!status) return null;
    const msgs: string[] = [];
    for (const [origem, itens] of Object.entries(status)) {
      for (const it of itens ?? []) {
        if (it?.Message) msgs.push(`${origem}: ${it.Message}${it.Code !== undefined ? ` (${it.Code})` : ''}`);
      }
    }
    return msgs.length ? msgs.join(' · ') : null;
  }

  // Localiza o bloco do parceiro no Result (a chave varia por dataset/parceiro).
  private acharBloco(r0: Record<string, unknown>, candidatas: string[]): Record<string, unknown> | null {
    for (const c of candidatas) {
      const v = r0[c];
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    }
    return null;
  }

  // Último recurso: qualquer objeto de 1º nível que contenha o campo esperado.
  private acharBlocoComCampo(r0: Record<string, unknown>, campo: string): Record<string, unknown> | null {
    for (const v of Object.values(r0)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && campo in (v as Record<string, unknown>)) {
        return v as Record<string, unknown>;
      }
    }
    return null;
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
      faixaRendaPresumida: '2 A 4 SM',
      faixaPatrimonio: null,
      processosTotal: 0,
      processosComoReu: 0,
      protocolo: `sim_${cpf.slice(-4)}`,
    };
  }
}
