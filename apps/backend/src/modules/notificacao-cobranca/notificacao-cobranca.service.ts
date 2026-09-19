import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { Prisma, StatusNotificacaoCobranca } from '@prisma/client';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  avaliarCasoCobranca,
  calcularEncargoAtraso,
  diasAtrasoCalendario,
  ETAPAS_NOTIFICACAO,
  formatCurrency,
  inicioHojeBrasilUTC,
  vencimentosDistintos,
  type AvaliacaoCaso,
  type EtapaNotificacao,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { TEXTOS_POP, VARIAVEIS_NOTIFICACAO, preencher, type TextoNotificacao } from './textos-pop';
import { gerarPdfDossie, gerarPdfNotificacao } from './pdf-notificacao';
import { normalizarWhatsapp, WhatsappMetaService } from './whatsapp-meta.service';

// ============================================================
// Notificações formais de cobrança — POP-COB-001 (doc 02 §23, decisão Luís
// 19/09). Orquestra: sincroniza o CASO de cada contrato de veículo, avalia
// pelo motor puro (@azit/utils avaliarCasoCobranca), gera texto + PDF + hash,
// envia pela Cloud API da Meta (ou simula FORA de produção) e guarda a prova.
// O webhook da Meta devolve entrega/leitura/falha — processado na fila.
// ============================================================

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'notificacoes');
const CONTAM_COMO_ENVIADA: StatusNotificacaoCobranca[] = ['ENVIADA', 'ENTREGUE', 'LIDA', 'SIMULADA'];
const MAX_TENTATIVAS_AUTOMATICAS = 3;
const ROTULO_STATUS: Record<StatusNotificacaoCobranca, string> = {
  PREPARADA: 'Preparada (envio em curso)',
  ENVIADA: 'Enviada',
  ENTREGUE: 'Entregue',
  LIDA: 'Lida',
  FALHOU: 'Falhou',
  SIMULADA: 'SIMULADA — não enviada',
};

