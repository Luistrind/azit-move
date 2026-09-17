// Ambiente de NEGÓCIO do build (17/09) — definido em BUILD TIME pelo
// VITE_AMBIENTE (o Vite inlina no bundle): producao | homologacao. Em
// `vite dev` (máquina local) vale 'desenvolvimento'.
export type Ambiente = 'producao' | 'homologacao' | 'desenvolvimento';

export const AMBIENTE: Ambiente = import.meta.env.DEV
  ? 'desenvolvimento'
  : import.meta.env.VITE_AMBIENTE === 'homologacao'
    ? 'homologacao'
    : 'producao';

// Ferramentas de teste (simular pagamento, assinatura, régua…) — nunca em
// produção; no homolog ficam à mão porque é lá que se testa. O backend
// espelha a mesma regra (DevOnlyGuard × AMBIENTE).
export const FERRAMENTAS_TESTE = AMBIENTE !== 'producao';
