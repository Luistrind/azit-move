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
