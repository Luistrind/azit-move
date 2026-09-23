import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import {
  camposFaltantesTermos,
  centavosParaReaisString,
  classificarCobrancaLegada,
  conciliarLegado,
  contextoDosTermos,
  dataHojeBrasil,
  extrairTermosDoTexto,
  interpretarCobrancaLegada,
  TERMOS_VAZIOS,
  type CobrancaConciliavel,
  type InterpretacaoCobranca,
  type ResultadoConciliacao,
  type TermosContratoLegado,
  type TipoCobrancaLegada,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';

// Migração do legado — F2 (doc 02 §26.7): o lado PopHub do caso (termos +
// PDF), a leitura das descrições cobrança a cobrança e a conciliação do
// cronograma esperado com as cobranças reais. Regras propõem; o operador
// decide — e a decisão dele nunca é sobrescrita por regra ou releitura.

const UPLOADS_DIR = join(process.cwd(), 'uploads', 'legado');
const TIPOS: TipoCobrancaLegada[] = ['parcela', 'intermediaria', 'entrada', 'acordo', 'reembolso', 'outra'];

export const ROTULO_TIPO_COBRANCA: Record<TipoCobrancaLegada, string> = {
  parcela: 'Parcela semanal',
  intermediaria: 'Intermediária (entrada diluída)',
  entrada: 'Entrada',
  acordo: 'Acordo',
  reembolso: 'Reembolso de despesa',
  outra: 'Outra',
};

const serieSchema = z.object({
  total: z.number().int().min(0).nullable(),
  quantidade: z.number().int().min(1).nullable(),
  valor: z.number().int().min(0).nullable(),
  primeiraEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});
const texto = z.string().trim().max(200).nullable();
export const termosSchema = z.object({
  numeroOrigem: texto,
  dataAssinatura: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  compradorNome: texto,
  compradorCpf: z.string().transform((s) => s.replace(/\D/g, '') || null).nullable(),
  garantidorNome: texto,
  garantidorCpf: z.string().transform((s) => s.replace(/\D/g, '') || null).nullable(),
  veiculo: z.object({
    marca: texto, modelo: texto,
    anoFabricacao: z.number().int().min(1990).max(2100).nullable(),
    anoModelo: z.number().int().min(1990).max(2100).nullable(),
    cor: texto,
    placa: z.string().transform((s) => s.replace(/[\s-]/g, '').toUpperCase() || null).nullable(),
    chassi: z.string().transform((s) => s.trim().toUpperCase() || null).nullable(),
    renavam: texto, origem: texto, combustivel: texto,
    quilometragem: z.number().int().min(0).nullable(),
  }),
  valorTotal: z.number().int().min(0).nullable(),
  entradaValor: z.number().int().min(0).nullable(),
  parcelas: serieSchema,
  intermediarias: serieSchema.nullable(),
  seguroSemanal: z.number().int().min(0),
  taxaSemanal: z.number().int().min(0),
  indiceReajuste: texto,
  multaAtrasoPct: z.number().min(0).nullable(),
  jurosMensalPct: z.number().min(0).nullable(),
  garantiaDias: z.number().int().min(0).nullable(),
  observacoes: z.string().trim().max(4000).nullable(),
});

const centavos = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Math.round(Number(v) * 100));
const reais = (c: number) => new Prisma.Decimal(centavosParaReaisString(c));
const iso = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;

type CobrancaBanco = Prisma.CobrancaLegadaGetPayload<object>;

@Injectable()
export class LegadoConciliacaoService {
  private readonly logger = new Logger(LegadoConciliacaoService.name);
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- Termos ----------------

