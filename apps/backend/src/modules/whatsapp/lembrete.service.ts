import { Injectable, Logger, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { AreaSistema, Prisma, SituacaoLembrete } from '@prisma/client';
import { DecisaoEnvioWhatsapp, MomentoLembrete } from '@azit/types';
import {
  dataCalendarioUTC,
  dentroDaJanelaLembrete,
  diaBrasil,
  faturaElegivelLembrete,
  formatarWhatsapp,
  FUSO_NEGOCIO,
  inicioDiaUTC,
  LEMBRETE_DIAS_ANTES,
  LEMBRETE_DIAS_ATRASO,
  LEMBRETE_HORA_FIM,
  LEMBRETE_HORA_INICIO,
  momentoLembreteDaFatura,
  MOMENTOS_LEMBRETE_PIX,
  normalizarWhatsapp,
  partesBrasil,
  pixCabeNoLembrete,
  situacaoLembreteAposStatusMeta,
  somarDiasISO,
  textoLembrete,
  textoLembretePix,
  variaveisLembrete,
  variaveisLembretePix,
  type MomentoLembretePix,
} from '@azit/utils';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AsaasService } from '../asaas/asaas.service';
import { FaturaService } from '../cobranca/fatura.service';
import { IntencaoPagamentoService } from '../faturamento/intencao-pagamento.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { WhatsappEnvioService } from './whatsapp-envio.service';
import { ReceptorStatusMeta, WhatsappEventosService } from './whatsapp-eventos.service';
import { WhatsappParametrosService, type ParametrosWhatsapp } from './whatsapp-parametros.service';
import { JOB_EVENTO_META, WhatsappProcessor } from './whatsapp.processor';

// ============================================================
// Lembretes de pagamento pelo WhatsApp — doc 02 §28 (decisão Luís 30/10,
// revista em 15/11). Dois momentos por fatura: D-2 (fatura disponível) e D0
// (vence hoje, se ainda em aberto), com o link da Fatura Azit. Nasce ANTES do
// atraso; não é a notificação formal da POP (não abre caso, sem PDF, sem prova).
//
// Regras de quem recebe e de qual momento são funções puras de @azit/utils;
// se a mensagem sai de verdade é decisão da regra única de envio (§23).
// ============================================================

export const JOB_LEMBRETES = 'lembretes';
const cent = (d: Prisma.Decimal | null | undefined): number => (d ? Math.round(Number(d.toString()) * 100) : 0);

const INCLUDE_FATURA = {
  conta: { include: { titular: { select: { id: true, nome: true, whatsapp: true } } } },
  parcelas: { select: { acordoId: true } },
  lembretes: true,
} satisfies Prisma.FaturaInclude;
type FaturaComTitular = Prisma.FaturaGetPayload<{ include: typeof INCLUDE_FATURA }>;

export interface ResumoVarredura {
  dia: string;
  executada: boolean;
  motivo: string | null; // por que não executou
  candidatas: number;
  enviados: number;
  simulados: number;
  retidos: number;
  falhas: number;
  ignoradas: number; // não elegíveis ou já com lembrete do momento
}

@Injectable()
export class LembreteService implements OnModuleInit, ReceptorStatusMeta {
  private readonly logger = new Logger(LembreteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parametros: WhatsappParametrosService,
    private readonly envio: WhatsappEnvioService,
    private readonly eventos: WhatsappEventosService,
    private readonly processor: WhatsappProcessor,
    private readonly asaas: AsaasService,
    private readonly alertas: NotificacaoService,
    @InjectQueue(QUEUE_NAMES.WHATSAPP) private readonly fila: Queue,
    private readonly intencoes: IntencaoPagamentoService,
    private readonly faturas: FaturaService,
    private readonly config: ConfigService,
  ) {}

