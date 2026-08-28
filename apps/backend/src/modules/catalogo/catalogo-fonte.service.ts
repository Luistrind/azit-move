import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// F2 — o Catálogo como FONTE do simulador (doc 02 §17). A chave de virada é o
// ciclo de vida: só quando o produto compra_parcelada E a variante estão ATIVOS
// este serviço devolve parâmetros; caso contrário devolve null e o simulador
// segue no motor legado (VersaoParametrosSimulacao). Dinheiro em CENTAVOS.

// Fatores do Catálogo (decisão 02/08: "seguir o documento"):
// índice de conversão de VALOR (parcela exibida) e de PRAZO (nº de parcelas).
export const FATORES_CATALOGO = {
  precificacaoSemanal: 4,
  precificacaoQuinzenal: 2,
  contratoSemanal: 4.3452,
  contratoQuinzenal: 2.1726,
} as const;

export interface OfertaPadraoCatalogo {
  valorEntrada: number; // centavos
  prazoMeses: number;
  frequencia: 'MENSAL' | 'QUINZENAL' | 'SEMANAL';
}

export interface ParametrosCatalogoCompraParcelada {
  produtoId: string;
  varianteId: string;
  varianteChave: string;
  versaoProduto: number | null;
  versaoVariante: number | null;
  entradaMinima: number;
  prazoMinMeses: number;
  prazoMaxMeses: number;
  taxaMensal: number; // fração a.m.
  comissaoInicial: number;
  comissaoRecorrenteMensal: number;
  protecaoObrigatoria: boolean;
  // Homologação 04/08: a proteção vem CALCULADA do produto PV (Essencial) via
  // protecaoEssencialSemanalExata(), ou congelada na ref do contrato (protS).
  // O valor abaixo (derivado do protecaoMensal chumbado na versão) é só
  // FALLBACK para versões antigas/refs congeladas sem protS.
  protecaoSemanal: number;
  protecaoSemanalExata: number; // SEM arredondar — p/ arredondamento único da parcela
  // Antecipação por componente (F4): taxas de desconto e isenções na liquidação.
  taxaDescontoBem: number;
  taxaDescontoComissao: number;
  taxaDescontoProtecao: number;
  isencaoComissaoLiquidacao: boolean;
  isencaoProtecaoLiquidacao: boolean;
  ofertasPadrao: OfertaPadraoCatalogo[];
}

export interface ParametrosCatalogoReembolso {
  versao: number;
  valorMinimo: number; // centavos
  valorMaximo: number; // centavos
  prazoMaximoMeses: number;
  valorMinimoParcela: number; // centavos
  encargoMensal: number; // fração a.m.
  taxaInicialPct: number; // fração
  taxaInicialMinima: number; // centavos
  limiteParcelaAcessoria: number; // fração da parcela do contrato principal
  ofertasPadrao: { valor: number; parcelas: number; frequencia: string }[];
}

type Parametros = Record<string, string | number | boolean>;

const num = (v: unknown, padrao = 0): number => (typeof v === 'number' ? v : padrao);
const bool = (v: unknown): boolean => v === true;

@Injectable()
export class CatalogoFonteService {
  constructor(private readonly prisma: PrismaService) {}

  // Parâmetros efetivos da Compra Parcelada para uma variante (carro/moto/outro),
  // ou null se o catálogo ainda não está ativo para ela.
  async compraParcelada(varianteChave: string): Promise<ParametrosCatalogoCompraParcelada | null> {
    const produto = await this.prisma.db.produtoCatalogo.findFirst({
      where: { chave: 'compra_parcelada', deletedAt: null },
      include: { variantes: { where: { deletedAt: null } }, versoes: true },
    });
    if (!produto || produto.status !== 'ATIVO') return null;
    const variante = produto.variantes.find((v) => v.chave === varianteChave);
    if (!variante || variante.status !== 'ATIVO') return null;

    const vigente = <T extends { vigenteAte: Date | null; numero: number }>(xs: T[]) =>
      xs.filter((x) => !x.vigenteAte).sort((a, b) => b.numero - a.numero)[0] ?? null;
    const vProduto = vigente(produto.versoes.filter((x) => !x.varianteId));
    const vVariante = vigente(produto.versoes.filter((x) => x.varianteId === variante.id));
    return this.montarCompraParcelada(produto.id, variante.id, varianteChave, vProduto, vVariante);
  }

