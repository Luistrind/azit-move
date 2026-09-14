import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// Bootstrap do Catálogo (14/09): produtos ESTRUTURAIS do domínio nascem com o
// sistema — a tela do Catálogo gerencia versões/variantes/ciclo de vida, mas
// não cria produto (criação nasceu via API e o produto `novacao` não existia
// em produção). Idempotente: cria SÓ se a chave não existir, sempre em
// RASCUNHO com a versão 1 de parâmetros padrão — ativar continua sendo ato
// humano pela tela (chave de virada dos produtos).
@Injectable()
export class CatalogoBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(CatalogoBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.garantirNovacao();
  }

  private async garantirNovacao() {
    const existente = await this.prisma.db.produtoCatalogo.findFirst({
      where: { chave: 'novacao' },
      include: { versoes: { where: { varianteId: null } } },
    });
    if (existente && existente.versoes.length > 0) return;

    const produto =
      existente ??
      (await this.prisma.db.produtoCatalogo.create({
        data: {
          chave: 'novacao',
          nome: 'Novação de Contrato',
          classificacao: 'Principal',
          finalidade:
            'Reorganização radical da dívida: extingue as obrigações de origem e gera dois contratos novos assinados juntos (veículo + Termo de Regularização de Débitos)',
          descricao:
            'Doc Produto Novação V1.0 (Vicente 26/08) + adaptações Azit 13/09 (docs/novacao-adaptacoes-azit-2026-09.md)',
          status: 'RASCUNHO',
        },
      }));

    if (!existente || existente.versoes.length === 0) {
      await this.prisma.db.versaoProduto.create({
        data: {
          produtoId: produto.id,
          numero: 1,
          parametros: {
            taxaFinanceiraMensal: 0.017, // NV010 — 1,70% a.m. (fração)
            taxaInicialProcessamento: 0.02, // 2% do saldo-base
            taxaMinimaProcessamento: 399000, // R$ 3.990,00 (centavos)
            percentualEntradaMinima: 0.01, // 1% do saldo novado (mín. c/ recebimento)
            prazoMaximoMeses: 60,
            prazoAtivacaoDias: 5, // assinatura → ativação
          },
          observacao: 'Versão 1 (bootstrap) — parâmetros do V1.0 com adaptações Azit 13/09',
        },
      });
    }
    this.logger.log('Catálogo: produto novacao garantido (Rascunho, versão 1)');
  }
}