  // A fila do WhatsApp tem UM consumidor; a situação de entrega chega por UM
  // webhook. Este serviço se registra nos dois.
  onModuleInit() {
    this.eventos.registrarReceptor(this);
    this.processor.registrarTratador(JOB_LEMBRETES, (job) => this.varrer((job.data ?? {}) as { ignorarJanela?: boolean }));
  }

  // ---------------- Varredura (job) ----------------

  // De hora em hora dentro da janela (9h–19h, fuso do Brasil — Regra 15). O
  // container roda em UTC: horário e chave do job vêm do fuso do negócio. A
  // chave por dia+hora deduplica réplicas; a chave única (fatura, momento)
  // garante um lembrete por momento mesmo com rodadas repetidas.
  @Cron(`0 ${LEMBRETE_HORA_INICIO}-${LEMBRETE_HORA_FIM - 1} * * *`, { timeZone: FUSO_NEGOCIO })
  async cronLembretes(): Promise<void> {
    const { dia, hora } = partesBrasil(new Date());
    await this.fila.add(JOB_LEMBRETES, {}, { jobId: `lembretes-${dia}-${String(hora).padStart(2, '0')}`, removeOnComplete: true, removeOnFail: 50 });
    this.logger.log('[cron] varredura dos lembretes de pagamento enfileirada');
  }

  async varrer(opts: { ignorarJanela?: boolean; agora?: Date } = {}): Promise<ResumoVarredura> {
    const agora = opts.agora ?? new Date();
    const hoje = diaBrasil(agora);
    const resumo: ResumoVarredura = { dia: hoje, executada: false, motivo: null, candidatas: 0, enviados: 0, simulados: 0, retidos: 0, falhas: 0, ignoradas: 0 };

    const params = await this.parametros.vigente();
    if (!params.ativo) return { ...resumo, motivo: 'envios automáticos desligados em Configuração › WhatsApp' };
    if (!opts.ignorarJanela && !dentroDaJanelaLembrete(agora)) {
      return { ...resumo, motivo: `fora da janela de envio (${LEMBRETE_HORA_INICIO}h às ${LEMBRETE_HORA_FIM}h, horário de Brasília)` };
    }
    resumo.executada = true;

    // Vencimento é coluna de DATA (dia-calendário gravado em UTC): as faturas
    // que vencem HOJE (D0), as que vencem daqui a 2 dias (D-2) e as que
    // venceram há 2 dias (D+2, §28.6), de titular com o lembrete ligado.
    const doDia = (d: string) => ({ dataVencimento: { gte: inicioDiaUTC(d), lt: inicioDiaUTC(somarDiasISO(d, 1)) } });
    const faturas = await this.prisma.db.fatura.findMany({
      where: {
        status: 'FECHADA',
        OR: [doDia(hoje), doDia(somarDiasISO(hoje, LEMBRETE_DIAS_ANTES)), doDia(somarDiasISO(hoje, -LEMBRETE_DIAS_ATRASO))],
        conta: { titular: { lembrete: { ativo: true } } },
      },
      include: INCLUDE_FATURA,
      orderBy: { dataVencimento: 'asc' },
    });
    resumo.candidatas = faturas.length;

    for (const f of faturas) {
      const momento = momentoLembreteDaFatura(dataCalendarioUTC(f.dataVencimento), hoje);
      if (!momento) { resumo.ignoradas += 1; continue; }
      const existente = f.lembretes.find((l) => l.momento === momento) ?? null;
      // Um por fatura por momento. Só o RETIDO do próprio dia é tentado de novo
      // (a credencial pode ter chegado); falha não tem reenvio automático.
      if (existente && !(existente.situacao === 'RETIDO' && existente.diaReferencia === hoje)) { resumo.ignoradas += 1; continue; }
      const elegivel = faturaElegivelLembrete({
        status: f.status,
        saldoCentavos: Math.max(0, cent(f.valorTotal) - cent(f.valorPago)),
        acordoId: f.acordoId,
        parcelas: f.parcelas,
        tokenPublico: f.tokenPublico,
      });
      if (!elegivel.elegivel) {
        this.logger.debug(`fatura ${f.id} sem lembrete: ${elegivel.motivo}`);
        resumo.ignoradas += 1;
        continue;
      }
      try {
        const situacao = await this.enviar(f, momento, hoje, params, existente?.id ?? null);
        if (situacao === 'ENVIADO') resumo.enviados += 1;
        else if (situacao === 'SIMULADO') resumo.simulados += 1;
        else if (situacao === 'RETIDO') resumo.retidos += 1;
        else if (situacao === 'FALHOU') resumo.falhas += 1;
        else resumo.ignoradas += 1;
      } catch (e) {
        // Uma fatura com problema não derruba as demais da rodada.
        this.logger.error(`lembrete da fatura ${f.id} (${momento}) falhou: ${(e as Error).message}`);
        resumo.falhas += 1;
      }
    }
    this.logger.log(
      `lembretes ${hoje}: ${resumo.candidatas} fatura(s), ${resumo.enviados} enviado(s), ${resumo.simulados} simulado(s), ${resumo.retidos} retido(s), ${resumo.falhas} falha(s), ${resumo.ignoradas} ignorada(s)`,
    );
    return resumo;
  }

