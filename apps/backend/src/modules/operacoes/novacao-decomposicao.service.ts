import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AcordoNovacao,
  ComponenteNovacao,
  ComposicaoCoberta,
  decomporSaldoNovacao,
  diasAtrasoCalendario,
  FrequenciaNovacao,
  inicioHojeBrasilUTC,
  precificarNovacao,
  ProdutoNovacao,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CatalogoFonteService } from '../catalogo/catalogo-fonte.service';

const DIA_MS = 24 * 60 * 60 * 1000;
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;
const frac = (d: Prisma.Decimal | null | undefined): number =>
  d !== null && d !== undefined ? Number(d.toString()) : 0;

// ============================================================
// NOVAÇÃO — F1: montador da decomposição do saldo por produto.
//
// Este service monta o retrato REAL da conta (parcelas em aberto, itens de
// fatura discriminados, acordos com cobertura e snapshot) e delega TODO o
// cálculo ao motor puro de @azit/utils (novacao.ts) — A7 passos 1–2 do doc
// docs/novacao-adaptacoes-azit-2026-09.md. O resultado separa:
//   parteVeiculo (insumo do Contrato 1 — novação do veículo) ×
//   demaisProdutos (insumo do Contrato 2 — Termo de Regularização de Débitos).
//
// Classificação por produto:
//   - parcela de item VENDA em contrato COM ativo → veículo; a proteção
//     EMBUTIDA na parcela (ItemFatura SERVICO da mesma parcela) sai da parte
//     do veículo e entra como seguro;
//   - parcela de item VENDA em contrato SEM ativo → reembolso (doc 02 §19);
//   - parcela de item ACORDO → saldo em aberto do plano daquele acordo;
//   - ItemFatura sem parcela (proteção recorrente, intermediária, encargo) em
//     fatura vencida não paga → seguro / veículo / outro.
//
// Taxa de valor presente do futuro (taxa do contrato de ORIGEM):
//   - contrato do catálogo: taxaMensal (TR) da versão congelada na simulação;
//   - legado: taxaDescontoQuitacao; RP sem versão: encargo mensal do produto
//     reembolso no Catálogo; acordo: encargo mensal congelado no snapshot.
// ============================================================
@Injectable()
export class NovacaoDecomposicaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogoFonte: CatalogoFonteService,
  ) {}

  // Taxa mensal de origem por contrato (mesma hierarquia da quitação §7.4).
  private async taxaOrigemPorContrato(
    contratos: { id: string; ativoId: string | null; taxaDescontoQuitacao: Prisma.Decimal | null }[],
  ): Promise<Map<string, number>> {
    const taxas = new Map<string, number>();
    let taxaReembolsoCatalogo: number | null | undefined;
    for (const c of contratos) {
      const proposta = await this.prisma.db.proposta.findFirst({
        where: { OR: [{ contratoGeradoId: c.id }, { contratosPacote: { some: { id: c.id } } }] },
        select: { simulacao: { select: { parametroVersao: { select: { taxaMensal: true } } } } },
      });
      let taxa = frac(proposta?.simulacao?.parametroVersao?.taxaMensal);
      if (taxa <= 0) taxa = frac(c.taxaDescontoQuitacao);
      if (taxa <= 0 && !c.ativoId) {
        // RP sem versão congelada: encargo mensal do produto reembolso.
        if (taxaReembolsoCatalogo === undefined) {
          taxaReembolsoCatalogo = (await this.catalogoFonte.reembolsoParcelado())?.encargoMensal ?? null;
        }
        taxa = taxaReembolsoCatalogo ?? 0;
      }
      taxas.set(c.id, taxa);
    }
    return taxas;
  }

  async decomporConta(contaId: string) {
    const conta = await this.prisma.db.conta.findFirst({
      where: { id: contaId },
      select: {
        id: true,
        titularId: true,
        titular: { select: { nome: true } },
        contratosCredito: {
          select: {
            id: true,
            numero: true,
            ativoId: true,
            status: true,
            periodicidade: true,
            taxaMultaAtraso: true,
            taxaJurosAtraso: true,
            taxaDescontoQuitacao: true,
            ativo: { select: { descricao: true } },
          },
        },
      },
    });
    if (!conta) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Conta não encontrada' });
    }
    const hoje = inicioHojeBrasilUTC();
    const contratos = conta.contratosCredito;
    const porContrato = new Map(contratos.map((c) => [c.id, c]));
    const taxas = await this.taxaOrigemPorContrato(contratos);

    // --- 1. Parcelas EM ABERTO de todos os contratos da conta, com item de
    // origem e composição discriminada da fatura (PRINCIPAL × SERVICO).
    const parcelas = await this.prisma.db.parcela.findMany({
      where: { contratoId: { in: contratos.map((c) => c.id) }, status: null },
      orderBy: { dataVencimento: 'asc' },
      select: {
        id: true,
        contratoId: true,
        display: true,
        valorNominal: true,
        dataVencimento: true,
        faturaId: true,
        acordoId: true, // coberta por acordo → NÃO é componente direto
        itemContratado: { select: { origem: true, acordoOrigemId: true, descricao: true } },
        itensFatura: { select: { tipo: true, valor: true } },
      },
    });

    const componentes: ComponenteNovacao[] = [];
    // Parcelas em aberto dos planos de acordo, agrupadas por acordo.
    const abertasPorAcordo = new Map<string, ComponenteNovacao[]>();

    const situacaoDe = (venc: Date): { situacao: 'vencido' | 'futuro'; dias: number } => {
      const atraso = diasAtrasoCalendario(venc, hoje);
      if (atraso > 0) return { situacao: 'vencido', dias: atraso };
      return { situacao: 'futuro', dias: Math.max(0, Math.round((venc.getTime() - hoje.getTime()) / DIA_MS)) };
    };

    for (const p of parcelas) {
      if (p.acordoId) continue; // coberta por acordo: entra pela explosão do acordo
      const c = porContrato.get(p.contratoId)!;
      const { situacao, dias } = situacaoDe(p.dataVencimento);
      const base = {
        contratoId: p.contratoId,
        faturaId: p.faturaId ?? undefined,
        situacao,
        dias,
        taxaMultaPercent: frac(c.taxaMultaAtraso),
        taxaJurosMensalPercent: frac(c.taxaJurosAtraso),
        taxaVpMensal: taxas.get(p.contratoId) ?? 0,
      };

      if (p.itemContratado.origem === 'ACORDO' && p.itemContratado.acordoOrigemId) {
        const grupo = abertasPorAcordo.get(p.itemContratado.acordoOrigemId) ?? [];
        grupo.push({ ...base, produto: 'outro', origem: `Parcela ${p.display} do acordo`, valorNominal: cent(p.valorNominal) });
        abertasPorAcordo.set(p.itemContratado.acordoOrigemId, grupo);
        continue;
      }

      const nominal = cent(p.valorNominal);
      if (!c.ativoId) {
        componentes.push({ ...base, produto: 'reembolso', origem: `Reembolso ${p.display} · ${c.numero}`, valorNominal: nominal });
        continue;
      }
      // Veículo — proteção embutida (ItemFatura SERVICO da parcela) sai como seguro.
      const servico = p.itensFatura.filter((i) => i.tipo === 'SERVICO').reduce((s, i) => s + cent(i.valor), 0);
      const protecao = Math.min(Math.max(0, servico), nominal);
      componentes.push({
        ...base,
        produto: 'veiculo',
        origem: `Parcela ${p.display} · ${c.ativo?.descricao ?? c.numero}`,
        valorNominal: nominal - protecao,
      });
      if (protecao > 0) {
        componentes.push({ ...base, produto: 'seguro', origem: `Proteção embutida · ${p.display}`, valorNominal: protecao });
      }
    }

    // --- 2. Itens de fatura SEM parcela (proteção recorrente, intermediária,
    // encargo) em faturas vencidas não pagas: dívida real fora das parcelas.
    // RENEGOCIADA entra TAMBÉM: o acordo cobre só PARCELAS — o item de serviço
    // sem parcela da fatura renegociada não foi coberto por acordo nenhum e
    // segue devido (gap do produto Acordo sinalizado ao Luís em 13/09; sem
    // risco de dupla contagem enquanto o acordo não cobrir serviços).
    const faturasVencidas = await this.prisma.db.fatura.findMany({
      where: { contaId, status: { in: ['ABERTA', 'FECHADA', 'RENEGOCIADA'] }, dataVencimento: { lt: hoje } },
      select: {
        id: true,
        numero: true,
        dataVencimento: true,
        itensFatura: { where: { parcelaId: null }, select: { tipo: true, descricao: true, valor: true } },
      },
    });
    for (const f of faturasVencidas) {
      const dias = diasAtrasoCalendario(f.dataVencimento, hoje);
      for (const i of f.itensFatura) {
        const produto: ProdutoNovacao =
          i.tipo === 'SERVICO' ? 'seguro' : i.tipo === 'INTERMEDIARIA' ? 'veiculo' : 'outro';
        componentes.push({
          origem: `${i.descricao} · fatura ${f.numero}`,
          produto,
          faturaId: f.id,
          valorNominal: cent(i.valor),
          situacao: 'vencido',
          dias,
        });
      }
    }

    // --- 3. Acordos da conta com plano gerado (ATIVO — e CUMPRIDO, que pode ser
    // referenciado por acordo posterior que cobriu parcelas dele).
    const acordosDb = await this.prisma.db.acordo.findMany({
      where: { contaId, status: { in: ['ATIVO', 'CUMPRIDO'] } },
      select: {
        id: true,
        status: true,
        snapshotJson: true,
        itensGerados: { select: { valor: true } },
        parcelasCobertas: {
          select: {
            display: true,
            valorNominal: true,
            contratoId: true,
            itemContratado: { select: { origem: true, acordoOrigemId: true } },
            itensFatura: { select: { tipo: true, valor: true } },
          },
        },
      },
    });
    let taxaAcordoCatalogo: number | null | undefined;
    const acordos: AcordoNovacao[] = [];
    for (const a of acordosDb) {
      const composicao: ComposicaoCoberta[] = [];
      for (const pc of a.parcelasCobertas) {
        const nominal = cent(pc.valorNominal);
        const item = pc.itemContratado;
        if (item.origem === 'ACORDO' && item.acordoOrigemId) {
          composicao.push({ ref: item.acordoOrigemId, valorNominal: nominal });
          continue;
        }
        const c = porContrato.get(pc.contratoId);
        if (!c?.ativoId) {
          composicao.push({ produto: 'reembolso', valorNominal: nominal });
          continue;
        }
        const servico = pc.itensFatura.filter((i) => i.tipo === 'SERVICO').reduce((s, i) => s + cent(i.valor), 0);
        const protecao = Math.min(Math.max(0, servico), nominal);
        composicao.push({ produto: 'veiculo', valorNominal: nominal - protecao });
        if (protecao > 0) composicao.push({ produto: 'seguro', valorNominal: protecao });
      }
      // Taxa de VP do futuro do plano: encargo mensal congelado no snapshot do
      // acordo; fallback: produto acordo_pagamento vigente no Catálogo.
      const snap = a.snapshotJson as null | { calculo?: { encargoMensal?: number } };
      let taxaAcordo = snap?.calculo?.encargoMensal ?? 0;
      if (taxaAcordo <= 0) {
        if (taxaAcordoCatalogo === undefined) {
          taxaAcordoCatalogo = (await this.catalogoFonte.acordoPagamento())?.encargoMensal ?? null;
        }
        taxaAcordo = taxaAcordoCatalogo ?? 0;
      }
      const abertas = (abertasPorAcordo.get(a.id) ?? []).map((p) => ({ ...p, taxaVpMensal: taxaAcordo }));
      acordos.push({
        acordoId: a.id,
        composicao,
        valorItens: a.itensGerados.reduce((s, i) => s + cent(i.valor), 0),
        parcelasAbertas: abertas,
      });
    }

    // --- 4. Motor puro (regra A7 — testado contra a planilha em @azit/utils).
    const resultado = decomporSaldoNovacao({ componentes, acordos });

    // Frequência herdada do contrato do veículo (mesma regra do acordo §7.7):
    // a novação mantém o ritmo das faturas por padrão; o operador pode trocar.
    const principal = contratos.find((c) => c.ativoId && c.status === 'ATIVO') ?? contratos[0];
    const frequenciaHerdada: FrequenciaNovacao =
      principal?.periodicidade === 'MENSAL' ? 'mensal' : principal?.periodicidade === 'QUINZENAL' ? 'quinzenal' : 'semanal';

    // Rótulo dos acordos para a memória em tela (o motor só conhece ids).
    const statusAcordo = new Map(acordosDb.map((a) => [a.id, a.status.toLowerCase()]));
    return {
      contaId,
      titularId: conta.titularId,
      titularNome: conta.titular.nome,
      dataBase: hoje.toISOString(),
      frequenciaHerdada,
      contratos: contratos.map((c) => ({
        id: c.id,
        numero: c.numero,
        descricao: c.ativo?.descricao ?? 'Reembolso Parcelado',
        temAtivo: !!c.ativoId,
        status: c.status,
        taxaVpMensal: taxas.get(c.id) ?? 0,
      })),
      ...resultado,
      memoria: {
        ...resultado.memoria,
        acordos: resultado.memoria.acordos.map((a) => ({ ...a, status: statusAcordo.get(a.acordoId) ?? null })),
      },
    };
  }

  // Simulação da proposta (A7 passos 3-4): decomposição (F1) + precificação
  // com os parâmetros do produto `novacao` no Catálogo (defaults do V1.0 em
  // Rascunho — Regra 12; a CONTRATAÇÃO na F2 exigirá o produto ATIVO).
  async simular(
    contaId: string,
    dto: {
      prazoMeses?: number; // preferencial — a frequência dita as parcelas
      numeroParcelasVeiculo?: number; // alternativa direta
      frequencia?: FrequenciaNovacao;
      desconto?: number; // centavos — só comitê
      recebimentoInicial?: number; // centavos
      trocaAtivoId?: string; // F3: troca de veículo (ativo disponível)
    },
  ) {
    const dec = await this.decomporConta(contaId);
    if (dec.parteVeiculo.total <= 0) {
      throw new UnprocessableEntityException({
        erro: 'sem_saldo_veiculo',
        mensagem: 'A conta não tem saldo de veículo a novar — a novação parte do contrato do veículo',
      });
    }
    const params = await this.catalogoFonte.novacao();
    const frequencia = dto.frequencia ?? dec.frequenciaHerdada;

    // Troca de veículo (F3 — A5, decisão Luís 13/09): o veículo novo deve
    // estar DISPONÍVEL no Estoque; o ajuste vem dos valores de CADASTRO
    // (valorVenda — referência FIPE do ativo): entra − sai. Nada informado
    // livremente pelo operador.
    let troca: null | {
      ativoEntraId: string; entraDescricao: string; entraValor: number;
      ativoSaiId: string; saiDescricao: string; saiValor: number; ajuste: number;
    } = null;
    if (dto.trocaAtivoId) {
      const atual = dec.contratos.find((c) => c.temAtivo && c.status === 'ATIVO') ?? dec.contratos.find((c) => c.temAtivo);
      const contratoAtual = atual
        ? await this.prisma.db.contratoCredito.findFirst({
            where: { id: atual.id },
            select: { ativo: { select: { id: true, descricao: true, valorVenda: true } } },
          })
        : null;
      if (!contratoAtual?.ativo) {
        throw new UnprocessableEntityException({ erro: 'sem_veiculo_atual', mensagem: 'A conta não tem veículo vigente para trocar' });
      }
      const novo = await this.prisma.db.ativo.findFirst({
        where: { id: dto.trocaAtivoId, deletedAt: null },
        select: { id: true, descricao: true, status: true, valorVenda: true },
      });
      if (!novo) throw new UnprocessableEntityException({ erro: 'ativo_invalido', mensagem: 'Veículo da troca não encontrado' });
      if (novo.status !== 'DISPONIVEL') {
        throw new UnprocessableEntityException({ erro: 'ativo_indisponivel', mensagem: `O veículo da troca precisa estar DISPONÍVEL no estoque (está ${novo.status})` });
      }
      const entraValor = novo.valorVenda ? Math.round(Number(novo.valorVenda.toString()) * 100) : 0;
      const saiValor = contratoAtual.ativo.valorVenda ? Math.round(Number(contratoAtual.ativo.valorVenda.toString()) * 100) : 0;
      if (entraValor <= 0 || saiValor <= 0) {
        throw new UnprocessableEntityException({
          erro: 'valor_cadastro_ausente',
          mensagem: 'A troca exige valor de cadastro (valor de venda/FIPE) preenchido nos DOIS veículos — complete o cadastro do ativo',
        });
      }
      troca = {
        ativoEntraId: novo.id, entraDescricao: novo.descricao, entraValor,
        ativoSaiId: contratoAtual.ativo.id, saiDescricao: contratoAtual.ativo.descricao, saiValor,
        ajuste: entraValor - saiValor,
      };
    }
    // Prazo em meses → parcelas pelo fator padrão do Catálogo (4,3452/2,1726).
    const numeroParcelas =
      dto.numeroParcelasVeiculo ??
      this.catalogoFonte.maxParcelasReembolso(dto.prazoMeses ?? 0, frequencia);
    if (numeroParcelas < 1) {
      throw new UnprocessableEntityException({
        erro: 'validacao',
        mensagem: 'Informe o prazo em meses do contrato do veículo',
      });
    }
    const r = precificarNovacao({
      saldoVeiculo: dec.parteVeiculo.total,
      saldoDemais: dec.demaisProdutos.total,
      ajusteTrocaVeiculo: troca?.ajuste ?? 0,
      desconto: dto.desconto ?? 0,
      recebimentoInicial: dto.recebimentoInicial ?? 0,
      numeroParcelasVeiculo: numeroParcelas,
      frequencia,
      taxaMensal: params.taxaMensal,
      taxaInicialPct: params.taxaInicialPct,
      taxaInicialMinima: params.taxaInicialMinima,
      entradaMinimaPct: params.entradaMinimaPct,
      prazoMaximoMeses: params.prazoMaximoMeses,
    });
    const excecoes = [...r.excecoes];
    if (!params.ativo) {
      excecoes.push('produto Novação ainda não está ATIVO no Catálogo — simulação com os parâmetros padrão (a contratação exigirá ativação)');
    }
    return {
      contaId,
      titularId: dec.titularId,
      titularNome: dec.titularNome,
      dataBase: dec.dataBase,
      frequencia,
      prazoMeses: dto.prazoMeses ?? null,
      numeroParcelasVeiculo: numeroParcelas,
      troca,
      produtoAtivo: params.ativo,
      versaoParametros: params.versao,
      decomposicao: {
        parteVeiculo: dec.parteVeiculo,
        demaisProdutos: dec.demaisProdutos,
        totalGeral: dec.totalGeral,
      },
      ...r,
      excecoes,
    };
  }
}
