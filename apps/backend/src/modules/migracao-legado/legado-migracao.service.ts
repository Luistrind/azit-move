import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { centavosParaReaisString, type LinhaConciliacao, type ForaDoCronograma, type TermosContratoLegado } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AsaasLeituraService } from '../asaas/asaas-leitura.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { LegadoConciliacaoService, type DivergenciaReconhecida } from './legado-conciliacao.service';
import { FaturaService } from '../cobranca/fatura.service';

// ============================================================
// Migração do legado — F3 (doc 02 §26.5, §26.8, §26.9): o caso VALIDADO vira
// titular, conta, veículo, contrato ATIVO, cronograma inteiro (parcelas,
// recebíveis, faturas com seus itens — as passadas já PAGAS), entrada
// materializada, Reembolsos Parcelados das despesas cobradas junto, PDF como
// instrumento assinado fora do sistema — e, por fim, a assinatura do Asaas é
// PARADA (PUT INACTIVE, nunca DELETE) para o sistema assumir a emissão.
//
// Cobranças A VENCER já emitidas pela assinatura (decisão Luís 01/10): são
// APAGADAS no Asaas e as faturas nascem ABERTAS — o sistema emite as suas, e
// a fatura aceita item novo (reembolso, acordo) como qualquer outra. As que já
// estariam fechadas (vencem em até 5 dias) são emitidas NA HORA. Cobrança
// VENCIDA fica amarrada (o Asaas não emite com vencimento no passado; é ela
// que um acordo cobre).
//
// Dois passos: PLANEJAR (puro: lê a conciliação validada e descreve o que vai
// nascer — a tela mostra a prévia) e PERSISTIR (uma transação). O corte no
// Asaas vem DEPOIS do commit: se falhar, o caso fica MIGRADO com a assinatura
// marcada como não parada, e o operador repete pelo botão.
// ============================================================

const UPLOADS_LEGADO = join(process.cwd(), 'uploads', 'legado');
const UPLOADS_ASSINATURAS = join(process.cwd(), 'uploads', 'assinaturas');
const DIA_MS = 86_400_000;

type StatusFaturaPlano = 'PAGA' | 'PAGA_EM_ATRASO' | 'FECHADA' | 'ABERTA';
type TipoItemPlano = 'PRINCIPAL' | 'INTERMEDIARIA' | 'SERVICO' | 'ENCARGO';

interface ItemPlano {
  tipo: TipoItemPlano;
  descricao: string;
  valor: number; // centavos
  // A que parcela o item pertence: a do veículo desta fatura, ou a parcela n do RP k.
  parcela: 'veiculo' | { rp: number; n: number } | null;
}

interface FaturaPlano {
  origem: string; // chave da linha ou 'cobranca:<id>'
  vencimento: string; // data da cobrança real (ou do cronograma)
  status: StatusFaturaPlano;
  valorTotal: number;
  valorPago: number | null;
  pagoEm: string | null;
  asaasChargeId: string | null;
  // Cobrança a vencer já emitida pela assinatura: apagada no Asaas após o commit;
  // a fatura nasce ABERTA e o sistema emite a sua (na hora, se já estiver no D-5).
  substituirChargeId: string | null;
  emitirAgora: boolean;
  itens: ItemPlano[];
  // Parcela do VEÍCULO que esta fatura cobra (null = intermediária solta, avulsa, RP solto).
  parcela: { numero: number; vencimento: string; valorNominal: number; principal: number; encargo: number } | null;
}

interface RpPlano {
  rotulo: string;
  parcelas: { n: number; valor: number; faturaIdx: number }[];
}

export interface PlanoMigracao {
  titular: { cpfCnpj: string; nome: string; existente: { id: string; nome: string } | null };
  veiculo: { descricao: string; placa: string | null; existente: { id: string; descricao: string } | null };
  estruturaId: string;
  contrato: { numero: string; dataAssinatura: string; dataPrimeiraParcela: string; numeroParcelas: number; valorParcela: number; valorTotal: number; valorEntrada: number; modoVencimentos: string };
  entrada: { valor: number; pagoEm: string; asaasChargeId: string | null } | null;
  faturas: FaturaPlano[];
  rps: RpPlano[];
  resumo: { faturasPagas: number; faturasFechadas: number; faturasAbertas: number; parcelasPagas: number; reembolsos: number; avulsas: number; encargos: number; assinaturaId: string | null; substituidas: number; emitidasAgora: number };
}

const d = (iso: string) => new Date(`${iso}T03:00:00.000Z`); // meia-noite de Brasília
const isoDe = (data: Date) => data.toISOString().slice(0, 10);
const addDias = (iso: string, n: number) => isoDe(new Date(d(iso).getTime() + n * DIA_MS));
const difDias = (a: string, b: string) => Math.round((d(a).getTime() - d(b).getTime()) / DIA_MS);
const reais = (c: number) => centavosParaReaisString(c);

@Injectable()
export class LegadoMigracaoService {
  private readonly logger = new Logger(LegadoMigracaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conciliacao: LegadoConciliacaoService,
    private readonly asaasLeitura: AsaasLeituraService,
    private readonly notificacao: NotificacaoService,
    private readonly fatura: FaturaService,
  ) {}

  // ---------------- Prévia (nada é gravado) ----------------

  async previa(casoId: string): Promise<PlanoMigracao> {
    const caso = await this.carregarValidado(casoId);
    return this.planejar(caso);
  }

  // ---------------- Migrar ----------------