  private async enviar(
    f: FaturaComTitular,
    momento: MomentoLembrete,
    hoje: string,
    params: ParametrosWhatsapp,
    retidoId: string | null,
  ): Promise<SituacaoLembrete | 'DUPLICADO'> {
    const titular = f.conta.titular;
    const saldo = Math.max(0, cent(f.valorTotal) - cent(f.valorPago)); // o SALDO, não o valor cheio
    const vencimentoISO = dataCalendarioUTC(f.dataVencimento);
    // No D+2 o valor é o de HOJE, com multa e atualização — o mesmo da ficha e
    // da página (§28.6). Antes de vencer não há encargo: vale o saldo.
    const valorCentavos = momento === MomentoLembrete.D_MAIS_2 ? ((await this.faturas.faltaHojeDaFatura(f.id)) ?? saldo) : saldo;
    const dados = { nomeTitular: titular.nome, numeroFatura: f.numero, valorCentavos, vencimentoISO };
    const destino = normalizarWhatsapp(titular.whatsapp);
    const link = `${(this.config.get<string>('faturaPublicaUrl') ?? '').replace(/\/+$/, '')}/${f.tokenPublico ?? ''}`;
    const modelo = params.modelos[momento];
    const baseLink = {
      faturaId: f.id,
      titularId: titular.id,
      momento,
      diaReferencia: hoje,
      destino,
      texto: textoLembrete(momento, dados),
      modeloNome: modelo.nome,
      modeloIdioma: modelo.idioma,
      intencaoId: null as string | null,
    };

    // Pix copia e cola na mensagem (§28.6): só D-2/D0, uma fatura em aberto do
    // modelo novo, e só quando a mensagem vai sair DE VERDADE (simulado e
    // retido não geram Pix no gateway). Qualquer impedimento = só o link.
    const pix = destino ? await this.prepararPix(f, momento, params, destino) : null;
    const base = pix
      ? {
          ...baseLink,
          texto: textoLembretePix(momento as MomentoLembretePix, { ...dados, valorCentavos: pix.intencao.valor }, link),
          modeloNome: params.modelosPix[momento as MomentoLembretePix].nome,
          modeloIdioma: params.modelosPix[momento as MomentoLembretePix].idioma,
          intencaoId: pix.intencao.id,
        }
      : baseLink;

    // Registra ANTES de falar com a Meta: se o processo cair no meio, o
    // lembrete fica "Enviando" e NÃO é mandado de novo (melhor faltar que dobrar).
    let id = retidoId;
    if (!id) {
      try {
        id = (await this.prisma.db.lembretePagamento.create({ data: { ...base, situacao: 'PREPARADO' }, select: { id: true } })).id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'DUPLICADO'; // outra réplica chegou antes
        throw e;
      }
    } else {
      await this.prisma.db.lembretePagamento.update({ where: { id }, data: { ...base } });
    }

    if (!destino) {
      const motivo = 'titular sem WhatsApp válido no cadastro';
      await this.prisma.db.lembretePagamento.update({ where: { id }, data: { situacao: 'FALHOU', motivo, falhaEm: new Date() } });
      await this.alertarFalha(titular, f.numero, motivo);
      return 'FALHOU';
    }

    const enviarSoLink = () =>
      this.envio.enviarModelo({
        destino,
        modelo: modelo.nome,
        idioma: modelo.idioma,
        variaveisCorpo: variaveisLembrete(dados, momento),
        sufixoBotaoUrl: f.tokenPublico ?? undefined,
      });
    let r;
    if (pix) {
      r = await this.envio.enviarModeloPedidoPix({
        destino,
        modelo: base.modeloNome,
        idioma: base.modeloIdioma,
        variaveisCorpo: variaveisLembretePix({ ...dados, valorCentavos: pix.intencao.valor }, link),
        pedido: {
          referencia: pix.intencao.id,
          itemNome: `Fatura nº ${f.numero}`,
          valorCentavos: pix.intencao.valor,
          codigoPix: pix.intencao.pixCopiaECola,
          recebedor: params.recebedorPix,
          chave: pix.chave.chave,
          tipoChave: pix.chave.tipo,
          expiraEm: pix.intencao.validoAte,
        },
      });
      // A Meta recusou o modelo com Pix (ainda em análise, pagamento não
      // habilitado, formato): o aviso não pode deixar de sair por causa do Pix —
      // vai só com o link, e o registro diz por quê (Regra 12).
      if (r.resultado === 'FALHOU') {
        const motivoPix = `o Pix não foi na mensagem (${r.motivo}); enviado só com o link`;
        this.logger.warn(`lembrete da fatura ${f.id}: ${motivoPix}`);
        await this.prisma.db.lembretePagamento.update({ where: { id }, data: { ...baseLink } });
        r = await enviarSoLink();
        if (r.resultado === 'ENVIADO') {
          await this.prisma.db.lembretePagamento.update({ where: { id }, data: { situacao: 'ENVIADO', mensagemId: r.mensagemId, enviadoEm: new Date(), motivo: motivoPix.slice(0, 500) } });
          return 'ENVIADO';
        }
      }
    } else {
      r = await enviarSoLink();
    }
    if (r.resultado === 'ENVIADO') {
      await this.prisma.db.lembretePagamento.update({ where: { id }, data: { situacao: 'ENVIADO', mensagemId: r.mensagemId, enviadoEm: new Date(), motivo: null } });
      return 'ENVIADO';
    }
    if (r.resultado === 'SIMULADO') {
      // Id de mentira (só fora de produção): permite à ferramenta de teste
      // exercitar o webhook de entrega; a situação continua SIMULADO.
      await this.prisma.db.lembretePagamento.update({ where: { id }, data: { situacao: 'SIMULADO', motivo: r.motivo, mensagemId: `wamid.SIMULADO.${id}` } });
      return 'SIMULADO';
    }
    if (r.resultado === 'RETIDO') {
      const jaHavia = await this.prisma.db.lembretePagamento.count({ where: { situacao: 'RETIDO', diaReferencia: hoje } });
      await this.prisma.db.lembretePagamento.update({ where: { id }, data: { situacao: 'RETIDO', motivo: r.motivo } });
      if (jaHavia === 0) {
        await this.alertas.emitir({
          titulo: 'Lembretes de pagamento retidos',
          corpo: 'O WhatsApp está sem credencial: os lembretes de hoje não saíram. Cadastre a credencial da Meta em Configuração › Integrações.',
          rota: '/configuracoes/whatsapp',
          tipo: 'FALHA',
          area: AreaSistema.CONFIGURACOES,
        });
      }
      return 'RETIDO';
    }
    await this.prisma.db.lembretePagamento.update({ where: { id }, data: { situacao: 'FALHOU', motivo: r.motivo, falhaEm: new Date() } });
    await this.alertarFalha(titular, f.numero, r.motivo);
    return 'FALHOU';
  }

