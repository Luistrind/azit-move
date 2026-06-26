import { Prisma } from '@prisma/client';

// Soft delete global (Doc 5 §1.1 e §11.1). Modelos com deletedAt:
const SOFT_DELETE_MODELS = new Set<string>([
  'Titular',
  'Conta',
  'ContratoCredito',
  'ContratoInvestimento',
  'Fatura',
  'Parcela',
  'Acordo',
  'Ativo',
  'ItemContratado',
  'Recebivel',
]);

// Reads onde deletedAt é um filtro válido. findUnique/findUniqueOrThrow NÃO entram aqui
// (where só aceita campos únicos); para lookup único ciente de soft delete, usar findFirst.
const READ_OPS_FILTRAVEIS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

function injetaNaoDeletado(args: any): any {
  const a = args ?? {};
  if (a.where && 'deletedAt' in a.where) return a; // caller pediu deletados explicitamente
  return { ...a, where: { ...a.where, deletedAt: null } };
}

export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !SOFT_DELETE_MODELS.has(model)) return query(args);
        if (READ_OPS_FILTRAVEIS.has(operation)) return query(injetaNaoDeletado(args));
        return query(args);
      },
    },
  },
  model: {
    $allModels: {
      // delete -> update { deletedAt: now }
      async delete<T>(this: T, args: any): Promise<unknown> {
        const ctx = Prisma.getExtensionContext(this) as any;
        if (!SOFT_DELETE_MODELS.has(ctx.$name)) {
          return ctx.$parent[ctx.$name].delete(args);
        }
        return ctx.update({ ...args, data: { deletedAt: new Date() } });
      },
      // deleteMany -> updateMany { deletedAt: now } (apenas registros ainda não deletados)
      async deleteMany<T>(this: T, args: any): Promise<unknown> {
        const ctx = Prisma.getExtensionContext(this) as any;
        if (!SOFT_DELETE_MODELS.has(ctx.$name)) {
          return ctx.$parent[ctx.$name].deleteMany(args);
        }
        const a = args ?? {};
        return ctx.updateMany({
          ...a,
          where: { ...a.where, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      },
    },
  },
});
