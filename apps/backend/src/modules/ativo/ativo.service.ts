import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PreparacaoService } from './preparacao.service';
import { preparacaoAbertaDo, preparacoesAbertas, STATUS_OFERECIVEIS } from './preparacao.regras';
import { CriarAtivoDto } from './dto/criar-ativo.dto';
import { AtualizarAtivoDto } from './dto/atualizar-ativo.dto';
import { ListarAtivosDto } from './dto/listar-ativos.dto';
import {
  AtivoApi,
  ativoParaApi,
  mapearAtivoEnums,
  valorAquisicaoParaPrisma,
} from './ativo.mapper';

// Cliente do veículo (doc 02 §25.1): titular do contrato ATIVO, quando existe.
// 1 ativo = 1 contrato ativo por vez (Doc 2 §4.4), por isso take: 1.
const INCLUDE_CLIENTE = {
  reservadoProposta: { select: { id: true, titular: { select: { nome: true } } } },
  contratosCredito: {
    where: { status: 'ATIVO' as const, deletedAt: null },
    select: { id: true, numero: true, conta: { select: { titular: { select: { id: true, nome: true } } } } },
    take: 1,
  },
};

export interface ListaPaginada<T> {
  total: number;
  page: number;
  limit: number;
  data: T[];
}

@Injectable()
export class AtivoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preparacao: PreparacaoService,
  ) {}

  async criar(dto: CriarAtivoDto, usuarioId?: string): Promise<AtivoApi> {
    if (dto.placa) await this.garantirPlacaLivre(dto.placa);
    if (dto.chassi) await this.garantirChassiLivre(dto.chassi);
    if (dto.estruturaJuridicaId) await this.garantirEstrutura(dto.estruturaJuridicaId);

    // Veículo novo nasce EM PREPARAÇÃO com o checklist (doc 02 §25.8, decisão
    // Luís 24/11): troca de óleo, rastreador etc. antes de ir para venda.
    const ativo = await this.prisma.db.$transaction(async (tx) => {
      const criado = await tx.ativo.create({
        data: {
          tipo: mapearAtivoEnums.tipoParaPrisma(dto.tipo),
          estruturaJuridicaId: dto.estruturaJuridicaId,
          descricao: dto.descricao,
          varianteCatalogo: dto.varianteCatalogo ?? 'carro',
          marca: dto.marca,
          modelo: dto.modelo,
          anoFabricacao: dto.anoFabricacao,
          anoModelo: dto.anoModelo,
          cor: dto.cor,
          placa: dto.placa,
          chassi: dto.chassi,
          renavam: dto.renavam,
          origem: dto.origem
            ? mapearAtivoEnums.origemParaPrisma(dto.origem)
            : undefined,
          combustivel: dto.combustivel
            ? mapearAtivoEnums.combustivelParaPrisma(dto.combustivel)
            : undefined,
          quilometragemEntrada: dto.quilometragemEntrada,
          valorAquisicao:
            dto.valorAquisicao !== undefined
              ? valorAquisicaoParaPrisma(dto.valorAquisicao)
              : undefined,
          valorVenda:
            dto.valorVenda !== undefined
              ? valorAquisicaoParaPrisma(dto.valorVenda)
              : undefined,
          pacoteOfertaId: dto.pacoteOfertaId,
          ofertaFixaId: dto.ofertaFixaId ?? undefined,
        },
        include: { estruturaJuridica: { select: { id: true, nome: true } } },
      });
      if (criado.tipo === 'VEICULO') {
        await this.preparacao.abrirNaTransacao(tx, criado.id, 'ENTRADA', null, usuarioId);
        criado.status = 'EM_PREPARACAO';
      }
      return criado;
    });

    // Aporte SAIU do cadastro de ativo (doc 02 §19, decisão Luís 20/09): aqui se
    // declara apenas a estrutura jurídica dona. Valor aportado e taxa de retorno
    // são assunto da estrutura e serão discutidos adiante.
    return ativoParaApi(ativo, await preparacaoAbertaDo(this.prisma.db, ativo.id));
  }

  async listar(filtros: ListarAtivosDto): Promise<ListaPaginada<AtivoApi>> {
    const where: Prisma.AtivoWhereInput = {};
    if (filtros.status) where.status = mapearAtivoEnums.statusParaPrisma(filtros.status);
    else if (filtros.oferecivel === 'true') where.status = { in: STATUS_OFERECIVEIS };
    if (filtros.tipo) where.tipo = filtros.tipo === 'veiculo' ? 'VEICULO' : 'OUTRO';
    if (filtros.placa) where.placa = { contains: filtros.placa, mode: 'insensitive' };
    if (filtros.chassi) where.chassi = { contains: filtros.chassi, mode: 'insensitive' };
    if (filtros.busca) {
      // Placa digitada com hífen/espaço ("ABC-1D23") casa com a gravada ("ABC1D23").
      const termo = filtros.busca.replace(/[\s-]/g, '');
      where.OR = [
        { placa: { contains: termo, mode: 'insensitive' } },
        { chassi: { contains: termo, mode: 'insensitive' } },
        { descricao: { contains: filtros.busca, mode: 'insensitive' } },
        { marca: { contains: filtros.busca, mode: 'insensitive' } },
        { modelo: { contains: filtros.busca, mode: 'insensitive' } },
      ];
    }

    const [total, registros] = await Promise.all([
      this.prisma.db.ativo.count({ where }),
      this.prisma.db.ativo.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filtros.page - 1) * filtros.limit,
        take: filtros.limit,
        include: { estruturaJuridica: { select: { id: true, nome: true } }, ...INCLUDE_CLIENTE },
      }),
    ]);

    return {
      total,
      page: filtros.page,
      limit: filtros.limit,
      data: await this.comPreparacao(registros),
    };
  }

  async buscarPorId(id: string): Promise<AtivoApi> {
    const ativo = await this.prisma.db.ativo.findFirst({
      where: { id },
      include: { estruturaJuridica: { select: { id: true, nome: true } }, ...INCLUDE_CLIENTE },
    });
    if (!ativo) throw this.naoEncontrado();
    return ativoParaApi(ativo, await preparacaoAbertaDo(this.prisma.db, ativo.id));
  }

  // Lista com o alerta de preparação de cada carro (doc 02 §25.8).
  private async comPreparacao<T extends Parameters<typeof ativoParaApi>[0]>(registros: T[]): Promise<AtivoApi[]> {
    const preps = await preparacoesAbertas(this.prisma.db, registros.map((r) => r.id));
    return registros.map((r) => ativoParaApi(r, preps.get(r.id) ?? null));
  }

  // Busca por chassi ou placa exatos (item 2.3). Um dos dois é obrigatório.
  async buscarPorIdentificador(params: {
    chassi?: string;
    placa?: string;
  }): Promise<AtivoApi> {
    if (!params.chassi && !params.placa) {
      throw new BadRequestException({
        erro: 'validacao',
        mensagem: 'Informe chassi ou placa',
      });
    }
    const where: Prisma.AtivoWhereInput = params.chassi
      ? { chassi: params.chassi }
      : { placa: params.placa };
    const ativo = await this.prisma.db.ativo.findFirst({ where });
    if (!ativo) throw this.naoEncontrado();
    return ativoParaApi(ativo);
  }

  async atualizar(id: string, dto: AtualizarAtivoDto, usuarioId?: string): Promise<AtivoApi> {
    const anterior = await this.prisma.db.ativo.findFirst({ where: { id }, select: { observacao: true } });
    if (!anterior) throw this.naoEncontrado();

    if (dto.estruturaJuridicaId) await this.garantirEstrutura(dto.estruturaJuridicaId);
    const data: Prisma.AtivoUpdateInput = {
      descricao: dto.descricao,
      varianteCatalogo: dto.varianteCatalogo,
      ...(dto.estruturaJuridicaId
        ? { estruturaJuridica: { connect: { id: dto.estruturaJuridicaId } } }
        : {}),
      marca: dto.marca,
      modelo: dto.modelo,
      anoFabricacao: dto.anoFabricacao,
      anoModelo: dto.anoModelo,
      cor: dto.cor,
      renavam: dto.renavam,
      quilometragemEntrada: dto.quilometragemEntrada,
    };
    if (dto.observacao !== undefined) data.observacao = dto.observacao?.trim() || null;
    if (dto.tipo) data.tipo = mapearAtivoEnums.tipoParaPrisma(dto.tipo);
    if (dto.origem !== undefined) {
      data.origem = dto.origem ? mapearAtivoEnums.origemParaPrisma(dto.origem) : null;
    }
    if (dto.combustivel !== undefined) {
      data.combustivel = dto.combustivel
        ? mapearAtivoEnums.combustivelParaPrisma(dto.combustivel)
        : null;
    }
    if (dto.valorAquisicao !== undefined) {
      data.valorAquisicao =
        dto.valorAquisicao === null
          ? null
          : valorAquisicaoParaPrisma(dto.valorAquisicao);
    }
    if (dto.valorVenda !== undefined) {
      data.valorVenda =
        dto.valorVenda === null ? null : valorAquisicaoParaPrisma(dto.valorVenda);
    }
    if (dto.pacoteOfertaId !== undefined) data.pacoteOfertaId = dto.pacoteOfertaId;
    // Relação (AtivoUpdateInput não aceita o FK escalar): vincula/desvincula a oferta fixa.
    if (dto.ofertaFixaId !== undefined) {
      data.ofertaFixa = dto.ofertaFixaId
        ? { connect: { id: dto.ofertaFixaId } }
        : { disconnect: true };
    }
    if (dto.placa !== undefined) {
      if (dto.placa) await this.garantirPlacaLivre(dto.placa, id);
      data.placa = dto.placa;
    }
    if (dto.chassi !== undefined) {
      if (dto.chassi) await this.garantirChassiLivre(dto.chassi, id);
      data.chassi = dto.chassi;
    }

    const ativo = await this.prisma.db.ativo.update({ where: { id }, data });
    // Observação auditada (doc 02 §25.1): quem mudou, quando, de quê para quê —
    // a ficha do veículo mostra a última alteração.
    if (dto.observacao !== undefined && (anterior.observacao ?? null) !== (ativo.observacao ?? null)) {
      await this.prisma.db.logAuditoria.create({
        data: {
          usuarioId,
          acao: 'ativo_observacao_alterada',
          entidade: 'ativo',
          entidadeId: id,
          antes: { observacao: anterior.observacao },
          depois: { observacao: ativo.observacao },
        },
      });
    }
    return ativoParaApi(ativo);
  }

  async remover(id: string): Promise<void> {
    await this.garantirExiste(id);
    await this.prisma.db.ativo.delete({ where: { id } }); // soft delete
  }

  // --- helpers ---

  // Homologação 04/08: ativo nasce com a estrutura jurídica dona (tag 1:N).
  private async garantirEstrutura(id: string): Promise<void> {
    const existe = await this.prisma.db.estruturaJuridica.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existe) {
      throw new BadRequestException({
        erro: 'estrutura_invalida',
        mensagem: 'Estrutura jurídica não encontrada — cadastre a estrutura dona do ativo antes (tela Estruturas jurídicas)',
      });
    }
  }

  private async garantirExiste(id: string): Promise<void> {
    const existe = await this.prisma.db.ativo.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!existe) throw this.naoEncontrado();
  }

  // findUnique vê deletados de propósito: placa/chassi são UNIQUE globais no banco.
  private async garantirPlacaLivre(placa: string, ignorarId?: string): Promise<void> {
    const existente = await this.prisma.db.ativo.findUnique({
      where: { placa },
      select: { id: true },
    });
    if (existente && existente.id !== ignorarId) {
      throw new ConflictException({
        erro: 'placa_duplicada',
        mensagem: 'Já existe um ativo com esta placa',
      });
    }
  }

  private async garantirChassiLivre(chassi: string, ignorarId?: string): Promise<void> {
    const existente = await this.prisma.db.ativo.findUnique({
      where: { chassi },
      select: { id: true },
    });
    if (existente && existente.id !== ignorarId) {
      throw new ConflictException({
        erro: 'chassi_duplicado',
        mensagem: 'Já existe um ativo com este chassi',
      });
    }
  }

  private naoEncontrado(): NotFoundException {
    return new NotFoundException({
      erro: 'nao_encontrado',
      mensagem: 'Ativo não encontrado',
    });
  }
}