  // Pix que vai junto (§28.6) — ou null, com o motivo no log, quando o lembrete
  // deve sair só com o link. Nunca lança.
  private async prepararPix(f: FaturaComTitular, momento: MomentoLembrete, params: ParametrosWhatsapp, destino: string) {
    try {
      if (!params.pixNoLembrete || !(MOMENTOS_LEMBRETE_PIX as MomentoLembrete[]).includes(momento)) return null;
      const decisao = await this.envio.decidir(destino);
      if (decisao.decisao !== DecisaoEnvioWhatsapp.ENVIA) return null; // simulado/retido: sem Pix no gateway
      const emAberto = await this.prisma.db.fatura.findMany({ where: { contaId: f.contaId, status: 'FECHADA' }, select: { id: true, valorTotal: true, valorPago: true } });
      const cabe = pixCabeNoLembrete({
        momento,
        faturaId: f.id,
        modeloEncargo: f.modeloEncargo,
        faturasEmAberto: emAberto.filter((x) => cent(x.valorTotal) - cent(x.valorPago) > 0).map((x) => x.id),
      });
      if (!cabe.cabe) {
        this.logger.debug(`lembrete da fatura ${f.id} sem Pix: ${cabe.motivo}`);
        return null;
      }
      const r = await this.intencoes.pixParaLembrete({ contaId: f.contaId, faturaId: f.id, ateDia: dataCalendarioUTC(f.dataVencimento) });
      if ('motivo' in r) {
        this.logger.warn(`lembrete da fatura ${f.id} sem Pix: ${r.motivo}`);
        return null;
      }
      const chave = await this.intencoes.chavePix();
      if (!chave || !r.intencao.pixCopiaECola) {
        this.logger.warn(`lembrete da fatura ${f.id} sem Pix: chave Pix de recebimento indisponível`);
        return null;
      }
      return { intencao: r.intencao, chave };
    } catch (e) {
      this.logger.warn(`lembrete da fatura ${f.id} sem Pix: ${(e as Error).message}`);
      return null;
    }
  }