  // Monta os parâmetros efetivos (herança produto + variante) — usado tanto pela
  // leitura vigente (F2) quanto pela referência congelada do contrato (F4).
  private montarCompraParcelada(
    produtoId: string,
    varianteId: string,
    varianteChave: string,
    vProduto: { numero: number; parametros: unknown } | null,
    vVariante: { numero: number; parametros: unknown } | null,
  ): ParametrosCatalogoCompraParcelada {
    const p: Parametros = {
      ...((vProduto?.parametros as Parametros) ?? {}),
      ...((vVariante?.parametros as Parametros) ?? {}),
    };

    const protecaoObrigatoria = bool(p.protecaoObrigatoria);
    const protecaoMensal = num(p.protecaoMensal);
    const ofertasPadrao: OfertaPadraoCatalogo[] = [];
    for (const n of [1, 2, 3]) {
      // Feedback 28/08: oferta padrão pode ser DESATIVADA na versão do produto
      // (flag ofertaNDesativada) — some do atendimento/simulação sem apagar o
      // histórico das versões anteriores.
      if (bool(p[`oferta${n}Desativada`])) continue;
      const prazo = num(p[`oferta${n}PrazoMeses`]);
      const entrada = num(p[`oferta${n}Entrada`]);
      const freq = String(p[`oferta${n}Frequencia`] ?? '').toUpperCase();
      if (prazo > 0 && ['MENSAL', 'QUINZENAL', 'SEMANAL'].includes(freq)) {
        ofertasPadrao.push({ valorEntrada: entrada, prazoMeses: prazo, frequencia: freq as OfertaPadraoCatalogo['frequencia'] });
      }
    }

    return {
      produtoId,
      varianteId,
      varianteChave,
      versaoProduto: vProduto?.numero ?? null,
      versaoVariante: vVariante?.numero ?? null,
      entradaMinima: num(p.entradaMinima),
      prazoMinMeses: num(p.prazoMinimoMeses, 1),
      prazoMaxMeses: num(p.prazoMaximoMeses, 60),
      taxaMensal: num(p.taxaRemuneracaoMensal),
      comissaoInicial: num(p.comissaoInicial),
      comissaoRecorrenteMensal: num(p.comissaoRecorrenteMensal),
      protecaoObrigatoria,
      protecaoSemanal: protecaoObrigatoria ? Math.round(protecaoMensal / FATORES_CATALOGO.precificacaoSemanal) : 0,
      protecaoSemanalExata: protecaoObrigatoria ? protecaoMensal / FATORES_CATALOGO.precificacaoSemanal : 0,
      taxaDescontoBem: num(p.taxaDescontoBemAntecipacao),
      taxaDescontoComissao: num(p.taxaDescontoComissaoAntecipacao),
      taxaDescontoProtecao: num(p.taxaDescontoProtecaoAntecipacao),
      isencaoComissaoLiquidacao: bool(p.isencaoComissaoLiquidacao),
      isencaoProtecaoLiquidacao: bool(p.isencaoProtecaoLiquidacao),
      ofertasPadrao,
    };
  }


  // F4: parâmetros CONGELADOS pela referência gravada no contrato na contratação
  // ({variante, vp, vv}). Ignora ciclo de vida e vigência — snapshot é snapshot.
  async compraParceladaPorRef(ref: string): Promise<ParametrosCatalogoCompraParcelada | null> {
    // protS = proteção semanal exata (centavos) CONGELADA na formalização — a
    // partir de 04/08 a proteção é calculada do produto PV e congelada aqui.
    let parsed: { variante?: string; vp?: number | null; vv?: number | null; protS?: number };
    try {
      parsed = JSON.parse(ref) as { variante?: string; vp?: number | null; vv?: number | null; protS?: number };
    } catch {
      return null;
    }
    if (!parsed.variante) return null;
    const produto = await this.prisma.db.produtoCatalogo.findFirst({
      where: { chave: 'compra_parcelada', deletedAt: null },
      include: { variantes: true, versoes: true },
    });
    if (!produto) return null;
    const variante = produto.variantes.find((v) => v.chave === parsed.variante);
    if (!variante) return null;
    const vProduto = produto.versoes.find((x) => !x.varianteId && x.numero === (parsed.vp ?? -1)) ?? null;
    const vVariante = produto.versoes.find((x) => x.varianteId === variante.id && x.numero === (parsed.vv ?? -1)) ?? null;
    if (!vProduto && !vVariante) return null;
    const params = this.montarCompraParcelada(produto.id, variante.id, parsed.variante, vProduto, vVariante);
    if (typeof parsed.protS === 'number' && parsed.protS >= 0) {
      params.protecaoSemanalExata = parsed.protS;
      params.protecaoSemanal = Math.round(parsed.protS);
    }
    return params;
  }

