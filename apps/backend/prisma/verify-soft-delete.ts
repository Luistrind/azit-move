/**
 * Verificação do soft delete (Bloco 0.6). Roda com: pnpm exec ts-node prisma/verify-soft-delete.ts
 * Exige Postgres no ar e a migration aplicada.
 *
 * Confirma que:
 *  - delete() não remove fisicamente, apenas seta deletedAt;
 *  - leituras filtradas (prisma.db) não retornam o registro deletado;
 *  - o cliente cru (prisma) ainda enxerga o registro com deletedAt preenchido.
 */
import { PrismaClient } from '@prisma/client';
import { softDeleteExtension } from '../src/database/soft-delete.extension';

async function main() {
  const base = new PrismaClient();
  const db = base.$extends(softDeleteExtension);

  const cpf = `verify-${Date.now()}`;
  const criado = await db.titular.create({
    data: { nome: 'Soft Delete Teste', tipoPessoa: 'PF', cpfCnpj: cpf, whatsapp: '5500000000000' },
  });
  console.log('1) criado:', criado.id);

  await db.titular.delete({ where: { id: criado.id } });
  console.log('2) delete() executado (esperado: soft delete)');

  const viaFiltrado = await db.titular.findFirst({ where: { id: criado.id } });
  if (viaFiltrado) throw new Error('FALHA: cliente filtrado ainda retorna o registro deletado');
  console.log('3) OK: leitura filtrada não retorna o deletado');

  const viaCru = await base.titular.findFirst({ where: { id: criado.id } });
  if (!viaCru) throw new Error('FALHA: registro sumiu fisicamente (era para ser soft delete)');
  if (!viaCru.deletedAt) throw new Error('FALHA: deletedAt não foi preenchido');
  console.log('4) OK: registro persiste com deletedAt =', viaCru.deletedAt.toISOString());

  // limpeza física via SQL cru (contorna a extensão)
  await base.$executeRaw`DELETE FROM titulares WHERE id = ${criado.id}`;
  console.log('5) limpeza concluída');

  await base.$disconnect();
  console.log('\n✅ SOFT DELETE OK');
}

main().catch((e) => {
  console.error('\n❌', e.message);
  process.exit(1);
});