  private alertarFalha(titular: { id: string; nome: string }, numeroFatura: number, motivo: string) {
    return this.alertas.emitir({
      titulo: `Lembrete de pagamento não saiu: ${titular.nome}`,
      corpo: `Fatura nº ${numeroFatura}: ${motivo}. O link pode ser enviado à mão pela ficha.`.slice(0, 300),
      rota: `/titulares/${titular.id}`,
      tipo: 'FALHA',
      area: AreaSistema.CARTEIRA_COBRANCA,
    });
  }

  // ---------------- Situação de entrega (webhook → fila) ----------------

  async aplicarStatusMeta(s: { mensagemId: string; status: string; quando: Date; motivoFalha?: string }): Promise<boolean> {
    const l = await this.prisma.db.lembretePagamento.findUnique({ where: { mensagemId: s.mensagemId } });
    if (!l) return false;
    const nova = situacaoLembreteAposStatusMeta(l.situacao, s.status);
    const data: Prisma.LembretePagamentoUpdateInput = {};
    // Carimbos: o primeiro horário informado pela Meta vale (ela reentrega).
    if (s.status === 'delivered' || s.status === 'read') data.entregueEm = l.entregueEm ?? s.quando;
    if (s.status === 'read') data.lidoEm = l.lidoEm ?? s.quando;
    if (nova) {
      data.situacao = nova;
      if (nova === 'FALHOU') {
        data.falhaEm = s.quando;
        data.motivo = (s.motivoFalha ?? 'falha informada pela Meta').slice(0, 500);
      } else if (l.situacao === 'FALHOU') {
        data.motivo = null;
      }
    }
    if (Object.keys(data).length > 0) await this.prisma.db.lembretePagamento.update({ where: { id: l.id }, data });
    if (nova === 'FALHOU') {
      const f = await this.prisma.db.fatura.findFirst({ where: { id: l.faturaId }, select: { numero: true, conta: { select: { titular: { select: { id: true, nome: true } } } } } });
      if (f) await this.alertarFalha(f.conta.titular, f.numero, data.motivo as string);
    }
    return true;
  }