  // Parâmetros do Acordo de Pagamento (doc 02 §7.7, 2026-08-18), ou null se o
  // produto não está ATIVO — a CHAVE DE VIRADA do motor financeiro do acordo:
  // em RASCUNHO vale o placeholder (divisão simples); ATIVO liga TP/TR/Price.
  async acordoPagamento(): Promise<null | {
    versao: number;
    diasMinimosAtraso: number;
    maxAcordosAtivos: number;
    entradaMinimaPct: number;
    prazoMaximoPadraoMeses: number;
    valorMinimoParcela: number;
    taxaInicialPct: number;
    encargoMensal: number;
    prazoAtivacaoDias: number;
  }> {
    const produto = await this.prisma.db.produtoCatalogo.findFirst({
      where: { chave: 'acordo_pagamento', deletedAt: null },
      include: { versoes: true },
    });
    if (!produto || produto.status !== 'ATIVO') return null;
    const vigente = produto.versoes
      .filter((x) => !x.varianteId && !x.vigenteAte)
      .sort((a, b) => b.numero - a.numero)[0];
    if (!vigente) return null;
    const p = vigente.parametros as Parametros;
    return {
      versao: vigente.numero,
      diasMinimosAtraso: num(p.diasMinimosAtrasoElegibilidade, 15),
      maxAcordosAtivos: num(p.maxAcordosAtivosSimultaneos, 2),
      entradaMinimaPct: num(p.percentualEntradaMinima, 0.3),
      prazoMaximoPadraoMeses: num(p.prazoMaximoPadraoMeses, 6),
      valorMinimoParcela: num(p.valorMinimoParcela, 5000),
      taxaInicialPct: num(p.taxaInicialProcessamento, 0.0999),
      encargoMensal: num(p.encargoMensalProcessamento, 0.0499),
      prazoAtivacaoDias: num(p.prazoAtivacaoDias, 5),
    };
  }

  // Parâmetros do Reembolso Parcelado (F3), ou null se o produto não está ATIVO.
  async reembolsoParcelado(): Promise<ParametrosCatalogoReembolso | null> {
    const produto = await this.prisma.db.produtoCatalogo.findFirst({
      where: { chave: 'reembolso_parcelado', deletedAt: null },
      include: { versoes: true },
    });
    if (!produto || produto.status !== 'ATIVO') return null;
    const vigente = produto.versoes
      .filter((x) => !x.varianteId && !x.vigenteAte)
      .sort((a, b) => b.numero - a.numero)[0];
    if (!vigente) return null;
    const p = vigente.parametros as Parametros;
    const ofertasPadrao: { valor: number; parcelas: number; frequencia: string }[] = [];
    for (const n of [1, 2, 3]) {
      if (bool(p[`oferta${n}Desativada`])) continue; // feedback 28/08
      const valor = num(p[`oferta${n}Valor`]);
      const parcelas = num(p[`oferta${n}Parcelas`]);
      if (valor > 0 && parcelas > 0) {
        ofertasPadrao.push({ valor, parcelas, frequencia: String(p[`oferta${n}Frequencia`] ?? 'semanal') });
      }
    }
    return {
      versao: vigente.numero,
      valorMinimo: num(p.valorMinimoOperacao),
      valorMaximo: num(p.valorMaximoOperacao),
      prazoMaximoMeses: num(p.prazoMaximoMeses, 12),
      valorMinimoParcela: num(p.valorMinimoParcela),
      encargoMensal: num(p.encargoMensalProcessamento),
      taxaInicialPct: num(p.taxaInicialProcessamento),
      taxaInicialMinima: num(p.taxaMinimaProcessamento),
      limiteParcelaAcessoria: num(p.limiteParcelaAcessoria, 0.3),
      ofertasPadrao,
    };
  }


  // Proteção Veicular (F5): parâmetros efetivos por variante/oferta. Devolve
  // mesmo em RASCUNHO (para SIMULAÇÃO interna); a comercialização exige ATIVO —
  // quem chama decide pelo campo status. Valores em homologação (pergunta 2).
  async protecaoVeicular(): Promise<{
    status: string;
    versao: number | null;
    parametros: Parametros;
    variantes: { chave: string; nome: string; parametros: Parametros }[];
  } | null> {
    const produto = await this.prisma.db.produtoCatalogo.findFirst({
      where: { chave: 'protecao_veicular', deletedAt: null },
      include: { variantes: { where: { deletedAt: null }, orderBy: { ordem: 'asc' } }, versoes: true },
    });
    if (!produto) return null;
    const vigente = <T extends { vigenteAte: Date | null; numero: number }>(xs: T[]) =>
      xs.filter((x) => !x.vigenteAte).sort((a, b) => b.numero - a.numero)[0] ?? null;
    const vProduto = vigente(produto.versoes.filter((x) => !x.varianteId));
    return {
      status: produto.status,
      versao: vProduto?.numero ?? null,
      parametros: (vProduto?.parametros as Parametros) ?? {},
      variantes: produto.variantes.map((v) => ({
        chave: v.chave,
        nome: v.nome,
        parametros: (vigente(produto.versoes.filter((x) => x.varianteId === v.id))?.parametros as Parametros) ?? {},
      })),
    };
  }