const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const cent = (d: Prisma.Decimal | number) => Math.round(Number(d.toString()) * 100);
const dataBR = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const dataVencBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const horaBR = (d: Date) => d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const listaBR = (itens: string[]) => (itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`);

type Evento = { em: string; tipo: string; detalhe?: string };

const INCLUDE_CONTRATO = {
  conta: { include: { titular: { select: { nome: true, cpfCnpj: true, whatsapp: true } } } },
  ativo: { select: { id: true, tipo: true, marca: true, modelo: true, descricao: true, placa: true } },
} satisfies Prisma.ContratoCreditoInclude;
type ContratoAlvo = Prisma.ContratoCreditoGetPayload<{ include: typeof INCLUDE_CONTRATO }>;

export interface EstadoPop {
  contratoId: string;
  casoId: string | null;
  vencimentos: string[];
  diasAtraso: number;
  valorAtualizado: number; // centavos
  avaliacao: AvaliacaoCaso;
  noJuridico: boolean;
  retomadoEm: Date | null;
}

export interface ParametrosEfetivos {
  ativo: boolean;
  modeloNome: string;
  modeloIdioma: string;
  textos: Record<number, TextoNotificacao & { personalizado: boolean }>;
  numerosTeste: string[]; // fora de produção, só estes recebem de verdade (§23 item 10)
}

@Injectable()
export class NotificacaoCobrancaService {
  private readonly logger = new Logger(NotificacaoCobrancaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly alertas: NotificacaoService,
    private readonly meta: WhatsappMetaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICACAO_COBRANCA) private readonly fila: Queue,
  ) {}

  private producao(): boolean {
    return this.config.get<string>('ambiente') === 'producao';
  }

  // Produção NUNCA simula: sem credencial as notificações ficam retidas (o
  // caso não avança — a cadeia de prova nunca contém um envio que não houve).
  provedorDisponivel(): { disponivel: boolean; simulado: boolean } {
    const meta = this.meta.configurado();
    return { disponivel: meta || !this.producao(), simulado: !meta };
  }

  // ---------------- Parâmetros ----------------

  async parametros(): Promise<ParametrosEfetivos> {
    const p = await this.prisma.db.parametroNotificacaoCobranca.findFirst();
    const personalizados = (p?.textos ?? {}) as unknown as Record<string, TextoNotificacao>;
    const textos: ParametrosEfetivos['textos'] = {};
    for (const etapa of [1, 2, 3, 4, 5, 6]) {
      const custom = personalizados[String(etapa)];
      textos[etapa] = custom ? { ...custom, personalizado: true } : { ...TEXTOS_POP[etapa], personalizado: false };
    }
    return {
      ativo: p?.ativo ?? false,
      modeloNome: p?.modeloNome ?? 'azit_notificacao_cobranca',
      modeloIdioma: p?.modeloIdioma ?? 'pt_BR',
      textos,
      numerosTeste: p?.numerosTeste ?? [],
    };
  }

  // Número real único em todos os ambientes (doc 02 §23 item 10): envia de
  // verdade só com credencial E (produção OU destino autorizado no ambiente).
  // Retorna o motivo quando NÃO é real — vira o registro da SIMULADA.
  private motivoSimulacao(destino: string | null, numerosTeste: string[]): string | null {
    if (!this.meta.configurado()) return 'ambiente sem credencial do WhatsApp — nada foi enviado';
    if (this.producao()) return null;
    if (destino && numerosTeste.includes(destino)) return null;
    return `destino ${destino ? `+${destino}` : '(sem WhatsApp válido)'} fora da lista de números autorizados deste ambiente de teste — nada foi enviado`;
  }

  async parametrosTela() {
    const p = await this.parametros();
    const prov = this.provedorDisponivel();
    return {
      ...p,
      variaveis: VARIAVEIS_NOTIFICACAO,
      etapas: ETAPAS_NOTIFICACAO,
      provedor: { configurado: !prov.simulado, simulado: prov.simulado, producao: this.producao() },
      numerosTeste: p.numerosTeste,
      janela: 'Dias úteis, das 9h às 17h (horário de Brasília) — feriados nacionais excluídos',
    };
  }

  async salvarParametros(
    dto: {
      ativo?: boolean;
      modeloNome?: string;
      modeloIdioma?: string;
      textos?: Record<string, { subtitulo?: string; assunto: string; texto: string } | null>;
      numerosTeste?: string[];
    },
    usuarioId?: string,
  ) {
    const atual = await this.prisma.db.parametroNotificacaoCobranca.findFirst();
    let numerosTeste = atual?.numerosTeste ?? [];
    if (dto.numerosTeste !== undefined) {
      if (this.producao()) {
        throw new UnprocessableEntityException({ erro: 'so_teste', mensagem: 'A lista de números autorizados só vale em ambientes de teste — em produção todos os clientes recebem.' });
      }
      const normalizados = dto.numerosTeste.map((n) => ({ bruto: n, ok: normalizarWhatsapp(n) }));
      const invalido = normalizados.find((n) => !n.ok);
      if (invalido) {
        throw new UnprocessableEntityException({ erro: 'numero_invalido', mensagem: `"${invalido.bruto}" não é um WhatsApp brasileiro válido (DDD + número)` });
      }
      numerosTeste = [...new Set(normalizados.map((n) => n.ok as string))];
    }
    if (dto.ativo === true && this.producao() && !this.meta.configurado()) {
      throw new UnprocessableEntityException({
        erro: 'sem_credencial',
        mensagem: 'Configure o WhatsApp (Meta) em Configurações > Integrações antes de ligar o disparo automático em produção.',
      });
    }
    const textos = { ...((atual?.textos ?? {}) as unknown as Record<string, TextoNotificacao>) };
    for (const [k, v] of Object.entries(dto.textos ?? {})) {
      if (!['1', '2', '3', '4', '5', '6'].includes(k)) {
        throw new UnprocessableEntityException({ erro: 'etapa_invalida', mensagem: `Etapa ${k} não existe (1 a 6)` });
      }
      if (v === null) {
        delete textos[k]; // volta ao padrão do POP
        continue;
      }
      if (!v.assunto?.trim() || !v.texto?.trim() || v.texto.length > 20_000) {
        throw new UnprocessableEntityException({ erro: 'texto_invalido', mensagem: `Assunto e texto da etapa ${k} são obrigatórios (até 20 mil caracteres)` });
      }
      textos[k] = { subtitulo: v.subtitulo?.trim() || TEXTOS_POP[Number(k)].subtitulo, assunto: v.assunto.trim(), texto: v.texto.trim() };
    }
    const data = {
      ativo: dto.ativo ?? atual?.ativo ?? false,
      modeloNome: dto.modeloNome?.trim() || atual?.modeloNome || 'azit_notificacao_cobranca',
      modeloIdioma: dto.modeloIdioma?.trim() || atual?.modeloIdioma || 'pt_BR',
      textos: textos as unknown as Prisma.InputJsonValue,
      numerosTeste,
    };
    const salvo = atual
      ? await this.prisma.db.parametroNotificacaoCobranca.update({ where: { id: atual.id }, data })
      : await this.prisma.db.parametroNotificacaoCobranca.create({ data });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'notificacoes_cobranca_parametros',
        entidade: 'parametro_notificacao_cobranca',
        entidadeId: salvo.id,
        antes: atual ? ({ ativo: atual.ativo, modeloNome: atual.modeloNome, etapasPersonalizadas: Object.keys(atual.textos as object) } as Prisma.InputJsonValue) : undefined,
        depois: { ativo: data.ativo, modeloNome: data.modeloNome, etapasPersonalizadas: Object.keys(textos), numerosTeste } as Prisma.InputJsonValue,
      },
    });
    return this.parametrosTela();
  }

  // ---------------- Avaliação ----------------

  private hoje() {
    return inicioHojeBrasilUTC();
  }

  private async contratosAlvo(ids?: string[]): Promise<ContratoAlvo[]> {
    return this.prisma.db.contratoCredito.findMany({
      where: { status: 'ATIVO', deletedAt: null, ativo: { tipo: 'VEICULO' }, ...(ids ? { id: { in: ids } } : {}) },
      include: INCLUDE_CONTRATO,
    });
  }

  private async vencidas(ids: string[]) {
    const linhas = await this.prisma.db.parcela.findMany({
      where: { contratoId: { in: ids }, status: null, acordoId: null, deletedAt: null, dataVencimento: { lt: this.hoje() } },
      select: { contratoId: true, dataVencimento: true, valorNominal: true },
    });
    const por = new Map<string, typeof linhas>();
    for (const l of linhas) por.set(l.contratoId, [...(por.get(l.contratoId) ?? []), l]);
    return por;
  }

  private async casosAbertos(ids: string[]) {
    const casos = await this.prisma.db.casoCobranca.findMany({
      where: { contratoId: { in: ids }, encerradoEm: null },
      include: { notificacoes: true },
    });
    return new Map(casos.map((c) => [c.contratoId, c]));
  }

  private enviadasDoCaso(notifs: { etapa: number; status: StatusNotificacaoCobranca; enviadaEm: Date | null }[]) {
    const enviadas: Partial<Record<EtapaNotificacao, Date>> = {};
    for (const n of notifs) {
      if (CONTAM_COMO_ENVIADA.includes(n.status) && n.enviadaEm) enviadas[n.etapa as EtapaNotificacao] = n.enviadaEm;
    }
    return enviadas;
  }

  // Estado POP de vários contratos em 3 consultas (régua lista todos).
  async avaliar(contratos: ContratoAlvo[], opts: { ignorarJanela?: boolean } = {}): Promise<Map<string, EstadoPop>> {
    const ids = contratos.map((c) => c.id);
    const res = new Map<string, EstadoPop>();
    if (!ids.length) return res;
    const [vencidas, casos] = await Promise.all([this.vencidas(ids), this.casosAbertos(ids)]);
    const agora = new Date();
    for (const c of contratos) {
      const linhas = vencidas.get(c.id) ?? [];
      const vencimentos = vencimentosDistintos(linhas.map((l) => l.dataVencimento));
      const diasAtraso = vencimentos.length ? diasAtrasoCalendario(new Date(`${vencimentos[0]}T00:00:00.000Z`)) : 0;
      const multa = Number(c.taxaMultaAtraso.toString());
      const juros = Number(c.taxaJurosAtraso.toString());
      const valorAtualizado = linhas.reduce((s, l) => {
        const v = Number(l.valorNominal.toString());
        return s + cent(v + calcularEncargoAtraso(v, diasAtrasoCalendario(l.dataVencimento), multa, juros));
      }, 0);
      const caso = casos.get(c.id);
      const avaliacao = avaliarCasoCobranca({
        vencimentosEmAtraso: vencimentos,
        diasAtraso,
        enviadas: this.enviadasDoCaso(caso?.notificacoes ?? []),
        veiculoRetomadoEm: c.veiculoRetomadoEm,
        noJuridico: !!c.cobrancaJuridicaEm,
        agora,
        ignorarJanela: opts.ignorarJanela,
      });
      res.set(c.id, { contratoId: c.id, casoId: caso?.id ?? null, vencimentos, diasAtraso, valorAtualizado, avaliacao, noJuridico: !!c.cobrancaJuridicaEm, retomadoEm: c.veiculoRetomadoEm });
    }
    return res;
  }

  async avaliarPorIds(ids: string[]) {
    return this.avaliar(await this.contratosAlvo(ids));
  }

  // ---------------- Varredura (cron + fila) ----------------

  // De hora em hora dentro da janela (dias úteis 9h–16h05, Brasília). O motor
  // ainda confere feriado e janela; o jobId por hora deduplica réplicas.
  @Cron('5 9-16 * * 1-5', { timeZone: 'America/Sao_Paulo' })
  async cronVarredura(): Promise<void> {
    const hora = new Date().toISOString().slice(0, 13);
    await this.fila.add('varrer', {}, { jobId: `notif-varrer-${hora}`, removeOnComplete: true, removeOnFail: 50 });
  }

  async varrer(opts: { ignorarJanela?: boolean; contratoIds?: string[] } = {}) {
    const params = await this.parametros();
    const contratos = await this.contratosAlvo(opts.contratoIds);
    const idsAlvo = new Set(contratos.map((c) => c.id));
    let encerrados = 0;
    let abertos = 0;
    let enfileirados = 0;

    // Contrato que saiu de Ativo (quitação, novação, cancelamento) encerra o caso.
    if (!opts.contratoIds) {
      const orfaos = await this.prisma.db.casoCobranca.findMany({ where: { encerradoEm: null, contratoId: { notIn: [...idsAlvo] } } });
      for (const o of orfaos) {
        await this.prisma.db.casoCobranca.update({ where: { id: o.id }, data: { encerradoEm: new Date(), motivoEncerramento: 'contrato_encerrado' } });
        encerrados += 1;
      }
    }

    let estados = await this.avaliar(contratos, opts);
    for (const c of contratos) {
      const e = estados.get(c.id)!;
      if (e.vencimentos.length > 0 && !e.casoId) {
        try {
          await this.prisma.db.casoCobranca.create({ data: { contratoId: c.id } });
          abertos += 1;
        } catch (err) {
          // P2002: outra réplica abriu o mesmo caso (índice parcial único).
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        }
      } else if (e.vencimentos.length === 0 && e.casoId) {
        await this.prisma.db.casoCobranca.update({ where: { id: e.casoId }, data: { encerradoEm: new Date(), motivoEncerramento: 'regularizado' } });
        encerrados += 1;
      }
    }
    if (abertos) estados = await this.avaliar(contratos, opts);

    const prov = this.provedorDisponivel();
    let retidas = 0;
    for (const e of estados.values()) {
      const etapa = e.avaliacao.enviarAgora;
      if (!etapa || !e.casoId || etapa === 6) continue;
      if (!params.ativo) continue;
      if (!prov.disponivel) {
        retidas += 1;
        continue;
      }
      const falhas = await this.prisma.db.notificacaoCobranca.findUnique({ where: { casoId_etapa: { casoId: e.casoId, etapa } }, select: { tentativas: true, status: true } });
      if (falhas && falhas.status === 'FALHOU' && falhas.tentativas >= MAX_TENTATIVAS_AUTOMATICAS) continue;
      await this.fila.add(
        'enviar',
        { casoId: e.casoId, etapa, disparo: 'automatico', ignorarJanela: !!opts.ignorarJanela },
        { jobId: `notif-${e.casoId}-${etapa}-${falhas?.tentativas ?? 0}`, removeOnComplete: true, removeOnFail: 50, attempts: 1 },
      );
      enfileirados += 1;
    }
    if (retidas) this.logger.warn(`${retidas} notificação(ões) retida(s): produção sem credencial do WhatsApp`);
    return { contratos: contratos.length, casosAbertos: abertos, casosEncerrados: encerrados, enfileirados, retidas, disparoAutomatico: params.ativo };
  }

  // ---------------- Envio ----------------

  private async variaveis(contrato: ContratoAlvo, estado: EstadoPop, enviadas: Partial<Record<EtapaNotificacao, Date>>) {
    const linhas = (await this.vencidas([contrato.id])).get(contrato.id) ?? [];
    const maisAntigo = estado.vencimentos[0];
    const valorMaisAntigo = linhas
      .filter((l) => l.dataVencimento.toISOString().slice(0, 10) === maisAntigo)
      .reduce((s, l) => s + cent(l.valorNominal), 0);
    const a = contrato.ativo;
    const vars: Record<string, string> = {
      nome: contrato.conta.titular.nome,
      veiculo: [a?.marca, a?.modelo].filter(Boolean).join(' ') || a?.descricao || 'veículo',
      placa: a?.placa ?? 'sem placa',
      contrato: contrato.numero,
      dataContrato: dataBR(contrato.dataAssinatura),
      vencimento: maisAntigo ? dataVencBR(maisAntigo) : '',
      valorParcela: formatCurrency(valorMaisAntigo),
      vencimento1: maisAntigo ? dataVencBR(maisAntigo) : '',
      // POP §10: a 3ª cita a parcela original e a 2ª que venceu (a mais RECENTE);
      // a lista completa fica em {{vencimentos}} e o total no valor atualizado.
      vencimento2: estado.vencimentos.length > 1 ? dataVencBR(estado.vencimentos[estado.vencimentos.length - 1]) : '',
      vencimentos: listaBR(estado.vencimentos.map(dataVencBR)),
      quantidadeParcelas: String(estado.vencimentos.length),
      valorAtualizado: formatCurrency(estado.valorAtualizado),
      dataComunicacao: dataBR(new Date()),
    };
    if (contrato.veiculoRetomadoEm) vars.dataRetomada = dataBR(contrato.veiculoRetomadoEm);
    for (const [k, d] of Object.entries(enviadas)) {
      if (!d) continue;
      vars[`n${k}Data`] = dataBR(d);
      vars[`n${k}Hora`] = horaBR(d);
    }
    return vars;
  }

  private async anexarEvento(id: string, ev: Omit<Evento, 'em'> & { em?: string }) {
    const atual = await this.prisma.db.notificacaoCobranca.findUnique({ where: { id }, select: { eventos: true } });
    const eventos = [...((atual?.eventos as Evento[] | null) ?? []), { em: ev.em ?? new Date().toISOString(), tipo: ev.tipo, detalhe: ev.detalhe }];
    return eventos as Prisma.InputJsonValue;
  }

  async enviar(job: { casoId: string; etapa: EtapaNotificacao; disparo: 'automatico' | 'manual'; usuarioId?: string; ignorarJanela?: boolean }) {
    const caso = await this.prisma.db.casoCobranca.findUnique({ where: { id: job.casoId }, include: { notificacoes: true } });
    if (!caso) return { resultado: 'caso_inexistente' };
    if (caso.encerradoEm) return { resultado: 'caso_encerrado' };
    const existente = caso.notificacoes.find((n) => n.etapa === job.etapa);
    if (existente && CONTAM_COMO_ENVIADA.includes(existente.status)) return { resultado: 'ja_enviada' };

    const [contrato] = await this.contratosAlvo([caso.contratoId]);
    if (!contrato) return { resultado: 'contrato_fora_do_escopo' };
    const estado = (await this.avaliar([contrato], { ignorarJanela: job.ignorarJanela })).get(contrato.id)!;
    const params = await this.parametros();

    if (job.disparo === 'automatico') {
      // Revalida no momento do envio: pagamento/acordo pode ter chegado entre
      // a varredura e a execução.
      if (!params.ativo) return { resultado: 'disparo_desligado' };
      if (estado.avaliacao.enviarAgora !== job.etapa) return { resultado: 'condicao_mudou' };
      if (existente && existente.tentativas >= MAX_TENTATIVAS_AUTOMATICAS) return { resultado: 'limite_tentativas' };
    }
    const prov = this.provedorDisponivel();
    if (!prov.disponivel) {
      throw new UnprocessableEntityException({ erro: 'sem_credencial', mensagem: 'WhatsApp (Meta) sem credencial — em produção a notificação não é simulada. Configure em Configurações > Integrações.' });
    }

    // Conteúdo + prova.
    const enviadas = this.enviadasDoCaso(caso.notificacoes);
    const vars = await this.variaveis(contrato, estado, enviadas);
    const modelo = params.textos[job.etapa];
    const assunto = preencher(modelo.assunto, vars);
    const texto = preencher(modelo.texto, vars);
    const textoSha256 = sha256(texto);
    const meta = ETAPAS_NOTIFICACAO[job.etapa];
    const tentativa = (existente?.tentativas ?? 0) + 1;
    const pdf = await gerarPdfNotificacao({
      titulo: meta.titulo,
      subtitulo: modelo.subtitulo,
      assunto,
      texto,
      notificado: contrato.conta.titular.nome,
      contrato: contrato.numero,
      emitidaEm: new Date(),
      textoSha256,
    });
    const pdfRef = `${caso.id}-${job.etapa}-${tentativa}.pdf`;
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(join(UPLOADS_DIR, pdfRef), pdf);
    const destino = normalizarWhatsapp(contrato.conta.titular.whatsapp);

    const base = {
      status: 'PREPARADA' as const,
      disparo: job.disparo,
      usuarioId: job.usuarioId ?? null,
      destino,
      assunto,
      texto,
      textoSha256,
      pdfRef,
      pdfSha256: sha256(pdf),
      dados: { ...vars, valorAtualizadoCentavos: estado.valorAtualizado, vencimentos: estado.vencimentos, diasAtraso: estado.diasAtraso } as Prisma.InputJsonValue,
      tentativas: tentativa,
      falhaEm: null,
      falhaMotivo: null,
    };
    const registro = existente
      ? await this.prisma.db.notificacaoCobranca.update({
          where: { id: existente.id },
          data: { ...base, eventos: await this.anexarEvento(existente.id, { tipo: 'preparada', detalhe: `tentativa ${tentativa} (${job.disparo})` }) },
        })
      : await this.prisma.db.notificacaoCobranca.create({
          data: { ...base, casoId: caso.id, contratoId: contrato.id, etapa: job.etapa, eventos: [{ em: new Date().toISOString(), tipo: 'preparada', detalhe: `tentativa 1 (${job.disparo})` }] },
        });

    let final: StatusNotificacaoCobranca;
    // Fora de produção: só destinos autorizados recebem de verdade (§23 item 10).
    const motivoSimulada = this.motivoSimulacao(destino, params.numerosTeste);
    try {
      if (motivoSimulada) {
        await this.prisma.db.notificacaoCobranca.update({
          where: { id: registro.id },
          data: { status: 'SIMULADA', provedor: 'simulado', enviadaEm: new Date(), eventos: await this.anexarEvento(registro.id, { tipo: 'simulada', detalhe: motivoSimulada }) },
        });
        final = 'SIMULADA';
      } else {
        if (!destino) throw new Error(`WhatsApp do titular inválido ("${contrato.conta.titular.whatsapp}") — corrija o cadastro e reenvie`);
        const mensagemId = await this.meta.enviarNotificacao({
          destino,
          destinoAutorizadoTeste: !this.producao() && params.numerosTeste.includes(destino),
          modelo: params.modeloNome,
          idioma: params.modeloIdioma,
          pdf,
          nomeArquivo: `${meta.titulo.replace(/\s+/g, '-')}-contrato-${contrato.numero}.pdf`.normalize('NFD').replace(/[̀-ͯ]/g, ''),
          parametros: [contrato.conta.titular.nome, `${meta.titulo} – ${meta.resumo}`, contrato.numero, vars.placa],
        });
        await this.prisma.db.notificacaoCobranca.update({
          where: { id: registro.id },
          data: { status: 'ENVIADA', provedor: 'meta', mensagemId, enviadaEm: new Date(), eventos: await this.anexarEvento(registro.id, { tipo: 'enviada', detalhe: `aceita pela Meta (${mensagemId})` }) },
        });
        final = 'ENVIADA';
      }
    } catch (e) {
      const motivo = (e as Error).message.slice(0, 500);
      await this.prisma.db.notificacaoCobranca.update({
        where: { id: registro.id },
        data: { status: 'FALHOU', falhaEm: new Date(), falhaMotivo: motivo, eventos: await this.anexarEvento(registro.id, { tipo: 'falhou', detalhe: motivo }) },
      });
      await this.alertas.emitir({
        titulo: `${meta.titulo} não enviada — ${contrato.conta.titular.nome}`,
        corpo: motivo,
        rota: `/contratos/${contrato.id}`,
        tipo: 'FALHA',
        area: 'CARTEIRA_COBRANCA',
      });
      this.logger.error(`notificação ${job.etapa} do contrato ${contrato.numero} falhou: ${motivo}`);
      return { resultado: 'falhou', motivo };
    }

    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId: job.usuarioId,
        acao: 'notificacao_cobranca_enviada',
        entidade: 'contrato',
        entidadeId: contrato.id,
        depois: { etapa: job.etapa, status: final, disparo: job.disparo, textoSha256, destino } as Prisma.InputJsonValue,
      },
    });
    // Marcos que pedem ação humana (POP §11 e §13).
    if (job.etapa === 3) {
      await this.alertas.emitir({ titulo: `Monitorar veículo — ${contrato.conta.titular.nome}`, corpo: `3ª notificação enviada (2 parcelas vencidas). Iniciar o monitoramento do veículo ${vars.placa} (POP §11).`, rota: `/contratos/${contrato.id}`, tipo: 'COBRANCA', area: 'CARTEIRA_COBRANCA' });
    }
    if (job.etapa === 4) {
      await this.alertas.emitir({ titulo: `Pré-bloqueio — ${contrato.conta.titular.nome}`, corpo: `4ª notificação enviada. Sem regularização em 24h, o bloqueio do veículo ${vars.placa} fica liberado (POP §13–14).`, rota: `/contratos/${contrato.id}`, tipo: 'COBRANCA', area: 'CARTEIRA_COBRANCA' });
    }
    if (job.etapa === 6 && !contrato.cobrancaJuridicaEm) {
      await this.prisma.db.contratoCredito.update({ where: { id: contrato.id }, data: { cobrancaJuridicaEm: new Date() } });
    }
    return { resultado: final === 'SIMULADA' ? 'simulada' : 'enviada' };
  }

  // ---------------- Webhook da Meta (via fila) ----------------

  async processarStatusMeta(payload: unknown) {
    type StatusMeta = { id: string; status: string; timestamp?: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] };
    const p = payload as { entry?: { changes?: { value?: { statuses?: StatusMeta[] } }[] }[] };
    let processados = 0;
    for (const entry of p.entry ?? []) {
      for (const ch of entry.changes ?? []) {
        for (const s of ch.value?.statuses ?? []) {
          const n = await this.prisma.db.notificacaoCobranca.findUnique({ where: { mensagemId: s.id } });
          if (!n) continue; // mensagem que não é deste ambiente/sistema
          const quando = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
          const data: Prisma.NotificacaoCobrancaUpdateInput = {};
          let detalhe: string | undefined;
          if (s.status === 'delivered') {
            data.entregueEm = n.entregueEm ?? quando;
            if (n.status === 'ENVIADA') data.status = 'ENTREGUE';
          } else if (s.status === 'read') {
            data.lidaEm = n.lidaEm ?? quando;
            data.entregueEm = n.entregueEm ?? quando;
            data.status = 'LIDA';
          } else if (s.status === 'failed') {
            const er = s.errors?.[0];
            detalhe = [er?.code, er?.title, er?.message, er?.error_data?.details].filter(Boolean).join(' · ') || 'falha informada pela Meta';
            data.status = 'FALHOU';
            data.falhaEm = quando;
            data.falhaMotivo = detalhe.slice(0, 500);
          }
          data.eventos = await this.anexarEvento(n.id, { em: quando.toISOString(), tipo: `meta_${s.status}`, detalhe });
          await this.prisma.db.notificacaoCobranca.update({ where: { id: n.id }, data });
          if (s.status === 'failed') {
            await this.alertas.emitir({
              titulo: `${ETAPAS_NOTIFICACAO[n.etapa as EtapaNotificacao].titulo} falhou na entrega`,
              corpo: detalhe,
              rota: `/contratos/${n.contratoId}`,
              tipo: 'FALHA',
              area: 'CARTEIRA_COBRANCA',
            });
          }
          processados += 1;
        }
      }
    }
    return { processados };
  }

  // ---------------- Ações do operador ----------------

  private async contratoVeiculoAtivo(contratoId: string) {
    const [c] = await this.contratosAlvo([contratoId]);
    if (!c) {
      const existe = await this.prisma.db.contratoCredito.findFirst({ where: { id: contratoId }, select: { id: true } });
      if (!existe) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
      throw new UnprocessableEntityException({ erro: 'fora_do_escopo', mensagem: 'O fluxo do POP vale para contratos de veículo na fase Ativo' });
    }
    return c;
  }

  // Registro mínimo da retomada (POP §14; fotos/vistoria na fase 2). Preenche
  // as estruturas que já esperavam o dado: recuperacaoIniciadaEm (contrato) e
  // RECUPERADO (ativo). A dívida continua (Regra 3) — contrato segue Ativo.
  async registrarRetomada(
    contratoId: string,
    dto: { dataHora?: string; local: string; responsavel: string; condicoes: string; observacoes?: string },
    usuarioId?: string,
  ) {
    const c = await this.contratoVeiculoAtivo(contratoId);
    if (c.veiculoRetomadoEm) throw new UnprocessableEntityException({ erro: 'ja_retomado', mensagem: 'A retomada deste veículo já foi registrada' });
    const estado = (await this.avaliar([c])).get(c.id)!;
    if (estado.vencimentos.length === 0) {
      throw new UnprocessableEntityException({ erro: 'sem_atraso', mensagem: 'O contrato não tem parcelas vencidas — retomada por inadimplência não se aplica' });
    }
    if (!dto.local?.trim() || !dto.responsavel?.trim() || !dto.condicoes?.trim()) {
      throw new UnprocessableEntityException({ erro: 'dados_obrigatorios', mensagem: 'Informe local, responsável e condições do veículo' });
    }
    const quando = dto.dataHora ? new Date(dto.dataHora) : new Date();
    if (Number.isNaN(quando.getTime()) || quando > new Date()) {
      throw new UnprocessableEntityException({ erro: 'data_invalida', mensagem: 'Data/hora da retomada inválida ou no futuro' });
    }
    const registro = { local: dto.local.trim(), responsavel: dto.responsavel.trim(), condicoes: dto.condicoes.trim(), observacoes: dto.observacoes?.trim() || null, registradoPor: usuarioId ?? null, registradoEm: new Date().toISOString() };
    await this.prisma.db.$transaction([
      this.prisma.db.contratoCredito.update({
        where: { id: c.id },
        data: { veiculoRetomadoEm: quando, retomadaRegistro: registro, recuperacaoIniciadaEm: c.recuperacaoIniciadaEm ?? quando },
      }),
      ...(c.ativo ? [this.prisma.db.ativo.update({ where: { id: c.ativo.id }, data: { status: 'RECUPERADO' } })] : []),
      this.prisma.db.logAuditoria.create({
        data: { usuarioId, acao: 'veiculo_retomado', entidade: 'contrato', entidadeId: c.id, depois: { ...registro, veiculoRetomadoEm: quando.toISOString() } as Prisma.InputJsonValue },
      }),
    ]);
    // A 5ª sai pela varredura (respeita a janela de envio).
    await this.fila.add('varrer', { contratoIds: [c.id] }, { removeOnComplete: true });
    return { resultado: 'retomada_registrada', quinta: estado.avaliacao.fase === 'juridico' ? 'caso no jurídico — sem 5ª automática' : 'na próxima janela de envio' };
  }

  // Veículo devolvido ao cliente após negociação: desfaz a intervenção (o
  // histórico fica na auditoria e no registro).
  async devolverVeiculo(contratoId: string, motivo: string, usuarioId?: string) {
    const c = await this.contratoVeiculoAtivo(contratoId);
    if (!c.veiculoRetomadoEm) throw new UnprocessableEntityException({ erro: 'nao_retomado', mensagem: 'Não há retomada registrada para desfazer' });
    if (!motivo?.trim()) throw new UnprocessableEntityException({ erro: 'motivo_obrigatorio', mensagem: 'Informe o motivo da devolução' });
    const registro = { ...((c.retomadaRegistro as object) ?? {}), devolvidoEm: new Date().toISOString(), motivoDevolucao: motivo.trim(), devolvidoPor: usuarioId ?? null };
    await this.prisma.db.$transaction([
      this.prisma.db.contratoCredito.update({ where: { id: c.id }, data: { veiculoRetomadoEm: null, recuperacaoIniciadaEm: null, retomadaRegistro: registro } }),
      ...(c.ativo ? [this.prisma.db.ativo.update({ where: { id: c.ativo.id }, data: { status: 'EM_CONTRATO' } })] : []),
      this.prisma.db.logAuditoria.create({
        data: { usuarioId, acao: 'veiculo_devolvido', entidade: 'contrato', entidadeId: c.id, antes: { veiculoRetomadoEm: c.veiculoRetomadoEm.toISOString() }, depois: { motivo: motivo.trim() } },
      }),
    ]);
    return { resultado: 'veiculo_devolvido' };
  }

  async definirJuridico(contratoId: string, encaminhar: boolean, motivo: string | undefined, usuarioId?: string) {
    const c = await this.contratoVeiculoAtivo(contratoId);
    if (encaminhar === !!c.cobrancaJuridicaEm) {
      return { resultado: encaminhar ? 'ja_no_juridico' : 'fora_do_juridico' };
    }
    await this.prisma.db.contratoCredito.update({ where: { id: c.id }, data: { cobrancaJuridicaEm: encaminhar ? new Date() : null } });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: encaminhar ? 'cobranca_encaminhada_juridico' : 'cobranca_retirada_juridico', entidade: 'contrato', entidadeId: c.id, depois: { motivo: motivo?.trim() || null } },
    });
    return { resultado: encaminhar ? 'encaminhado' : 'retirado' };
  }

  // 6ª (rescisão) — NUNCA automática (doc 02 §23 item 3). O texto afirma
  // "atraso há mais de 30 dias": só habilita quando isso é verdade.
  async enviarRescisao(contratoId: string, usuarioId?: string) {
    const c = await this.contratoVeiculoAtivo(contratoId);
    const estado = (await this.avaliar([c])).get(c.id)!;
    if (!estado.casoId) throw new UnprocessableEntityException({ erro: 'sem_caso', mensagem: 'Não há caso de cobrança aberto neste contrato' });
    if (estado.diasAtraso <= 30) {
      throw new UnprocessableEntityException({ erro: 'antes_de_30_dias', mensagem: `A notificação de rescisão exige atraso superior a 30 dias (hoje: ${estado.diasAtraso})` });
    }
    return this.enviar({ casoId: estado.casoId, etapa: 6, disparo: 'manual', usuarioId });
  }

  async reenviar(notificacaoId: string, usuarioId?: string) {
    const n = await this.prisma.db.notificacaoCobranca.findUnique({ where: { id: notificacaoId } });
    if (!n) throw new NotFoundException({ erro: 'nao_encontrada', mensagem: 'Notificação não encontrada' });
    if (n.status !== 'FALHOU') throw new UnprocessableEntityException({ erro: 'nao_falhou', mensagem: 'Só é possível reenviar uma notificação que falhou' });
    return this.enviar({ casoId: n.casoId, etapa: n.etapa as EtapaNotificacao, disparo: 'manual', usuarioId });
  }

  // ---------------- Tela: dossiê do contrato ----------------

  async painelContrato(contratoId: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      include: { ...INCLUDE_CONTRATO, casosCobranca: { orderBy: { abertoEm: 'desc' }, include: { notificacoes: { orderBy: { etapa: 'asc' } } } } },
    });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    const elegivel = contrato.status === 'ATIVO' && contrato.ativo?.tipo === 'VEICULO';
    const estado = elegivel ? (await this.avaliar([contrato])).get(contrato.id)! : null;
    const params = await this.parametros();
    const prov = this.provedorDisponivel();
    const av = estado?.avaliacao;
    return {
      elegivel,
      disparoAutomatico: params.ativo,
      provedor: { simulado: prov.simulado, disponivel: prov.disponivel, producao: this.producao(), numerosTeste: params.numerosTeste.length },
      estado: estado && av
        ? {
            casoAberto: !!estado.casoId,
            parcelasVencidas: estado.vencimentos.length,
            diasAtraso: estado.diasAtraso,
            valorAtualizado: estado.valorAtualizado,
            fase: av.fase,
            ultimaEtapa: av.ultimaEtapa,
            proxima: av.proxima ? { ...av.proxima, prevista: av.proxima.prevista?.toISOString() ?? null } : null,
            monitorarVeiculo: av.monitorarVeiculo,
            bloqueioLiberado: av.bloqueioLiberado,
            bloqueioLiberadoEm: av.bloqueioLiberadoEm?.toISOString() ?? null,
            rescisaoSinalizada: av.rescisaoSinalizada,
            // Caso encaminhado ao jurídico ainda pode receber a 6ª — só não duas vezes.
            podeEnviarRescisao:
              !!estado.casoId &&
              estado.diasAtraso > 30 &&
              !contrato.casosCobranca.some((cs) => !cs.encerradoEm && cs.notificacoes.some((n) => n.etapa === 6 && CONTAM_COMO_ENVIADA.includes(n.status))),
          }
        : null,
      intervencoes: {
        bloqueadoEm: contrato.veiculoBloqueadoEm?.toISOString() ?? null,
        retomadoEm: contrato.veiculoRetomadoEm?.toISOString() ?? null,
        retomada: contrato.retomadaRegistro ?? null,
        juridicoEm: contrato.cobrancaJuridicaEm?.toISOString() ?? null,
      },
      casos: contrato.casosCobranca.map((cs) => ({
        id: cs.id,
        abertoEm: cs.abertoEm.toISOString(),
        encerradoEm: cs.encerradoEm?.toISOString() ?? null,
        motivoEncerramento: cs.motivoEncerramento,
        notificacoes: cs.notificacoes.map((n) => ({
          id: n.id,
          etapa: n.etapa,
          titulo: ETAPAS_NOTIFICACAO[n.etapa as EtapaNotificacao].titulo,
          assunto: n.assunto,
          status: n.status,
          statusRotulo: ROTULO_STATUS[n.status],
          disparo: n.disparo,
          destino: n.destino,
          provedor: n.provedor,
          mensagemId: n.mensagemId,
          tentativas: n.tentativas,
          enviadaEm: n.enviadaEm?.toISOString() ?? null,
          entregueEm: n.entregueEm?.toISOString() ?? null,
          lidaEm: n.lidaEm?.toISOString() ?? null,
          falhaEm: n.falhaEm?.toISOString() ?? null,
          falhaMotivo: n.falhaMotivo,
          textoSha256: n.textoSha256,
          pdfSha256: n.pdfSha256,
          temPdf: !!n.pdfRef,
          eventos: n.eventos,
        })),
      })),
    };
  }

  async pdfDaNotificacao(id: string) {
    const n = await this.prisma.db.notificacaoCobranca.findUnique({ where: { id }, include: { contrato: { select: { numero: true } } } });
    if (!n?.pdfRef) throw new NotFoundException({ erro: 'sem_pdf', mensagem: 'PDF não encontrado' });
    const buffer = await fs.readFile(join(UPLOADS_DIR, n.pdfRef));
    return { nome: `notificacao-${n.etapa}-contrato-${n.contrato.numero}.pdf`, buffer };
  }

  async dossie(contratoId: string, usuarioId: string) {
    const usuario = await this.prisma.db.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true, email: true } });
    const usuarioNome = usuario ? `${usuario.nome} (${usuario.email})` : usuarioId;
    const c = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      include: { ...INCLUDE_CONTRATO, notificacoesCobranca: { orderBy: [{ createdAt: 'asc' }] } },
    });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    const params = await this.parametros();
    const dh = (d: Date) => `${dataBR(d)} às ${horaBR(d)}`;
    const intervencoes: string[] = [];
    if (c.veiculoBloqueadoEm) intervencoes.push(`Veículo bloqueado em ${dh(c.veiculoBloqueadoEm)}`);
    if (c.veiculoRetomadoEm) {
      const r = (c.retomadaRegistro ?? {}) as { local?: string; responsavel?: string; condicoes?: string };
      intervencoes.push(`Veículo retomado em ${dh(c.veiculoRetomadoEm)} — local: ${r.local ?? '—'}; responsável: ${r.responsavel ?? '—'}; condições: ${r.condicoes ?? '—'}`);
    }
    if (c.cobrancaJuridicaEm) intervencoes.push(`Caso encaminhado ao jurídico em ${dh(c.cobrancaJuridicaEm)}`);
    const a = c.ativo;
    const pdf = await gerarPdfDossie({
      contrato: c.numero,
      titular: c.conta.titular.nome,
      cpfCnpj: c.conta.titular.cpfCnpj,
      veiculo: `${[a?.marca, a?.modelo].filter(Boolean).join(' ') || a?.descricao || '—'} · placa ${a?.placa ?? '—'}`,
      dataContrato: c.dataAssinatura,
      geradoEm: new Date(),
      geradoPor: usuarioNome,
      intervencoes,
      itens: c.notificacoesCobranca.map((n) => ({
        titulo: ETAPAS_NOTIFICACAO[n.etapa as EtapaNotificacao].titulo,
        subtitulo: params.textos[n.etapa]?.subtitulo ?? '',
        assunto: n.assunto,
        texto: n.texto,
        notificado: c.conta.titular.nome,
        contrato: c.numero,
        emitidaEm: n.enviadaEm ?? n.createdAt,
        textoSha256: n.textoSha256,
        status: ROTULO_STATUS[n.status],
        destino: n.destino,
        mensagemId: n.mensagemId,
        enviadaEm: n.enviadaEm,
        entregueEm: n.entregueEm,
        lidaEm: n.lidaEm,
        falhaMotivo: n.falhaMotivo,
        pdfSha256: n.pdfSha256,
      })),
    });
    return { nome: `dossie-notificacoes-contrato-${c.numero}.pdf`, buffer: pdf };
  }

  // Prévia do texto (tela de configuração) com dados de EXEMPLO.
  async previa(etapa: number, modelo?: { subtitulo?: string; assunto?: string; texto?: string }) {
    if (![1, 2, 3, 4, 5, 6].includes(etapa)) throw new UnprocessableEntityException({ erro: 'etapa_invalida', mensagem: 'Etapa de 1 a 6' });
    const params = await this.parametros();
    const base = params.textos[etapa];
    const exemplo: Record<string, string> = {
      nome: 'Maria da Silva (exemplo)', veiculo: 'Chevrolet Onix', placa: 'ABC1D23', contrato: '2026090001', dataContrato: '01/09/2026',
      vencimento: '14/09/2026', valorParcela: 'R$ 814,00', vencimento1: '14/09/2026', vencimento2: '21/09/2026', vencimentos: '14/09/2026 e 21/09/2026', quantidadeParcelas: '2',
      valorAtualizado: 'R$ 1.662,70', n1Data: '15/09/2026', n1Hora: '09:05', n2Data: '18/09/2026', n2Hora: '09:05', n3Data: '22/09/2026', n3Hora: '09:05',
      n4Data: '25/09/2026', n4Hora: '09:05', n5Data: '29/09/2026', n5Hora: '10:05', dataRetomada: '28/09/2026', dataComunicacao: dataBR(new Date()),
    };
    const texto = preencher(modelo?.texto ?? base.texto, exemplo);
    const e = etapa as EtapaNotificacao;
    return gerarPdfNotificacao({
      titulo: `${ETAPAS_NOTIFICACAO[e].titulo} — PRÉVIA`,
      subtitulo: modelo?.subtitulo ?? base.subtitulo,
      assunto: preencher(modelo?.assunto ?? base.assunto, exemplo),
      texto,
      notificado: exemplo.nome,
      contrato: exemplo.contrato,
      emitidaEm: new Date(),
      textoSha256: sha256(texto),
    });
  }

  // ---------------- Ferramentas de teste (homolog) ----------------

  // Recua os carimbos do caso aberto em N horas — simula a passagem do tempo
  // (72h/24h do POP) sem esperar. Só fora de produção (DevOnlyGuard).
  async avancarRelogio(contratoId: string, horas: number) {
    const caso = await this.prisma.db.casoCobranca.findFirst({ where: { contratoId, encerradoEm: null }, include: { notificacoes: true } });
    if (!caso) throw new UnprocessableEntityException({ erro: 'sem_caso', mensagem: 'Não há caso aberto neste contrato' });
    const ms = Math.max(1, Math.min(24 * 30, horas)) * 3_600_000;
    const recua = (d: Date | null) => (d ? new Date(d.getTime() - ms) : null);
    for (const n of caso.notificacoes) {
      await this.prisma.db.notificacaoCobranca.update({
        where: { id: n.id },
        data: {
          enviadaEm: recua(n.enviadaEm), entregueEm: recua(n.entregueEm), lidaEm: recua(n.lidaEm),
          eventos: await this.anexarEvento(n.id, { tipo: 'teste_relogio', detalhe: `carimbos recuados ${horas}h (ferramenta de teste)` }),
        },
      });
    }
    await this.prisma.db.casoCobranca.update({ where: { id: caso.id }, data: { abertoEm: new Date(caso.abertoEm.getTime() - ms) } });
    return { resultado: 'relogio_avancado', horas, notificacoes: caso.notificacoes.length };
  }

  // Simula o webhook de entrega/leitura de uma notificação SIMULADA.
  async simularStatus(notificacaoId: string, status: 'delivered' | 'read') {
    const n = await this.prisma.db.notificacaoCobranca.findUnique({ where: { id: notificacaoId } });
    if (!n) throw new NotFoundException({ erro: 'nao_encontrada', mensagem: 'Notificação não encontrada' });
    const agora = new Date();
    await this.prisma.db.notificacaoCobranca.update({
      where: { id: n.id },
      data: {
        entregueEm: n.entregueEm ?? agora,
        ...(status === 'read' ? { lidaEm: n.lidaEm ?? agora } : {}),
        eventos: await this.anexarEvento(n.id, { tipo: `teste_${status}`, detalhe: 'status simulado (ferramenta de teste)' }),
      },
    });
    return { resultado: 'ok' };
  }
}
