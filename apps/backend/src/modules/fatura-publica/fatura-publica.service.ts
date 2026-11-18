import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { ContaFaturaPublica, FaturaPublica, ItemFaturaPublica, PixFaturaPublica, PixSobDemandaPublico, SituacaoFaturaPublica, SituacaoFaturaPublicaResumo } from '@azit/types';
import {
  dataCalendarioUTC,
  dataHojeBrasil,
  encargoHojeDaFatura,
  diasAtrasoCalendario,
  faturaQuitada,
  horaBrasil,
  inicioDiaUTC,
  mascararDocumento,
  primeiroNome,
  situacaoFaturaRuntime,
  type TipoContrato,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasLeituraService } from '../asaas/asaas-leitura.service';
import { tiposDosContratos } from '../contrato/tipo-contrato';
import { TOKEN_FATURA_RE, whatsappParaWaMe } from '../cobranca/fatura-link';
import { ContaFaturaService } from '../faturamento/conta-fatura.service';
import { IntencaoPagamentoService, opcoesDePagamento } from '../faturamento/intencao-pagamento.service';
import { apresentarItemFatura, contratosDosItens, INCLUDE_ITEM_FATURA } from '../faturamento/itens-fatura';
import { comNavegador, htmlParaPdf } from '../dossie/pdf';
import { payloadPixSimulado, valorDoPayloadPix } from '../asaas/pix';
import { htmlFaturaAzitPdf } from './fatura-azit-pdf';
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
    private readonly contaFatura: ContaFaturaService,
    private readonly intencao: IntencaoPagamentoService,
  ) {}

  // Fatura do modelo AZIT (Pix sob demanda, doc 02 §32.4-A) projeta a CONTA; a
  // do modelo antigo segue exatamente como na F1.
  async porToken(token: string): Promise<FaturaPublica> {
    const f = await this.carregar(token);
    return f.modeloEncargo === 'AZIT' ? this.projetarAzit(f) : this.projetar(f, true);
  }

  // Consulta leve para a página aberta (polling): só o que muda com o pagamento.
  async situacao(token: string): Promise<SituacaoFaturaPublicaResumo> {
    const f = await this.carregar(token);
    const p = f.modeloEncargo === 'AZIT' ? await this.projetarAzit(f) : await this.projetar(f, false);
    return {
      situacao: p.situacao,
      pagaParcialmente: p.pagaParcialmente,
      valorPago: p.valorPago,
      totalHoje: p.totalHoje,
      dataPagamento: p.dataPagamento,
      ...(p.conta ? { assinatura: p.conta.assinatura } : {}),
    };
  }

  // PDF da fatura do link — ou, no modelo AZIT, de outra fatura da MESMA conta
  // que a página já mostra (`numero`), sem expor o link dela.
  async pdf(token: string, numero?: number): Promise<{ pdf: Buffer; nomeArquivo: string }> {
    const f = await this.carregar(token);
    let html: string;
    let paga: boolean;
    let numeroFatura = f.numero;
    if (f.modeloEncargo === 'AZIT') {
      const p = await this.projetarAzit(f);
      const conta = p.conta!;
      const alvo = numero ? conta.faturas.find((x) => x.numero === numero) : conta.faturas.find((x) => x.id === conta.faturaDoLink);
      if (!alvo) throw this.indisponivel();
      numeroFatura = alvo.numero;
      const r = htmlFaturaAzitPdf(p, alvo.id);
      html = r.html;
      paga = r.paga;
    } else {
      const p = await this.projetar(f, true);
      html = htmlFaturaPdf(p);
      paga = p.situacao === 'paga';
    }
    const pdf = await comNavegador((b) => htmlParaPdf(b, html));
    return { pdf, nomeArquivo: paga ? `comprovante-fatura-${numeroFatura}.pdf` : `fatura-azit-${numeroFatura}.pdf` };
  }

  // Pix sob demanda (doc 02 §32.4-A): o cliente escolheu um valor na página.
  // O servidor VALIDA o valor pela regra do motor (nunca confia na tela), reusa
  // a intenção ativa de mesmo valor no dia e devolve o código.
  async criarIntencao(token: string, valor: number): Promise<PixSobDemandaPublico> {
    // MEDIÇÃO (15/11): duração da rota inteira, do pedido à resposta — o tempo
    // que o cliente espera pelo código. Nunca loga o token (é o acesso à fatura).
    const t0 = Date.now();
    const f = await this.carregar(token);
    if (f.modeloEncargo !== 'AZIT') {
      throw new UnprocessableEntityException({ erro: 'modelo_antigo', mensagem: 'Esta fatura é paga pelo Pix que já aparece na página.' });
    }
    const i = await this.intencao.criar({ contaId: f.contaId, valor, origem: 'PAGINA_PUBLICA' }).catch((e: unknown) => {
      this.logger.warn(`POST intencao · fatura #${f.numero} conta ${f.contaId} valor ${valor}c: FALHOU em ${Date.now() - t0} ms (${(e as Error).message})`);
      throw e;
    });
    this.logger.log(`POST intencao · fatura #${f.numero} conta ${f.contaId} valor ${valor}c: ${i.reaproveitada ? 'reaproveitada' : 'nova'} em ${Date.now() - t0} ms`);
    return {
      valor: i.valor,
      copiaECola: i.pixCopiaECola,
      qrCodeImagem: i.pixQrCodeImagem,
      validoAte: i.validoAte.toISOString(),
      simulado: i.simulado,
      outroValor: i.outroValor,
      faturas: i.faturas.map((x) => ({ numero: x.numero, vencimento: x.vencimento, valor: x.valor })),
    };
  }

  // Link inválido ou regenerado (§32.2): "Não encontramos esta fatura", sem
  // revelar nada da conta — só o WhatsApp da Azit, para a página orientar.
  private indisponivel(): NotFoundException {
    const atendimento = this.config.get<string>('atendimentoWhatsapp') || null;
    return new NotFoundException({ erro: 'fatura_indisponivel', mensagem: 'Fatura indisponível', atendimentoWhatsapp: atendimento, atendimentoWhatsappLink: whatsappParaWaMe(atendimento) });
  }

  // Muda quando entra pagamento em QUALQUER fatura da conta ou quando o dia
  // vira — a página aberta recarrega. Gerar um Pix NÃO muda a assinatura (não
  // altera saldo nem cancela nada; a página já guarda os códigos que pediu).
  private assinatura(c: Omit<ContaFaturaPublica, 'assinatura'>): string {
    const pagamentos = c.motor.faturas.map((x) => `${x.id}:${x.pagamentos.length}:${x.pagamentos.reduce((t, p) => t + p.valor, 0)}`).join('|');
    return `${c.hoje}#${pagamentos}#${c.antigasEmAberto.length}`;
  }

  // Projeção da CONTA do modelo AZIT (§32.4-A, §32.6-A): as faturas em aberto
  // (mais as pagas recentes), os itens com nome, os Pix recebidos e a entrada do
  // motor. Os campos da F1 (totalHoje, encargo, …) saem da MESMA conta, para o
  // PDF e o polling.
  private async projetarAzit(f: Awaited<ReturnType<FaturaPublicaService['carregar']>>): Promise<FaturaPublica> {
    const hoje = dataHojeBrasil();
    const [conta, ativas, proxima] = await Promise.all([
      this.contaFatura.carregar(f.contaId, { incluirFaturaId: f.id }),
      this.intencao.ativasDaConta(f.contaId),
      // Próxima fatura ainda não disponível (vence depois de hoje).
      this.prisma.db.fatura.findFirst({ where: { contaId: f.contaId, status: 'ABERTA', dataVencimento: { gt: inicioDiaUTC(hoje) } }, orderBy: { dataVencimento: 'asc' }, select: { dataVencimento: true } }),
    ]);
    const k = this.contaFatura.projetar(conta, hoje);
    // Pix que se dividiu entre faturas: o valor inteiro e onde caiu o resto.
    const divisao = await this.contaFatura.divisaoDosPix('', conta.faturas.flatMap((x) => x.pagamentos.map((p) => p.gatewayPaymentId)));
    const dividir = (numero: number, p: { valor: number; valorExcedente: number; gatewayPaymentId: string | null }) => {
      const d = p.gatewayPaymentId ? divisao.get(p.gatewayPaymentId) : undefined;
      return { valorPix: d?.valorPix || p.valor + p.valorExcedente, outrasFaturas: (d?.outrasFaturas ?? []).filter((o) => o.numero !== numero) };
    };
    const opcoes = opcoesDePagamento(conta, k);
    const daConta = conta.faturas.find((x) => x.id === f.id);
    const projetada = k.faturas.find((x) => x.id === f.id);
    if (!daConta || !projetada) throw this.indisponivel();

    const contratosDoLink = [...contratosDosItens(f.itensFatura).values()];
    // Todos os Pix ativos de hoje (um por valor, do mais recente para o mais
    // antigo): a página mostra na hora o código de uma opção que o cliente já
    // tinha gerado, sem pedir de novo.
    const pixAtivos: PixSobDemandaPublico[] = ativas
      .filter((a) => a.pixCopiaECola)
      .map((a) => ({
        valor: cent(a.valor),
        copiaECola: a.pixCopiaECola!,
        qrCodeImagem: a.pixQrCodeImagem,
        validoAte: a.validoAte.toISOString(),
        simulado: a.simulado,
        outroValor: a.outroValor,
        faturas: ((a.faturasPretendidas as unknown as { numero: number; vencimento: string; valor: number }[]) ?? []).map((x) => ({ numero: x.numero, vencimento: x.vencimento, valor: x.valor })),
      }));
    const pixAtivo: PixSobDemandaPublico | null = pixAtivos[0] ?? null;
    const recebedor = this.config.get<{ nome: string; cnpj: string }>('faturaRecebedor') ?? { nome: 'Azit Move', cnpj: '' };
    const atendimento = this.config.get<string>('atendimentoWhatsapp') || null;

    const semAssinatura: Omit<ContaFaturaPublica, 'assinatura'> = {
      hoje,
      faturaDoLink: f.id,
      faturas: conta.faturas.map((x) => ({
        id: x.id,
        numero: x.numero,
        vencimento: x.vencimento,
        contratos: x.id === f.id ? contratosDoLink.map((c) => c.numero) : [],
        itens: x.itens.map((it) => ({ id: it.id, titulo: it.titulo, subtitulo: it.subtitulo, produto: it.produto })),
        // Mesma ordem dos pagamentos do motor (valor zero = só registro de excedente, fica fora).
        recebidos: x.pagamentos.filter((p) => p.valor > 0).map((p) => ({ data: p.data, hora: p.pagoEm ? horaBrasil(p.pagoEm) : null, valor: p.valor, identificador: p.identificadorPix, ...dividir(x.numero, p) })),
      })),
      motor: {
        faturas: conta.faturas.map((x) => x.motor),
        parametros: { cascata: conta.parametros.cascata, minimoParcialPct: conta.parametros.minimoParcialPct, minimoParcialPiso: conta.parametros.minimoParcialPiso },
      },
      mista: opcoes.mista,
      antigasEmAberto: conta.abertasModeloAntigo.map((a) => ({ numero: a.numero, vencimento: a.vencimento, valor: a.valor })),
      pix: pixAtivo,
      pixAtivos,
      recebedor,
      atendimentoWhatsappLink: whatsappParaWaMe(atendimento),
      proximoVencimento: proxima ? dataCalendarioUTC(proxima.dataVencimento) : null,
    };
    const contaPublica: ContaFaturaPublica = { ...semAssinatura, assinatura: this.assinatura(semAssinatura) };

    const paga = projetada.situacao === 'paga';
    const situacao: SituacaoFaturaPublica = paga ? 'paga' : projetada.diasAtraso > 0 ? 'vencida' : projetada.vencimento === hoje ? 'vence_hoje' : 'em_aberto';
    const primeiroAtivo = contratosDoLink.find((c) => c.ativo)?.ativo ?? null;
    const recebidos = daConta.pagamentos.filter((p) => p.valor > 0);
    const ultimo = recebidos.at(-1);
    return {
      numero: f.numero,
      situacao,
      pagaParcialmente: projetada.situacao === 'parcial',
      titular: { primeiroNome: primeiroNome(f.conta.titular.nome), documentoMascarado: mascararDocumento(f.conta.titular.cpfCnpj) },
      veiculo: primeiroAtivo ? { descricao: [primeiroAtivo.marca, primeiroAtivo.modelo].filter(Boolean).join(' ').trim() || primeiroAtivo.descricao, placa: primeiroAtivo.placa ?? null } : null,
      contratos: contratosDoLink.map((c) => c.numero),
      vencimento: projetada.vencimento,
      dataPagamento: paga && ultimo ? ultimo.data : null,
      itens: daConta.itens.map((it) => ({ titulo: it.titulo, subtitulo: it.subtitulo, produto: it.produto, valor: it.valor })),
      encargo: !paga && projetada.diasAtraso > 0 ? { multa: projetada.encargo.multa, atualizacao: projetada.encargo.atualizacao, diasAtraso: projetada.diasAtraso, fonte: 'calculo' } : null,
      valorNominal: projetada.face,
      valorPago: projetada.pagoTotal,
      saldoNominal: projetada.saldoNominal,
      totalHoje: projetada.totalHoje,
      pagamentos: recebidos.map((p) => ({ data: p.data, valor: p.valor })),
      pix: pixAtivo ? { payload: pixAtivo.copiaECola, valor: pixAtivo.valor, expiraEm: pixAtivo.validoAte, simulado: pixAtivo.simulado } : null,
      atendimentoWhatsapp: atendimento,
      geradoEm: new Date().toISOString(),
      conta: contaPublica,
    };
  }

  // ---------------------------------------------------------------

  private async carregar(token: string) {
    if (!TOKEN_FATURA_RE.test(token)) throw this.indisponivel();
    const f = await this.prisma.db.fatura.findFirst({
      where: { tokenPublico: token, deletedAt: null },
      include: {
        conta: { include: { titular: { select: { nome: true, cpfCnpj: true } } } },
        itensFatura: { orderBy: { createdAt: 'asc' }, include: INCLUDE_ITEM_FATURA },
        parcelas: { include: { contrato: { select: { taxaMultaAtraso: true, taxaJurosAtraso: true } } } },
      },
    });
    if (!f) throw this.indisponivel();
    // Fatura extinta (novação/rescisão) não é cobrança do cliente: a página
    // responde indisponível em vez de mostrar valores que não valem mais.
    if (f.status === 'NOVADA' || f.status === 'RESCINDIDA' || f.status === 'RENEGOCIADA') {
      throw this.indisponivel();
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

    // Itens com o nome que o cliente lê — UMA montagem (faturamento/itens-fatura),
    // a mesma da conta AZIT, do PDF e da ficha.
    const contratos = contratosDosItens(f.itensFatura);
    const tipos: Map<string, TipoContrato> = await tiposDosContratos(this.prisma.db, [...contratos.values()]);

    const primeiroAtivo = [...contratos.values()].find((c) => c.ativo)?.ativo ?? null;
    const veiculo = primeiroAtivo
      ? { descricao: [primeiroAtivo.marca, primeiroAtivo.modelo].filter(Boolean).join(' ').trim() || primeiroAtivo.descricao, placa: primeiroAtivo.placa ?? null }
      : null;

    const itens: ItemFaturaPublica[] = f.itensFatura.map((it) => {
      const a = apresentarItemFatura(it, tipos);
      return { titulo: a.titulo, subtitulo: a.subtitulo, produto: a.produto, valor: a.valor };
    });

    // Encargo de hoje (doc 02 §7.2, uma função) sobre as parcelas da fatura; fatura
    // sem parcelas (legado) usa o próprio total e as taxas padrão.
    let multa = 0;
    let atualizacao = 0;
    let diasAtraso = 0;
    if (!quitada) {
      const agora = new Date();
      // A mesma função da ficha do titular (Regra 16) — as duas telas dão o mesmo número.
      ({ multa, atualizacao, diasAtraso } = encargoHojeDaFatura(
        f.parcelas.map((p) => ({
          valor: cent(p.valorNominal),
          diasAtraso: diasAtrasoCalendario(p.dataVencimento, agora),
          taxaMultaPercent: Number(p.contrato.taxaMultaAtraso.toString()),
          taxaJurosMensalPercent: Number(p.contrato.taxaJurosAtraso.toString()),
        })),
        { saldo: saldoNominal, diasAtraso: diasAtrasoCalendario(f.dataVencimento, agora) },
      ));
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
