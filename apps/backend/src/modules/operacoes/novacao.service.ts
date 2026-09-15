import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  centavosParaReaisString,
  dataPorExtenso,
  formatCurrency,
  numeroPorExtenso,
  renderTemplate,
  valorPorExtenso,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { ContratoService } from '../contrato/contrato.service';
import { AprovacaoService } from '../aprovacao/aprovacao.service';
import { AssinaturaService } from '../assinatura/assinatura.service';
import { AsaasService } from '../asaas/asaas.service';
import { CatalogoFonteService } from '../catalogo/catalogo-fonte.service';
import { NovacaoDecomposicaoService } from './novacao-decomposicao.service';
import { SimularNovacaoBody } from './dto/novacao.dto';
import { INSTRUMENTO_NOVACAO_TEMPLATE } from './templates/instrumento-novacao.template';

const DIA_MS = 24 * 60 * 60 * 1000;
const reais = (c: number) => centavosParaReaisString(c);
const cent = (d: Prisma.Decimal | null): number =>
  d !== null ? Math.round(Number(d.toString()) * 100) : 0;

// Fotografia congelada na proposta (fonte da efetivação — RAP034 por analogia).
type SnapshotNovacao = {
  dataBase: string;
  dto: SimularNovacaoBody & { observacao?: string };
  simulacao: Awaited<ReturnType<NovacaoDecomposicaoService['simular']>>;
  documento?: string;
};

// ============================================================
// NOVAÇÃO CONTA-CÊNTRICA — F2 (doc adaptações 13/09, A2/A6/A7 passo 6).
//
// Fluxo: solicitar (RASCUNHO, snapshot congela decomposição+simulação) →
// motor de aprovação §7.9-A (CONAC = trilha do tipo 'novacao', 2 aprovações) →
// aoAprovar: cria os DOIS contratos em AGUARDANDO_ASSINATURA (sem cronograma)
// + instrumento único na ZapSign → aoAssinarContrato (registry pós-assinatura):
// recebimento inicial via Asaas quando houver (prazo de ativação do produto) →
// ativar: extingue as obrigações de origem (parcelas/faturas NOVADAS, acordos
// NOVADOS, contratos ENCERRADOS por NOVACAO) e gera os dois cronogramas na
// ordem A6 (Termo primeiro; fatura de transição com antecipação do veículo).
//
// ATOMICIDADE (A7 passo 6): a extinção das origens roda numa transação única;
// a geração dos cronogramas reusa ativarComCronograma (idempotente) e o job
// tem retry — uma falha no meio NUNCA fica muda (alerta FALHA) e o reprocesso
// completa exatamente o que faltou. A extinção vem ANTES dos cronogramas para
// as faturas novas não consolidarem nas faturas antigas da conta.
// ============================================================
@Injectable()
export class NovacaoService implements OnModuleInit {
  private readonly logger = new Logger(NovacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contrato: ContratoService,
    private readonly aprovacao: AprovacaoService,
    private readonly assinatura: AssinaturaService,
    private readonly asaas: AsaasService,
    private readonly catalogoFonte: CatalogoFonteService,
    private readonly decomposicao: NovacaoDecomposicaoService,
  ) {}

  onModuleInit() {
    this.aprovacao.registrarEfetivador('novacao', {
      aprovada: async (a) => this.aoAprovar(a.referenciaId),
      reprovada: async (a) => {
        await this.cancelar(a.referenciaId, 'Reprovada na aprovação');
      },
    });
    // Instrumento assinado por todos → recebimento inicial ou ativação direta.
    this.assinatura.registrarPosAssinatura((contratoId) => this.aoAssinarContrato(contratoId));
  }