  // Máximo de parcelas por frequência = prazo máximo × índice de conversão de
  // prazo do Catálogo (12 meses → 12 / 26 / 52).
  maxParcelasReembolso(prazoMaximoMeses: number, frequencia: 'mensal' | 'quinzenal' | 'semanal'): number {
    const icpf = frequencia === 'mensal' ? 1 : frequencia === 'quinzenal' ? FATORES_CATALOGO.contratoQuinzenal : FATORES_CATALOGO.contratoSemanal;
    return Math.round(prazoMaximoMeses * icpf);
  }

  // Fator de PRAZO (nº de períodos por mês) — converte fluxo por período em
  // mensal equivalente (mesmo padrão do comprometimento na análise de cadastro).
  fatorPrazo(frequencia: 'mensal' | 'quinzenal' | 'semanal'): number {
    return frequencia === 'mensal' ? 1 : frequencia === 'quinzenal' ? FATORES_CATALOGO.contratoQuinzenal : FATORES_CATALOGO.contratoSemanal;
  }

  // Proteção por período conforme a frequência do contrato (homologação 04/08):
  // 4/2 são fatores de VALOR (mensal = semanal × 4; quinzenal = semanal × 2) —
  // 4,3452/2,1726 são fatores de PRAZO e não se aplicam aqui. A planilha calcula
  // o mês primeiro e deriva a semana ÷ 4. (Reverte a decisão de 02/08.)
  protecaoPorPeriodo(protecaoSemanal: number, frequencia: 'mensal' | 'quinzenal' | 'semanal'): number {
    return Math.round(this.protecaoPorPeriodoExata(protecaoSemanal, frequencia));
  }

  // Versão SEM arredondar (fração de centavo) — a parcela final arredonda UMA vez,
  // como a planilha (ROUND na soma dos componentes).
  protecaoPorPeriodoExata(protecaoSemanal: number, frequencia: 'mensal' | 'quinzenal' | 'semanal'): number {
    if (protecaoSemanal <= 0) return 0;
    if (frequencia === 'semanal') return protecaoSemanal;
    if (frequencia === 'quinzenal') return protecaoSemanal * FATORES_CATALOGO.precificacaoQuinzenal;
    return protecaoSemanal * FATORES_CATALOGO.precificacaoSemanal;
  }

  // Homologação 04/08: a proteção embutida na CP é sempre CALCULADA do produto
  // Proteção Veicular (oferta Essencial, variante pela categoria do ativo) — o
  // parâmetro chumbado protecaoMensal da CP morreu (era herança da planilha).
  // Base = valor à vista do ativo como PROXY da FIPE (placeholder Regra 12, até
  // existir campo FIPE no cadastro). Retorna a contribuição SEMANAL exata (mensal
  // ÷ 4, fator de valor) em centavos, ou null se o produto PV não existir.
  async protecaoEssencialSemanalExata(varianteCP: string, baseCentavos: number): Promise<number | null> {
    const p = await this.protecaoPlano(varianteCP, baseCentavos, 'essencial');
    return p?.semanalExata ?? null;
  }

  // Contribuição de um PLANO da PV (essencial | protecao | completa) para a
  // variante do ativo — base do upsell (doc 02 §20 passo 8). Retorna a semanal
  // EXATA (mensal ÷ 4, fator de valor) + a cobertura qualitativa do plano.
  async protecaoPlano(
    varianteCP: string,
    baseCentavos: number,
    plano: 'essencial' | 'protecao' | 'completa',
  ): Promise<{ semanalExata: number; mensal: number; cobertura: string | null } | null> {
    if (baseCentavos <= 0) return null;
    const pv = await this.protecaoVeicular();
    if (!pv) return null;
    const mapa: Record<string, string> = { carro: 'leves', moto: 'duas_rodas', outro: 'utilitarios' };
    const chavePv = mapa[varianteCP] ?? 'leves';
    const variante =
      pv.variantes.find((v) => v.chave === chavePv) ??
      pv.variantes.find((v) => v.chave.startsWith(chavePv.slice(0, 4))) ??
      pv.variantes[0];
    if (!variante) return null;
    const prefixo = plano === 'essencial' ? 'ofertaEssencial' : plano === 'protecao' ? 'ofertaProtecao' : 'ofertaCompleta';
    const baseFipe = Math.round(baseCentavos * num(pv.parametros[`${prefixo}TaxaFipe`]));
    const mensal =
      Math.max(num(variante.parametros.contribuicaoMinimaMensal), baseFipe) +
      num(pv.parametros.taxaAdministracaoMensal) +
      num(pv.parametros[`${prefixo}Assistencia`]);
    const cobertura = pv.parametros[`${prefixo}Cobertura`];
    return {
      semanalExata: mensal / FATORES_CATALOGO.precificacaoSemanal,
      mensal,
      cobertura: typeof cobertura === 'string' ? cobertura : null,
    };
  }
}
