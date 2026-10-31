// Régua de cobrança (Doc 2 §7.6, Doc 7 Bloco 5). O estágio é uma POSIÇÃO
// OPERACIONAL calculada a partir dos dias de atraso — NÃO é status de entidade
// (Doc 3 §4.5). Compartilhado entre backend (job) e frontend (kanban).

export type EstagioRegua = 'D+1' | 'D+2' | 'D+3' | 'D+10' | 'D+12';

// Limiares configuráveis (item 5.2). Ordem decrescente para resolver pelo maior.
export const LIMIARES_REGUA: { dias: number; estagio: EstagioRegua }[] = [
  { dias: 12, estagio: 'D+12' },
  { dias: 10, estagio: 'D+10' },
  { dias: 3, estagio: 'D+3' },
  { dias: 2, estagio: 'D+2' },
  { dias: 1, estagio: 'D+1' },
];

export const ESTAGIOS_REGUA: EstagioRegua[] = ['D+1', 'D+2', 'D+3', 'D+10', 'D+12'];

// Rótulos exibidos nas colunas do kanban (Doc 3 §4.5).
export const ROTULO_ESTAGIO: Record<EstagioRegua, string> = {
  'D+1': 'D+1 · Cobrança ativa',
  'D+2': 'D+2 · 2ª tentativa',
  'D+3': 'D+3 · Bloqueado',
  'D+10': 'D+10 · Extrajudicial',
  'D+12': 'D+12 · Recuperação',
};

/** Resolve o estágio da régua pelos dias de atraso. Retorna null se ainda em dia (< 1). */
export function resolverEstagioRegua(diasAtraso: number): EstagioRegua | null {
  for (const { dias, estagio } of LIMIARES_REGUA) {
    if (diasAtraso >= dias) return estagio;
  }
  return null;
}

// ============================================================
// RAIAS DO KANBAN (decisão Luís 31/10/2026, doc 02 §7.6): o quadro deixa de ter
// uma coluna por dia (1…7, +7 — "poluído") e passa a ter FAIXAS de atraso da
// parcela vencida mais antiga, mais a raia "Vence hoje". Uma fonte só para
// backend e frontend (Regra 16). O bloqueio do veículo fica disponível a partir
// da raia "até 14 dias" (`DIAS_BLOQUEIO_DISPONIVEL`) — o D+3 da tabela §7.6
// deixa de ser o gatilho do bloqueio.
// ============================================================

export type ChaveRaiaRegua = 'hoje' | 'ate7' | 'ate14' | 'ate21' | 'ate30' | 'ate60' | 'mais60';

export interface RaiaRegua {
  chave: ChaveRaiaRegua;
  rotulo: string;
  /** Dias de atraso cobertos: [de, ate]; `ate` null = sem teto. 0 = vence hoje. */
  de: number;
  ate: number | null;
  /** Estágio de referência para a cor (statusColors, Regra 9). */
  estagio: EstagioRegua | null;
  /** Marco operacional mostrado como subtítulo da raia. */
  marco: string;
}

/** Primeiro dia de atraso em que o bloqueio do veículo fica disponível (raia "até 14 dias"). */
export const DIAS_BLOQUEIO_DISPONIVEL = 8;

export const RAIAS_REGUA: RaiaRegua[] = [
  { chave: 'hoje', rotulo: 'Vence hoje', de: 0, ate: 0, estagio: null, marco: 'lembrete de vencimento' },
  { chave: 'ate7', rotulo: 'Vencida até 7 dias', de: 1, ate: 7, estagio: 'D+1', marco: 'cobrança ativa (D+1 · D+2)' },
  { chave: 'ate14', rotulo: 'Vencida até 14 dias', de: 8, ate: 14, estagio: 'D+3', marco: 'bloqueio disponível' },
  { chave: 'ate21', rotulo: 'Vencida até 21 dias', de: 15, ate: 21, estagio: 'D+10', marco: 'notificação extrajudicial' },
  { chave: 'ate30', rotulo: 'Vencida até 30 dias', de: 22, ate: 30, estagio: 'D+12', marco: 'recuperação do veículo' },
  { chave: 'ate60', rotulo: 'Vencida até 60 dias', de: 31, ate: 60, estagio: 'D+12', marco: 'recuperação do veículo' },
  { chave: 'mais60', rotulo: 'Mais de 60 dias', de: 61, ate: null, estagio: 'D+12', marco: 'judicial' },
];

/**
 * Raia do caso: `diasAtraso` da parcela vencida mais antiga (0 = nada vencido).
 * Com 0 dias, só entra em "Vence hoje" se houver parcela vencendo hoje; sem
 * atraso e sem vencimento hoje devolve null (o caso só está no quadro por
 * intervenção — bloqueio/recuperação — e o chamador decide onde mostrar).
 */
export function resolverRaiaRegua(diasAtraso: number, venceHoje = false): RaiaRegua | null {
  if (diasAtraso <= 0) return venceHoje ? RAIAS_REGUA[0] : null;
  return RAIAS_REGUA.find((r) => r.de >= 1 && diasAtraso >= r.de && (r.ate === null || diasAtraso <= r.ate)) ?? null;
}

/** Bloqueio disponível a partir da raia "até 14 dias" (decisão 31/10). */
export function bloqueioDisponivel(diasAtraso: number): boolean {
  return diasAtraso >= DIAS_BLOQUEIO_DISPONIVEL;
}