  // ---------------------------------------------------------------
  // 1. Proposta: congela decomposição + simulação e abre a aprovação.
  async solicitar(
    contaId: string,
    dto: SimularNovacaoBody & { observacao?: string },
    operadorId: string,
  ) {
    // Chave de virada: a CONTRATAÇÃO exige o produto ATIVO no Catálogo
    // (a simulação roda em Rascunho — Regra 12; contratar não).
    const params = await this.catalogoFonte.novacao();
    if (!params.ativo) {
      throw new UnprocessableEntityException({
        erro: 'produto_inativo',
        mensagem: 'O produto Novação ainda está em Rascunho no Catálogo — ative-o para contratar',
      });
    }

    const emAberto = await this.prisma.db.novacao.count({
      where: {
        contaId,
        status: { in: ['RASCUNHO', 'AGUARDANDO_ASSINATURA', 'AGUARDANDO_RECEBIMENTO'] },
        deletedAt: null,
      },
    });
    if (emAberto > 0) {
      throw new UnprocessableEntityException({
        erro: 'novacao_em_aberto',
        mensagem: 'Esta conta já tem uma novação em andamento — conclua ou cancele antes de propor outra',
      });
    }

    // Números do SERVIDOR (fonte de verdade) — valida saldo do veículo > 0.
    const sim = await this.decomposicao.simular(contaId, dto);

    const snapshot: SnapshotNovacao = {
      dataBase: sim.dataBase,
      dto,
      simulacao: sim,
    };
    const novacao = await this.prisma.db.novacao.create({
      data: {
        contaId,
        operadorId,
        saldoVeiculo: reais(sim.decomposicao.parteVeiculo.total),
        saldoDemais: reais(sim.decomposicao.demaisProdutos.total),
        // F4: a parcela registrada é a COMPOSTA (financeira + CR + proteção) —
        // o valor real que o cliente assina e paga (A4.4).
        valorParcela: reais(sim.valorParcelaTotal ?? sim.valorParcela),
        recebimentoInicial: reais(dto.recebimentoInicial ?? 0),
        observacao: dto.observacao,
        snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    const excecoes = sim.excecoes.length ? ` · ⚠ EXCEÇÕES: ${sim.excecoes.join('; ')}` : '';
    await this.aprovacao.criar({
      tipoOperacao: 'novacao',
      referenciaTipo: 'novacao',
      referenciaId: novacao.id,
      titularId: sim.titularId,
      valorCentavos: sim.decomposicao.totalGeral,
      resumo: `Novação da conta — ${formatCurrency(sim.decomposicao.totalGeral)} reorganizados em 2 contratos · parcela única ${formatCurrency(sim.valorParcelaTotal ?? sim.valorParcela)} (${sim.frequencia}) · Termo ${sim.contrato2.totalParcelas}p + veículo ${sim.contrato1.totalParcelas}p${excecoes}`,
      payload: { excecoes: sim.excecoes },
      solicitanteId: operadorId,
    });

    return { id: novacao.id, status: 'aguardando_aprovacao', valorParcela: sim.valorParcelaTotal ?? sim.valorParcela };
  }

  // ---------------------------------------------------------------
  // 2. Aprovada: cria os DOIS contratos (sem cronograma) + instrumento único.
  private async aoAprovar(novacaoId: string): Promise<string> {
    const novacao = await this.prisma.db.novacao.findFirst({
      where: { id: novacaoId, status: 'RASCUNHO' },
      include: { conta: { select: { id: true, titularId: true } } },
    });
    if (!novacao) return 'Novação não está aguardando aprovação.';
    const snap = novacao.snapshotJson as unknown as SnapshotNovacao;
    const sim = snap.simulacao;

    // Contrato de origem do veículo: dono do ativo e do credor do Contrato 1.
    const origemVeiculo = await this.prisma.db.contratoCredito.findFirst({
      where: { contaId: novacao.contaId, status: { not: 'ENCERRADO' }, ativoId: { not: null } },
      orderBy: { createdAt: 'asc' },
      include: {
        ativo: { select: { descricao: true } },
        itensContratados: { where: { natureza: 'PARCELADO' }, take: 1, select: { credor: true } },
      },
    });
    if (!origemVeiculo?.ativoId) {
      throw new UnprocessableEntityException({
        erro: 'sem_contrato_veiculo',
        mensagem: 'A conta não tem contrato de veículo vigente para novar',
      });
    }

    const periodicidade = (
      { semanal: 'SEMANAL', quinzenal: 'QUINZENAL', mensal: 'MENSAL' } as const
    )[sim.frequencia];
    const passo = sim.frequencia === 'mensal' ? 30 : sim.frequencia === 'quinzenal' ? 14 : 7;
    const credorVeiculo = (origemVeiculo.itensContratados[0]?.credor ?? 'AZIT').toLowerCase() as
      | 'azit' | 'investidor' | 'terceiro';
    const hoje = new Date();
    // O contrato carrega o TOTAL DO PLANO do motor (PMT × n, encargos
    // embutidos) — nunca o saldo a valor presente: o cronograma distribui
    // valores NOMINAIS e a última parcela ficava negativa (mesmo bug do
    // acordo em 31/08, pego no E2E da F2 em 14/09).
    // F4 (15/09): parcela COMPOSTA (financeira + CR + proteção). Snapshots
    // anteriores à F4 não têm os campos novos — caem no comportamento antigo.
    const cr = sim.comissaoPorPeriodo ?? 0;
    const parcelaTotal = sim.valorParcelaTotal ?? sim.valorParcela;
    const somaFase2 =
      sim.contrato2.totalComposto ??
      sim.contrato2.parcelasCheias * sim.valorParcela + sim.contrato2.valorUltima;
    const somaFase1 =
      sim.contrato1.totalComposto ??
      sim.contrato1.parcelasCheias * sim.valorParcela + sim.contrato1.valorUltima;
    const paramsNovacao = await this.catalogoFonte.novacao();
    // Discriminação por componente CONGELADA na ref dos contratos novos (A4.2):
    // protS (semanal exata) alimenta o cronograma (principal × proteção na
    // fatura) e crP a quitação antecipada; dcr = taxa de desconto da CR na
    // antecipação, herdada dos parâmetros vigentes da venda.
    const vendaVigente = await this.prisma.db.versaoParametrosSimulacao.findFirst({
      orderBy: { vigenteDesde: 'desc' },
      select: { taxaDescontoAntecipacaoCR: true },
    });
    const dcr = vendaVigente ? Number(vendaVigente.taxaDescontoAntecipacaoCR.toString()) : 0.2;
    const protS = sim.protecaoSemanalExata ?? 0;
    const refNovacao = (crPeriodo: number) =>
      JSON.stringify({ nv: 1, protS, crP: crPeriodo, dcr, taxaM: paramsNovacao.taxaMensal });

    // Contrato 2 — Termo (pago PRIMEIRO; sem ativo, credor Azit). Datas são
    // estimativas: a ativação atômica recalcula antes de gerar os cronogramas.
    const c2 = await this.contrato.criar(
      {
        contaId: novacao.contaId,
        dataAssinatura: hoje,
        dataPrimeiraParcela: new Date(hoje.getTime() + passo * DIA_MS),
        valorTotal: somaFase2,
        valorEntrada: 0,
        numeroParcelas: Math.max(1, sim.contrato2.totalParcelas),
        valorParcelaInicial: parcelaTotal,
        periodicidade: sim.frequencia,
        modalidade: 'compra_parcelada',
        descricaoFinanciamento: 'Termo de Regularização de Débitos (novação)',
        credor: 'azit',
        // Taxa de origem do contrato novo (quitação/decomposições futuras).
        taxaDescontoQuitacao: paramsNovacao.taxaMensal,
      },
      'AGUARDANDO_ASSINATURA',
      false,
    );
    // Fase do Termo: proteção nas faturas desde a 1ª (A3); a CR do período é
    // amortização extra do próprio Termo (A4.3) — por isso crP = 0 na ref.
    await this.prisma.db.contratoCredito.update({
      where: { id: c2.id },
      data: { catalogoVersaoRef: refNovacao(0) },
    });

    // Contrato 1 — veículo. SEM troca: MESMO ativo do contrato de origem (que
    // só encerra na ativação atômica) → verificarEstoque desligado, exceção
    // legítima da regra "1 ativo = 1 contrato": é o contrato SUBSTITUTO.
    // COM troca (F3 — A5): o ativo NOVO do estoque, com verificação normal
    // (criar marca EM_CONTRATO = reserva); o antigo volta ao estoque na
    // ativação. valorEntrada = antecipação da fatura de transição (A6.3).
    const troca = sim.troca ?? null;
    const ativoC1 = troca?.ativoEntraId ?? origemVeiculo.ativoId;
    const c1 = await this.contrato.criar(
      {
        contaId: novacao.contaId,
        ativoId: ativoC1,
        dataAssinatura: hoje,
        dataPrimeiraParcela: new Date(hoje.getTime() + (sim.contrato2.totalParcelas + 1) * passo * DIA_MS),
        // Total do PLANO da fase do veículo + a antecipação (a "entrada",
        // cobrada na fatura de transição) — saldoDevedor nasce = somaFase1.
        valorTotal: somaFase1 + sim.contrato2.antecipacaoTransicao,
        valorEntrada: sim.contrato2.antecipacaoTransicao,
        numeroParcelas: Math.max(1, sim.contrato1.totalParcelas),
        valorParcelaInicial: parcelaTotal,
        periodicidade: sim.frequencia,
        descricaoFinanciamento: 'Novação do veículo',
        credor: credorVeiculo,
        taxaDescontoQuitacao: paramsNovacao.taxaMensal,
      },
      'AGUARDANDO_ASSINATURA',
      false,
      { verificarEstoque: !!troca },
    );
    // Veículo: proteção discriminada na fatura + CR do período na ref (A4.2) —
    // a quitação antecipada do contrato novado desconta CR × principal como na venda.
    await this.prisma.db.contratoCredito.update({
      where: { id: c1.id },
      data: { catalogoVersaoRef: refNovacao(cr) },
    });

    // Instrumento único (os dois contratos no mesmo ato) anexado ao contrato
    // do veículo — a assinatura dele destrava a operação inteira.
    const documento = await this.gerarInstrumento(novacao.id, {
      numeroContratoVeiculo: c1.numero,
      numeroContratoTermo: c2.numero,
      descricaoVeiculo: troca ? troca.entraDescricao : (origemVeiculo.ativo?.descricao ?? '—'),
      periodicidade,
    });
    await this.prisma.db.contratoCredito.update({
      where: { id: c1.id },
      data: { snapshotJson: { documento } as unknown as Prisma.InputJsonValue },
    });

    await this.prisma.db.novacao.update({
      where: { id: novacao.id },
      data: { status: 'AGUARDANDO_ASSINATURA', contratoVeiculoId: c1.id, contratoTermoId: c2.id },
    });

    // Envio automático à ZapSign — falha NÃO derruba a aprovação (padrão RP):
    // fica a notificação FALHA e o reenvio manual pela tela do contrato.
    try {
      await this.assinatura.enviar(c1.id);
    } catch (e) {
      this.logger.error(`Novação ${novacao.id}: envio à assinatura falhou: ${(e as Error).message}`);
      await this.prisma.db.notificacao.create({
        data: {
          titulo: 'FALHA — instrumento da novação não foi à assinatura',
          corpo: `Contratos ${c1.numero}/${c2.numero} criados, mas o envio à ZapSign falhou: ${(e as Error).message}. Reenvie pela tela do contrato ${c1.numero}.`,
          rota: `/contratos/${c1.id}`,
          tipo: 'COBRANCA',
          area: 'CARTEIRA_COBRANCA',
        },
      });
    }

    return `Novação aprovada: contratos ${c1.numero} (veículo) e ${c2.numero} (Termo) criados — instrumento enviado para assinatura.`;
  }

  // ---------------------------------------------------------------
  // 3. Registry pós-assinatura: instrumento assinado por todos.
  private async aoAssinarContrato(contratoId: string): Promise<void> {
    const novacao = await this.prisma.db.novacao.findFirst({
      where: { contratoVeiculoId: contratoId, status: 'AGUARDANDO_ASSINATURA' },
      include: { conta: { select: { titular: { select: { id: true, nome: true, cpfCnpj: true, email: true, whatsapp: true, asaasCustomerId: true } } } } },
    });
    if (!novacao) return; // contrato de outro fluxo — registry é geral

    await this.prisma.db.novacao.update({
      where: { id: novacao.id },
      data: { dataAssinatura: new Date() },
    });

    const recebimento = cent(novacao.recebimentoInicial);
    if (recebimento <= 0) {
      await this.ativar(novacao.id, new Date().toISOString());
      return;
    }

    // Recebimento inicial condiciona a ativação (A7 passo 6) — vencimento no
    // prazo de ativação do produto; vencer sem pagar EXPIRA a novação.
    const params = await this.catalogoFonte.novacao();
    const titular = novacao.conta.titular;
    let customerId = this.asaas.clienteReutilizavel(titular.asaasCustomerId);
    if (!customerId) {
      customerId = await this.asaas.criarCliente({
        titularId: titular.id, nome: titular.nome, cpfCnpj: titular.cpfCnpj,
        email: titular.email, telefone: titular.whatsapp,
      });
      await this.prisma.db.titular.update({ where: { id: titular.id }, data: { asaasCustomerId: customerId } });
    }
    const cobranca = await this.asaas.criarCobranca({
      externalReference: `novacao:${novacao.id}`,
      valor: recebimento,
      vencimento: new Date(Date.now() + params.prazoAtivacaoDias * DIA_MS),
      cancelarRegistroAposVencimento: true,
      descricao: `Recebimento inicial da novação — ${titular.nome}`,
      customerId,
    });
    await this.prisma.db.novacao.update({
      where: { id: novacao.id },
      data: { status: 'AGUARDANDO_RECEBIMENTO', asaasChargeIdRecebimento: cobranca.id },
    });
    this.logger.log(`Novação ${novacao.id}: instrumento assinado — cobrança do recebimento inicial gerada (${cobranca.id})`);
  }

  // ---------------------------------------------------------------
  // 4. ATIVAÇÃO (A7 passo 6): extingue as origens e gera os dois cronogramas.
  async ativar(novacaoId: string, paymentDateISO: string) {
    const novacao = await this.prisma.db.novacao.findFirst({
      where: { id: novacaoId, status: { in: ['AGUARDANDO_ASSINATURA', 'AGUARDANDO_RECEBIMENTO'] } },
    });
    if (!novacao) return { resultado: 'estado_invalido' };
    if (!novacao.contratoVeiculoId || !novacao.contratoTermoId) return { resultado: 'contratos_ausentes' };
    const snap = novacao.snapshotJson as unknown as SnapshotNovacao;
    const sim = snap.simulacao;
    const passo = sim.frequencia === 'mensal' ? 30 : sim.frequencia === 'quinzenal' ? 14 : 7;
    const novos = [novacao.contratoVeiculoId, novacao.contratoTermoId];

    // Etapa 1 (TRANSAÇÃO ÚNICA) — extinção das obrigações de origem. Vem ANTES
    // dos cronogramas: faturas antigas NOVADAS não recebem as parcelas novas.
    // Idempotente: reprocesso só re-filtra estados já finais (no-op).
    const dataCiclo = await this.prisma.db.$transaction(async (tx) => {
      const origens = await tx.contratoCredito.findMany({
        where: { contaId: novacao.contaId, id: { notIn: novos }, status: { not: 'ENCERRADO' } },
        select: { id: true },
      });
      const origemIds = origens.map((c) => c.id);

      // Preserva o dia do ciclo: menor vencimento FUTURO entre as faturas que
      // serão extintas (o relacionamento novo continua no mesmo ritmo).
      const proximaFatura = await tx.fatura.findFirst({
        where: { contaId: novacao.contaId, status: { in: ['ABERTA', 'FECHADA', 'RENEGOCIADA'] }, dataVencimento: { gt: new Date() } },
        orderBy: { dataVencimento: 'asc' },
        select: { dataVencimento: true },
      });

      // Parcelas em aberto dos contratos de origem → NOVADAS; recebíveis
      // esperados → RENEGOCIADO (obrigação substituída — Regra 3: nada se apaga).
      await tx.recebivel.updateMany({
        where: { contratoId: { in: origemIds }, status: 'ESPERADO', parcela: { status: null } },
        data: { status: 'RENEGOCIADO' },
      });
      await tx.parcela.updateMany({
        where: { contratoId: { in: origemIds }, status: null },
        data: { status: 'NOVADA' },
      });
      // Faturas não pagas da conta (inclusive RENEGOCIADAS de acordos) → NOVADAS.
      await tx.fatura.updateMany({
        where: { contaId: novacao.contaId, status: { in: ['ABERTA', 'FECHADA', 'RENEGOCIADA'] } },
        data: { status: 'NOVADA' },
      });
      // Acordos: ATIVO → NOVADO (saldo absorvido); propostas não efetivadas → CANCELADO.
      await tx.acordo.updateMany({
        where: { contaId: novacao.contaId, status: 'ATIVO' },
        data: { status: 'NOVADO' },
      });
      await tx.acordo.updateMany({
        where: { contaId: novacao.contaId, status: { in: ['RASCUNHO', 'AGUARDANDO_ENTRADA'] } },
        data: { status: 'CANCELADO' },
      });
      // Contratos de origem → ENCERRADOS por novação, vinculados a ela.
      await tx.contratoCredito.updateMany({
        where: { id: { in: origemIds } },
        data: {
          status: 'ENCERRADO',
          motivoEncerramento: 'NOVACAO',
          dataEncerramento: new Date(),
          novacaoOrigemId: novacao.id,
        },
      });
      return proximaFatura?.dataVencimento ?? null;
    }, { timeout: 60_000 });

    // Etapa 2 — cronogramas (ativarComCronograma é idempotente; job tem retry).
    // Termo primeiro (ocupa as primeiras faturas)...
    const dataPrimeiraC2 = this.rolarParaFuturo(dataCiclo ?? new Date(Date.now() + passo * DIA_MS), passo);
    await this.prisma.db.contratoCredito.update({
      where: { id: novacao.contratoTermoId },
      data: { dataPrimeiraParcela: dataPrimeiraC2 },
    });
    await this.contrato.ativarComCronograma(novacao.contratoTermoId);

    // ...o veículo começa APÓS a fatura de transição (última do Termo).
    const nTermo = Math.max(1, sim.contrato2.totalParcelas);
    const dataPrimeiraC1 = new Date(dataPrimeiraC2.getTime() + nTermo * passo * DIA_MS);
    await this.prisma.db.contratoCredito.update({
      where: { id: novacao.contratoVeiculoId },
      data: { dataPrimeiraParcela: dataPrimeiraC1 },
    });
    await this.contrato.ativarComCronograma(novacao.contratoVeiculoId);

    // Etapa 3 — antecipação do veículo NA fatura de transição (A6.3): a última
    // fatura do Termo é completada até o valor periódico padrão.
    const antecipacao = sim.contrato2.antecipacaoTransicao;
    if (antecipacao > 0) {
      const ultimaParcelaTermo = await this.prisma.db.parcela.findFirst({
        where: { contratoId: novacao.contratoTermoId },
        orderBy: { numero: 'desc' },
        select: { faturaId: true },
      });
      if (ultimaParcelaTermo?.faturaId) {
        const jaExiste = await this.prisma.db.itemFatura.count({
          where: { faturaId: ultimaParcelaTermo.faturaId, tipo: 'INTERMEDIARIA', descricao: { contains: 'transição' } },
        });
        if (jaExiste === 0) {
          await this.prisma.db.itemFatura.create({
            data: {
              faturaId: ultimaParcelaTermo.faturaId,
              tipo: 'INTERMEDIARIA',
              descricao: 'Antecipação do contrato do veículo — fatura de transição (novação)',
              valor: reais(antecipacao),
              credor: 'AZIT',
            },
          });
          await this.prisma.db.fatura.update({
            where: { id: ultimaParcelaTermo.faturaId },
            data: { valorTotal: { increment: reais(antecipacao) } },
          });
        }
      }
    }

    // Etapa 3b — troca de veículo (F3): o veículo que SAI volta ao estoque
    // (DISPONÍVEL); o novo já está EM_CONTRATO desde a criação do C1.
    const trocaSnap = sim.troca ?? null;
    if (trocaSnap) {
      await this.prisma.db.ativo.updateMany({
        where: { id: trocaSnap.ativoSaiId, status: 'EM_CONTRATO' },
        data: { status: 'DISPONIVEL' },
      });
    }

    // Etapa 4 — commit do estado da novação.
    await this.prisma.db.novacao.update({
      where: { id: novacao.id },
      data: { status: 'ATIVO', dataAtivacao: new Date(paymentDateISO || Date.now()) },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId: novacao.operadorId,
        acao: 'novacao_ativada',
        entidade: 'novacao',
        entidadeId: novacao.id,
        depois: {
          contratoVeiculoId: novacao.contratoVeiculoId,
          contratoTermoId: novacao.contratoTermoId,
          saldoVeiculo: cent(novacao.saldoVeiculo),
          saldoDemais: cent(novacao.saldoDemais),
          valorParcela: cent(novacao.valorParcela),
        },
      },
    });
    this.logger.warn(`Novação ${novacao.id} ATIVA: origens extintas, cronogramas gerados (Termo ${nTermo}p → veículo)`);
    return { resultado: 'ativada' };
  }

  // Recebimento inicial venceu sem pagamento → EXPIRA (recalcular obrigatório:
  // o saldo de origem seguiu vivo). Contratos criados voltam a cancelados.
  async expirarPorRecebimentoVencido(novacaoId: string) {
    const novacao = await this.prisma.db.novacao.findFirst({
      where: { id: novacaoId, status: 'AGUARDANDO_RECEBIMENTO' },
      include: { conta: { select: { titular: { select: { nome: true } } } } },
    });
    if (!novacao) return { resultado: 'ignorado' };
    await this.cancelarContratosNovos(novacao.id);
    await this.prisma.db.novacao.update({ where: { id: novacao.id }, data: { status: 'EXPIRADO' } });
    await this.prisma.db.notificacao.create({
      data: {
        titulo: `Novação expirada — ${novacao.conta.titular.nome}`,
        corpo: 'O recebimento inicial venceu sem pagamento; a novação expirou. Simule novamente (o saldo de origem seguiu acumulando mora).',
        rota: '/acordos',
        tipo: 'COBRANCA',
        area: 'CARTEIRA_COBRANCA',
      },
    });
    return { resultado: 'expirado' };
  }

  async cancelar(novacaoId: string, motivo: string) {
    const novacao = await this.prisma.db.novacao.findFirst({
      where: { id: novacaoId, status: { in: ['RASCUNHO', 'AGUARDANDO_ASSINATURA'] } },
    });
    if (!novacao) return;
    await this.cancelarContratosNovos(novacao.id);
    await this.prisma.db.novacao.update({
      where: { id: novacao.id },
      data: { status: 'CANCELADO', observacao: [novacao.observacao, motivo].filter(Boolean).join(' · ') },
    });
  }

  // Contratos novos ainda sem cronograma (novação não ativada) são encerrados
  // por cancelamento — nunca chegaram a existir como obrigação. Com TROCA de
  // veículo, o ativo novo reservado volta a DISPONÍVEL.
  private async cancelarContratosNovos(novacaoId: string) {
    const novacao = await this.prisma.db.novacao.findFirst({
      where: { id: novacaoId },
      select: { contratoVeiculoId: true, contratoTermoId: true, snapshotJson: true },
    });
    const ids = [novacao?.contratoVeiculoId, novacao?.contratoTermoId].filter((x): x is string => !!x);
    if (ids.length === 0) return;
    await this.prisma.db.contratoCredito.updateMany({
      where: { id: { in: ids }, status: 'AGUARDANDO_ASSINATURA' },
      data: { status: 'ENCERRADO', motivoEncerramento: 'CANCELAMENTO', dataEncerramento: new Date() },
    });
    const troca = (novacao?.snapshotJson as unknown as SnapshotNovacao | null)?.simulacao?.troca;
    if (troca?.ativoEntraId) {
      await this.prisma.db.ativo.updateMany({
        where: { id: troca.ativoEntraId, status: 'EM_CONTRATO' },
        data: { status: 'DISPONIVEL' },
      });
    }
  }

  private rolarParaFuturo(data: Date, passoDias: number): Date {
    const d = new Date(data.getTime());
    while (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + passoDias);
    return d;
  }

  // Instrumento único (placeholder Regra 12 — jurídico dará a redação final).
  private async gerarInstrumento(
    novacaoId: string,
    ctx: { numeroContratoVeiculo: string; numeroContratoTermo: string; descricaoVeiculo: string; periodicidade: 'SEMANAL' | 'QUINZENAL' | 'MENSAL' },
  ): Promise<string> {
    const novacao = await this.prisma.db.novacao.findFirst({
      where: { id: novacaoId },
      include: { conta: { select: { titular: { select: { nome: true, cpfCnpj: true, whatsapp: true } } } } },
    });
    if (!novacao) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Novação não encontrada' });
    const snap = novacao.snapshotJson as unknown as SnapshotNovacao;
    const sim = snap.simulacao;
    const t = novacao.conta.titular;
    const params = await this.assinatura.obterParametros();
    const plural = { MENSAL: 'mensais', QUINZENAL: 'quinzenais', SEMANAL: 'semanais' }[ctx.periodicidade];
    const linhaTest = (nome?: string, cpf?: string) => (nome ? `${nome}\nCPF: ${cpf || '—'}` : 'Nome:\nCPF:');
    const recebimento = cent(novacao.recebimentoInicial);
    const desconto = snap.dto.desconto ?? 0;
    return renderTemplate(INSTRUMENTO_NOVACAO_TEMPLATE, {
      nomeCliente: t.nome,
      cpfCliente: t.cpfCnpj,
      telefoneCliente: t.whatsapp ?? '—',
      razaoCredoraVeiculo: 'Estrutura jurídica titular do veículo (conforme contrato)',
      dataBase: new Date(snap.dataBase).toLocaleDateString('pt-BR'),
      saldoTotal: `R$ ${reais(sim.decomposicao.totalGeral)}`,
      saldoTotalExtenso: valorPorExtenso(sim.decomposicao.totalGeral),
      numeroContratoVeiculo: ctx.numeroContratoVeiculo,
      numeroContratoTermo: ctx.numeroContratoTermo,
      descricaoVeiculo: ctx.descricaoVeiculo,
      saldoVeiculo: `R$ ${reais(sim.decomposicao.parteVeiculo.total)}`,
      saldoVeiculoExtenso: valorPorExtenso(sim.decomposicao.parteVeiculo.total),
      trocaLinha: sim.troca
        ? `\n\nA operação inclui TROCA DE VEÍCULO: sai o veículo ${sim.troca.saiDescricao} (valor de cadastro R$ ${reais(sim.troca.saiValor)}), devolvido à CREDORA, e entra o veículo ${sim.troca.entraDescricao} (valor de cadastro R$ ${reais(sim.troca.entraValor)}); o ajuste de R$ ${reais(Math.abs(sim.troca.ajuste))} ${sim.troca.ajuste >= 0 ? 'soma-se ao' : 'deduz-se do'} saldo-base.`
        : '',
      taxaInicial: `R$ ${reais(sim.taxaInicial)}`,
      descontoLinha: desconto > 0 ? ` e deduzido o desconto de R$ ${reais(desconto)} aprovado pelo comitê` : '',
      parcelasVeiculo: sim.contrato1.totalParcelas,
      parcelasVeiculoExtenso: numeroPorExtenso(sim.contrato1.totalParcelas),
      saldoDemais: `R$ ${reais(sim.decomposicao.demaisProdutos.total)}`,
      saldoDemaisExtenso: valorPorExtenso(sim.decomposicao.demaisProdutos.total),
      parcelasTermo: Math.max(1, sim.contrato2.totalParcelas),
      periodicidadePlural: plural,
      // F4 (A4.4): o instrumento declara a parcela COMPOSTA — o valor
      // apresentado é o valor cobrado (financeira + comissão + proteção).
      valorParcela: `R$ ${reais(sim.valorParcelaTotal ?? sim.valorParcela)}`,
      valorParcelaExtenso: valorPorExtenso(sim.valorParcelaTotal ?? sim.valorParcela),
      antecipacaoTransicao: `R$ ${reais(sim.contrato2.antecipacaoTransicao)}`,
      recebimentoLinha:
        recebimento > 0
          ? `O CLIENTE pagará, como recebimento inicial, **R$ ${reais(recebimento)} (${valorPorExtenso(recebimento)})**, sendo a taxa inicial de processamento apropriada primeiro e o restante amortizado do saldo novado.`
          : 'Não há recebimento inicial nesta operação — a taxa inicial de processamento é financiada nas parcelas.',
      condicaoRecebimento: recebimento > 0 ? 'e com a confirmação do pagamento do recebimento inicial, no prazo máximo de 5 dias' : '',
      dataAssinaturaLinha: `VITÓRIA/ES, ${dataPorExtenso(new Date())}.`,
      testemunha1Linha: linhaTest(params.testemunha1Nome, params.testemunha1Cpf),
      testemunha2Linha: linhaTest(params.testemunha2Nome, params.testemunha2Cpf),
    });
  }

  // ---------------------------------------------------------------
  async listar() {
    const novacoes = await this.prisma.db.novacao.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        conta: { select: { titularId: true, titular: { select: { nome: true } } } },
        contratoVeiculo: { select: { id: true, numero: true } },
        contratoTermo: { select: { id: true, numero: true } },
      },
    });
    return novacoes.map((n) => ({
      id: n.id,
      status: n.status.toLowerCase(),
      titularId: n.conta.titularId,
      titular: n.conta.titular.nome,
      saldoVeiculo: cent(n.saldoVeiculo),
      saldoDemais: cent(n.saldoDemais),
      valorParcela: cent(n.valorParcela),
      recebimentoInicial: cent(n.recebimentoInicial),
      contratoVeiculo: n.contratoVeiculo ? { id: n.contratoVeiculo.id, numero: n.contratoVeiculo.numero } : null,
      contratoTermo: n.contratoTermo ? { id: n.contratoTermo.id, numero: n.contratoTermo.numero } : null,
      dataAssinatura: n.dataAssinatura?.toISOString() ?? null,
      dataAtivacao: n.dataAtivacao?.toISOString() ?? null,
      criadaEm: n.createdAt.toISOString(),
    }));
  }
}