  async migrar(casoId: string, usuarioId: string) {
    const caso = await this.carregarValidado(casoId);
    const plano = await this.planejar(caso);
    const termos = caso.termos as unknown as TermosContratoLegado;
    const reconhecidas = (caso.divergenciasReconhecidas as DivergenciaReconhecida[] | null) ?? [];

    const resultado = await this.prisma.db.$transaction(async (tx) => {
      // 1. Titular + conta (cadastro único pelo CPF — Regra 8)
      let titularId = plano.titular.existente?.id ?? null;
      if (!titularId) {
        const outroComCustomer = await tx.titular.findFirst({ where: { asaasCustomerId: caso.asaasCustomerId }, select: { id: true } });
        const criado = await tx.titular.create({
          data: {
            nome: plano.titular.nome,
            tipoPessoa: plano.titular.cpfCnpj.length > 11 ? 'PJ' : 'PF',
            cpfCnpj: plano.titular.cpfCnpj,
            whatsapp: caso.telefone ?? '',
            email: caso.email ?? null,
            asaasCustomerId: outroComCustomer ? null : caso.asaasCustomerId,
          },
          select: { id: true },
        });
        titularId = criado.id;
      } else {
        const t = await tx.titular.findUnique({ where: { id: titularId }, select: { asaasCustomerId: true } });
        if (t && !t.asaasCustomerId) {
          const outro = await tx.titular.findFirst({ where: { asaasCustomerId: caso.asaasCustomerId }, select: { id: true } });
          if (!outro) await tx.titular.update({ where: { id: titularId }, data: { asaasCustomerId: caso.asaasCustomerId } });
        }
      }
      const conta = (await tx.conta.findFirst({ where: { titularId }, select: { id: true } }))
        ?? (await tx.conta.create({ data: { titularId }, select: { id: true } }));

      // 2. Veículo sob a estrutura Azit (§26.9 item 1)
      let ativoId = plano.veiculo.existente?.id ?? null;
      if (ativoId) {
        await tx.ativo.update({ where: { id: ativoId }, data: { status: 'EM_CONTRATO', estruturaJuridicaId: plano.estruturaId } });
      } else {
        const v = termos.veiculo;
        const criado = await tx.ativo.create({
          data: {
            tipo: 'VEICULO',
            estruturaJuridicaId: plano.estruturaId,
            descricao: plano.veiculo.descricao,
            marca: v.marca, modelo: v.modelo, anoFabricacao: v.anoFabricacao, anoModelo: v.anoModelo, cor: v.cor,
            placa: plano.veiculo.placa, chassi: v.chassi, renavam: v.renavam,
            quilometragemEntrada: v.quilometragem,
            status: 'EM_CONTRATO',
            observacao: `Importado do legado (caso ${caso.id}, contrato ${termos.numeroOrigem ?? 'sem número'})`,
          },
          select: { id: true },
        });
        ativoId = criado.id;
      }

      // 3. Contrato do veículo (versão "Legado": valores do contrato, sem motor — §26.9 item 2)
      const refLegado = JSON.stringify({ legado: 1, protS: termos.seguroSemanal, taxaS: termos.taxaSemanal });
      const todasPagas = plano.faturas.filter((f) => f.parcela).every((f) => f.status === 'PAGA' || f.status === 'PAGA_EM_ATRASO');
      const contrato = await tx.contratoCredito.create({
        data: {
          numero: plano.contrato.numero,
          contaId: conta.id,
          ativoId,
          legadoCasoId: caso.id,
          catalogoVersaoRef: refLegado,
          dataAssinatura: d(plano.contrato.dataAssinatura),
          dataPrimeiraParcela: d(plano.contrato.dataPrimeiraParcela),
          valorTotal: reais(plano.contrato.valorTotal),
          valorEntrada: reais(plano.contrato.valorEntrada),
          entradaParcelada: !!termos.intermediarias,
          entradaPagaEm: plano.entrada ? d(plano.entrada.pagoEm) : null,
          valorEntradaPago: plano.entrada ? reais(plano.entrada.valor) : null,
          entradaCobrancaAsaasId: plano.entrada?.asaasChargeId ?? null,
          modalidade: 'ASSINATURA',
          assinaturaTitularEm: d(plano.contrato.dataAssinatura),
          assinaturaAzitEm: d(plano.contrato.dataAssinatura),
          cronogramaGeradoEm: new Date(),
          saldoDevedor: reais(plano.contrato.valorTotal - plano.contrato.valorEntrada),
          numeroParcelas: plano.contrato.numeroParcelas,
          valorParcelaInicial: reais(plano.contrato.valorParcela),
          periodicidade: 'SEMANAL',
          indiceReajuste: null, // §26.9 item 5: reajuste ignorado no legado
          taxaMultaAtraso: termos.multaAtrasoPct ?? 2,
          taxaJurosAtraso: termos.jurosMensalPct ?? 1,
          status: todasPagas ? 'ENCERRADO' : 'ATIVO',
          motivoEncerramento: todasPagas ? 'QUITACAO' : null,
          dataEncerramento: todasPagas ? new Date() : null,
          asaasSubscriptionId: caso.assinaturaId,
          snapshotJson: {
            legado: {
              casoId: caso.id,
              numeroOrigem: termos.numeroOrigem,
              modoVencimentos: caso.modoVencimentos,
              termos: termos as unknown as Prisma.InputJsonValue,
              divergencias: reconhecidas as unknown as Prisma.InputJsonValue,
              vinculosManuais: (caso.vinculosManuais ?? []) as Prisma.InputJsonValue,
              instrumento: 'assinado fora do sistema (PDF do PopHub)',
              migradoEm: new Date().toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
        select: { id: true, numero: true },
      });
      const itemVeiculo = await tx.itemContratado.create({
        data: { contratoId: contrato.id, descricao: `Compra Parcelada ${plano.veiculo.descricao}`, natureza: 'PARCELADO', credor: 'AZIT', valor: reais(plano.contrato.valorTotal - plano.contrato.valorEntrada), numeroParcelas: plano.contrato.numeroParcelas, periodicidade: 'SEMANAL', dataInicio: d(plano.contrato.dataPrimeiraParcela) },
        select: { id: true },
      });
      if (termos.seguroSemanal > 0) {
        await tx.itemContratado.create({ data: { contratoId: contrato.id, descricao: 'Proteção veicular (legado)', natureza: 'RECORRENTE', credor: 'AZIT', valor: reais(termos.seguroSemanal), periodicidade: 'SEMANAL', dataInicio: d(plano.contrato.dataPrimeiraParcela) } });
      }
      if (termos.taxaSemanal > 0) {
        await tx.itemContratado.create({ data: { contratoId: contrato.id, descricao: 'Taxa de boleto e PIX (legado)', natureza: 'RECORRENTE', credor: 'AZIT', valor: reais(termos.taxaSemanal), periodicidade: 'SEMANAL', dataInicio: d(plano.contrato.dataPrimeiraParcela) } });
      }

      // 4. Entrada materializada (§26.8)
      if (plano.entrada) {
        await tx.lancamentoConta.create({
          data: { contaId: conta.id, contratoId: contrato.id, tipo: 'ENTRADA_CONTRATO', descricao: `Entrada do contrato ${contrato.numero} (legado)`, valor: reais(plano.entrada.valor), dataPagamento: d(plano.entrada.pagoEm), asaasChargeId: plano.entrada.asaasChargeId },
        });
      }

      // 5. Reembolsos Parcelados (§26.8: valores exatos, sem taxa, sem reprecificar)
      const rpContratos: { contratoId: string; itemId: string; parcelaIds: Map<number, string>; total: number }[] = [];
      for (const [k, rp] of plano.rps.entries()) {
        const total = rp.parcelas.reduce((s, p) => s + p.valor, 0);
        const primeira = plano.faturas[rp.parcelas[0].faturaIdx];
        const ultima = plano.faturas[rp.parcelas[rp.parcelas.length - 1].faturaIdx];
        const pagoTudo = rp.parcelas.every((p) => plano.faturas[p.faturaIdx].status === 'PAGA' || plano.faturas[p.faturaIdx].status === 'PAGA_EM_ATRASO');
        const c = await tx.contratoCredito.create({
          data: {
            numero: `${contrato.numero}-RP${k + 1}`,
            contaId: conta.id,
            ativoId: null,
            legadoCasoId: null,
            catalogoVersaoRef: refLegado,
            dataAssinatura: d(primeira.vencimento),
            dataPrimeiraParcela: d(primeira.vencimento),
            valorTotal: reais(total), valorEntrada: reais(0), saldoDevedor: reais(total),
            modalidade: 'COMPRA_PARCELADA',
            cronogramaGeradoEm: new Date(),
            numeroParcelas: rp.parcelas.length,
            valorParcelaInicial: reais(rp.parcelas[0].valor),
            periodicidade: 'SEMANAL',
            status: pagoTudo ? 'ENCERRADO' : 'ATIVO',
            motivoEncerramento: pagoTudo ? 'QUITACAO' : null,
            dataEncerramento: pagoTudo ? d(ultima.vencimento) : null,
            snapshotJson: { legado: { casoId: caso.id, reembolsoDe: contrato.numero, rotulo: rp.rotulo, semTaxa: true } } as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        const item = await tx.itemContratado.create({
          data: { contratoId: c.id, descricao: `Reembolso Parcelado — ${rp.rotulo}`, natureza: 'PARCELADO', credor: 'AZIT', valor: reais(total), numeroParcelas: rp.parcelas.length, periodicidade: 'SEMANAL', dataInicio: d(primeira.vencimento) },
          select: { id: true },
        });
        rpContratos.push({ contratoId: c.id, itemId: item.id, parcelaIds: new Map(), total });
      }

      // 6. Faturas, parcelas, recebíveis e itens — na ordem do vencimento
      const ultimoNumero = await tx.fatura.aggregate({ where: { contaId: conta.id }, _max: { numero: true } });
      let numeroFatura = (ultimoNumero._max.numero ?? 0) + 1;
      const ordenadas = plano.faturas.map((f, idx) => ({ f, idx })).sort((a, b) => a.f.vencimento.localeCompare(b.f.vencimento));
      const faturaIds: string[] = new Array(plano.faturas.length);
      const substituicoes: { faturaId: string; chargeId: string; emitirAgora: boolean; vencimento: string }[] = [];
      for (const { f, idx } of ordenadas) {
        const paga = f.status === 'PAGA' || f.status === 'PAGA_EM_ATRASO';
        const fatura = await tx.fatura.create({
          data: {
            contaId: conta.id,
            numero: numeroFatura++,
            periodoReferencia: d(f.vencimento),
            dataFechamento: new Date(d(f.vencimento).getTime() - 5 * DIA_MS),
            dataVencimento: d(f.vencimento),
            dataPagamento: paga && f.pagoEm ? d(f.pagoEm) : null,
            valorTotal: reais(f.valorTotal),
            valorPago: paga ? reais(f.valorPago ?? f.valorTotal) : null,
            status: f.status,
            asaasChargeId: f.asaasChargeId,
          },
          select: { id: true },
        });
        faturaIds[idx] = fatura.id;
        if (f.substituirChargeId) substituicoes.push({ faturaId: fatura.id, chargeId: f.substituirChargeId, emitirAgora: f.emitirAgora, vencimento: f.vencimento });

        // Parcela do veículo (+ recebível)
        let parcelaVeiculoId: string | null = null;
        if (f.parcela) {
          const p = f.parcela;
          const statusParcela = paga ? (f.status === 'PAGA_EM_ATRASO' ? 'PAGA_EM_ATRASO' : 'PAGA') : null;
          const parcela = await tx.parcela.create({
            data: {
              contratoId: contrato.id, itemContratadoId: itemVeiculo.id,
              numero: p.numero, totalParcelas: plano.contrato.numeroParcelas, display: `${p.numero}/${plano.contrato.numeroParcelas}`,
              valorNominal: reais(p.valorNominal), dataVencimento: d(p.vencimento),
              dataPagamento: paga && f.pagoEm ? d(f.pagoEm) : null,
              valorPago: paga ? reais(p.principal + p.encargo) : null,
              valorEncargo: paga && p.encargo > 0 ? reais(p.encargo) : null,
              status: statusParcela, faturaId: fatura.id,
            },
            select: { id: true },
          });
          parcelaVeiculoId = parcela.id;
          await tx.recebivel.create({
            data: {
              contratoId: contrato.id, parcelaId: parcela.id, origemCapitalId: null,
              dataPrevista: d(p.vencimento), valorPrevisto: reais(p.valorNominal),
              dataRealizada: paga && f.pagoEm ? d(f.pagoEm) : null, valorRealizado: paga ? reais(p.principal) : null,
              status: paga ? 'REALIZADO' : 'ESPERADO',
            },
          });
        }

        // Itens da fatura
        for (const it of f.itens) {
          let parcelaId: string | null = null;
          if (it.parcela === 'veiculo') parcelaId = parcelaVeiculoId;
          else if (it.parcela && typeof it.parcela === 'object') {
            const rp = rpContratos[it.parcela.rp];
            const plan = plano.rps[it.parcela.rp];
            const nRp = it.parcela.n;
            const pp = plan.parcelas.find((x) => x.n === nRp)!;
            const parcelaRp = await tx.parcela.create({
              data: {
                contratoId: rp.contratoId, itemContratadoId: rp.itemId,
                numero: pp.n, totalParcelas: plan.parcelas.length, display: `${pp.n}/${plan.parcelas.length}`,
                valorNominal: reais(pp.valor), dataVencimento: d(f.vencimento),
                dataPagamento: paga && f.pagoEm ? d(f.pagoEm) : null,
                valorPago: paga ? reais(pp.valor) : null,
                status: paga ? (f.status === 'PAGA_EM_ATRASO' ? 'PAGA_EM_ATRASO' : 'PAGA') : null,
                faturaId: fatura.id,
              },
              select: { id: true },
            });
            await tx.recebivel.create({
              data: { contratoId: rp.contratoId, parcelaId: parcelaRp.id, dataPrevista: d(f.vencimento), valorPrevisto: reais(pp.valor), dataRealizada: paga && f.pagoEm ? d(f.pagoEm) : null, valorRealizado: paga ? reais(pp.valor) : null, status: paga ? 'REALIZADO' : 'ESPERADO' },
            });
            rp.parcelaIds.set(pp.n, parcelaRp.id);
            parcelaId = parcelaRp.id;
          }
          await tx.itemFatura.create({ data: { faturaId: fatura.id, parcelaId, tipo: it.tipo, descricao: it.descricao, valor: reais(it.valor), credor: 'AZIT' } });
        }
      }

      // 7. PDF do PopHub = instrumento assinado fora do sistema (§26.9 item 3)
      let pdfCopiado = false;
      if (caso.contratoPdfRef) {
        try {
          await fs.mkdir(UPLOADS_ASSINATURAS, { recursive: true });
          const destino = `${contrato.id}.pdf`;
          await fs.copyFile(join(UPLOADS_LEGADO, caso.contratoPdfRef), join(UPLOADS_ASSINATURAS, destino));
          await tx.documentoAssinatura.create({
            data: {
              contratoCreditoId: contrato.id, provedor: 'legado', docToken: null, status: 'assinado',
              signatarios: [{ papel: 'titular', nome: plano.titular.nome, assinadoEm: plano.contrato.dataAssinatura, fora_do_sistema: true }] as Prisma.InputJsonValue,
              pdfAssinadoRef: destino, simulado: false,
              enviadoEm: d(plano.contrato.dataAssinatura), concluidoEm: d(plano.contrato.dataAssinatura),
            },
          });
          pdfCopiado = true;
        } catch (e) {
          this.logger.warn(`caso ${caso.id}: PDF não copiado (${(e as Error).message})`);
        }
      }

      // 8. O caso vira MIGRADO e aponta para o que nasceu
      const resumo = { ...plano.resumo, contratoNumero: contrato.numero, reembolsosIds: rpContratos.map((r) => r.contratoId), pdfCopiado, faturas: faturaIds.length, substituicoes: substituicoes.length };
      await tx.casoMigracaoLegado.update({
        where: { id: caso.id },
        data: {
          status: 'MIGRADO', titularId, contratoId: contrato.id,
          migradoEm: new Date(), migradoPor: usuarioId, migracaoResumo: resumo as Prisma.InputJsonValue,
          statusAlteradoEm: new Date(), statusAlteradoPor: usuarioId,
        },
      });
      await tx.logAuditoria.create({ data: { usuarioId, acao: 'legado_caso_migrado', entidade: 'caso_migracao_legado', entidadeId: caso.id, depois: resumo as Prisma.InputJsonValue } });
      return { titularId, contaId: conta.id, contratoId: contrato.id, contratoNumero: contrato.numero, resumo, substituicoes };
    }, { timeout: 120_000 });

    // 9. Corte no Asaas — DEPOIS do commit (§26.5): parar a assinatura preservando
    // as cobranças emitidas. Falha não desfaz a migração: fica visível e repetível.
    const corte = await this.pararAssinatura(casoId, usuarioId);
    const substituicao = await this.substituirCobrancas(casoId, resultado.substituicoes);
    return { titularId: resultado.titularId, contaId: resultado.contaId, contratoId: resultado.contratoId, contratoNumero: resultado.contratoNumero, resumo: resultado.resumo, assinatura: corte, substituicao };
  }

  // Apaga no Asaas as cobranças A VENCER da assinatura antiga e emite as do
  // sistema. Por cobrança: DELETE /payments/{id} → ok: fatura segue ABERTA (o
  // fechamento D-5 emite) ou, se já está no D-5, fecha e emite AGORA; falha:
  // a fatura volta a ficar amarrada à cobrança antiga (FECHADA), nada se perde.
  private async substituirCobrancas(casoId: string, lista: { faturaId: string; chargeId: string; emitirAgora: boolean; vencimento: string }[]) {
    const r = { apagadas: 0, emitidasAgora: 0, mantidas: [] as { vencimento: string; chargeId: string; erro: string }[] };
    if (!lista.length) return r;
    const simulado = this.asaasLeitura.ambiente === 'simulado';
    for (const s of lista) {
      try {
        if (!simulado) await this.asaasLeitura.requisicao('DELETE', `/payments/${s.chargeId}`);
        r.apagadas++;
        if (s.emitirAgora) {
          await this.prisma.db.fatura.update({ where: { id: s.faturaId }, data: { status: 'FECHADA' } });
          await this.fatura.gerarCobranca(s.faturaId);
          r.emitidasAgora++;
        }
      } catch (e) {
        const erro = (e as Error).message.slice(0, 200);
        // Não conseguiu apagar (ou emitir): mantém a cobrança antiga amarrada.
        await this.prisma.db.fatura.update({ where: { id: s.faturaId }, data: { status: 'FECHADA', asaasChargeId: s.chargeId } }).catch(() => undefined);
        r.mantidas.push({ vencimento: s.vencimento, chargeId: s.chargeId, erro });
        this.logger.warn(`caso ${casoId}: cobrança ${s.chargeId} mantida (${erro})`);
      }
    }
    const caso = await this.prisma.db.casoMigracaoLegado.findUnique({ where: { id: casoId }, select: { migracaoResumo: true, nome: true } });
    const resumo = { ...((caso?.migracaoResumo as Record<string, unknown> | null) ?? {}), cobrancasApagadas: r.apagadas, emitidasAgora: r.emitidasAgora, cobrancasMantidas: r.mantidas };
    await this.prisma.db.casoMigracaoLegado.update({ where: { id: casoId }, data: { migracaoResumo: resumo as Prisma.InputJsonValue } });
    if (r.mantidas.length) {
      await this.notificacao.emitir({
        titulo: `Legado: ${r.mantidas.length} cobrança(s) a vencer não foram substituídas — ${caso?.nome ?? casoId}`,
        corpo: `Ficaram amarradas à cobrança antiga do Asaas (o cliente paga o PIX que já tem). Vencimentos: ${r.mantidas.map((m) => m.vencimento).join(', ')}.`,
        rota: `/migracao-legado/${casoId}`,
        tipo: 'DINHEIRO',
        area: 'CARTEIRA_COBRANCA',
      }).catch(() => undefined);
    }
    return r;
  }

  // PUT /subscriptions/{id} { status: INACTIVE } — preserva as cobranças emitidas
  // (DELETE as apagaria — verificado no sandbox 21/09). Repetível pelo botão.
  async pararAssinatura(casoId: string, usuarioId: string) {
    const caso = await this.prisma.db.casoMigracaoLegado.findUnique({ where: { id: casoId }, select: { id: true, status: true, assinaturaId: true, assinaturaParadaEm: true, nome: true, contratoId: true } });
    if (!caso) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Caso não encontrado' });
    if (caso.status !== 'MIGRADO') throw new UnprocessableEntityException({ erro: 'nao_migrado', mensagem: 'Só um caso migrado tem a assinatura parada' });
    if (!caso.assinaturaId) return { parada: true, motivo: 'sem_assinatura' };
    if (caso.assinaturaParadaEm) return { parada: true, motivo: 'ja_parada' };
    if (this.asaasLeitura.ambiente === 'simulado') {
      await this.prisma.db.casoMigracaoLegado.update({ where: { id: casoId }, data: { assinaturaParadaEm: new Date(), assinaturaParadaErro: null, assinaturaAtiva: false, assinaturaStatus: 'INACTIVE (simulado)' } });
      return { parada: true, motivo: 'simulado' };
    }
    try {
      await this.asaasLeitura.requisicao('PUT', `/subscriptions/${caso.assinaturaId}`, { status: 'INACTIVE' });
      await this.prisma.db.casoMigracaoLegado.update({ where: { id: casoId }, data: { assinaturaParadaEm: new Date(), assinaturaParadaErro: null, assinaturaAtiva: false, assinaturaStatus: 'INACTIVE' } });
      await this.prisma.db.logAuditoria.create({ data: { usuarioId, acao: 'legado_assinatura_parada', entidade: 'caso_migracao_legado', entidadeId: casoId, depois: { assinaturaId: caso.assinaturaId } } });
      return { parada: true, motivo: 'ok' };
    } catch (e) {
      const erro = (e as Error).message.slice(0, 300);
      await this.prisma.db.casoMigracaoLegado.update({ where: { id: casoId }, data: { assinaturaParadaErro: erro } });
      await this.notificacao.emitir({
        titulo: `Legado: assinatura do Asaas NÃO foi parada — ${caso.nome}`,
        corpo: `O contrato já está no sistema, mas o Asaas continua emitindo pela assinatura antiga. Repita "Parar assinatura" no caso. Erro: ${erro}`,
        rota: `/migracao-legado/${casoId}`,
        tipo: 'DINHEIRO',
        area: 'CARTEIRA_COBRANCA',
      }).catch(() => undefined);
      return { parada: false, motivo: erro };
    }
  }

  // ---------------- Planejador (puro sobre o caso validado) ----------------

  private async planejar(caso: CasoValidado): Promise<PlanoMigracao> {
    const termos = caso.termos as unknown as TermosContratoLegado;
    const conc = this.conciliacao.conciliar(caso);
    const reconhecidas = new Map(conc.reconhecidas.map((r) => [r.chave, r]));
    const cobrancas = new Map(caso.cobrancas.map((c) => [c.id, c]));
    const chargeDe = (cobrancaId: string | null | undefined) => (cobrancaId ? cobrancas.get(cobrancaId)?.asaasPaymentId ?? null : null);
    const hoje = new Date().toISOString().slice(0, 10);

    // Quem é o titular
    const cpf = (termos.compradorCpf ?? caso.cpfCnpj ?? '').replace(/\D/g, '');
    if (!cpf) throw new UnprocessableEntityException({ erro: 'cpf_ausente', mensagem: 'O caso não tem CPF do comprador (termos ou cadastro do Asaas)' });
    const titularExistente = await this.prisma.db.titular.findUnique({ where: { cpfCnpj: cpf }, select: { id: true, nome: true, deletedAt: true } });
    if (titularExistente?.deletedAt) throw new UnprocessableEntityException({ erro: 'titular_excluido', mensagem: 'Existe um titular EXCLUÍDO com este CPF — restaure-o antes de migrar' });

    // Estrutura Azit (dona do capital de todos os veículos legados — §26.9 item 1)
    const estrutura = await this.prisma.db.estruturaJuridica.findFirst({ where: { ativo: true, nome: { contains: 'azit', mode: 'insensitive' } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!estrutura) throw new UnprocessableEntityException({ erro: 'estrutura_azit_ausente', mensagem: 'Cadastre a estrutura jurídica "Azit" em Capital antes de migrar o legado' });

    // Veículo
    const v = termos.veiculo;
    const descricaoVeiculo = [v.marca, v.modelo, v.anoModelo ?? v.anoFabricacao].filter(Boolean).join(' ') || 'Veículo (legado)';
    const placa = v.placa ? v.placa.replace(/[\s-]/g, '').toUpperCase() : null;
    let veiculoExistente: { id: string; descricao: string } | null = null;
    if (placa) {
      const a = await this.prisma.db.ativo.findFirst({ where: { placa, deletedAt: null }, select: { id: true, descricao: true, status: true, contratosCredito: { where: { status: { not: 'ENCERRADO' } }, select: { id: true } } } });
      if (a) {
        if (a.contratosCredito.length) throw new UnprocessableEntityException({ erro: 'veiculo_em_contrato', mensagem: `O veículo ${placa} já tem contrato ativo no sistema` });
        veiculoExistente = { id: a.id, descricao: a.descricao };
      }
    }

    // Termos essenciais
    const qtd = termos.parcelas.quantidade ?? 0;
    const valorParcela = termos.parcelas.valor ?? 0;
    const primeiraEm = termos.parcelas.primeiraEm;
    if (!qtd || !valorParcela || !primeiraEm) throw new UnprocessableEntityException({ erro: 'termos_incompletos', mensagem: 'Parcelas (quantidade, valor, 1ª) são obrigatórias' });
    const dataAssinatura = termos.dataAssinatura ?? primeiraEm;
    const valorTotal = termos.valorTotal ?? (termos.entradaValor ?? 0) + qtd * valorParcela;
    const seguro = termos.seguroSemanal ?? 0;
    const taxa = termos.taxaSemanal ?? 0;

    // Número do contrato
    const base = termos.numeroOrigem?.trim() || `LEG-${caso.id.slice(-6).toUpperCase()}`;
    const numeroOcupado = await this.prisma.db.contratoCredito.findFirst({ where: { numero: base }, select: { id: true } });
    const numero = numeroOcupado ? `${base}-${caso.id.slice(-4).toUpperCase()}` : base;

    // Deslocamento do dia da semana (§26.9 item 4, modo ASAAS): as futuras
    // seguem o dia da ÚLTIMA cobrança real.
    const modo = caso.modoVencimentos;
    const linhasParcela = conc.linhas.filter((l) => l.serie === 'parcela').sort((a, b) => a.numero - b.numero);
    const ultimaCobrada = [...linhasParcela].reverse().find((l) => l.cobradoEm);
    const deslocamento = modo === 'ASAAS' && ultimaCobrada?.cobradoEm ? difDias(ultimaCobrada.cobradoEm, ultimaCobrada.esperadoEm) : 0;

    const faturas: FaturaPlano[] = [];
    const rps: RpPlano[] = [];
    let rpAberto: { chave: string; idx: number } | null = null;
    const resumo = { faturasPagas: 0, faturasFechadas: 0, faturasAbertas: 0, parcelasPagas: 0, reembolsos: 0, avulsas: 0, encargos: 0, assinaturaId: caso.assinaturaId, substituidas: 0, emitidasAgora: 0 };
    // Fatura que já estaria no D-5 (vence em até 5 dias) é emitida na hora.
    const emitirAgora = (venc: string) => difDias(venc, hoje) <= 5;

    const statusDe = (l: LinhaConciliacao, rec: DivergenciaReconhecida | undefined, vencFatura: string): { status: StatusFaturaPlano; pagoEm: string | null; valorPago: number | null; chargeId: string | null; substituir: string | null } => {
      const chargeId = chargeDe(l.cobrancaId) ?? chargeDe(l.partes[0]?.cobrancaId);
      const pagaReal = l.situacao === 'paga' || l.situacao === 'paga_com_encargo';
      if (pagaReal || (l.situacao === 'valor_diverge' && l.pagoEm)) {
        const pagoEm = l.pagoEm ?? vencFatura;
        return { status: difDias(pagoEm, vencFatura) > 0 ? 'PAGA_EM_ATRASO' : 'PAGA', pagoEm, valorPago: l.pagoValor ?? l.cobradoValor ?? l.esperadoValor, chargeId, substituir: null };
      }
      if (rec?.desfecho === 'PAGA_FORA_ASAAS') return { status: 'PAGA', pagoEm: l.pagoEm ?? vencFatura, valorPago: l.esperadoValor, chargeId: null, substituir: null };
      if (rec?.desfecho === 'VALOR_ACEITO') return { status: 'PAGA', pagoEm: l.pagoEm ?? l.cobradoEm ?? vencFatura, valorPago: l.pagoValor ?? l.cobradoValor ?? l.esperadoValor, chargeId, substituir: null };
      // A vencer: a cobrança antiga é substituída pela do sistema (decisão 01/10).
      if (l.situacao === 'pendente' && chargeId) return { status: 'ABERTA', pagoEm: null, valorPago: null, chargeId: null, substituir: chargeId };
      if (l.situacao === 'vencida') return { status: 'FECHADA', pagoEm: null, valorPago: null, chargeId, substituir: null };
      return { status: 'ABERTA', pagoEm: null, valorPago: null, chargeId: null, substituir: null };
    };
    const contar = (status: StatusFaturaPlano, substituir: string | null, venc: string) => {
      if (status === 'PAGA' || status === 'PAGA_EM_ATRASO') resumo.faturasPagas++;
      else if (status === 'FECHADA') resumo.faturasFechadas++;
      else resumo.faturasAbertas++;
      if (substituir) { resumo.substituidas++; if (emitirAgora(venc)) resumo.emitidasAgora++; }
    };

    for (const l of linhasParcela) {
      const rec = reconhecidas.get(l.chave);
      const vencParcela = modo === 'ASAAS' ? (l.cobradoEm ?? addDias(l.esperadoEm, deslocamento)) : l.esperadoEm;
      const vencFatura = l.cobradoEm ?? vencParcela;
      const st = statusDe(l, rec, vencFatura);
      const comp = l.componentes;
      const cobrado = l.cobradoValor;
      // Proteção e taxa: a conciliação só traz valores lidos da descrição quando
      // diferem do padrão; o padrão do contrato (termos) é a referência.
      const segV = comp?.seguro || seguro;
      const taxV = comp?.taxa || taxa;
      const inter = comp?.intermediaria ?? 0;
      const extra = comp?.extra ?? 0;
      const principal = cobrado != null && comp ? Math.max(0, cobrado - segV - taxV - inter - extra) : valorParcela;
      const encargo = st.status === 'PAGA' || st.status === 'PAGA_EM_ATRASO' ? Math.max(0, l.encargo) : 0;
      const itens: ItemPlano[] = [{ tipo: 'PRINCIPAL', descricao: `Parcela ${l.numero}/${qtd} · Compra Parcelada ${descricaoVeiculo}`, valor: principal, parcela: 'veiculo' }];
      if (segV > 0) itens.push({ tipo: 'SERVICO', descricao: `Proteção veicular · ${l.numero}/${qtd}`, valor: segV, parcela: null });
      if (taxV > 0) itens.push({ tipo: 'SERVICO', descricao: `Taxa de boleto e PIX · ${l.numero}/${qtd}`, valor: taxV, parcela: null });
      if (inter > 0) itens.push({ tipo: 'INTERMEDIARIA', descricao: `Intermediária (entrada diluída) · ${l.numero}/${qtd}`, valor: inter, parcela: null });
      if (encargo > 0) { itens.push({ tipo: 'ENCARGO', descricao: 'Multa e juros de atraso (legado)', valor: encargo, parcela: 'veiculo' }); resumo.encargos += encargo; }
      const idx = faturas.length;
      // Despesa junto da parcela → Reembolso Parcelado (1 ou N) — consecutivas de mesmo rótulo formam um só RP
      if (extra > 0) {
        const rotulo = (comp?.extraRotulo ?? 'Despesa').replace(/\s*\(?\d+\s*\/\s*\d+\)?/g, '').trim() || 'Despesa';
        const chaveRp = rotulo.toLowerCase();
        if (!rpAberto || rpAberto.chave !== chaveRp) { rps.push({ rotulo, parcelas: [] }); rpAberto = { chave: chaveRp, idx: rps.length - 1 }; resumo.reembolsos++; }
        const rp = rps[rpAberto.idx];
        const n = rp.parcelas.length + 1;
        rp.parcelas.push({ n, valor: extra, faturaIdx: idx });
        itens.push({ tipo: 'PRINCIPAL', descricao: `Reembolso Parcelado · ${rotulo} ${n}/?`, valor: extra, parcela: { rp: rpAberto.idx, n } });
      } else {
        rpAberto = null;
      }
      const valorTotalFatura = cobrado ?? principal + segV + taxV + inter + extra;
      faturas.push({ origem: l.chave, vencimento: vencFatura, status: st.status, valorTotal: valorTotalFatura, valorPago: st.valorPago, pagoEm: st.pagoEm, asaasChargeId: st.chargeId, substituirChargeId: st.substituir, emitirAgora: !!st.substituir && emitirAgora(vencFatura), itens, parcela: { numero: l.numero, vencimento: vencParcela, valorNominal: valorParcela, principal, encargo } });
      contar(st.status, st.substituir, vencFatura);
      if (st.status === 'PAGA' || st.status === 'PAGA_EM_ATRASO') resumo.parcelasPagas++;
    }
    // Fecha "n/?" dos RPs agora que o total é conhecido
    for (const f of faturas) for (const it of f.itens) if (it.parcela && typeof it.parcela === 'object') it.descricao = it.descricao.replace('/?', `/${rps[it.parcela.rp].parcelas.length}`);

    // Intermediárias cobradas à parte
    for (const l of conc.linhas.filter((x) => x.serie === 'intermediaria')) {
      if (!l.cobradoEm && !reconhecidas.get(l.chave)) continue; // embutida na parcela (já é item) ou futura sem cobrança
      const venc = l.cobradoEm ?? l.esperadoEm;
      const st = statusDe(l, reconhecidas.get(l.chave), venc);
      if (st.status === 'ABERTA' && difDias(venc, hoje) < 0) continue;
      faturas.push({ origem: l.chave, vencimento: venc, status: st.status, valorTotal: l.cobradoValor ?? l.esperadoValor, valorPago: st.valorPago, pagoEm: st.pagoEm, asaasChargeId: st.chargeId, substituirChargeId: st.substituir, emitirAgora: !!st.substituir && emitirAgora(venc), itens: [{ tipo: 'INTERMEDIARIA', descricao: `Intermediária ${l.numero} (entrada diluída)`, valor: l.cobradoValor ?? l.esperadoValor, parcela: null }], parcela: null });
      contar(st.status, st.substituir, venc);
    }

    // Entrada (§26.8): valor do contrato, pago; as transações ficam como prova no caso
    const linhaEntrada = conc.linhas.find((x) => x.serie === 'entrada');
    let entrada: PlanoMigracao['entrada'] = null;
    if ((termos.entradaValor ?? 0) > 0) {
      const rec = linhaEntrada ? reconhecidas.get(linhaEntrada.chave) : undefined;
      const pagoEm = linhaEntrada?.pagoEm ?? linhaEntrada?.cobradoEm ?? dataAssinatura;
      const paga = !!linhaEntrada && (linhaEntrada.situacao === 'paga' || linhaEntrada.situacao === 'paga_com_encargo' || !!rec?.desfecho);
      entrada = { valor: termos.entradaValor ?? 0, pagoEm: paga ? pagoEm : dataAssinatura, asaasChargeId: chargeDe(linhaEntrada?.cobrancaId) ?? chargeDe(linhaEntrada?.partes[0]?.cobrancaId) };
    }

    // Fora do cronograma: reembolso solto → RP de 1 parcela com fatura própria;
    // o resto → fatura avulsa PAGA/FECHADA com um item de serviço (nada se perde)
    for (const f of conc.fora as ForaDoCronograma[]) {
      if (f.tipo === 'entrada') continue; // compõe a entrada (prova no caso)
      const cob = cobrancas.get(f.cobrancaId);
      if (!cob) continue;
      const pagoEm = cob.pagoEm ? isoDe(cob.pagoEm) : null;
      const venc = f.vencimento;
      let status: StatusFaturaPlano;
      let substituir: string | null = null;
      if (f.classe === 'paga') status = pagoEm && difDias(pagoEm, venc) > 0 ? 'PAGA_EM_ATRASO' : 'PAGA';
      else if (f.classe === 'pendente') { status = 'ABERTA'; substituir = cob.asaasPaymentId; }
      else if (f.classe === 'vencida') status = 'FECHADA';
      else continue;
      const chargeFora = substituir ? null : cob.asaasPaymentId;
      const valorPago = cob.valorPago != null ? Math.round(Number(cob.valorPago) * 100) : f.valorOriginal;
      const idx = faturas.length;
      if (f.tipo === 'reembolso') {
        const rotulo = (cob.descricao ?? 'Despesa').slice(0, 80);
        rps.push({ rotulo, parcelas: [{ n: 1, valor: f.valorOriginal, faturaIdx: idx }] });
        resumo.reembolsos++;
        faturas.push({ origem: `cobranca:${f.cobrancaId}`, vencimento: venc, status, valorTotal: f.valorOriginal, valorPago: status.startsWith('PAGA') ? valorPago : null, pagoEm: status.startsWith('PAGA') ? pagoEm : null, asaasChargeId: chargeFora, substituirChargeId: substituir, emitirAgora: !!substituir && emitirAgora(venc), itens: [{ tipo: 'PRINCIPAL', descricao: `Reembolso Parcelado · ${rotulo} 1/1`, valor: f.valorOriginal, parcela: { rp: rps.length - 1, n: 1 } }], parcela: null });
      } else {
        resumo.avulsas++;
        faturas.push({ origem: `cobranca:${f.cobrancaId}`, vencimento: venc, status, valorTotal: f.valorOriginal, valorPago: status.startsWith('PAGA') ? valorPago : null, pagoEm: status.startsWith('PAGA') ? pagoEm : null, asaasChargeId: chargeFora, substituirChargeId: substituir, emitirAgora: !!substituir && emitirAgora(venc), itens: [{ tipo: 'SERVICO', descricao: (cob.descricao ?? `Cobrança avulsa (legado, ${f.tipo})`).slice(0, 120), valor: f.valorOriginal, parcela: null }], parcela: null });
      }
      contar(status, substituir, venc);
    }

    return {
      titular: { cpfCnpj: cpf, nome: termos.compradorNome ?? caso.nome, existente: titularExistente ? { id: titularExistente.id, nome: titularExistente.nome } : null },
      veiculo: { descricao: descricaoVeiculo, placa, existente: veiculoExistente },
      estruturaId: estrutura.id,
      contrato: { numero, dataAssinatura, dataPrimeiraParcela: modo === 'ASAAS' ? (linhasParcela[0]?.cobradoEm ?? primeiraEm) : primeiraEm, numeroParcelas: qtd, valorParcela, valorTotal, valorEntrada: termos.entradaValor ?? 0, modoVencimentos: modo },
      entrada,
      faturas,
      rps,
      resumo,
    };
  }

  private async carregarValidado(casoId: string): Promise<CasoValidado> {
    const caso = await this.prisma.db.casoMigracaoLegado.findUnique({ where: { id: casoId }, include: { cobrancas: { where: { deletada: false } } } });
    if (!caso) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Caso não encontrado' });
    if (caso.status !== 'VALIDADO') throw new UnprocessableEntityException({ erro: 'nao_validado', mensagem: 'Só um caso VALIDADO pode ser migrado' });
    if (caso.contratoId) throw new UnprocessableEntityException({ erro: 'ja_migrado', mensagem: 'Este caso já gerou contrato' });
    if (!caso.termos) throw new UnprocessableEntityException({ erro: 'termos_ausentes', mensagem: 'Caso sem termos do contrato' });
    const pend = this.conciliacao.pendenciasParaValidar(caso);
    if (pend.length) throw new UnprocessableEntityException({ erro: 'pendencias', mensagem: `O caso tem pendências: ${pend.join('; ')}`, pendencias: pend });
    return caso as CasoValidado;
  }
}

type CasoValidado = Prisma.CasoMigracaoLegadoGetPayload<{ include: { cobrancas: true } }>;
