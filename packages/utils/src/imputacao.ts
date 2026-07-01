// Ordem de imputação do pagamento (Doc 2 §7.3). Função PURA — centavos.
// Quando o valor pago é INSUFICIENTE para cobrir todos os itens, aplica nesta
// ordem: 1) Encargo (multa/juros) → 2) Serviço (recorrentes) → 3) Principal.
//
// NOTA: a regra está pronta aqui; ligá-la exige suporte a pagamento PARCIAL na
// conciliação (hoje full-payment). Ver flag no relatório.

export type TipoImputacao = 'encargo' | 'servico' | 'principal';

const PRIORIDADE: Record<TipoImputacao, number> = { encargo: 0, servico: 1, principal: 2 };

export interface ItemImputacao {
  id: string;
  tipo: TipoImputacao;
  valor: number; // centavos devidos
}

export interface AlocacaoImputacao {
  id: string;
  tipo: TipoImputacao;
  devido: number;
  alocado: number; // centavos efetivamente cobertos
  saldo: number; // centavos ainda em aberto
}

// Aloca `valorPago` entre os itens na ordem encargo → serviço → principal.
export function imputarPagamento(valorPago: number, itens: ItemImputacao[]): {
  alocacoes: AlocacaoImputacao[];
  sobra: number; // troco (se pagou além do devido)
} {
  let restante = Math.max(0, valorPago);
  const ordenados = [...itens].sort((a, b) => PRIORIDADE[a.tipo] - PRIORIDADE[b.tipo]);
  const alocacoes = ordenados.map((it) => {
    const alocado = Math.min(restante, it.valor);
    restante -= alocado;
    return { id: it.id, tipo: it.tipo, devido: it.valor, alocado, saldo: it.valor - alocado };
  });
  return { alocacoes, sobra: restante };
}
