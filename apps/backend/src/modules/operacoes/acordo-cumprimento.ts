// Cumprimento do ACORDO (doc 02 §5.4, decisão 2026-09-07): quando a última
// parcela do plano (itens de origem ACORDO) é paga, o acordo vira CUMPRIDO —
// "acordo não se quita, se cumpre" (Vocabulário §2-A). Chamado de TODOS os
// caminhos de pagamento (conciliação de fatura, quitação antecipada, sinistro)
// para nenhum escapar. Função pura sobre o client/tx — sem DI, sem ciclo de
// módulo entre cobrança e operações.

// Interface mínima do client — assinaturas relaxadas (o client estendido do
// Prisma não é atribuível a tipos literais estritos).
/* eslint-disable @typescript-eslint/no-explicit-any */
type _DbAcordos = { // referência da forma esperada (o client estendido do Prisma não é estruturalmente atribuível)
  acordo: { findMany(args: any): Promise<{ id: string }[]>; update(args: any): Promise<unknown> };
  parcela: { count(args: any): Promise<number> };
};

export async function cumprirAcordosSePagos(db: any, contratoIds: string[]): Promise<number> {
  if (contratoIds.length === 0) return 0;
  const acordos = await db.acordo.findMany({
    where: { status: 'ATIVO', itensGerados: { some: { contratoId: { in: contratoIds } } } },
    select: { id: true },
  });
  let cumpridos = 0;
  for (const a of acordos) {
    const abertas = await db.parcela.count({
      where: { status: null, itemContratado: { acordoOrigemId: a.id } },
    });
    if (abertas === 0) {
      await db.acordo.update({ where: { id: a.id }, data: { status: 'CUMPRIDO' } });
      cumpridos += 1;
    }
  }
  return cumpridos;
}
