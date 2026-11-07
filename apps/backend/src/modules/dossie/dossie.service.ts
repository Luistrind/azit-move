import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { StatusParcela } from '@azit/types';
import { dataCalendarioUTC, dataHojeBrasil, diaBrasil, formatCurrency, isoParaBR, nomeDiaSemanaISO, resolverStatusParcela } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { CabecalhoDossie, DadosHistorico, LinhaHistorico, SecaoSumario, htmlCapa, htmlCapaAnexo, htmlCapturas, htmlHistorico, htmlTextoContrato } from './dossie-html';
import { comNavegador, contarPaginas, htmlParaPdf, juntarPdfs } from './pdf';

// Dossiê para cobrança judicial (doc 02 §30, pedido Luís 04/11/2026). O
// operador manda só as capturas do WhatsApp (e, se tiver, notificação e
// relatório do Infleet em PDF); o sistema junta contrato assinado, histórico,
// capturas e contrato social num PDF só, guardado no contrato.

const UPLOADS = join(process.cwd(), 'uploads');
const DIR_DOSSIES = join(UPLOADS, 'dossies');
const DIR_ENTRADA = join(DIR_DOSSIES, 'entrada');
const DIR_EMPRESA = join(UPLOADS, 'empresa');
const DIR_ASSINATURAS = join(UPLOADS, 'assinaturas');
const DIR_LEGADO = join(UPLOADS, 'legado');

const cent = (d: Prisma.Decimal | null | undefined): number => (d ? Math.round(Number(d.toString()) * 100) : 0);
const PARCELA_PAGA = ['PAGA', 'PAGA_EM_ATRASO', 'PAGA_ANTECIPADA'];
const IMAGENS = ['.png', '.jpg', '.jpeg', '.webp'];
const ID_ARQUIVO = /^[a-f0-9-]{36}$/;

export type TipoArquivoEntrada = 'captura' | 'notificacao' | 'infleet';

export interface ComposicaoDossie {
  secoes: (SecaoSumario & { chave: string })[];
  avisos: string[];
}

