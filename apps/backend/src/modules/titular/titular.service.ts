import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { limparDocumento, reaisParaCentavos } from '@azit/utils';
import {
  StatusContratoCredito,
  StatusContratoInvestimento,
} from '@azit/types';
import { PrismaService } from '../../database/prisma.service';
import { CriarTitularDto } from './dto/criar-titular.dto';
import { AtualizarTitularDto } from './dto/atualizar-titular.dto';
import { ListarTitularesDto } from './dto/listar-titulares.dto';
import {
  TitularApi,
  titularParaApi,
  mapearTipoPessoa,
  mapearStatusTitular,
} from './titular.mapper';

export interface ListaPaginada<T> {
  total: number;
  page: number;
  limit: number;
  data: T[];
}

@Injectable()
export class TitularService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarTitularDto): Promise<TitularApi> {
    const cpfCnpj = limparDocumento(dto.cpfCnpj);
    await this.garantirDocumentoLivre(cpfCnpj);

    const titular = await this.prisma.db.titular.create({
      data: {
        nome: dto.nome,
        tipoPessoa: mapearTipoPessoa.paraPrisma(dto.tipoPessoa),
        cpfCnpj,
        rg: dto.rg,
        estadoCivil: dto.estadoCivil,
        profissao: dto.profissao,
        whatsapp: dto.whatsapp,
        email: dto.email,
        endereco: dto.endereco,
        bairro: dto.bairro,
        cidade: dto.cidade,
        estado: dto.estado,
        cep: dto.cep,
      },
    });
    return titularParaApi(titular);
  }

  async listar(filtros: ListarTitularesDto): Promise<ListaPaginada<TitularApi>> {
    const where: Prisma.TitularWhereInput = {};
    if (filtros.nome) {
      where.nome = { contains: filtros.nome, mode: 'insensitive' };
    }
    if (filtros.cpfCnpj) {
      where.cpfCnpj = { contains: limparDocumento(filtros.cpfCnpj) };
    }
    if (filtros.status) {
      where.status = mapearStatusTitular.paraPrisma(filtros.status);
    }

    const [total, registros] = await Promise.all([
      this.prisma.db.titular.count({ where }),
      this.prisma.db.titular.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filtros.page - 1) * filtros.limit,
        take: filtros.limit,
      }),
    ]);

    return {
      total,
      page: filtros.page,
      limit: filtros.limit,
      data: registros.map(titularParaApi),
    };
  }

  async buscarPorId(id: string): Promise<TitularApi> {
    // findFirst (não findUnique) para que a extensão de soft delete filtre deletedAt.
    const titular = await this.prisma.db.titular.findFirst({ where: { id } });
    if (!titular) throw this.naoEncontrado();
    return titularParaApi(titular);
  }

  // Ficha completa: cadastro VIVO + Conta + contratos pendurados. Os contratos são
  // apenas listados (dados congelados no snapshot da formalização); editar o titular
  // NÃO os altera (imutabilidade do contrato assinado — Doc 2).
  async ficha(id: string) {
    const titular = await this.prisma.db.titular.findFirst({
      where: { id },
      include: {
        conta: {
          include: {
            contratosCredito: {
              select: { id: true, numero: true, status: true, saldoDevedor: true, dataAssinatura: true },
              orderBy: { createdAt: 'desc' },
            },
            contratosInvestimento: {
              select: { id: true, numero: true, status: true, valorAportado: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });
    if (!titular) throw this.naoEncontrado();
    const conta = titular.conta;
    return {
      titular: titularParaApi(titular),
      conta: conta
        ? { id: conta.id, status: conta.status.toLowerCase(), dataAbertura: conta.dataAbertura.toISOString() }
        : null,
      contratosCredito: (conta?.contratosCredito ?? []).map((c) => ({
        id: c.id,
        numero: c.numero,
        status: StatusContratoCredito[c.status],
        saldoDevedor: reaisParaCentavos(c.saldoDevedor.toString()),
        dataAssinatura: c.dataAssinatura.toISOString(),
      })),
      contratosInvestimento: (conta?.contratosInvestimento ?? []).map((i) => ({
        id: i.id,
        numero: i.numero,
        status: StatusContratoInvestimento[i.status],
        valorAportado: reaisParaCentavos(i.valorAportado.toString()),
      })),
    };
  }

  // Detalhe completo do titular (tela dedicada): dados pessoais + documentos +
  // resumo financeiro agregado + contratos. Tudo somente leitura.
  async detalhe(id: string) {
    const titular = await this.prisma.db.titular.findFirst({
      where: { id },
      include: {
        conta: {
          include: {
            contratosCredito: {
              select: { id: true, numero: true, status: true, valorTotal: true, valorEntrada: true, entradaParcelada: true, cronogramaGeradoEm: true, saldoDevedor: true, dataAssinatura: true },
              orderBy: { createdAt: 'desc' },
            },
            contratosInvestimento: {
              select: { id: true, numero: true, status: true, valorAportado: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });
    if (!titular) throw this.naoEncontrado();
    const conta = titular.conta;
    const contratos = conta?.contratosCredito ?? [];
    const ids = contratos.map((c) => c.id);

    // Documentos anexados ao titular (dedup por tipo, mantém o mais recente).
    const docsRaw = await this.prisma.db.documentoProposta.findMany({
      where: { titularId: id },
      orderBy: { dataAnexo: 'desc' },
      select: { id: true, tipo: true, arquivoRef: true, dataAnexo: true },
    });
    const vistos = new Set<string>();
    const documentos = docsRaw
      .filter((d) => (vistos.has(d.tipo) ? false : (vistos.add(d.tipo), true)))
      .map((d) => ({ id: d.id, tipo: d.tipo.toLowerCase(), arquivoRef: d.arquivoRef, dataAnexo: d.dataAnexo.toISOString() }));

    // Resumo financeiro agregado sobre os contratos da conta.
    const ATIVOS = ['ATIVO', 'INADIMPLENTE', 'BLOQUEADO', 'SUSPENSO', 'EM_RECUPERACAO_VEICULO'] as const;
    const idsAtivos = contratos.filter((c) => (ATIVOS as readonly string[]).includes(c.status)).map((c) => c.id);
    const hoje = new Date();
    const [pago, saldo, atraso, qAcordos, qNovacoes] = await Promise.all([
      // Total recebido do cliente = soma do valorPago das faturas (inclui principal,
      // encargos, intermediárias e serviços recorrentes — visão fiel ao caixa).
      conta ? this.prisma.db.fatura.aggregate({ where: { contaId: conta.id }, _sum: { valorPago: true } }) : null,
      idsAtivos.length ? this.prisma.db.parcela.aggregate({ where: { contratoId: { in: idsAtivos }, status: null, acordoId: null }, _sum: { valorNominal: true } }) : null,
      ids.length ? this.prisma.db.parcela.aggregate({ where: { contratoId: { in: ids }, status: null, acordoId: null, dataVencimento: { lt: hoje } }, _sum: { valorNominal: true } }) : null,
      ids.length ? this.prisma.db.acordo.count({ where: { contratoId: { in: ids } } }) : 0,
      ids.length ? this.prisma.db.novacao.count({ where: { contratoOrigemId: { in: ids } } }) : 0,
    ]);
    const cent = (d: Prisma.Decimal | null | undefined) => (d ? reaisParaCentavos(d.toString()) : 0);
    const valorEmContratoAtivo = contratos
      .filter((c) => (ATIVOS as readonly string[]).includes(c.status))
      .reduce((s, c) => s + cent(c.valorTotal), 0);
    // Entrada paga na ativação (não passa por fatura): à vista, ou 60% se parcelada
    // (os 40% restantes viram intermediárias já contadas no valorPago das faturas).
    const entradaPaga = contratos
      .filter((c) => c.cronogramaGeradoEm)
      .reduce((s, c) => {
        const ent = cent(c.valorEntrada);
        return s + (c.entradaParcelada ? Math.round(ent * 0.6) : ent);
      }, 0);

    return {
      titular: titularParaApi(titular),
      conta: conta
        ? { id: conta.id, status: conta.status.toLowerCase(), dataAbertura: conta.dataAbertura.toISOString() }
        : null,
      documentos,
      resumoFinanceiro: {
        valorEmContratoAtivo,
        valorPago: cent(pago?._sum.valorPago) + entradaPaga,
        saldoDevedor: cent(saldo?._sum.valorNominal),
        valorEmAtraso: cent(atraso?._sum.valorNominal),
        quantidadeRenegociacoes: qAcordos + qNovacoes,
        contratosAtivos: idsAtivos.length,
        contratosTotal: contratos.length,
      },
      contratosCredito: contratos.map((c) => ({
        id: c.id,
        numero: c.numero,
        status: StatusContratoCredito[c.status],
        valorTotal: cent(c.valorTotal),
        saldoDevedor: cent(c.saldoDevedor),
        dataAssinatura: c.dataAssinatura.toISOString(),
      })),
      contratosInvestimento: (conta?.contratosInvestimento ?? []).map((i) => ({
        id: i.id,
        numero: i.numero,
        status: StatusContratoInvestimento[i.status],
        valorAportado: cent(i.valorAportado),
      })),
    };
  }

  // Busca por CPF/CNPJ exato (item 2.1) — usada na originação para identificar
  // titular existente antes de criar. Retorna null quando não há cadastro ativo.
  async buscarPorDocumento(documento: string): Promise<TitularApi | null> {
    const cpfCnpj = limparDocumento(documento);
    const titular = await this.prisma.db.titular.findFirst({
      where: { cpfCnpj },
    });
    return titular ? titularParaApi(titular) : null;
  }

  async atualizar(id: string, dto: AtualizarTitularDto, usuarioId?: string): Promise<TitularApi> {
    await this.garantirExiste(id);
    const anterior = await this.prisma.db.titular.findFirst({ where: { id } });

    const data: Prisma.TitularUpdateInput = {
      nome: dto.nome,
      rg: dto.rg,
      estadoCivil: dto.estadoCivil,
      profissao: dto.profissao,
      whatsapp: dto.whatsapp,
      email: dto.email,
      endereco: dto.endereco,
      bairro: dto.bairro,
      cidade: dto.cidade,
      estado: dto.estado,
      cep: dto.cep,
    };
    if (dto.tipoPessoa) data.tipoPessoa = mapearTipoPessoa.paraPrisma(dto.tipoPessoa);
    if (dto.status) data.status = mapearStatusTitular.paraPrisma(dto.status);
    if (dto.cpfCnpj !== undefined) {
      const cpfCnpj = limparDocumento(dto.cpfCnpj);
      await this.garantirDocumentoLivre(cpfCnpj, id);
      data.cpfCnpj = cpfCnpj;
    }

    const titular = await this.prisma.db.titular.update({ where: { id }, data });
    // Auditoria: alteração de dados cadastrais é evento sensível (reunião 13/07).
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'titular_alterado',
        entidade: 'titular',
        entidadeId: id,
        antes: anterior ? JSON.parse(JSON.stringify(titularParaApi(anterior))) : undefined,
        depois: JSON.parse(JSON.stringify(titularParaApi(titular))),
      },
    });
    return titularParaApi(titular);
  }

  async remover(id: string, usuarioId?: string): Promise<void> {
    await this.garantirExiste(id);
    // Soft delete via extensão (preenche deletedAt).
    await this.prisma.db.titular.delete({ where: { id } });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'titular_removido',
        entidade: 'titular',
        entidadeId: id,
      },
    });
  }

  // --- helpers ---

  private async garantirExiste(id: string): Promise<void> {
    // findFirst para respeitar o soft delete (um titular deletado não "existe").
    const existe = await this.prisma.db.titular.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw this.naoEncontrado();
  }

  private async garantirDocumentoLivre(
    cpfCnpj: string,
    ignorarId?: string,
  ): Promise<void> {
    // findUnique (vê deletados de propósito): a constraint UNIQUE de cpfCnpj vale
    // globalmente; um titular soft-deleted ainda ocupa o documento no banco.
    const existente = await this.prisma.db.titular.findUnique({
      where: { cpfCnpj },
      select: { id: true },
    });
    if (existente && existente.id !== ignorarId) {
      throw new ConflictException({
        erro: 'documento_duplicado',
        mensagem: 'Já existe um titular com este CPF/CNPJ',
      });
    }
  }

  private naoEncontrado(): NotFoundException {
    return new NotFoundException({
      erro: 'nao_encontrado',
      mensagem: 'Titular não encontrado',
    });
  }
}