  // ---------------- Lembrete por titular (ficha) ----------------

  private async titularOuErro(titularId: string) {
    const t = await this.prisma.db.titular.findFirst({ where: { id: titularId }, select: { id: true, nome: true, whatsapp: true, asaasCustomerId: true } });
    if (!t) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Titular não encontrado' });
    return t;
  }

  private async nomes(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unicos = [...new Set(ids.filter((i): i is string => !!i))];
    if (unicos.length === 0) return new Map();
    const us = await this.prisma.db.usuario.findMany({ where: { id: { in: unicos } }, select: { id: true, nome: true } });
    return new Map(us.map((u) => [u.id, u.nome]));
  }

  // Tudo o que a ficha mostra: o lembrete do titular, o aviso do Asaas, o que
  // aconteceria com um envio agora e os lembretes já registrados por fatura.
  async doTitular(titularId: string) {
    const t = await this.titularOuErro(titularId);
    const numeroCanonico = normalizarWhatsapp(t.whatsapp);
    const daConversa = { numero: numeroCanonico ?? '__sem_numero__' };
    const [cfg, params, lembretes, mensagensConversa, naoLidasConversa] = await Promise.all([
      this.prisma.db.lembreteTitular.findUnique({ where: { titularId } }),
      this.parametros.vigente(),
      this.prisma.db.lembretePagamento.findMany({
        where: { titularId },
        orderBy: { createdAt: 'desc' },
        take: 60,
        include: { fatura: { select: { id: true, numero: true, dataVencimento: true } } },
      }),
      // Atalho da ficha para a conversa do número do cadastro (doc 02 §24).
      this.prisma.db.mensagemWhatsapp.count({ where: daConversa }),
      this.prisma.db.mensagemWhatsapp.count({ where: { ...daConversa, direcao: 'ENTRADA', lidaEm: null } }),
    ]);
    const nomes = await this.nomes([cfg?.ligadoPorId, cfg?.desligadoPorId, cfg?.asaasAvisoAlteradoPorId]);
    const destino = numeroCanonico;
    const decisao = destino ? await this.envio.decidir(destino) : null;
    const ativo = cfg?.ativo ?? false;
    const avisoDesligado = cfg?.asaasAvisoDesligado ?? false;
    return {
      titularId: t.id,
      whatsapp: destino ? formatarWhatsapp(destino) : null,
      whatsappValido: !!destino,
      // Conversa deste número em Carteira › Conversas do WhatsApp (se o cliente já escreveu).
      conversa: { numero: destino, mensagens: mensagensConversa, naoLidas: naoLidasConversa },
      lembrete: {
        ativo,
        ligadoEm: cfg?.ligadoEm?.toISOString() ?? null,
        ligadoPor: cfg?.ligadoPorId ? nomes.get(cfg.ligadoPorId) ?? null : null,
        desligadoEm: cfg?.desligadoEm?.toISOString() ?? null,
        desligadoPor: cfg?.desligadoPorId ? nomes.get(cfg.desligadoPorId) ?? null : null,
      },
      avisoAsaas: {
        desligado: avisoDesligado,
        alteradoEm: cfg?.asaasAvisoAlteradoEm?.toISOString() ?? null,
        alteradoPor: cfg?.asaasAvisoAlteradoPorId ? nomes.get(cfg.asaasAvisoAlteradoPorId) ?? null : null,
        // true = decidido aqui, ainda não aplicado no Asaas (cliente ainda não existe lá).
        pendente: cfg?.asaasAvisoPendente ?? false,
        clienteNoAsaas: !!this.asaas.clienteReutilizavel(t.asaasCustomerId),
      },
      // Ninguém avisa este cliente: nem o lembrete, nem o Asaas (§28.1).
      semAvisoNenhum: !ativo && avisoDesligado,
      canal: {
        enviosAutomaticos: params.ativo,
        producao: this.parametros.producao(),
        // O que aconteceria com um lembrete para este número, agora (§23.2).
        decisao: decisao?.decisao ?? null,
        motivo: decisao?.motivo ?? null,
        enviaDeVerdade: decisao?.decisao === DecisaoEnvioWhatsapp.ENVIA,
      },
      lembretes: lembretes.map((l) => ({
        id: l.id,
        faturaId: l.faturaId,
        faturaNumero: l.fatura.numero,
        vencimento: l.fatura.dataVencimento.toISOString(),
        momento: l.momento,
        situacao: l.situacao,
        motivo: l.motivo,
        destino: l.destino ? formatarWhatsapp(l.destino) : null,
        texto: l.texto,
        modelo: l.modeloNome,
        comPix: !!l.intencaoId, // levou o Pix copia e cola (§28.6)
        registradoEm: l.createdAt.toISOString(),
        enviadoEm: l.enviadoEm?.toISOString() ?? null,
        entregueEm: l.entregueEm?.toISOString() ?? null,
        lidoEm: l.lidoEm?.toISOString() ?? null,
        falhaEm: l.falhaEm?.toISOString() ?? null,
      })),
    };
  }

