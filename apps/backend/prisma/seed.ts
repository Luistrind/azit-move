import { PrismaClient, RoleUsuario } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// Seed base (Doc 4 §7.4, Doc 7 item 1.1). Por enquanto: um usuário admin para o login.
// Ativos/contratos fictícios entram nos seeds dos blocos 2 e 3.
const prisma = new PrismaClient();

async function main() {
  const email = 'admin@azit.com.br';
  const senhaPlana = 'azit123';
  const senhaHash = await bcrypt.hash(senhaPlana, 12); // cost 12 (Doc 6 §2.1)

  // Diretor que também administra e aprova — RBAC acumulativo (Doc 6 §5.1).
  const roles: RoleUsuario[] = [
    RoleUsuario.DIRETOR,
    RoleUsuario.ADMIN,
    RoleUsuario.APROVADOR,
  ];

  const usuario = await prisma.usuario.upsert({
    where: { email },
    update: { senhaHash, ativo: true },
    create: { nome: 'Administrador Azit', email, senhaHash },
  });

  // Garante os roles (tabela de junção UsuarioRole).
  for (const role of roles) {
    await prisma.usuarioRole.upsert({
      where: { usuarioId_role: { usuarioId: usuario.id, role } },
      update: {},
      create: { usuarioId: usuario.id, role },
    });
  }

  console.log('✅ Seed concluído');
  console.log(`   Usuário: ${email}`);
  console.log(`   Senha:   ${senhaPlana}`);
  console.log(`   Roles:   ${roles.join(', ')}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