  async salvarTermos(casoId: string, corpo: unknown, usuarioId: string) {
    const caso = await this.carregar(casoId);
    this.exigirEditavel(caso.status);
    const parsed = termosSchema.safeParse(corpo);
    if (!parsed.success) {
      throw new UnprocessableEntityException({ erro: 'termos_invalidos', mensagem: 'Termos com campo inválido', campos: parsed.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })) });
    }
    const termos = parsed.data as TermosContratoLegado;
    await this.prisma.db.casoMigracaoLegado.update({
      where: { id: casoId },
      data: { termos: termos as unknown as Prisma.InputJsonValue, termosAtualizadosEm: new Date() },
    });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'legado_termos_salvos', entidade: 'caso_migracao_legado', entidadeId: casoId, antes: (caso.termos ?? Prisma.JsonNull) as Prisma.InputJsonValue, depois: termos as unknown as Prisma.InputJsonValue },
    });
    // Termos mudam o contexto da leitura (parcela contratual, intermediária…).
    await this.interpretarCobrancasDoCaso(casoId, 'regra');
    return { salvo: true, faltantes: camposFaltantesTermos(termos) };
  }

  // ---------------- PDF ----------------

  async anexarPdf(casoId: string, arquivo: { nome: string; conteudo: string }, usuarioId: string) {
    const caso = await this.carregar(casoId);
    this.exigirEditavel(caso.status);
    const base64 = arquivo.conteudo.includes(',') ? arquivo.conteudo.split(',')[1] : arquivo.conteudo;
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < 100 || buffer.subarray(0, 4).toString() !== '%PDF') {
      throw new UnprocessableEntityException({ erro: 'nao_e_pdf', mensagem: 'O arquivo precisa ser o PDF do contrato' });
    }
    const ref = `${casoId}.pdf`;
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(join(UPLOADS_DIR, ref), buffer);

    // Leitura do texto para pré-preencher os termos (modelo Mod06).
    let extracao: ReturnType<typeof extrairTermosDoTexto> | null = null;
    let erroLeitura: string | null = null;
    try {
      // pdf-parse v2 (API de classe) — mesmo uso do assistente de análise.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PDFParse } = require('pdf-parse') as { PDFParse: new (o: { data: Uint8Array }) => { getText(): Promise<{ text: string }>; destroy?: () => Promise<void> } };
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const r = await parser.getText();
        extracao = extrairTermosDoTexto(r.text ?? '');
      } finally {
        await parser.destroy?.().catch(() => undefined);
      }
    } catch (e) {
      erroLeitura = e instanceof Error ? e.message : String(e);
      this.logger.warn(`PDF do caso ${casoId}: não consegui ler o texto (${erroLeitura})`);
    }

    // CPF do contrato × CPF do cliente no Asaas: aviso, não trava (o operador confere).
    const cpfDiverge = !!(extracao?.termos.compradorCpf && caso.cpfCnpj && extracao.termos.compradorCpf !== caso.cpfCnpj);

    // Pré-preenche só o que o operador ainda não digitou.
    let termosGravados = caso.termos as TermosContratoLegado | null;
    let preenchido = false;
    if (extracao && (!termosGravados || camposFaltantesTermos(termosGravados).length > 0)) {
      termosGravados = mesclarTermos(termosGravados, extracao.termos);
      preenchido = true;
    }
    await this.prisma.db.casoMigracaoLegado.update({
      where: { id: casoId },
      data: {
        contratoPdfRef: ref,
        contratoPdfNome: arquivo.nome.slice(0, 200),
        contratoPdfEm: new Date(),
        extracaoPdf: (extracao
          ? { modeloReconhecido: extracao.modeloReconhecido, extraidos: extracao.extraidos, faltantes: extracao.faltantes, cpfDiverge, termos: extracao.termos }
          : { erro: erroLeitura }) as Prisma.InputJsonValue,
        ...(preenchido && termosGravados ? { termos: termosGravados as unknown as Prisma.InputJsonValue, termosAtualizadosEm: new Date() } : {}),
      },
    });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'legado_pdf_anexado', entidade: 'caso_migracao_legado', entidadeId: casoId, depois: { nome: arquivo.nome, bytes: buffer.length, modeloReconhecido: extracao?.modeloReconhecido ?? null, extraidos: extracao?.extraidos ?? [] } },
    });
    if (preenchido) await this.interpretarCobrancasDoCaso(casoId, 'regra');
    return {
      anexado: true,
      modeloReconhecido: extracao?.modeloReconhecido ?? false,
      extraidos: extracao?.extraidos ?? [],
      faltantes: extracao?.faltantes ?? camposFaltantesTermos(TERMOS_VAZIOS),
      cpfDiverge,
      preenchido,
      erroLeitura,
    };
  }

  async baixarPdf(casoId: string) {
    const caso = await this.carregar(casoId);
    if (!caso.contratoPdfRef) throw new NotFoundException({ erro: 'sem_pdf', mensagem: 'Nenhum PDF anexado a este caso' });
    return { nome: caso.contratoPdfNome ?? caso.contratoPdfRef, buffer: await fs.readFile(join(UPLOADS_DIR, caso.contratoPdfRef)) };
  }

  // ---------------- Interpretação das cobranças ----------------

  // Regras sobre todas as cobranças do caso que o operador ainda não decidiu.
  async interpretarCobrancasDoCaso(casoId: string, fonte: 'regra' | 'ia' = 'regra') {
    const caso = await this.prisma.db.casoMigracaoLegado.findUnique({ where: { id: casoId }, include: { cobrancas: true } });
    if (!caso) return { interpretadas: 0 };
    const termos = caso.termos as TermosContratoLegado | null;
    const contexto = contextoDosTermos(termos, centavos(caso.valorParcelaPadrao));
    let n = 0;
    for (const c of caso.cobrancas) {
      if (c.interpretadoPor === 'operador') continue;
      const valorOriginal = centavos(c.valorOriginal) ?? centavos(c.valor) ?? 0;
      const r = interpretarCobrancaLegada({ descricao: c.descricao, valorOriginal, avulsa: !c.assinaturaId, contexto });
      await this.prisma.db.cobrancaLegada.update({
        where: { id: c.id },
        data: { tipoInterpretado: r.tipo, interpretacao: r as unknown as Prisma.InputJsonValue, interpretadoPor: fonte, interpretadoEm: new Date(), duvida: r.duvida },
      });
      n += 1;
    }
    return { interpretadas: n };
  }

  async definirInterpretacao(
    casoId: string,
    cobrancaId: string,
    corpo: { tipo: string; parcelamento?: number; seguro?: number; taxa?: number; intermediaria?: number; extra?: number; extraRotulo?: string; observacao?: string },
    usuarioId: string,
  ) {
    const caso = await this.carregar(casoId);
    this.exigirEditavel(caso.status);
    const c = await this.prisma.db.cobrancaLegada.findFirst({ where: { id: cobrancaId, casoId } });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrada', mensagem: 'Cobrança não encontrada neste caso' });
    if (!TIPOS.includes(corpo.tipo as TipoCobrancaLegada)) {
      throw new UnprocessableEntityException({ erro: 'tipo_invalido', mensagem: 'Tipo de cobrança desconhecido' });
    }
    const valorOriginal = centavos(c.valorOriginal) ?? centavos(c.valor) ?? 0;
    const seguro = corpo.seguro ?? 0;
    const taxa = corpo.taxa ?? 0;
    const intermediaria = corpo.intermediaria ?? 0;
    const extra = corpo.extra ?? 0; // despesa repassada junto da parcela (23/09)
    const parcelamento = corpo.parcelamento ?? valorOriginal - seguro - taxa - intermediaria - extra;
    if ([seguro, taxa, intermediaria, extra, parcelamento].some((v) => !Number.isInteger(v) || v < 0)) {
      throw new UnprocessableEntityException({ erro: 'decomposicao_invalida', mensagem: 'Valores da decomposição precisam ser inteiros em centavos, não negativos' });
    }
    if (parcelamento + seguro + taxa + intermediaria + extra !== valorOriginal) {
      throw new UnprocessableEntityException({
        erro: 'decomposicao_nao_fecha',
        mensagem: `A decomposição soma ${centavosParaReaisString(parcelamento + seguro + taxa + intermediaria + extra)} e a cobrança vale ${centavosParaReaisString(valorOriginal)}`,
      });
    }
    const interp: InterpretacaoCobranca = { tipo: corpo.tipo as TipoCobrancaLegada, parcelamento, seguro, taxa, intermediaria, extra, extraRotulo: extra > 0 ? (corpo.extraRotulo?.trim() || 'despesa junto da parcela') : null, duvida: false, motivo: 'definido pelo operador' };
    const atualizada = await this.prisma.db.cobrancaLegada.update({
      where: { id: cobrancaId },
      data: { tipoInterpretado: interp.tipo, interpretacao: interp as unknown as Prisma.InputJsonValue, interpretadoPor: 'operador', interpretadoEm: new Date(), duvida: false, interpretacaoObs: corpo.observacao?.trim() || null },
    });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'legado_cobranca_interpretada', entidade: 'cobranca_legada', entidadeId: cobrancaId, antes: (c.interpretacao ?? Prisma.JsonNull) as Prisma.InputJsonValue, depois: interp as unknown as Prisma.InputJsonValue },
    });
    return this.cobrancaParaApi(atualizada);
  }

  // Volta uma cobrança para a leitura por regra (desfaz a decisão do operador).
  async desfazerInterpretacao(casoId: string, cobrancaId: string, usuarioId: string) {
    const caso = await this.carregar(casoId);
    this.exigirEditavel(caso.status);
    await this.prisma.db.cobrancaLegada.updateMany({ where: { id: cobrancaId, casoId }, data: { interpretadoPor: null, interpretacaoObs: null } });
    await this.interpretarCobrancasDoCaso(casoId, 'regra');
    await this.prisma.db.logAuditoria.create({ data: { usuarioId, acao: 'legado_cobranca_interpretacao_desfeita', entidade: 'cobranca_legada', entidadeId: cobrancaId } });
    return { desfeito: true };
  }

  // ---------------- Conciliação ----------------

  conciliar(caso: { termos: unknown; cobrancas: CobrancaBanco[]; divergenciasReconhecidas: unknown }): ResultadoConciliacao & { reconhecidas: DivergenciaReconhecida[] } {
    const termos = caso.termos as TermosContratoLegado | null;
    const hoje = dataHojeBrasil();
    const conciliaveis: CobrancaConciliavel[] = caso.cobrancas.map((c) => {
      const interp = c.interpretacao as InterpretacaoCobranca | null;
      const valorOriginal = centavos(c.valorOriginal) ?? centavos(c.valor) ?? 0;
      return {
        id: c.id,
        vencimento: iso(c.vencimento) as string,
        valorOriginal,
        valorPago: centavos(c.valorPago),
        pagoEm: iso(c.pagoEm),
        classe: classificarCobrancaLegada({ valor: valorOriginal, vencimento: iso(c.vencimento) as string, status: c.status, deletada: c.deletada }, hoje),
        tipo: (c.tipoInterpretado as TipoCobrancaLegada | null) ?? 'outra',
        intermediariaEmbutida: interp?.intermediaria ?? 0,
        // Composição lida da descrição (23/09): casa a parcela pela parte do
        // contrato e mostra a despesa que veio junto.
        parcelamento: interp && interp.tipo === 'parcela' ? interp.parcelamento : null,
        extra: interp?.extra ?? 0,
        extraRotulo: interp?.extraRotulo ?? null,
        descricao: c.descricao,
      };
    });
    const r = conciliarLegado({
      termos: termos
        ? { parcelas: termos.parcelas, intermediarias: termos.intermediarias, entradaValor: termos.entradaValor, seguroSemanal: termos.seguroSemanal, taxaSemanal: termos.taxaSemanal }
        : { parcelas: { quantidade: null, valor: null, primeiraEm: null }, intermediarias: null, entradaValor: null, seguroSemanal: 5_000, taxaSemanal: 500 },
      cobrancas: conciliaveis,
      hoje,
    });
    const reconhecidas = ((caso.divergenciasReconhecidas as DivergenciaReconhecida[] | null) ?? []);
    return { ...r, reconhecidas };
  }

  async reconhecerDivergencia(casoId: string, chave: string, nota: string, usuarioId: string) {
    const caso = await this.carregar(casoId);
    this.exigirEditavel(caso.status);
    if (!nota?.trim()) throw new UnprocessableEntityException({ erro: 'nota_obrigatoria', mensagem: 'Explique a divergência para reconhecê-la' });
    const lista = ((caso.divergenciasReconhecidas as DivergenciaReconhecida[] | null) ?? []).filter((d) => d.chave !== chave);
    lista.push({ chave, nota: nota.trim(), em: new Date().toISOString(), por: usuarioId });
    await this.prisma.db.casoMigracaoLegado.update({ where: { id: casoId }, data: { divergenciasReconhecidas: lista as unknown as Prisma.InputJsonValue } });
    await this.prisma.db.logAuditoria.create({ data: { usuarioId, acao: 'legado_divergencia_reconhecida', entidade: 'caso_migracao_legado', entidadeId: casoId, depois: { chave, nota } } });
    return { reconhecidas: lista };
  }

  async desfazerReconhecimento(casoId: string, chave: string, usuarioId: string) {
    const caso = await this.carregar(casoId);
    this.exigirEditavel(caso.status);
    const lista = ((caso.divergenciasReconhecidas as DivergenciaReconhecida[] | null) ?? []).filter((d) => d.chave !== chave);
    await this.prisma.db.casoMigracaoLegado.update({ where: { id: casoId }, data: { divergenciasReconhecidas: lista as unknown as Prisma.InputJsonValue } });
    await this.prisma.db.logAuditoria.create({ data: { usuarioId, acao: 'legado_divergencia_reconhecimento_desfeito', entidade: 'caso_migracao_legado', entidadeId: casoId, depois: { chave } } });
    return { reconhecidas: lista };
  }

  // ---------------- Validação ----------------

  // O que ainda impede validar — a tela mostra a lista, o botão só libera vazio.
  pendenciasParaValidar(caso: { termos: unknown; contratoPdfRef: string | null; cobrancas: CobrancaBanco[]; divergenciasReconhecidas: unknown }): string[] {
    const p: string[] = [];
    const termos = caso.termos as TermosContratoLegado | null;
    if (!termos) p.push('Termos do contrato não preenchidos');
    else {
      const faltam = camposFaltantesTermos(termos);
      if (faltam.length) p.push(`Termos incompletos: ${faltam.join(', ')}`);
    }
    if (!caso.contratoPdfRef) p.push('PDF do contrato não anexado');
    const emDuvida = caso.cobrancas.filter((c) => c.duvida && !c.deletada).length;
    if (emDuvida) p.push(`${emDuvida} cobrança(s) com leitura em dúvida — confirme o tipo de cada uma`);
    const semTipo = caso.cobrancas.filter((c) => !c.tipoInterpretado && !c.deletada).length;
    if (semTipo) p.push(`${semTipo} cobrança(s) sem leitura`);
    if (termos && camposFaltantesTermos(termos).length === 0) {
      const r = this.conciliar(caso);
      const reconhecidas = new Set(r.reconhecidas.map((d) => d.chave));
      const abertas = [
        ...r.linhas.filter((l) => l.divergencia && !reconhecidas.has(l.chave)).map((l) => l.chave),
        ...r.fora.filter((f) => f.divergencia && !reconhecidas.has(`cobranca:${f.cobrancaId}`)).map((f) => `cobranca:${f.cobrancaId}`),
      ];
      if (abertas.length) p.push(`${abertas.length} divergência(s) da conciliação sem reconhecimento`);
    }
    return p;
  }

  async validar(casoId: string, usuarioId: string) {
    const caso = await this.carregar(casoId);
    if (caso.status !== 'EM_REVISAO') {
      throw new UnprocessableEntityException({ erro: 'status_invalido', mensagem: 'Só um caso em revisão pode ser validado' });
    }
    const pendencias = this.pendenciasParaValidar(caso);
    if (pendencias.length) {
      throw new UnprocessableEntityException({ erro: 'pendencias', mensagem: 'Ainda falta: ' + pendencias.join('; '), pendencias });
    }
    await this.prisma.db.casoMigracaoLegado.update({
      where: { id: casoId },
      data: { status: 'VALIDADO', validadoEm: new Date(), validadoPor: usuarioId, statusAlteradoEm: new Date(), statusAlteradoPor: usuarioId },
    });
    await this.prisma.db.logAuditoria.create({ data: { usuarioId, acao: 'legado_caso_validado', entidade: 'caso_migracao_legado', entidadeId: casoId, antes: { status: caso.status }, depois: { status: 'VALIDADO' } } });
    return { validado: true };
  }

  // ---------------- Apoio ----------------

  cobrancaParaApi(c: CobrancaBanco) {
    const hoje = dataHojeBrasil();
    const valorOriginal = centavos(c.valorOriginal) ?? centavos(c.valor) ?? 0;
    return {
      id: c.id,
      asaasPaymentId: c.asaasPaymentId,
      assinaturaId: c.assinaturaId,
      valor: centavos(c.valor) ?? 0,
      valorOriginal,
      valorPago: centavos(c.valorPago),
      encargoPago: centavos(c.encargoPago),
      vencimento: iso(c.vencimento) as string,
      pagoEm: iso(c.pagoEm),
      status: c.status,
      classe: classificarCobrancaLegada({ valor: valorOriginal, vencimento: iso(c.vencimento) as string, status: c.status, deletada: c.deletada }, hoje),
      tipo: c.tipo,
      descricao: c.descricao,
      invoiceUrl: c.invoiceUrl,
      deletada: c.deletada,
      tipoInterpretado: c.tipoInterpretado,
      tipoRotulo: c.tipoInterpretado ? ROTULO_TIPO_COBRANCA[c.tipoInterpretado as TipoCobrancaLegada] ?? c.tipoInterpretado : null,
      interpretacao: c.interpretacao as InterpretacaoCobranca | null,
      interpretadoPor: c.interpretadoPor,
      duvida: c.duvida,
      interpretacaoObs: c.interpretacaoObs,
    };
  }

  private async carregar(id: string) {
    const c = await this.prisma.db.casoMigracaoLegado.findUnique({ where: { id }, include: { cobrancas: true } });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Caso não encontrado' });
    return c;
  }

  private exigirEditavel(status: string) {
    if (status === 'MIGRADO' || status === 'VALIDADO') {
      throw new UnprocessableEntityException({ erro: 'caso_fechado', mensagem: status === 'VALIDADO' ? 'Caso validado — reabra (voltar para revisão) antes de alterar' : 'Caso já migrado — não pode ser alterado' });
    }
  }
}