  // Ligar é ato do operador (consentimento — §28.3), com quem e quando.
  async ligar(titularId: string, usuarioId: string) {
    const t = await this.titularOuErro(titularId);
    if (!normalizarWhatsapp(t.whatsapp)) {
      throw new UnprocessableEntityException({ erro: 'whatsapp_invalido', mensagem: 'O WhatsApp do cadastro deste titular não é um número válido. Corrija o cadastro antes de ligar o lembrete.' });
    }
    const agora = new Date();
    await this.prisma.db.lembreteTitular.upsert({
      where: { titularId },
      create: { titularId, ativo: true, ligadoEm: agora, ligadoPorId: usuarioId },
      update: { ativo: true, ligadoEm: agora, ligadoPorId: usuarioId },
    });
    await this.auditar(usuarioId, 'lembrete_whatsapp_ligado', titularId, { ativo: true });
    return this.doTitular(titularId);
  }

  async desligar(titularId: string, usuarioId: string) {
    await this.titularOuErro(titularId);
    const agora = new Date();
    await this.prisma.db.lembreteTitular.upsert({
      where: { titularId },
      create: { titularId, ativo: false, desligadoEm: agora, desligadoPorId: usuarioId },
      update: { ativo: false, desligadoEm: agora, desligadoPorId: usuarioId },
    });
    await this.auditar(usuarioId, 'lembrete_whatsapp_desligado', titularId, { ativo: false });
    return this.doTitular(titularId);
  }

