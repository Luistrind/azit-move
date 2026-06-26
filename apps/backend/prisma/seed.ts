import {
  PrismaClient,
  RoleUsuario,
  TipoPessoa,
  TipoAtivo,
  OrigemAtivo,
  TipoCombustivel,
  StatusAtivo,
  TipoOrigemCapital,
  Periodicidade,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { gerarCronograma, centavosParaReaisString } from '@azit/utils';

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
  // Titulares dos contratos-demo da régua.
  {
    nome: 'Pedro Henrique Souza',
    tipoPessoa: TipoPessoa.PF,
    cpfCnpj: '86288366757',
    whatsapp: '11999990004',
    profissao: 'Motorista de app',
    cidade: 'São Paulo',
    estado: 'SP',
  },
  {
    nome: 'Mariana Costa Lima',
    tipoPessoa: TipoPessoa.PF,
    cpfCnpj: '52341787809',
    whatsapp: '11999990005',
    profissao: 'Motorista de app',
    cidade: 'Diadema',
    estado: 'SP',
  },
  {
    nome: 'Rafael Oliveira Santos',
    tipoPessoa: TipoPessoa.PF,
    cpfCnpj: '70179723408',
    whatsapp: '11999990006',
    profissao: 'Motorista de app',
    cidade: 'Santo André',
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
  // Ativos dos contratos-demo da régua (vencimentos recentes p/ espalhar o kanban).
  {
    titularCpf: '86288366757',
    descricao: 'Renault Kwid 2024',
    marca: 'Renault',
    modelo: 'Kwid',
    anoFabricacao: 2023,
    anoModelo: 2024,
    cor: 'Vermelho',
    placa: 'KWD1D11',
    chassi: '9BRKWID000R400010',
    origem: OrigemAtivo.LOCADORA,
    combustivel: TipoCombustivel.FLEX,
    valorAquisicao: '60000.00',
    capital: { tipo: TipoOrigemCapital.CAPITAL_PROPRIO, valorAportado: '60000.00' },
  },
  {
    titularCpf: '52341787809',
    descricao: 'Volkswagen Polo 2024',
    marca: 'Volkswagen',
    modelo: 'Polo',
    anoFabricacao: 2024,
    anoModelo: 2024,
    cor: 'Cinza',
    placa: 'PLO2E22',
    chassi: '9BWPOLO000R400011',
    origem: OrigemAtivo.CONCESSIONARIA,
    combustivel: TipoCombustivel.FLEX,
    valorAquisicao: '78000.00',
    capital: { tipo: TipoOrigemCapital.EMPRESTIMO, valorAportado: '78000.00' },
  },
  {
    titularCpf: '70179723408',
    descricao: 'Fiat Mobi 2023',
    marca: 'Fiat',
    modelo: 'Mobi',
    anoFabricacao: 2023,
    anoModelo: 2023,
    cor: 'Branco',
    placa: 'MOB3F33',
    chassi: '9BDMOBI000R400012',
    origem: OrigemAtivo.LOCADORA,
    combustivel: TipoCombustivel.FLEX,
    valorAquisicao: '55000.00',
    capital: { tipo: TipoOrigemCapital.CAPITAL_PROPRIO, valorAportado: '55000.00' },
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

// Contratos de crédito completos com cronograma (item 3.6). Valores em CENTAVOS.
const CONTRATOS = [
  {
    titularCpf: '52998224725', // Samuel
    ativoChassi: '9BHBG51CAPP100001', // Hyundai
    dataAssinatura: '2026-02-01',
    dataPrimeiraParcela: '2026-03-01',
    valorTotal: 9_000_000,
    valorEntrada: 1_000_000,
    numeroParcelas: 24,
    valorParcelaInicial: 333_333,
    periodicidade: 'mensal' as const,
  },
  {
    titularCpf: '39053344705', // Joana
    ativoChassi: '9BGKS48R0PB200002', // Chevrolet Onix
    dataAssinatura: '2026-03-10',
    dataPrimeiraParcela: '2026-03-17',
    valorTotal: 8_200_000,
    valorEntrada: 800_000,
    numeroParcelas: 52,
    valorParcelaInicial: 142_307,
    periodicidade: 'semanal' as const,
  },
  // Contratos-demo da régua: vencimentos recentes -> estágios D+1, D+3, D+10.
  // (relativo a 2026-06-26; data do sistema)
  {
    titularCpf: '86288366757', // Pedro -> D+1
    ativoChassi: '9BRKWID000R400010',
    dataAssinatura: '2026-06-18',
    dataPrimeiraParcela: '2026-06-25',
    valorTotal: 6_000_000,
    valorEntrada: 0,
    numeroParcelas: 12,
    valorParcelaInicial: 500_000,
    periodicidade: 'semanal' as const,
  },
  {
    titularCpf: '52341787809', // Mariana -> D+3
    ativoChassi: '9BWPOLO000R400011',
    dataAssinatura: '2026-06-16',
    dataPrimeiraParcela: '2026-06-23',
    valorTotal: 7_800_000,
    valorEntrada: 0,
    numeroParcelas: 12,
    valorParcelaInicial: 650_000,
    periodicidade: 'semanal' as const,
  },
  {
    titularCpf: '70179723408', // Rafael -> D+10
    ativoChassi: '9BDMOBI000R400012',
    dataAssinatura: '2026-06-08',
    dataPrimeiraParcela: '2026-06-15',
    valorTotal: 5_500_000,
    valorEntrada: 0,
    numeroParcelas: 12,
    valorParcelaInicial: 458_333,
    periodicidade: 'semanal' as const,
  },
];

const PERIODICIDADE_PRISMA: Record<'semanal' | 'quinzenal' | 'mensal', Periodicidade> =
  { semanal: 'SEMANAL', quinzenal: 'QUINZENAL', mensal: 'MENSAL' };

async function seedContratos() {
  let criados = 0;
  for (const c of CONTRATOS) {
    const ativo = await prisma.ativo.findUnique({
      where: { chassi: c.ativoChassi },
      include: { origemCapital: true, contratoCredito: true },
    });
    if (!ativo || !ativo.origemCapital) continue;
    if (ativo.contratoCredito) continue; // idempotente: ativo já tem contrato

    const titular = await prisma.titular.findUnique({
      where: { cpfCnpj: c.titularCpf },
      include: { conta: true },
    });
    if (!titular?.conta) continue;
    const conta = titular.conta.id;

    const saldoDevedor = c.valorTotal - c.valorEntrada;
    const cronograma = gerarCronograma({
      numeroParcelas: c.numeroParcelas,
      valorParcela: c.valorParcelaInicial,
      valorTotal: saldoDevedor,
      dataPrimeiraParcela: c.dataPrimeiraParcela,
      periodicidade: c.periodicidade,
    });
    const ano = new Date(c.dataAssinatura).getUTCFullYear();
    const mes = String(new Date(c.dataAssinatura).getUTCMonth() + 1).padStart(2, '0');
    const prefixo = `${ano}${mes}`;
    const count = await prisma.contratoCredito.count({
      where: { numero: { startsWith: prefixo } },
    });
    const numero = `${prefixo}${String(count + 1).padStart(4, '0')}`;
    const reais = centavosParaReaisString;

    await prisma.$transaction(async (tx) => {
      const contrato = await tx.contratoCredito.create({
        data: {
          numero,
          contaId: conta,
          ativoId: ativo.id,
          dataAssinatura: new Date(c.dataAssinatura),
          dataPrimeiraParcela: new Date(c.dataPrimeiraParcela),
          valorTotal: reais(c.valorTotal),
          valorEntrada: reais(c.valorEntrada),
          saldoDevedor: reais(saldoDevedor),
          numeroParcelas: c.numeroParcelas,
          valorParcelaInicial: reais(c.valorParcelaInicial),
          periodicidade: PERIODICIDADE_PRISMA[c.periodicidade],
          status: 'ATIVO',
        },
      });
      const item = await tx.itemContratado.create({
        data: {
          contratoId: contrato.id,
          descricao: 'Parcelamento do veículo',
          natureza: 'PARCELADO',
          origem: 'VENDA',
          credor: 'AZIT',
          valor: reais(saldoDevedor),
          numeroParcelas: c.numeroParcelas,
          periodicidade: PERIODICIDADE_PRISMA[c.periodicidade],
          dataInicio: new Date(c.dataPrimeiraParcela),
        },
      });
      await tx.parcela.createMany({
        data: cronograma.map((p) => ({
          contratoId: contrato.id,
          itemContratadoId: item.id,
          numero: p.numero,
          totalParcelas: p.totalParcelas,
          display: p.display,
          valorNominal: reais(p.valorNominal),
          dataVencimento: p.dataVencimento,
        })),
      });
      const parcelas = await tx.parcela.findMany({
        where: { contratoId: contrato.id },
        select: { id: true, numero: true },
      });
      const porNumero = new Map(cronograma.map((p) => [p.numero, p]));
      await tx.recebivel.createMany({
        data: parcelas.map((pc) => {
          const cron = porNumero.get(pc.numero)!;
          return {
            contratoId: contrato.id,
            parcelaId: pc.id,
            origemCapitalId: ativo.origemCapital!.id,
            dataPrevista: cron.dataVencimento,
            valorPrevisto: reais(cron.valorNominal),
          };
        }),
      });

      // Faturas no dia zero (item 4.1): uma por parcela/ciclo, status ABERTA.
      let seqFatura = 0;
      for (const pc of parcelas) {
        const cron = porNumero.get(pc.numero)!;
        const venc = cron.dataVencimento;
        seqFatura += 1;
        const fatura = await tx.fatura.create({
          data: {
            contaId: conta,
            numero: seqFatura,
            periodoReferencia: venc,
            dataFechamento: new Date(venc.getTime() - 5 * 24 * 60 * 60 * 1000),
            dataVencimento: venc,
            valorTotal: reais(cron.valorNominal),
            status: 'ABERTA',
          },
        });
        await tx.itemFatura.create({
          data: {
            faturaId: fatura.id,
            parcelaId: pc.id,
            tipo: 'PRINCIPAL',
            descricao: `Parcela ${cron.display}`,
            valor: reais(cron.valorNominal),
            credor: 'AZIT',
          },
        });
        await tx.parcela.update({ where: { id: pc.id }, data: { faturaId: fatura.id } });
      }
    });
    criados++;
  }
  console.log(`   Contratos com cronograma: ${criados}`);
}

async function main() {
  await seedAdmin();
  await seedDadosBase();
  await seedContratos();
  console.log('✅ Seed concluído');
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
