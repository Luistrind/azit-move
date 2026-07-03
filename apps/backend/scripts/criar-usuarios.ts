// Cria/atualiza SÓ os usuários internos (idempotente, sem apagar nada). Útil para
// testar a segregação do motor de aprovação (solicitante ≠ aprovador) sem rodar o
// seed completo (que tem deleteMany). Senha de todos: azit123.
import { PrismaClient, RoleUsuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const USUARIOS: { nome: string; email: string; roles: RoleUsuario[] }[] = [
  { nome: 'Administrador Azit', email: 'admin@azit.com.br', roles: [
    RoleUsuario.ADMIN, RoleUsuario.DIRETOR, RoleUsuario.APROVADOR, RoleUsuario.OPERADOR, RoleUsuario.FINANCEIRO,
  ] },
  { nome: 'Diretoria Azit', email: 'diretor@azit.com.br', roles: [RoleUsuario.DIRETOR] },
  { nome: 'Aprovador Azit', email: 'aprovador@azit.com.br', roles: [RoleUsuario.APROVADOR] },
  { nome: 'Operador Azit', email: 'operador@azit.com.br', roles: [RoleUsuario.OPERADOR] },
  { nome: 'Financeiro Azit', email: 'financeiro@azit.com.br', roles: [RoleUsuario.FINANCEIRO] },
];

async function main() {
  const senhaHash = await bcrypt.hash('azit123', 12);
  for (const u of USUARIOS) {
    const usuario = await prisma.usuario.upsert({
      where: { email: u.email },
      update: { senhaHash, ativo: true, nome: u.nome },
      create: { nome: u.nome, email: u.email, senhaHash },
    });
    for (const role of u.roles) {
      await prisma.usuarioRole.upsert({
        where: { usuarioId_role: { usuarioId: usuario.id, role } },
        update: {},
        create: { usuarioId: usuario.id, role },
      });
    }
    console.log(`>> ${u.email} (${u.roles.join(', ')})`);
  }
  console.log('Pronto. Todos com senha: azit123');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
