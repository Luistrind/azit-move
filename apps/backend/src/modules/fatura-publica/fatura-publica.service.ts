import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { FaturaPublica, ItemFaturaPublica, PixFaturaPublica, SituacaoFaturaPublica, SituacaoFaturaPublicaResumo } from '@azit/types';
import {
  chaveProdutoItemFatura,
  dataCalendarioUTC,
  dataHojeBrasil,
  detalharEncargoAtraso,
  diasAtrasoCalendario,
  faturaQuitada,
  mascararDocumento,
  primeiroNome,
  situacaoFaturaRuntime,
  type TipoContrato,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasLeituraService } from '../asaas/asaas-leitura.service';
import { tiposDosContratos } from '../contrato/tipo-contrato';
import { TOKEN_FATURA_RE } from '../cobranca/fatura-link';
import { comNavegador, htmlParaPdf } from '../dossie/pdf';
import { payloadPixSimulado, valorDoPayloadPix } from '../asaas/pix';
import { htmlFaturaPdf } from './fatura-publica-pdf';

const cent = (d: Prisma.Decimal | null | undefined): number => (d ? Math.round(Number(d.toString()) * 100) : 0);

// Projeção da fatura como o CLIENTE vê (doc 02 §32.2/§32.3). Monta a cada
// abertura a partir do banco (Regra 7: nada gravado); encargo pelo dia de hoje
// no fuso do Brasil (Regra 15); itens classificados pela MESMA função da
// carteira (chaveProdutoItemFatura, Regra 16). Dados pessoais: só primeiro
// nome, placa e documento mascarado (decisão 11/11).
@Injectable()
export class FaturaPublicaService {
  private readonly logger = new Logger(FaturaPublicaService.name);
  // PIX da cobrança: o Asaas limita chamadas por minuto e a página consulta a
  // situação a cada ~30 s — o QR não muda nesse intervalo, então fica em cache
  // curto por cobrança.
  private readonly cachePix = new Map<string, { em: number; pix: PixFaturaPublica }>();
  private static readonly CACHE_PIX_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasLeitura: AsaasLeituraService,
    private readonly config: ConfigService,
  ) {}

  async porToken(token: string): Promise<FaturaPublica> {
    const f = await this.carregar(token);
    return this.projetar(f, true);
  }

  // Consulta leve para a página aberta (polling): só o que muda com o pagamento.
  async situacao(token: string): Promise<SituacaoFaturaPublicaResumo> {
    const f = await this.carregar(token);
    const p = await this.projetar(f, false);
    return { situacao: p.situacao, pagaParcialmente: p.pagaParcialmente, valorPago: p.valorPago, totalHoje: p.totalHoje, dataPagamento: p.dataPagamento };
  }

  async pdf(token: string): Promise<{ pdf: Buffer; nomeArquivo: string }> {
    const f = await this.carregar(token);
    const p = await this.projetar(f, true);
    const html = htmlFaturaPdf(p);
    const pdf = await comNavegador((b) => htmlParaPdf(b, html));
    const nome = p.situacao === 'paga' ? `comprovante-fatura-${p.numero}.pdf` : `fatura-azit-${p.numero}.pdf`;
    return { pdf, nomeArquivo: nome };
  }

  // ---------------------------------------------------------------

  private async carregar(token: string) {
    if (!TOKEN_FATURA_RE.test(token)) throw new NotFoundException({ erro: 'fatura_indisponivel', mensagem: 'Fatura indisponível' });
    const f = await this.prisma.db.fatura.findFirst({
      where: { tokenPublico: token, deletedAt: null },
      include: {
        conta: { include: { titular: { select: { nome: true, cpfCnpj: true } } } },
        itensFatura: {
          orderBy: { createdAt: 'asc' },
          include: {
            parcela: {
              include: {
                itemContratado: {
                  include: {
                    contrato: {
                      select: {
                        id: true,
                        numero: true,
                        snapshotJson: true,
                        ativo: { select: { tipo: true, descricao: true, marca: true, modelo: true, placa: true } },
                        novacaoComoTermo: { select: { id: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        parcelas: { include: { contrato: { select: { taxaMultaAtraso: true, taxaJurosAtraso: true } } } },
      },
    });
    if (!f) throw new NotFoundException({ erro: 'fatura_indisponivel', mensagem: 'Fatura indisponível' });
    // Fatura extinta (novação/rescisão) não é cobrança do cliente: a página
    // responde indisponível em vez de mostrar valores que não valem mais.
    if (f.status === 'NOVADA' || f.status === 'RESCINDIDA' || f.status === 'RENEGOCIADA') {
      throw new NotFoundException({ erro: 'fatura_indisponivel', mensagem: 'Fatura indisponível' });
    }
    return f;
  }

  private async projetar(f: Awaited<ReturnType<FaturaPublicaService['carregar']>>, comPix: boolean): Promise<FaturaPublica> {
    const hoje = dataHojeBrasil();
    const vencimento = dataCalendarioUTC(f.dataVencimento);
    const quitada = faturaQuitada(f.status);
    const situacaoBase = situacaoFaturaRuntime(f.status, vencimento, hoje);
    const situacao: SituacaoFaturaPublica = quitada
      ? 'paga'
      : situacaoBase === 'vencida'
        ? 'vencida'
        : situacaoBase === 'vence_hoje'
          ? 'vence_hoje'
          : situacaoBase === 'em_aberto'
            ? 'em_aberto'
            : 'indisponivel';

    const valorNominal = cent(f.valorTotal);
    const valorPago = cent(f.valorPago);
    const saldoNominal = quitada ? 0 : Math.max(0, valorNominal - valorPago);
    const pagaParcialmente = !quitada && valorPago > 0;

    // Tipo de cada contrato envolvido (uma classificação por contrato — como a carteira).
    const contratos = new Map<string, NonNullable<(typeof f.itensFatura)[number]['parcela']>['itemContratado']['contrato']>();
    for (const it of f.itensFatura) {
      const c = it.parcela?.itemContratado.contrato;
      if (c && !contratos.has(c.id)) contratos.set(c.id, c);
    }
    const tipos: Map<string, TipoContrato> = await tiposDosContratos(this.prisma.db, [...contratos.values()]);

    const primeiroAtivo = [...contratos.values()].find((c) => c.ativo)?.ativo ?? null;
    const veiculo = primeiroAtivo
      ? { descricao: [primeiroAtivo.marca, primeiroAtivo.modelo].filter(Boolean).join(' ').trim() || primeiroAtivo.descricao, placa: primeiroAtivo.placa ?? null }
      : null;

    const itens: ItemFaturaPublica[] = f.itensFatura.map((it) => {
      const contrato = it.parcela?.itemContratado.contrato ?? null;
      const tipoContrato = contrato ? (tipos.get(contrato.id) ?? null) : null;
      const chave = chaveProdutoItemFatura({
        tipo: it.tipo,
        descricao: it.descricao,
        valor: cent(it.valor),
        origemItem: it.parcela?.itemContratado.origem ?? null,
        tipoContrato,
      });
      const ativo = contrato?.ativo ?? null;
      const nomeVeiculo = ativo ? [ativo.marca, ativo.modelo].filter(Boolean).join(' ').trim() || ativo.descricao : null;
      const parcelaDe = it.parcela ? `Parcela ${it.parcela.numero} de ${it.parcela.totalParcelas}` : null;
      const objeto = it.parcela?.itemContratado.descricao ?? it.descricao;
      let titulo = chave.rotulo;
      let subtitulo: string | null = parcelaDe;
      if (chave.chave === 'encargos') {
        titulo = 'Encargos de atraso';
        subtitulo = it.descricao;
      } else if (chave.parte === 'acordo') {
        titulo = 'Acordo de pagamento';
        subtitulo = parcelaDe ?? it.descricao;
      } else if (chave.parte === 'intermediaria') {
        titulo = nomeVeiculo ? `${chave.rotulo} — ${nomeVeiculo}` : chave.rotulo;
        subtitulo = 'Entrada — parcela intermediária';
      } else if (chave.parte === 'entrada_contrato' || chave.parte === 'entrada_acordo') {
        titulo = nomeVeiculo ? `${chave.rotulo} — ${nomeVeiculo}` : chave.rotulo;
        subtitulo = 'Entrada';
      } else if (chave.parte === 'avulso') {
        // Serviço/lançamento avulso dentro do produto do contrato: a descrição é o que explica.
        titulo = it.descricao;
        subtitulo = chave.rotulo;
      } else if (chave.chave === 'compra_parcelada') {
        titulo = nomeVeiculo ? `Compra Parcelada — ${nomeVeiculo}` : 'Compra Parcelada';
      } else if (chave.chave === 'reembolso_parcelado' || chave.chave === 'credito_avulso' || chave.chave === 'termo_novacao') {
        titulo = `${chave.rotulo} — ${objeto}`;
      } else if (chave.chave === 'protecao_veicular') {
        titulo = 'Proteção veicular';
        subtitulo = nomeVeiculo ? `Serviço do período · ${nomeVeiculo}` : 'Serviço do período';
      } else {
        // Outros serviços do Catálogo (taxa, clube): nome do produto; descrição como apoio.
        subtitulo = it.descricao !== chave.rotulo ? it.descricao : null;
      }
      return { titulo, subtitulo, produto: chave.chave, valor: cent(it.valor) };
    });

    // Encargo de hoje (doc 02 §7.2, uma função) sobre as parcelas da fatura; fatura
    // sem parcelas (legado) usa o próprio total e as taxas padrão.
    let multa = 0;
    let atualizacao = 0;
    let diasAtraso = 0;
    if (!quitada) {
      const agora = new Date();
      if (f.parcelas.length > 0) {
        for (const p of f.parcelas) {
          const dias = diasAtrasoCalendario(p.dataVencimento, agora);
          if (dias <= 0) continue;
          diasAtraso = Math.max(diasAtraso, dias);
          const e = detalharEncargoAtraso(cent(p.valorNominal), dias, Number(p.contrato.taxaMultaAtraso.toString()), Number(p.contrato.taxaJurosAtraso.toString()));
          multa += e.multa;
          atualizacao += e.atualizacao;
        }
      } else {
        diasAtraso = diasAtrasoCalendario(f.dataVencimento, agora);
        const e = detalharEncargoAtraso(saldoNominal, diasAtraso);
        multa = e.multa;
        atualizacao = e.atualizacao;
      }
      multa = Math.round(multa);
      atualizacao = Math.round(atualizacao);
    }

    // PIX da cobrança (modelo ASAAS_NATIVO, F1): o total da página é o que o PIX
    // cobra hoje (decisão 11/11); a conta nossa só compõe as linhas e cobre a
    // diferença na linha de atualização, para a soma bater com a cobrança.
    let pix: PixFaturaPublica | null = null;
    let fonte: 'cobranca' | 'calculo' = 'calculo';
    let totalHoje = saldoNominal + multa + atualizacao;
    if (!quitada && f.asaasChargeId && comPix) {
      pix = await this.pixDaCobranca(f.asaasChargeId, f.id, totalHoje);
    }
    if (!quitada && f.asaasChargeId && f.modeloEncargo === 'ASAAS_NATIVO') {
      const valorCobranca = pix?.valor ?? (await this.valorCobrancaEmCache(f.asaasChargeId));
      if (valorCobranca !== null && valorCobranca > 0) {
        fonte = 'cobranca';
        totalHoje = valorCobranca;
        const encargoCobranca = Math.max(0, valorCobranca - saldoNominal);
        if (encargoCobranca === 0) {
          multa = 0;
          atualizacao = 0;
        } else {
          multa = Math.min(multa, encargoCobranca);
          atualizacao = encargoCobranca - multa;
        }
      }
    }

    const pagamentos = quitada || valorPago > 0 ? [{ data: dataCalendarioUTC(f.dataPagamento ?? f.updatedAt), valor: quitada ? Math.max(valorPago, valorNominal) : valorPago }] : [];

    return {
      numero: f.numero,
      situacao,
      pagaParcialmente,
      titular: { primeiroNome: primeiroNome(f.conta.titular.nome), documentoMascarado: mascararDocumento(f.conta.titular.cpfCnpj) },
      veiculo,
      contratos: [...contratos.values()].map((c) => c.numero),
      vencimento,
      dataPagamento: f.dataPagamento ? dataCalendarioUTC(f.dataPagamento) : null,
      itens,
      encargo: !quitada && diasAtraso > 0 ? { multa, atualizacao, diasAtraso, fonte } : null,
      valorNominal,
      valorPago,
      saldoNominal,
      totalHoje: quitada ? 0 : totalHoje,
      pagamentos,
      pix,
      atendimentoWhatsapp: this.config.get<string>('atendimentoWhatsapp') || null,
      geradoEm: new Date().toISOString(),
    };
  }

  private async valorCobrancaEmCache(chargeId: string): Promise<number | null> {
    const c = this.cachePix.get(chargeId);
    return c && Date.now() - c.em < FaturaPublicaService.CACHE_PIX_MS ? c.pix.valor : null;
  }

  // QR/copia-e-cola da cobrança no Asaas (GET /payments/{id}/pixQrCode). Em
  // ambiente simulado (ou cobrança simulada) devolve um payload de teste com o
  // valor calculado, marcado como simulado.
  private async pixDaCobranca(chargeId: string, faturaId: string, valorCalculado: number): Promise<PixFaturaPublica | null> {
    const emCache = this.cachePix.get(chargeId);
    if (emCache && Date.now() - emCache.em < FaturaPublicaService.CACHE_PIX_MS) return emCache.pix.payload ? emCache.pix : null;
    let pix: PixFaturaPublica;
    if (this.asaasLeitura.simulado || chargeId.startsWith('pay_sim_')) {
      pix = { payload: payloadPixSimulado(faturaId, valorCalculado), valor: valorCalculado, expiraEm: null, simulado: true };
    } else {
      try {
        const r = await this.asaasLeitura.pixQrCode(chargeId);
        if (!r?.payload) return null;
        const valor = valorDoPayloadPix(r.payload) ?? valorCalculado;
        pix = { payload: r.payload, valor, expiraEm: r.expirationDate ?? null, simulado: false };
      } catch (e) {
        this.logger.warn(`PIX da cobrança ${chargeId} indisponível: ${(e as Error).message}`);
        // Falha fica em cache curto também: a página aberta não martela o Asaas.
        this.cachePix.set(chargeId, { em: Date.now() - FaturaPublicaService.CACHE_PIX_MS / 2, pix: { payload: '', valor: 0, expiraEm: null, simulado: false } });
        return null;
      }
    }
    this.cachePix.set(chargeId, { em: Date.now(), pix });
    if (this.cachePix.size > 5000) this.cachePix.clear();
    return pix;
  }
}
