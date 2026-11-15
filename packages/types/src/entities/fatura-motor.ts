// Tipos de ENTRADA do motor da Fatura Azit (doc 02 §32.4-A, §32.5). Só tipos —
// a conta vive em `@azit/utils/fatura-motor` (Regra 16). Ficam aqui porque
// trafegam: o backend manda os itens e os pagamentos registrados da conta para
// a página pública, que refaz a MESMA conta com a MESMA função.
// Dinheiro em CENTAVOS; datas-calendário em 'YYYY-MM-DD' (dia do Brasil).

// Grupos da cascata de baixa (FAT003). A ORDEM é parâmetro.
export type GrupoCascata = 'ENCARGOS' | 'PROTECAO' | 'ACESSORIOS' | 'PRINCIPAL';

export interface ParametrosMotorFatura {
  cascata: GrupoCascata[]; // FAT003
  minimoParcialPct: number; // FAT004 — % do valor de face
  minimoParcialPiso: number; // FAT004 — piso em centavos
}

export interface ItemMotor {
  id: string;
  grupo: GrupoCascata;
  valor: number; // valor de face do item
  // Percentuais do CONTRATO do item (§32.4).
  multaPct: number; // 2 = 2%
  atualizacaoMesPct: number; // 1 = 1% ao mês, pro-rata por dia
}

export type AlvoAlocacao = 'ITEM' | 'MULTA' | 'ATUALIZACAO';

export interface AlocacaoMotor {
  alvo: AlvoAlocacao;
  itemId: string | null; // só quando alvo = ITEM
  valor: number;
  nivel: number; // posição do grupo na cascata (1 = primeiro)
  quitou: boolean; // true = zerou o saldo do alvo neste pagamento
}

// Um pagamento JÁ APLICADO a uma fatura (PagamentoFatura + AlocacaoPagamento).
export interface PagamentoMotor {
  data: string; // dia do pagamento
  valor: number; // aplicado a ESTA fatura
  alocacoes: AlocacaoMotor[];
}

export interface FaturaMotor {
  id: string;
  vencimento: string;
  itens: ItemMotor[];
  pagamentos: PagamentoMotor[]; // os registrados, em qualquer ordem
}