  // "Sem dobro" (§28.1): desligar o aviso do próprio Asaas é ato EXPLÍCITO e
  // separado de ligar o lembrete. Com cliente já cadastrado lá, altera na hora;
  // sem cliente, a decisão fica registrada e vale quando ele for criado.
  async definirAvisoAsaas(titularId: string, desligado: boolean, usuarioId: string) {
    const t = await this.titularOuErro(titularId);
    const cfg = await this.prisma.db.lembreteTitular.findUnique({ where: { titularId } });
    if (desligado && !cfg?.ativo) {
      throw new UnprocessableEntityException({
        erro: 'lembrete_desligado',
        mensagem: 'Ligue o lembrete pelo WhatsApp antes de desligar o aviso do Asaas — senão ninguém avisa este cliente.',
      });
    }
    const customerId = this.asaas.clienteReutilizavel(t.asaasCustomerId);
    let pendente = false;
    if (customerId) {
      try {
        await this.asaas.definirAvisoCliente(customerId, desligado);
      } catch (e) {
        this.logger.warn(`aviso do Asaas do titular ${titularId} não foi alterado: ${(e as Error).message}`);
        throw new UnprocessableEntityException({
          erro: 'asaas_recusou',
          mensagem: 'O Asaas não aceitou a alteração do cadastro do cliente. Nada foi mudado; tente de novo em instantes.',
        });
      }
    } else {
      pendente = desligado; // vale na criação do cliente (AsaasService.criarCliente)
    }
    const agora = new Date();
    const dados = { asaasAvisoDesligado: desligado, asaasAvisoAlteradoEm: agora, asaasAvisoAlteradoPorId: usuarioId, asaasAvisoPendente: pendente };
    await this.prisma.db.lembreteTitular.upsert({ where: { titularId }, create: { titularId, ...dados }, update: dados });
    await this.auditar(usuarioId, desligado ? 'aviso_asaas_desligado' : 'aviso_asaas_religado', titularId, { desligado, aplicadoNoAsaas: !!customerId, pendente });
    return this.doTitular(titularId);
  }

  private auditar(usuarioId: string, acao: string, titularId: string, depois: Record<string, unknown>) {
    return this.prisma.db.logAuditoria.create({ data: { usuarioId, acao, entidade: 'titular', entidadeId: titularId, depois: depois as Prisma.InputJsonValue } });
  }

  // ---------------- Visão geral (Configuração › WhatsApp) ----------------

  async resumo() {
    const hoje = diaBrasil(new Date());
    const [porSituacaoHoje, retidos, titularesLigados, ultimos] = await Promise.all([
      this.prisma.db.lembretePagamento.groupBy({ by: ['situacao'], where: { diaReferencia: hoje }, _count: { _all: true } }),
      this.prisma.db.lembretePagamento.count({ where: { situacao: 'RETIDO' } }),
      this.prisma.db.lembreteTitular.count({ where: { ativo: true } }),
      this.prisma.db.lembretePagamento.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { fatura: { select: { numero: true, dataVencimento: true } }, titular: { select: { id: true, nome: true } } },
      }),
    ]);
    return {
      dia: hoje,
      titularesComLembrete: titularesLigados,
      hoje: Object.fromEntries(porSituacaoHoje.map((g) => [g.situacao, g._count._all])) as Record<string, number>,
      retidos,
      ultimos: ultimos.map((l) => ({
        id: l.id,
        titular: l.titular,
        faturaNumero: l.fatura.numero,
        vencimento: l.fatura.dataVencimento.toISOString(),
        momento: l.momento,
        situacao: l.situacao,
        motivo: l.motivo,
        registradoEm: l.createdAt.toISOString(),
      })),
    };
  }

  // ---------------- Ferramentas de teste (fora de produção) ----------------

  // Simula a situação de entrega que a Meta mandaria pelo webhook, passando
  // pela MESMA fila do webhook real (doc 02 §23.4: depois da entrada em
  // produção o homolog não recebe mais entrega nem leitura).
  async simularStatus(lembreteId: string, status: 'delivered' | 'read' | 'failed') {
    const l = await this.prisma.db.lembretePagamento.findUnique({ where: { id: lembreteId } });
    if (!l) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Lembrete não encontrado' });
    if (!l.mensagemId) throw new UnprocessableEntityException({ erro: 'sem_mensagem', mensagem: 'Este lembrete não chegou a ser enviado nem simulado.' });
    const evento = {
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: l.mensagemId, status, timestamp: String(Math.floor(Date.now() / 1000)), ...(status === 'failed' ? { errors: [{ code: 131026, title: 'Mensagem não entregue (simulado)' }] } : {}) }] } }] }],
    };
    await this.fila.add(JOB_EVENTO_META, evento, { removeOnComplete: true, removeOnFail: 50 });
    return { enfileirado: true };
  }
}