export interface DivergenciaReconhecida {
  chave: string; // parcela:N | intermediaria:N | entrada | cobranca:<id>
  nota: string;
  em: string;
  por: string;
}

// Preenche só o que está vazio nos termos já gravados.
function mesclarTermos(atual: TermosContratoLegado | null, extraido: TermosContratoLegado): TermosContratoLegado {
  if (!atual) return extraido;
  const vazio = (v: unknown) => v === null || v === undefined || v === '';
  const a = JSON.parse(JSON.stringify(atual)) as Record<string, unknown>;
  const e = extraido as unknown as Record<string, unknown>;
  for (const k of Object.keys(e)) {
    if (k === 'veiculo') {
      const av = a.veiculo as Record<string, unknown>;
      const ev = e.veiculo as Record<string, unknown>;
      for (const vk of Object.keys(ev)) if (vazio(av[vk]) && !vazio(ev[vk])) av[vk] = ev[vk];
    } else if (k === 'parcelas' || k === 'intermediarias') {
      const serie = a[k] as { valor?: unknown } | null;
      if ((serie == null || vazio(serie.valor)) && e[k]) a[k] = e[k];
    } else if (vazio(a[k]) && !vazio(e[k])) {
      a[k] = e[k];
    }
  }
  return a as unknown as TermosContratoLegado;
}