@Injectable()
export class DossieService {
  private readonly logger = new Logger(DossieService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- Entrada: arquivos enviados um a um (base64, como todo upload do sistema) ---

  private decodificar(conteudo: string): Buffer {
    const base64 = conteudo.includes(',') ? conteudo.split(',')[1] : conteudo;
    return Buffer.from(base64, 'base64');
  }

  async receberArquivo(contratoId: string, dto: { tipo: TipoArquivoEntrada; nome: string; conteudo: string }) {
    const ext = extname(dto.nome).toLowerCase();
    const buffer = this.decodificar(dto.conteudo);
    if (buffer.length < 100) throw new UnprocessableEntityException({ erro: 'arquivo_vazio', mensagem: `Arquivo ${dto.nome} está vazio` });
    if (dto.tipo === 'captura') {
      if (!IMAGENS.includes(ext)) throw new UnprocessableEntityException({ erro: 'formato_invalido', mensagem: `Captura ${dto.nome}: envie imagem PNG, JPG ou WEBP` });
    } else if (ext !== '.pdf' || buffer.subarray(0, 4).toString() !== '%PDF') {
      throw new UnprocessableEntityException({ erro: 'nao_e_pdf', mensagem: `${dto.nome}: envie um PDF` });
    }
    await fs.mkdir(DIR_ENTRADA, { recursive: true });
    const id = randomUUID();
    await fs.writeFile(join(DIR_ENTRADA, `${id}${ext}`), buffer);
    // Entrada é efêmera: o que ficou de tentativas antigas (> 24 h) sai aqui.
    void this.limparEntradaAntiga();
    return { id, nome: dto.nome, tamanho: buffer.length, contratoId };
  }

  private async limparEntradaAntiga() {
    try {
      const nomes = await fs.readdir(DIR_ENTRADA);
      const limite = Date.now() - 24 * 60 * 60 * 1000;
      for (const n of nomes) {
        const st = await fs.stat(join(DIR_ENTRADA, n));
        if (st.mtimeMs < limite) await fs.unlink(join(DIR_ENTRADA, n));
      }
    } catch { /* pasta ainda não existe */ }
  }

  private async lerEntrada(id: string, tiposAceitos: string[]): Promise<{ buffer: Buffer; ext: string; caminho: string }> {
    if (!ID_ARQUIVO.test(id)) throw new UnprocessableEntityException({ erro: 'arquivo_invalido', mensagem: 'Referência de arquivo inválida' });
    for (const ext of tiposAceitos) {
      const caminho = join(DIR_ENTRADA, `${id}${ext}`);
      try {
        return { buffer: await fs.readFile(caminho), ext, caminho };
      } catch { /* tenta a próxima extensão */ }
    }
    throw new UnprocessableEntityException({ erro: 'arquivo_nao_encontrado', mensagem: 'Arquivo enviado não foi encontrado — envie de novo' });
  }

  // --- Documentos da empresa (Configuração) ---

  async parametrosEmpresa() {
    const p = await this.prisma.db.parametroEmpresa.findFirst();
    return {
      contratoSocial: p?.contratoSocialRef
        ? { nome: p.contratoSocialNome, descricao: p.contratoSocialDescricao, em: p.contratoSocialEm?.toISOString() ?? null }
        : null,
    };
  }

  async salvarContratoSocial(dto: { nome: string; conteudo: string; descricao?: string }, usuarioId: string) {
    const buffer = this.decodificar(dto.conteudo);
    if (buffer.length < 100 || buffer.subarray(0, 4).toString() !== '%PDF') {
      throw new UnprocessableEntityException({ erro: 'nao_e_pdf', mensagem: 'O contrato social precisa ser um PDF' });
    }
    await fs.mkdir(DIR_EMPRESA, { recursive: true });
    const ref = `contrato-social-${Date.now()}.pdf`;
    await fs.writeFile(join(DIR_EMPRESA, ref), buffer);
    const atual = await this.prisma.db.parametroEmpresa.findFirst();
    const data = { contratoSocialRef: ref, contratoSocialNome: dto.nome, contratoSocialDescricao: dto.descricao?.trim() ?? '', contratoSocialEm: new Date() };
    const salvo = atual
      ? await this.prisma.db.parametroEmpresa.update({ where: { id: atual.id }, data })
      : await this.prisma.db.parametroEmpresa.create({ data });
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'contrato_social_atualizado', entidade: 'parametros_empresa', entidadeId: salvo.id, antes: { ref: atual?.contratoSocialRef ?? null }, depois: { ref, nome: dto.nome, descricao: data.contratoSocialDescricao } },
    });
    return this.parametrosEmpresa();
  }

  async baixarContratoSocial(): Promise<{ nome: string; buffer: Buffer }> {
    const p = await this.prisma.db.parametroEmpresa.findFirst();
    if (!p?.contratoSocialRef) throw new NotFoundException({ erro: 'sem_contrato_social', mensagem: 'Contrato social ainda não foi anexado em Configuração' });
    return { nome: p.contratoSocialNome ?? p.contratoSocialRef, buffer: await fs.readFile(join(DIR_EMPRESA, p.contratoSocialRef)) };
  }

  // --- Contrato assinado: ZapSign → âncora do pacote → PDF do legado → texto ---

  private async pdfDoContrato(contratoId: string, propostaPacoteId: string | null, legadoCasoId: string | null): Promise<{ buffer: Buffer; origem: string } | null> {
    const ler = async (dir: string, ref: string | null | undefined) => {
      if (!ref) return null;
      try { return await fs.readFile(join(dir, ref)); } catch { return null; }
    };
    const proprio = await this.prisma.db.documentoAssinatura.findFirst({ where: { contratoCreditoId: contratoId }, select: { pdfAssinadoRef: true, provedor: true } });
    const b1 = await ler(DIR_ASSINATURAS, proprio?.pdfAssinadoRef);
    if (b1) return { buffer: b1, origem: proprio?.provedor === 'legado' ? 'PDF do contrato migrado do legado' : 'PDF assinado digitalmente (ZapSign)' };
    if (propostaPacoteId) {
      const irmaos = await this.prisma.db.contratoCredito.findMany({ where: { propostaPacoteId, id: { not: contratoId } }, select: { id: true } });
      for (const c of irmaos) {
        const d = await this.prisma.db.documentoAssinatura.findFirst({ where: { contratoCreditoId: c.id }, select: { pdfAssinadoRef: true } });
        const b = await ler(DIR_ASSINATURAS, d?.pdfAssinadoRef);
        if (b) return { buffer: b, origem: 'PDF assinado digitalmente (instrumento do pacote)' };
      }
    }
    if (legadoCasoId) {
      const caso = await this.prisma.db.casoMigracaoLegado.findFirst({ where: { id: legadoCasoId }, select: { contratoPdfRef: true } });
      const b = await ler(DIR_LEGADO, caso?.contratoPdfRef);
      if (b) return { buffer: b, origem: 'PDF do contrato anexado na migração do legado' };
    }
    return null;
  }

  // --- Histórico (mesma fonte da ficha: parcelas + entrada do contrato) ---

  private async dadosHistorico(contratoId: string, cab: CabecalhoDossie): Promise<DadosHistorico> {
    const c = await this.prisma.db.contratoCredito.findFirstOrThrow({
      where: { id: contratoId },
      select: {
        numero: true, dataAssinatura: true, numeroParcelas: true, periodicidade: true, valorParcelaInicial: true,
        valorEntrada: true, valorEntradaPago: true, entradaPagaEm: true, taxaMultaAtraso: true, taxaJurosAtraso: true, status: true, motivoEncerramento: true,
        ativo: { select: { descricao: true, placa: true, chassi: true } },
        itensContratados: { where: { natureza: 'RECORRENTE', deletedAt: null }, select: { descricao: true, valor: true } },
        parcelas: { where: { deletedAt: null }, orderBy: { dataVencimento: 'asc' }, select: { display: true, numero: true, valorNominal: true, dataVencimento: true, dataPagamento: true, valorPago: true, valorEncargo: true, status: true, acordoId: true } },
      },
    });
    const hoje = dataHojeBrasil();
    const periodicidade = c.periodicidade === 'SEMANAL' ? 'semanal' : c.periodicidade === 'QUINZENAL' ? 'quinzenal' : 'mensal';
    const primeira = c.parcelas[0];
    const diaVencimento = c.periodicidade === 'SEMANAL' && primeira ? pluralDiaSemana(nomeDiaSemanaISO(dataCalendarioUTC(primeira.dataVencimento))) : null;
    const recorrentes = c.itensContratados.filter((i) => cent(i.valor) > 0);
    const valorParcela = primeira ? cent(primeira.valorNominal) : cent(c.valorParcelaInicial);
    const composicao = recorrentes.length
      ? `${formatCurrency(valorParcela)}${recorrentes.map((r) => ` + ${r.descricao.toLowerCase()} ${formatCurrency(cent(r.valor))}`).join('')}`
      : `${formatCurrency(valorParcela)} (parcela da compra)`;

    const linhas: LinhaHistorico[] = [];
    let pago = 0;
    let emAtraso = 0;
    let atrasadas = 0;
    let primeiraAtrasada: { display: string; venc: string } | null = null;
    let ultimaPaga: { display: string; venc: string; em: string } | null = null;

    const entradaPaga = cent(c.valorEntradaPago);
    if (entradaPaga > 0 || cent(c.valorEntrada) > 0) {
      const paga = entradaPaga > 0 && !!c.entradaPagaEm;
      linhas.push({
        item: 'Entrada', vencimento: isoParaBR(dataCalendarioUTC(c.dataAssinatura)), valor: entradaPaga > 0 ? entradaPaga : cent(c.valorEntrada),
        pagamento: paga ? isoParaBR(diaBrasil(c.entradaPagaEm!)) : '—', valorPago: paga ? entradaPaga : null,
        situacao: paga ? { rotulo: '✔ Pago', tom: 'ok' } : { rotulo: 'Não paga', tom: 'bad' },
      });
      if (paga) pago += entradaPaga;
    }

    type Agregada = { numeroInicial: number; numeroFinal: number; vencInicial: string; vencFinal: string; valor: number; qtd: number };
    let agregada: Agregada | null = null;
    let futurasMostradas = 0;
    for (const p of c.parcelas) {
      const venc = dataCalendarioUTC(p.dataVencimento);
      const rotuloStatus = p.acordoId && !p.status ? 'Em acordo' : resolverStatusParcela({ status: p.status ? StatusParcela[p.status] : null, dataVencimento: p.dataVencimento, hoje });
      const nominal = cent(p.valorNominal);
      if (PARCELA_PAGA.includes(p.status ?? '')) {
        const vp = p.valorPago === null ? nominal : cent(p.valorPago);
        pago += vp;
        const em = p.dataPagamento ? isoParaBR(diaBrasil(p.dataPagamento)) : '—';
        ultimaPaga = { display: `Parcela ${p.numero}`, venc: isoParaBR(venc), em };
        linhas.push({ item: `Parcela ${p.numero}`, vencimento: isoParaBR(venc), valor: nominal, pagamento: em, valorPago: vp, situacao: { rotulo: p.status === 'PAGA_EM_ATRASO' ? '✔ Pago em atraso' : '✔ Pago', tom: 'ok' } });
        continue;
      }
      if (rotuloStatus === StatusParcela.VENCIDA) {
        emAtraso += nominal;
        atrasadas += 1;
        if (!primeiraAtrasada) primeiraAtrasada = { display: `Parcela ${p.numero}`, venc: isoParaBR(venc) };
        linhas.push({ item: `Parcela ${p.numero}`, vencimento: isoParaBR(venc), valor: nominal, pagamento: '—', valorPago: null, situacao: { rotulo: '✕ Em atraso', tom: 'bad' }, classe: 'atrasada' });
        continue;
      }
      if (rotuloStatus === StatusParcela.EM_ABERTO || rotuloStatus === StatusParcela.VENCE_HOJE) {
        futurasMostradas += 1;
        if (futurasMostradas <= 6) {
          linhas.push({ item: `Parcela ${p.numero}`, vencimento: isoParaBR(venc), valor: nominal, pagamento: '—', valorPago: null, situacao: { rotulo: '• A vencer', tom: 'warn' }, classe: 'futura' });
        } else if (!agregada) {
          agregada = { numeroInicial: p.numero, numeroFinal: p.numero, vencInicial: isoParaBR(venc), vencFinal: isoParaBR(venc), valor: nominal, qtd: 1 };
        } else {
          agregada.numeroFinal = p.numero; agregada.vencFinal = isoParaBR(venc); agregada.valor += nominal; agregada.qtd += 1;
        }
        continue;
      }
      // Rescindida, novada, renegociada, em acordo, cancelada…
      linhas.push({ item: `Parcela ${p.numero}`, vencimento: isoParaBR(venc), valor: nominal, pagamento: '—', valorPago: null, situacao: { rotulo: rotuloStatus, tom: 'neutro' }, classe: 'futura' });
    }
    if (agregada) {
      linhas.push({ item: `Parcelas ${agregada.numeroInicial} a ${agregada.numeroFinal}`, vencimento: `${agregada.vencInicial} a ${agregada.vencFinal}`, valor: agregada.valor, pagamento: '—', valorPago: null, situacao: { rotulo: '• A vencer', tom: 'warn' }, classe: 'futura' });
    }

    const pills: DadosHistorico['pills'] = [];
    if (entradaPaga > 0) pills.push({ texto: `Entrada ${formatCurrency(entradaPaga)} paga` });
    pills.push({ texto: `Total pago ${formatCurrency(pago)}`, tom: 'ok' });
    if (atrasadas > 0) pills.push({ texto: `Em atraso ${formatCurrency(emAtraso)} · ${atrasadas} parcela(s) desde ${primeiraAtrasada?.venc}`, tom: 'bad' });
    if (c.status === 'ENCERRADO' && c.motivoEncerramento === 'RESCISAO') pills.push({ texto: 'Contrato rescindido por inadimplência' });

    const notas = [
      `Valores em atraso em valor de face, sem a multa de ${Number(c.taxaMultaAtraso.toString()).toLocaleString('pt-BR')}% e os juros de ${Number(c.taxaJurosAtraso.toString()).toLocaleString('pt-BR')}% ao mês previstos no contrato (cláusula 8.2).`,
    ];
    if (ultimaPaga) notas.push(`Última parcela paga: ${ultimaPaga.display.toLowerCase()} (vencimento ${ultimaPaga.venc}), recebida em ${ultimaPaga.em}.`);
    if (primeiraAtrasada) notas.push(`Da ${primeiraAtrasada.display.toLowerCase()} (${primeiraAtrasada.venc}) em diante, nenhum pagamento.`);

    return {
      cab,
      produto: 'Compra Parcelada',
      contrato: { assinadoEm: isoParaBR(dataCalendarioUTC(c.dataAssinatura)), numeroParcelas: c.numeroParcelas, periodicidade, diaVencimento },
      veiculo: { descricao: c.ativo?.descricao ?? '—', placa: c.ativo?.placa ?? '—', chassi: c.ativo?.chassi ?? null },
      parcela: { valor: valorParcela, composicao },
      pills,
      linhas,
      totais: { pago, emAtraso },
      nota: notas.join(' '),
    };
  }

  // --- Geração ---

  async gerar(contratoId: string, dto: { capturas: string[]; notificacaoId?: string; infleetId?: string; infleetDescricao?: string; observacao?: string }, usuarioId: string) {
    const c = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      select: { id: true, numero: true, status: true, propostaPacoteId: true, legadoCasoId: true, conta: { select: { titular: { select: { nome: true, cpfCnpj: true } } } }, ativo: { select: { descricao: true, placa: true, modelo: true, marca: true, anoModelo: true } } },
    });
    if (!c) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    if (['RASCUNHO', 'AGUARDANDO_ASSINATURA'].includes(c.status)) {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'O dossiê é de contrato que já virou obrigação (assinado)' });
    }
    if (!dto.capturas.length) throw new UnprocessableEntityException({ erro: 'sem_capturas', mensagem: 'Envie ao menos uma captura da conversa no WhatsApp' });

    const cab: CabecalhoDossie = {
      numero: c.numero,
      titular: c.conta.titular.nome,
      cpf: c.conta.titular.cpfCnpj,
      veiculo: c.ativo ? `${c.ativo.descricao} · placa ${c.ativo.placa ?? '—'}` : 'Contrato sem veículo',
      emitidoEm: isoParaBR(dataHojeBrasil()),
    };
    const avisos: string[] = [];
    const partes: { chave: string; titulo: string; pdf: Buffer }[] = [];
    const apagar: string[] = [];

    // Arquivos de entrada (lidos antes de abrir o navegador: erro de arquivo não custa um Chromium).
    const capturas: { dataUrl: string }[] = [];
    for (const id of dto.capturas) {
      const { buffer, ext, caminho } = await this.lerEntrada(id, IMAGENS);
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      capturas.push({ dataUrl: `data:${mime};base64,${buffer.toString('base64')}` });
      apagar.push(caminho);
    }
    const notificacao = dto.notificacaoId ? await this.lerEntrada(dto.notificacaoId, ['.pdf']) : null;
    const infleet = dto.infleetId ? await this.lerEntrada(dto.infleetId, ['.pdf']) : null;
    if (notificacao) apagar.push(notificacao.caminho);
    if (infleet) apagar.push(infleet.caminho);

    const contratoPdf = await this.pdfDoContrato(c.id, c.propostaPacoteId, c.legadoCasoId);
    const historico = await this.dadosHistorico(c.id, cab);
    const social = await this.prisma.db.parametroEmpresa.findFirst();
    let socialPdf: Buffer | null = null;
    if (social?.contratoSocialRef) {
      try { socialPdf = await fs.readFile(join(DIR_EMPRESA, social.contratoSocialRef)); } catch { socialPdf = null; }
    }
    if (!socialPdf) avisos.push('Contrato social da Azit não anexado em Configuração › Documentos da empresa — o dossiê saiu sem essa seção.');

    const resultado = await comNavegador(async (nav) => {
      // 1. Contrato
      if (contratoPdf) {
        partes.push({ chave: 'contrato', titulo: `Contrato ${c.numero} assinado`, pdf: contratoPdf.buffer });
      } else {
        const doc = await this.prisma.db.contratoCredito.findFirst({ where: { id: c.id }, select: { snapshotJson: true } });
        const texto = (doc?.snapshotJson as { documento?: string } | null)?.documento;
        if (texto) {
          avisos.push('Sem PDF assinado deste contrato: entrou o instrumento em texto gerado pelo sistema.');
          partes.push({ chave: 'contrato', titulo: `Contrato ${c.numero} (instrumento gerado pelo sistema)`, pdf: await htmlParaPdf(nav, htmlTextoContrato(cab, texto)) });
        } else {
          avisos.push('Sem PDF nem texto do contrato no sistema — anexe o instrumento à mão.');
        }
      }
      // 2. Histórico
      partes.push({ chave: 'historico', titulo: 'Histórico do contrato', pdf: await htmlParaPdf(nav, htmlHistorico(historico)) });
      // 3. Comunicações (capa + capturas)
      const capaCom = await htmlParaPdf(nav, htmlCapaAnexo(cab, 'Comunicações com o cliente', [
        'Capturas de tela da conversa de WhatsApp entre a Azit Move e o cliente.',
        `${capturas.length} captura(s), em ordem cronológica, enviadas pelo operador em ${cab.emitidoEm}.`,
        `Cada página a seguir reproduz duas capturas, numeradas de 1 a ${capturas.length}.`,
      ]));
      const pagsCom = await htmlParaPdf(nav, htmlCapturas(cab, capturas));
      partes.push({ chave: 'comunicacoes', titulo: `Anexo — Comunicações com o cliente (${capturas.length} capturas)`, pdf: Buffer.concat([]) });
      partes[partes.length - 1].pdf = (await juntarSemRodape([capaCom, pagsCom]));
      // 4. Notificação extrajudicial
      if (notificacao) {
        const capa = await htmlParaPdf(nav, htmlCapaAnexo(cab, 'Notificação extrajudicial', ['Notificação enviada ao cliente, reproduzida na íntegra nas páginas seguintes.']));
        partes.push({ chave: 'notificacao', titulo: 'Anexo — Notificação extrajudicial', pdf: await juntarSemRodape([capa, notificacao.buffer]) });
      }
      // 5. Infleet
      if (infleet) {
        const capa = await htmlParaPdf(nav, htmlCapaAnexo(cab, 'Rastreamento Infleet', [
          dto.infleetDescricao?.trim() || 'Relatório exportado da plataforma Infleet (AZIT COMERCIO DE VEICULOS LTDA), reproduzido na íntegra nas páginas seguintes.',
        ]));
        partes.push({ chave: 'infleet', titulo: 'Anexo — Rastreamento Infleet', pdf: await juntarSemRodape([capa, infleet.buffer]) });
      }
      // 6. Contrato social
      if (socialPdf) {
        const capa = await htmlParaPdf(nav, htmlCapaAnexo(cab, 'Contrato social da Azit', ['AZIT COMERCIO DE VEICULOS LTDA', `${social?.contratoSocialDescricao || 'Contrato social'}, reproduzido na íntegra nas páginas seguintes.`]));
        partes.push({ chave: 'contrato_social', titulo: 'Anexo — Contrato social da Azit', pdf: await juntarSemRodape([capa, socialPdf]) });
      }
      // Capa com sumário: precisa das contagens (capa = página 1).
      const secoes: (SecaoSumario & { chave: string })[] = [];
      let pagina = 2;
      for (const p of partes) {
        const n = await contarPaginas(p.pdf);
        secoes.push({ chave: p.chave, titulo: p.titulo, paginaInicial: pagina, paginas: n });
        pagina += n;
      }
      const capa = await htmlParaPdf(nav, htmlCapa(cab, secoes, avisos));
      const { pdf, paginas } = await juntarPdfs([capa, ...partes.map((p) => p.pdf)], `Dossiê · contrato ${c.numero} · ${c.conta.titular.nome}`);
      return { pdf, paginas, secoes };
    });

    await fs.mkdir(DIR_DOSSIES, { recursive: true });
    const composicao: ComposicaoDossie = { secoes: [{ chave: 'capa', titulo: 'Capa e sumário', paginaInicial: 1, paginas: 1 }, ...resultado.secoes], avisos };
    const registro = await this.prisma.db.dossieContrato.create({
      data: { contratoId: c.id, geradoPor: usuarioId, arquivoRef: '', paginas: resultado.paginas, capturas: capturas.length, tamanho: resultado.pdf.length, composicao: composicao as unknown as Prisma.InputJsonValue, observacao: dto.observacao?.trim() || null },
    });
    const ref = `${registro.id}.pdf`;
    await fs.writeFile(join(DIR_DOSSIES, ref), resultado.pdf);
    await this.prisma.db.dossieContrato.update({ where: { id: registro.id }, data: { arquivoRef: ref } });
    for (const caminho of apagar) { try { await fs.unlink(caminho); } catch { /* já não existe */ } }
    await this.prisma.db.logAuditoria.create({
      data: { usuarioId, acao: 'dossie_gerado', entidade: 'contrato', entidadeId: c.id, depois: { dossieId: registro.id, paginas: resultado.paginas, capturas: capturas.length, secoes: composicao.secoes.map((s) => s.chave), avisos } },
    });
    this.logger.log(`Dossiê ${registro.id} do contrato ${c.numero}: ${resultado.paginas} páginas, ${capturas.length} capturas`);
    return this.mapear({ ...registro, arquivoRef: ref }, c.conta.titular.nome);
  }

  async listar(contratoId: string) {
    const lista = await this.prisma.db.dossieContrato.findMany({ where: { contratoId }, orderBy: { createdAt: 'desc' } });
    const usuarios = await this.prisma.db.usuario.findMany({ where: { id: { in: [...new Set(lista.map((d) => d.geradoPor))] } }, select: { id: true, nome: true } });
    const nome = new Map(usuarios.map((u) => [u.id, u.nome]));
    return lista.map((d) => this.mapear(d, nome.get(d.geradoPor) ?? null));
  }

  private mapear(d: { id: string; contratoId: string; geradoPor: string; arquivoRef: string; paginas: number; capturas: number; tamanho: number; composicao: Prisma.JsonValue; observacao: string | null; createdAt: Date }, geradoPorNome: string | null) {
    const comp = d.composicao as unknown as ComposicaoDossie;
    return {
      id: d.id,
      contratoId: d.contratoId,
      geradoEm: d.createdAt.toISOString(),
      geradoPor: geradoPorNome,
      paginas: d.paginas,
      capturas: d.capturas,
      tamanho: d.tamanho,
      secoes: comp?.secoes ?? [],
      avisos: comp?.avisos ?? [],
      observacao: d.observacao,
      arquivo: `dossie-${d.contratoId}-${d.id}.pdf`,
    };
  }

  async baixar(dossieId: string): Promise<{ nome: string; buffer: Buffer }> {
    const d = await this.prisma.db.dossieContrato.findFirst({ where: { id: dossieId }, include: { contrato: { select: { numero: true } } } });
    if (!d) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Dossiê não encontrado' });
    return { nome: `dossie-${d.contrato.numero}-${dataCalendarioUTC(d.createdAt)}.pdf`, buffer: await fs.readFile(join(DIR_DOSSIES, d.arquivoRef)) };
  }
}

// 'segunda-feira' → 'segundas-feiras'; 'sábado' → 'sábados'.
function pluralDiaSemana(nome: string): string {
  return nome.includes('-feira') ? nome.replace('-feira', 's-feiras') : `${nome}s`;
}

// Junção interna (sem rodapé): o rodapé único vai na montagem final.
async function juntarSemRodape(partes: Buffer[]): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib');
  const saida = await PDFDocument.create();
  for (const parte of partes) {
    const doc = await PDFDocument.load(parte, { ignoreEncryption: true });
    for (const p of await saida.copyPages(doc, doc.getPageIndices())) saida.addPage(p);
  }
  return Buffer.from(await saida.save());
}
