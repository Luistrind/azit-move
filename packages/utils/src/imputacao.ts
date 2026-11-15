// Imputação do pagamento. Funções PURAS — centavos.
//
// UMA conta só (Regra 16): `imputarEmNiveis` é a cascata da Fatura Azit (doc 02
// §32.5) — percorre os níveis em ordem e, quando o dinheiro acaba no meio de um
// nível, rateia na proporção do saldo de cada item (o último absorve o
// centavo). `imputarPagamento` é a ordem fixa antiga do §7.3 (encargo → serviço
// → principal), usada pelas faturas do modelo ASAAS_NATIVO, e roda SOBRE a
// mesma função: cada item vira um nível próprio, o que dá a alocação sequencial
// de sempre.

export interface ItemNivel {
  id: string;
  nivel: number; // 1 = primeiro a receber
  saldo: number; // centavos devidos
}

export interface AlocacaoNivel {
  id: string;
  nivel: number;
  devido: number;
  alocado: number; // centavos efetivamente cobertos
  saldo: number; // centavos ainda em aberto
}

// Cascata com rateio proporcional no nível (RFAT-03). Devolve uma alocação por
// item, na ordem dos níveis (e, dentro do nível, na ordem recebida).
export function imputarEmNiveis(valorPago: number, itens: ItemNivel[]): {
  alocacoes: AlocacaoNivel[];
  sobra: number; // pago além do devido
} {
  let restante = Math.max(0, Math.round(valorPago));
  const niveis = [...new Set(itens.map((i) => i.nivel))].sort((a, b) => a - b);
  const alocacoes: AlocacaoNivel[] = [];
  for (const nivel of niveis) {
    const grupo = itens.filter((i) => i.nivel === nivel);
    const total = grupo.reduce((s, i) => s + Math.max(0, i.saldo), 0);
    if (restante >= total) {
      for (const i of grupo) alocacoes.push({ id: i.id, nivel, devido: i.saldo, alocado: Math.max(0, i.saldo), saldo: 0 });
      restante -= total;
      continue;
    }
    // Dinheiro acaba neste nível: rateio proporcional; o ÚLTIMO item com saldo
    // absorve o centavo do arredondamento.
    const comSaldo = grupo.filter((i) => i.saldo > 0);
    let distribuido = 0;
    for (const i of grupo) {
      let alocado = 0;
      if (i.saldo > 0 && restante > 0) {
        const ultimo = i === comSaldo[comSaldo.length - 1];
        alocado = ultimo ? restante - distribuido : Math.min(i.saldo, Math.round((restante * i.saldo) / total));
        alocado = Math.max(0, Math.min(alocado, i.saldo));
        distribuido += alocado;
      }
      alocacoes.push({ id: i.id, nivel, devido: i.saldo, alocado, saldo: i.saldo - alocado });
    }
    restante = 0;
  }
  return { alocacoes, sobra: restante };
}

// ------------------------------------------------------------
// Ordem fixa do §7.3 (modelo ASAAS_NATIVO)
// ------------------------------------------------------------
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

// Aloca `valorPago` entre os itens na ordem encargo → serviço → principal,
// um item por vez (sem rateio): cada item é o seu próprio nível.
export function imputarPagamento(valorPago: number, itens: ItemImputacao[]): {
  alocacoes: AlocacaoImputacao[];
  sobra: number; // troco (se pagou além do devido)
} {
  const ordenados = [...itens].sort((a, b) => PRIORIDADE[a.tipo] - PRIORIDADE[b.tipo]);
  const tipoDe = new Map(ordenados.map((i) => [i.id, i.tipo]));
  const { alocacoes, sobra } = imputarEmNiveis(
    valorPago,
    ordenados.map((it, ordem) => ({ id: it.id, nivel: ordem + 1, saldo: it.valor })),
  );
  return {
    alocacoes: alocacoes.map((a) => ({ id: a.id, tipo: tipoDe.get(a.id)!, devido: a.devido, alocado: a.alocado, saldo: a.saldo })),
    sobra,
  };
}
