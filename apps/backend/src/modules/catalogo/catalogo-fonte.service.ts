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
  // RF-CP12 (decisão 02/08): preço de referência da proteção é SEMANAL.
  // Enquanto a Proteção Veicular não é homologada, deriva da base mensal da
  // planilha: semanal = mensal ÷ 4 (índice de conversão de valor).
  protecaoSemanal: number;
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
    const p: Parametros = {
      ...((vProduto?.parametros as Parametros) ?? {}),
      ...((vVariante?.parametros as Parametros) ?? {}),
    };

    const protecaoObrigatoria = bool(p.protecaoObrigatoria);
    const protecaoMensal = num(p.protecaoMensal);
    const ofertasPadrao: OfertaPadraoCatalogo[] = [];
    for (const n of [1, 2, 3]) {
      const prazo = num(p[`oferta${n}PrazoMeses`]);
      const entrada = num(p[`oferta${n}Entrada`]);
      const freq = String(p[`oferta${n}Frequencia`] ?? '').toUpperCase();
      if (prazo > 0 && ['MENSAL', 'QUINZENAL', 'SEMANAL'].includes(freq)) {
        ofertasPadrao.push({ valorEntrada: entrada, prazoMeses: prazo, frequencia: freq as OfertaPadraoCatalogo['frequencia'] });
      }
    }

    return {
      produtoId: produto.id,
      varianteId: variante.id,
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
      ofertasPadrao,
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

  // Máximo de parcelas por frequência = prazo máximo × índice de conversão de
  // prazo do Catálogo (12 meses → 12 / 26 / 52).
  maxParcelasReembolso(prazoMaximoMeses: number, frequencia: 'mensal' | 'quinzenal' | 'semanal'): number {
    const icpf = frequencia === 'mensal' ? 1 : frequencia === 'quinzenal' ? FATORES_CATALOGO.contratoQuinzenal : FATORES_CATALOGO.contratoSemanal;
    return Math.round(prazoMaximoMeses * icpf);
  }

  // Proteção por período conforme a frequência do contrato (RF-CP12):
  // semanal = base; quinzenal = ×2; mensal = × fator semana→mês (4,3452); os
  // fatores quinzenal/diária aguardam confirmação (pergunta 10 da v0.3).
  protecaoPorPeriodo(protecaoSemanal: number, frequencia: 'mensal' | 'quinzenal' | 'semanal'): number {
    if (protecaoSemanal <= 0) return 0;
    if (frequencia === 'semanal') return protecaoSemanal;
    if (frequencia === 'quinzenal') return Math.round(protecaoSemanal * 2);
    return Math.round(protecaoSemanal * FATORES_CATALOGO.contratoSemanal);
  }
}
