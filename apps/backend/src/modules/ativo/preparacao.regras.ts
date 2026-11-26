import { StatusAtivo } from '@prisma/client';

// Preparação do veículo (doc 02 §25.8) — leituras compartilhadas com o funil
// (simulação, proposta, lista de espera, análise e formalização). Funções que
// recebem o cliente do banco (ou a transação) para não criar dependência entre
// módulos; a escrita fica no PreparacaoService.

type LinhaPreparacao = {
  id: string;
  ativoId: string;
  motivo: string;
  oQueFalta: string | null;
  abertaEm: Date;
  itens: { descricao: string; situacao: string | null }[];
};

type DbPreparacao = {
  preparacaoAtivo: {
    findFirst: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
  };
};

// O que o alerta mostra: o texto do operador e os itens ainda pendentes.
export interface AlertaPreparacao {
  preparacaoId: string;
  oQueFalta: string | null;
  pendentes: string[];
  totalItens: number;
  abertaEm: string;
}

const SELECT = {
  id: true,
  ativoId: true,
  motivo: true,
  oQueFalta: true,
  abertaEm: true,
  itens: { select: { descricao: true, situacao: true }, orderBy: { ordem: 'asc' as const } },
};

function paraAlerta(p: LinhaPreparacao): AlertaPreparacao {
  return {
    preparacaoId: p.id,
    oQueFalta: p.oQueFalta,
    pendentes: p.itens.filter((i) => !i.situacao).map((i) => i.descricao),
    totalItens: p.itens.length,
    abertaEm: p.abertaEm.toISOString(),
  };
}

export async function preparacaoAbertaDo(db: DbPreparacao, ativoId: string): Promise<AlertaPreparacao | null> {
  const p = (await db.preparacaoAtivo.findFirst({ where: { ativoId, concluidaEm: null }, select: SELECT })) as LinhaPreparacao | null;
  return p ? paraAlerta(p) : null;
}

export async function preparacoesAbertas(db: DbPreparacao, ativoIds: string[]): Promise<Map<string, AlertaPreparacao>> {
  const m = new Map<string, AlertaPreparacao>();
  if (!ativoIds.length) return m;
  const linhas = (await db.preparacaoAtivo.findMany({ where: { ativoId: { in: ativoIds }, concluidaEm: null }, select: SELECT })) as LinhaPreparacao[];
  for (const p of linhas) m.set(p.ativoId, paraAlerta(p));
  return m;
}

// Carro que pode ser oferecido (simulação, proposta, atribuição à lista de
// espera): Disponível ou Em preparação — este último sempre com o alerta.
export const STATUS_OFERECIVEIS: StatusAtivo[] = ['DISPONIVEL', 'EM_PREPARACAO'];
export function ativoOferecivel(status: StatusAtivo | string): boolean {
  return (STATUS_OFERECIVEIS as string[]).includes(status);
}

// Quando a reserva da lista de espera cai: o carro volta para Em preparação se
// a preparação ainda está aberta, senão para Disponível (§25.8 item 6).
export async function statusAoSoltarReserva(db: DbPreparacao, ativoId: string): Promise<StatusAtivo> {
  const aberta = await db.preparacaoAtivo.findFirst({ where: { ativoId, concluidaEm: null }, select: { id: true } });
  return aberta ? 'EM_PREPARACAO' : 'DISPONIVEL';
}

// Texto único do motivo de bloqueio da formalização — backend e tela leem daqui.
export function motivoPreparacaoPendente(a: AlertaPreparacao): string {
  const falta = a.pendentes.length ? `falta: ${a.pendentes.join(', ')}` : 'checklist completo, falta marcar como pronto';
  return `O veículo está em preparação (${falta}). O contrato só é gerado depois que ele for marcado como pronto na ficha do veículo.`;
}
