import {
  PrismaClient,
  RoleUsuario,
  TipoPessoa,
  TipoAtivo,
  OrigemAtivo,
  TipoCombustivel,
  StatusAtivo,
  TipoOrigemCapital,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// Seed (Doc 4 §7.4, Doc 7 itens 1.1 e 2.5). Idempotente via upsert.
// Banco guarda dinheiro em Decimal (reais); o domínio/API trafega centavos.
const prisma = new PrismaClient();

async function seedAdmin() {
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

  for (const role of roles) {
    await prisma.usuarioRole.upsert({
      where: { usuarioId_role: { usuarioId: usuario.id, role } },
      update: {},
      create: { usuarioId: usuario.id, role },
    });
  }
  console.log(`   Admin: ${email} / ${senhaPlana} (${roles.join(', ')})`);
}

// Titulares fictícios + conta de cada um (1:1).
const TITULARES = [
  {
    nome: 'Samuel Antonio Gomes',
    tipoPessoa: TipoPessoa.PF,
    cpfCnpj: '52998224725',
    whatsapp: '11999990001',
    email: 'samuel@exemplo.com',
    profissao: 'Motorista de app',
    cidade: 'São Paulo',
    estado: 'SP',
  },
  {
    nome: 'Joana Ribeiro da Silva',
    tipoPessoa: TipoPessoa.PF,
    cpfCnpj: '39053344705',
    whatsapp: '11999990002',
    email: 'joana@exemplo.com',
    profissao: 'Motorista de app',
    cidade: 'Guarulhos',
    estado: 'SP',
  },
  {
    nome: 'Carlos Eduardo Martins',
    tipoPessoa: TipoPessoa.PF,
    cpfCnpj: '11144477735',
    whatsapp: '11999990003',
    email: 'carlos@exemplo.com',
    profissao: 'Motorista de app',
    cidade: 'Osasco',
    estado: 'SP',
  },
  {
    nome: 'Transportes Azit LTDA',
    tipoPessoa: TipoPessoa.PJ,
    cpfCnpj: '11222333000181',
    whatsapp: '1133334444',
    email: 'contato@transportesazit.com',
    cidade: 'São Paulo',
    estado: 'SP',
  },
];

// Ativos (veículos) + origem de capital. Ligados ao titular pelo CPF/CNPJ.
// valorAquisicao/valorAportado em REAIS (coluna Decimal). taxaRetorno fração decimal.
const ATIVOS = [
  {
    titularCpf: '52998224725',
    descricao: 'Hyundai HB20S 2024',
    marca: 'Hyundai',
    modelo: 'HB20S',
    anoFabricacao: 2023,
    anoModelo: 2024,
    cor: 'Prata',
    placa: 'SJC9I93',
    chassi: '9BHBG51CAPP100001',
    renavam: '01234567890',
    origem: OrigemAtivo.CONCESSIONARIA,
    combustivel: TipoCombustivel.FLEX,
    quilometragemEntrada: 12000,
    valorAquisicao: '85000.00',
    capital: { tipo: TipoOrigemCapital.CAPITAL_PROPRIO, valorAportado: '85000.00' },
  },
  {
    titularCpf: '39053344705',
    descricao: 'Chevrolet Onix 2023',
    marca: 'Chevrolet',
    modelo: 'Onix',
    anoFabricacao: 2022,
    anoModelo: 2023,
    cor: 'Branco',
    placa: 'RGH4A21',
    chassi: '9BGKS48R0PB200002',
    renavam: '01234567891',
    origem: OrigemAtivo.LOCADORA,
    combustivel: TipoCombustivel.FLEX,
    quilometragemEntrada: 28000,
    valorAquisicao: '78000.00',
    capital: { tipo: TipoOrigemCapital.EMPRESTIMO, valorAportado: '78000.00' },
  },
  {
    titularCpf: '11144477735',
    descricao: 'Fiat Cronos 2025',
    marca: 'Fiat',
    modelo: 'Cronos',
    anoFabricacao: 2024,
    anoModelo: 2025,
    cor: 'Cinza',
    placa: 'PQR2B34',
    chassi: '9BD35A1AAPB300003',
    renavam: '01234567892',
    origem: OrigemAtivo.CONCESSIONARIA,
    combustivel: TipoCombustivel.FLEX,
    quilometragemEntrada: 3000,
    valorAquisicao: '92000.00',
    capital: { tipo: TipoOrigemCapital.CAPITAL_PROPRIO, valorAportado: '92000.00' },
  },
];

async function seedDadosBase() {
  for (const t of TITULARES) {
    const titular = await prisma.titular.upsert({
      where: { cpfCnpj: t.cpfCnpj },
      update: {},
      create: t,
    });
    // Conta 1:1 (titularId @unique).
    await prisma.conta.upsert({
      where: { titularId: titular.id },
      update: {},
      create: { titularId: titular.id },
    });
  }
  console.log(`   Titulares + contas: ${TITULARES.length}`);

  for (const a of ATIVOS) {
    const { titularCpf, capital, ...dadosAtivo } = a;
    const ativo = await prisma.ativo.upsert({
      where: { chassi: dadosAtivo.chassi },
      update: {},
      create: { tipo: TipoAtivo.VEICULO, status: StatusAtivo.DISPONIVEL, ...dadosAtivo },
    });
    await prisma.origemCapital.upsert({
      where: { ativoId: ativo.id },
      update: {},
      create: {
        ativoId: ativo.id,
        tipo: capital.tipo,
        valorAportado: capital.valorAportado,
        dataAporte: new Date('2026-01-15'),
      },
    });
  }
  console.log(`   Ativos + origens de capital: ${ATIVOS.length}`);
}

async function main() {
  await seedAdmin();
  await seedDadosBase();
  console.log('✅ Seed concluído');
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
