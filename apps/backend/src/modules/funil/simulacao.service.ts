import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, OrigemCalculoOferta, Periodicidade } from '@prisma/client';
import {
  precificarPrice,
  centavosParaReaisString,
  reaisParaCentavos,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CriarSimulacaoDto } from './dto/simulacao.dto';

const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? reaisParaCentavos(d.toString()) : 0;

// Intermediárias (Doc 2 §4-A.3): entrada parcelada → mín. 60% à vista.
const MIN_ENTRADA_A_VISTA = 0.6;

// 7.3 — Simulação e ofertas. A precificação parte do VALOR DE VENDA do ativo
// (e/ou de um pacote genérico legado). A simulação é descartável; persiste-se a
// estrutura e as ofertas calculadas, e marca-se só a oferta escolhida ao avançar.
@Injectable()
export class SimulacaoService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CriarSimulacaoDto) {
    const ativo = await this.prisma.db.ativo.findFirst({
      where: { id: dto.ativoId },
      select: { id: true, descricao: true, valorVenda: true, pacoteOfertaId: true, status: true },
    });
    if (!ativo) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Ativo não encontrado' });
    }
    if (ativo.status !== 'DISPONIVEL') {
      throw new UnprocessableEntityException({
        erro: 'ativo_indisponivel',
        mensagem: 'Ativo não está disponível para simulação',
      });
    }
    if (ativo.valorVenda === null && !ativo.pacoteOfertaId) {
      throw new UnprocessableEntityException({
        erro: 'sem_precificacao',
        mensagem: 'Ativo sem valor de venda nem pacote — não há como precificar',
      });
    }

    // Entrada não pode cobrir/exceder o valor de venda — não há o que financiar
    // (evita oferta zerada por valor mal cadastrado ou entrada alta demais).
    const valorVendaCent = ativo.valorVenda !== null ? cent(ativo.valorVenda) : 0;
    if (valorVendaCent > 0 && dto.valorEntrada >= valorVendaCent) {
      throw new UnprocessableEntityException({
        erro: 'entrada_invalida',
        mensagem: 'A entrada é maior ou igual ao valor de venda do ativo — nada a financiar. Verifique o valor de venda do ativo e a entrada.',
      });
    }

    // Estruturas de oferta a calcular (uma por origem disponível no ativo).
    const calculos: { origem: OrigemCalculoOferta; valorVenda: number }[] = [];
    if (ativo.valorVenda !== null) {
      calculos.push({ origem: 'VALOR_VENDA_ATIVO', valorVenda: cent(ativo.valorVenda) });
    }
    if (ativo.pacoteOfertaId) {
      // Pacote genérico (andaime legado): sem catálogo real, usa o mesmo motor
      // sobre o valor de venda como aproximação provisória.
      const base = ativo.valorVenda !== null ? cent(ativo.valorVenda) : 0;
      calculos.push({ origem: 'PACOTE_GENERICO', valorVenda: base });
    }

    const simulacao = await this.prisma.db.simulacao.create({
      data: {
        leadId: dto.leadId,
        titularId: dto.titularId,
        ativoId: ativo.id,
        valorEntrada: reais(dto.valorEntrada),
        prazoSemanas: dto.prazoSemanas,
        periodicidade: dto.periodicidade.toUpperCase() as Periodicidade,
        observacoes: dto.observacoes,
      },
    });

    const ofertas = [];
    for (const c of calculos) {
      const p = precificarPrice({
        valorVenda: c.valorVenda,
        valorEntrada: dto.valorEntrada,
        prazoSemanas: dto.prazoSemanas,
      });
      const oferta = await this.prisma.db.oferta.create({
        data: {
          simulacaoId: simulacao.id,
          origemCalculo: c.origem,
          valorEntrada: reais(dto.valorEntrada),
          entradaParcelada: dto.entradaParcelada,
          prazoSemanas: dto.prazoSemanas,
          valorParcela: reais(p.valorParcela),
          numeroParcelas: p.numeroParcelas,
        },
      });
      ofertas.push(this.ofertaApi(oferta, p.totalAPagar, p.valorFinanciado));
    }

    return {
      id: simulacao.id,
      ativo: { id: ativo.id, descricao: ativo.descricao },
      valorEntrada: dto.valorEntrada,
      prazoSemanas: dto.prazoSemanas,
      entradaParcelada: dto.entradaParcelada,
      precificacaoProvisoria: true, // 7.4 — marca placeholder (Vicente)
      ofertas,
    };
  }

  // Listagem de simulações (tela de apoio) — descartáveis; mostra a oferta escolhida
  // e se já viraram proposta.
  async listar() {
    const sims = await this.prisma.db.simulacao.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        ativo: { select: { descricao: true } },
        lead: { select: { nome: true } },
        titular: { select: { nome: true } },
        ofertas: { where: { selecionada: true }, take: 1 },
        proposta: { select: { id: true, status: true } },
      },
    });
    return sims.map((s) => {
      const sel = s.ofertas[0];
      return {
        id: s.id,
        cliente: s.titular?.nome ?? s.lead?.nome ?? '—',
        ativo: s.ativo.descricao,
        valorEntrada: cent(s.valorEntrada),
        prazoSemanas: s.prazoSemanas,
        ofertaEscolhida: sel ? { valorParcela: cent(sel.valorParcela), numeroParcelas: sel.numeroParcelas } : null,
        propostaId: s.proposta?.id ?? null,
        propostaStatus: s.proposta?.status?.toLowerCase() ?? null,
        createdAt: s.createdAt.toISOString(),
      };
    });
  }

  async selecionarOferta(simulacaoId: string, ofertaId: string) {
    const oferta = await this.prisma.db.oferta.findFirst({
      where: { id: ofertaId, simulacaoId },
    });
    if (!oferta) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Oferta não encontrada' });
    }
    // Só uma oferta selecionada por simulação.
    await this.prisma.db.oferta.updateMany({ where: { simulacaoId }, data: { selecionada: false } });
    const sel = await this.prisma.db.oferta.update({ where: { id: ofertaId }, data: { selecionada: true } });
    return { id: sel.id, selecionada: true };
  }

  private ofertaApi(o: { id: string; origemCalculo: OrigemCalculoOferta; valorEntrada: Prisma.Decimal; entradaParcelada: boolean; prazoSemanas: number; valorParcela: Prisma.Decimal; numeroParcelas: number; selecionada: boolean }, totalAPagar: number, valorFinanciado: number) {
    const entradaCent = cent(o.valorEntrada);
    return {
      id: o.id,
      origemCalculo: o.origemCalculo.toLowerCase(),
      valorEntrada: entradaCent,
      entradaParcelada: o.entradaParcelada,
      entradaAVistaMinima: Math.round(entradaCent * MIN_ENTRADA_A_VISTA),
      prazoSemanas: o.prazoSemanas,
      valorParcela: cent(o.valorParcela),
      numeroParcelas: o.numeroParcelas,
      valorFinanciado,
      totalAPagar,
      selecionada: o.selecionada,
    };
  }
}
