import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DecisaoEnvioWhatsapp, EtiquetaContato, nomeMomentoLembrete, TipoMidiaSaidaWhatsapp } from '@azit/types';
import {
  dataHojeBrasil,
  etiquetaDoContato,
  janelaRespostaWhatsapp,
  JANELA_RESPOSTA_WHATSAPP_HORAS,
  normalizarWhatsapp,
  reaisParaCentavos,
  rotuloAtivo,
  rotuloReferencia,
  ultimaAtividadeConversa,
  validarMidiaSaidaWhatsapp,
} from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { comNavegador, htmlParaPdf } from '../dossie/pdf';
import { converterParaVoz, MIME_VOZ } from './audio-voz';
import { htmlSimulacaoPdf, nomeArquivoSimulacao } from './simulacao-pdf';
import { ResultadoEnvioWhatsapp, WhatsappEnvioService } from './whatsapp-envio.service';
import { UPLOADS_WHATSAPP, WhatsappMensagensService } from './whatsapp-mensagens.service';
import { JOB_EVENTO_META } from './whatsapp.processor';
import { EnviarAnexoDto, EnviarSimulacaoDto } from './dto/conversa.dto';

// ============================================================
// Conversas do WhatsApp — doc 02 §24 (construída em 15/11) e §34 (atendimento,
// decisão Luís 25/11). O número oficial fica SÓ na API: tudo o que o cliente,
// o ex-cliente ou o lead escreve chega pelo webhook e é atendido aqui. A
// conversa é do NÚMERO canônico, ligada ao titular (ou ao lead) quando casa
// com o cadastro. A tela junta as mensagens trocadas aos lembretes enviados
// àquele número, sem duplicar registro (o lembrete continua sendo
// LembretePagamento).
// ============================================================

// Lembretes que aparecem na conversa (e põem o número na lista — §34.2).
const SITUACOES_NA_CONVERSA = ['ENVIADO', 'ENTREGUE', 'LIDO', 'SIMULADO'] as const;
const LIMITE_TEXTO = 4096; // limite da Meta para mensagem de texto

const TIPO_META: Record<TipoMidiaSaidaWhatsapp, 'image' | 'document' | 'audio'> = {
  [TipoMidiaSaidaWhatsapp.IMAGEM]: 'image',
  [TipoMidiaSaidaWhatsapp.DOCUMENTO]: 'document',
  [TipoMidiaSaidaWhatsapp.AUDIO]: 'audio',
};
const EXTENSAO_SAIDA: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3', 'text/plain': 'txt', 'application/msword': 'doc', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

type StatusSaida = 'enviada' | 'simulada' | 'retida' | 'falhou';

@Injectable()
export class ConversaService {
  private readonly logger = new Logger(ConversaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mensagens: WhatsappMensagensService,
    private readonly envio: WhatsappEnvioService,
    @InjectQueue(QUEUE_NAMES.WHATSAPP) private readonly fila: Queue,
  ) {}

  private canonico(bruto: string): string {
    return normalizarWhatsapp(bruto) ?? bruto.replace(/\D/g, '');
  }

  // Quantas mensagens de clientes ninguém abriu ainda — contador do menu.
  async naoLidas() {
    return { total: await this.prisma.db.mensagemWhatsapp.count({ where: { direcao: 'ENTRADA', lidaEm: null } }) };
  }

  // Status reais dos contratos de crédito de cada titular — base da etiqueta (§34.3).
  private async statusContratosPorTitular(titularIds: string[]): Promise<Map<string, string[]>> {
    const mapa = new Map<string, string[]>(titularIds.map((id) => [id, []]));
    if (!titularIds.length) return mapa;
    const contratos = await this.prisma.db.contratoCredito.findMany({
      where: { conta: { titularId: { in: titularIds } } },
      select: { status: true, conta: { select: { titularId: true } } },
    });
    for (const k of contratos) mapa.get(k.conta.titularId)?.push(k.status);
    return mapa;
  }

  // ---------------- Lista (§34.2) ----------------

  async listar() {
    const [grupos, entradas, naoLidas, lembretes] = await Promise.all([
      this.prisma.db.mensagemWhatsapp.groupBy({ by: ['numero'], _max: { momento: true } }),
      this.prisma.db.mensagemWhatsapp.groupBy({ by: ['numero'], where: { direcao: 'ENTRADA' }, _count: { _all: true } }),
      this.prisma.db.mensagemWhatsapp.groupBy({ by: ['numero'], where: { direcao: 'ENTRADA', lidaEm: null }, _count: { _all: true } }),
      // Todo número que recebeu lembrete entra na lista (decisão Luís 25/11).
      this.prisma.db.lembretePagamento.groupBy({
        by: ['destino'],
        where: { destino: { not: null }, situacao: { in: [...SITUACOES_NA_CONVERSA] } },
        _max: { enviadoEm: true, createdAt: true },
      }),
    ]);
    const ultimaMsg = new Map(grupos.map((g) => [g.numero, g._max.momento?.toISOString() ?? null]));
    const respondeu = new Set(entradas.map((e) => e.numero));
    const mapaNaoLidas = new Map(naoLidas.map((n) => [n.numero, n._count._all]));
    const ultimoLem = new Map(lembretes.filter((l) => l.destino).map((l) => [l.destino as string, (l._max.enviadoEm ?? l._max.createdAt)?.toISOString() ?? null]));
    const numeros = [...new Set([...ultimaMsg.keys(), ...ultimoLem.keys()])];

    const base = await Promise.all(
      numeros.map(async (numero) => {
        const [ultima, lembrete, comPerfil, titular] = await Promise.all([
          ultimaMsg.has(numero) ? this.prisma.db.mensagemWhatsapp.findFirst({ where: { numero }, orderBy: { momento: 'desc' } }) : null,
          ultimoLem.has(numero)
            ? this.prisma.db.lembretePagamento.findFirst({
                where: { destino: numero, situacao: { in: [...SITUACOES_NA_CONVERSA] } },
                orderBy: { createdAt: 'desc' },
                include: { fatura: { select: { numero: true } } },
              })
            : null,
          ultimaMsg.has(numero)
            ? this.prisma.db.mensagemWhatsapp.findFirst({ where: { numero, nomePerfil: { not: null } }, orderBy: { momento: 'desc' }, select: { nomePerfil: true } })
            : null,
          // Pelo cadastro de AGORA: se o WhatsApp do titular foi corrigido depois, a conversa passa a ser dele.
          this.mensagens.titularDoNumero(numero),
        ]);
        const lead = titular ? null : await this.mensagens.leadDoNumero(numero);
        return { numero, ultima, lembrete, comPerfil, titular, lead };
      }),
    );
    const contratos = await this.statusContratosPorTitular([...new Set(base.map((b) => b.titular?.id).filter((i): i is string => !!i))]);

    const itens = base.map(({ numero, ultima, lembrete, comPerfil, titular, lead }) => {
      const atividade = ultimaAtividadeConversa(ultimaMsg.get(numero) ?? null, ultimoLem.get(numero) ?? null);
      const previaLembrete = lembrete ? `Lembrete automático · ${nomeMomentoLembrete(lembrete.momento).toLowerCase()} · fatura nº ${lembrete.fatura.numero}` : '';
      const previaMensagem = ultima ? (ultima.texto ?? `(${ultima.tipo})`) : '';
      return {
        numero,
        titular,
        lead,
        nomePerfil: comPerfil?.nomePerfil ?? null,
        etiqueta: etiquetaDoContato({ titular: titular ? { statusContratos: contratos.get(titular.id) ?? [] } : null, temLead: !!lead }),
        ultimaEm: atividade.em,
        ultimaOrigem: atividade.origem,
        ultimaDirecao: atividade.origem === 'lembrete' ? ('SAIDA' as const) : (ultima?.direcao ?? null),
        ultimaPrevia: (atividade.origem === 'lembrete' ? previaLembrete : previaMensagem).slice(0, 120),
        naoLidas: mapaNaoLidas.get(numero) ?? 0,
        respondeu: respondeu.has(numero),
      };
    });
    // A última atividade primeiro, como no WhatsApp. Não lida NÃO fixa no topo (§34.2).
    return itens.sort((a, b) => (b.ultimaEm ?? '').localeCompare(a.ultimaEm ?? ''));
  }

  // ---------------- Uma conversa ----------------

  async conversa(numeroBruto: string) {
    const numero = this.canonico(numeroBruto);
    const [mensagens, titular, lembretes] = await Promise.all([
      this.prisma.db.mensagemWhatsapp.findMany({ where: { numero }, orderBy: { momento: 'asc' } }),
      this.mensagens.titularDoNumero(numero),
      this.prisma.db.lembretePagamento.findMany({
        where: { destino: numero, situacao: { in: [...SITUACOES_NA_CONVERSA] } },
        include: { fatura: { select: { numero: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const leadBasico = titular ? null : await this.mensagens.leadDoNumero(numero);
    const [lead, conta, historico] = await Promise.all([
      leadBasico
        ? this.prisma.db.lead.findUnique({ where: { id: leadBasico.id }, select: { id: true, nome: true, cpf: true, canalOrigem: true, createdAt: true } })
        : null,
      titular ? this.prisma.db.conta.findFirst({ where: { titularId: titular.id }, select: { id: true } }) : null,
      titular
        ? this.prisma.db.contratoCredito.findMany({
            where: { conta: { titularId: titular.id } },
            orderBy: { dataAssinatura: 'desc' },
            select: { id: true, numero: true, status: true, motivoEncerramento: true, dataEncerramento: true, ativo: { select: { placa: true, modelo: true, descricao: true } } },
          })
        : [],
    ]);
    const simulacoes = await this.simulacoesDoContato(titular?.id ?? null, lead?.id ?? null);
    const idsOperadores = [...new Set(mensagens.map((m) => m.usuarioId).filter((i): i is string => !!i))];
    const operadores = new Map(
      (idsOperadores.length ? await this.prisma.db.usuario.findMany({ where: { id: { in: idsOperadores } }, select: { id: true, nome: true } }) : []).map((u) => [u.id, u.nome]),
    );
    const ultimaEntrada = [...mensagens].reverse().find((m) => m.direcao === 'ENTRADA');
    const janela = janelaRespostaWhatsapp(ultimaEntrada?.momento, new Date());
    const decisao = await this.envio.decidir(numero);

    const itens = [
      ...mensagens.map((m) => ({
        id: m.id,
        origem: 'mensagem' as const,
        direcao: m.direcao,
        momento: m.momento.toISOString(),
        tipo: m.tipo,
        texto: m.texto,
        // Mídia recebida tem id na Meta; a enviada pela tela tem só o arquivo guardado (§34.6).
        temMidia: !!m.midiaId || !!m.midiaRef,
        midiaDisponivel: !!m.midiaRef,
        midiaNome: m.midiaNome,
        situacao: m.direcao === 'SAIDA' ? m.status : null,
        motivo: m.falhaMotivo,
        autor: m.direcao === 'SAIDA' ? (m.usuarioId ? operadores.get(m.usuarioId) ?? 'operador' : 'sistema') : null,
        lida: m.direcao === 'SAIDA' || !!m.lidaEm,
      })),
      ...lembretes.map((l) => ({
        id: l.id,
        origem: 'lembrete' as const,
        direcao: 'SAIDA' as const,
        momento: (l.enviadoEm ?? l.createdAt).toISOString(),
        tipo: l.momento, // D_MENOS_2 | D_ZERO
        texto: l.texto,
        temMidia: false,
        midiaDisponivel: false,
        midiaNome: null,
        situacao: l.situacao as string,
        motivo: l.motivo,
        autor: `lembrete automático · fatura nº ${l.fatura.numero}`,
        lida: true,
      })),
    ].sort((a, b) => a.momento.localeCompare(b.momento));

    const statusContratos = historico.map((k) => k.status as string);
    return {
      numero,
      titular,
      contaId: conta?.id ?? null,
      lead: lead ? { id: lead.id, nome: lead.nome, cpf: lead.cpf, canalOrigem: lead.canalOrigem.toLowerCase(), criadoEm: lead.createdAt.toISOString() } : null,
      nomePerfil: [...mensagens].reverse().find((m) => m.nomePerfil)?.nomePerfil ?? null,
      etiqueta: etiquetaDoContato({ titular: titular ? { statusContratos } : null, temLead: !!lead }) as EtiquetaContato,
      respondeu: !!ultimaEntrada,
      // Ativos: atalhos do cabeçalho e base da quitação no painel.
      contratos: historico
        .filter((k) => k.status === 'ATIVO')
        .map((k) => ({ id: k.id, numero: k.numero, ativo: k.ativo ? { placa: k.ativo.placa, modelo: k.ativo.modelo } : null })),
      // Todos (aba Histórico do ex-cliente).
      historico: historico.map((k) => ({
        id: k.id,
        numero: k.numero,
        status: k.status,
        motivoEncerramento: k.motivoEncerramento?.toLowerCase() ?? null,
        dataEncerramento: k.dataEncerramento?.toISOString() ?? null,
        ativo: k.ativo ? rotuloAtivo({ descricao: k.ativo.descricao, placa: k.ativo.placa }) : null,
      })),
      simulacoes,
      janela: { aberta: janela.aberta, ate: janela.ate?.toISOString() ?? null, horas: JANELA_RESPOSTA_WHATSAPP_HORAS },
      // O que acontece com uma resposta para este número, agora (doc 02 §23.2).
      envio: { producao: decisao.producao, decisao: decisao.decisao, motivo: decisao.motivo, enviaDeVerdade: decisao.decisao === DecisaoEnvioWhatsapp.ENVIA },
      itens,
    };
  }

  // Simulações do funil deste contato (§34.4/§34.5): do titular ou do lead —
  // simular exige CPF, então não há simulação sem dono. As mais recentes primeiro.
  private async simulacoesDoContato(titularId: string | null, leadId: string | null) {
    const onde = [...(titularId ? [{ titularId }] : []), ...(leadId ? [{ leadId }] : [])];
    if (!onde.length) return [];
    const lista = await this.prisma.db.simulacao.findMany({
      where: { OR: onde },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        ativo: { select: { descricao: true, placa: true } },
        referencia: { select: { marca: true, modelo: true, anoModelo: true } },
        ofertas: { orderBy: { createdAt: 'desc' } },
        proposta: { select: { id: true } },
      },
    });
    return lista.map((s) => {
      const oferta = s.ofertas.find((o) => o.selecionada) ?? s.ofertas[0] ?? null;
      return {
        id: s.id,
        criadaEm: s.createdAt.toISOString(),
        validaAte: s.validaAte?.toISOString() ?? null,
        veiculo: s.ativo ? rotuloAtivo(s.ativo) : s.referencia ? rotuloReferencia(s.referencia) : 'Valor informado',
        valorAvista: reaisParaCentavos(s.valorAvista?.toString() ?? 0),
        oferta: oferta
          ? {
              valorEntrada: reaisParaCentavos(oferta.valorEntrada.toString()),
              prazoMeses: oferta.prazoMeses,
              frequencia: oferta.frequencia.toLowerCase(),
              valorParcela: reaisParaCentavos(oferta.valorParcela.toString()),
            }
          : null,
        propostaId: s.proposta?.id ?? null,
      };
    });
  }

  // Abrir a conversa = ler: marca no sistema e manda o visto azul ao cliente.
  async marcarLida(numeroBruto: string, usuarioId?: string) {
    const numero = this.canonico(numeroBruto);
    const pendentes = await this.prisma.db.mensagemWhatsapp.findMany({ where: { numero, direcao: 'ENTRADA', lidaEm: null }, orderBy: { momento: 'desc' } });
    if (!pendentes.length) return { marcadas: 0 };
    await this.prisma.db.mensagemWhatsapp.updateMany({ where: { id: { in: pendentes.map((p) => p.id) } }, data: { lidaEm: new Date() } });
    // A Meta marca as anteriores junto com a mais recente. Pela regra de envio:
    // fora de produção, nem o visto sai para número não autorizado.
    if (pendentes[0].mensagemId) await this.envio.confirmarLeitura(numero, pendentes[0].mensagemId);
    this.logger.log(`conversa ${numero.slice(0, 4)}…${numero.slice(-2)}: ${pendentes.length} mensagem(ns) lida(s) por ${usuarioId ?? '?'}`);
    return { marcadas: pendentes.length };
  }

  // ---------------- Saída (texto, mídia, simulação) ----------------

  // Número válido E janela de 24 h aberta (§24 item 3; vale para mídia, §34.6).
  private async exigirJanela(numeroBruto: string): Promise<string> {
    const numero = normalizarWhatsapp(numeroBruto);
    if (!numero) throw new UnprocessableEntityException({ erro: 'numero_invalido', mensagem: 'Número de WhatsApp inválido' });
    const ultimaEntrada = await this.prisma.db.mensagemWhatsapp.findFirst({ where: { numero, direcao: 'ENTRADA' }, orderBy: { momento: 'desc' } });
    if (!janelaRespostaWhatsapp(ultimaEntrada?.momento, new Date()).aberta) {
      throw new UnprocessableEntityException({
        erro: 'janela_fechada',
        mensagem: `A Meta só permite mensagem livre (texto, áudio ou anexo) até ${JANELA_RESPOSTA_WHATSAPP_HORAS} horas depois da última mensagem do cliente. Passado esse prazo, só saem os modelos aprovados (os lembretes).`,
      });
    }
    return numero;
  }

  private validarTexto(texto: string | undefined | null, obrigatorio: boolean): string {
    const t = (texto ?? '').trim();
    if ((obrigatorio && !t) || t.length > LIMITE_TEXTO) {
      throw new UnprocessableEntityException({ erro: 'texto_invalido', mensagem: `Escreva a mensagem (até ${LIMITE_TEXTO.toLocaleString('pt-BR')} caracteres)` });
    }
    return t;
  }

  // Grava a saída como "enviando", executa pela regra única e grava o desfecho.
  private async registrarEnvio(
    dados: { numero: string; titularId: string | null; tipo: string; texto: string | null; usuarioId?: string; midia?: { ref: string; tipo: string; nome: string } },
    enviar: () => Promise<ResultadoEnvioWhatsapp>,
  ): Promise<{ resultado: StatusSaida; motivo?: string }> {
    const registro = await this.prisma.db.mensagemWhatsapp.create({
      data: {
        direcao: 'SAIDA',
        numero: dados.numero,
        titularId: dados.titularId,
        tipo: dados.tipo,
        texto: dados.texto || null,
        midiaRef: dados.midia?.ref,
        midiaTipo: dados.midia?.tipo,
        midiaNome: dados.midia?.nome,
        usuarioId: dados.usuarioId,
        momento: new Date(),
        status: 'enviando',
      },
    });
    const r = await enviar();
    if (r.resultado === 'ENVIADO') {
      await this.prisma.db.mensagemWhatsapp.update({ where: { id: registro.id }, data: { mensagemId: r.mensagemId, status: 'enviada' } });
      return { resultado: 'enviada' };
    }
    const status: StatusSaida = r.resultado === 'SIMULADO' ? 'simulada' : r.resultado === 'RETIDO' ? 'retida' : 'falhou';
    await this.prisma.db.mensagemWhatsapp.update({ where: { id: registro.id }, data: { status, falhaMotivo: r.motivo } });
    return { resultado: status, motivo: r.motivo };
  }

  private async guardarArquivo(buffer: Buffer, mime: string): Promise<string> {
    const ref = `saida-${randomUUID()}.${EXTENSAO_SAIDA[mime] ?? 'bin'}`;
    await fs.mkdir(UPLOADS_WHATSAPP, { recursive: true });
    await fs.writeFile(join(UPLOADS_WHATSAPP, ref), buffer);
    return ref;
  }

  // Resposta em texto livre — só dentro da janela de 24 h (§24 item 3).
  async responder(numeroBruto: string, texto: string, usuarioId?: string) {
    const t = this.validarTexto(texto, true);
    const numero = await this.exigirJanela(numeroBruto);
    const titular = await this.mensagens.titularDoNumero(numero);
    return this.registrarEnvio({ numero, titularId: titular?.id ?? null, tipo: 'text', texto: t, usuarioId }, () => this.envio.enviarTexto({ destino: numero, texto: t }));
  }

  // Imagem, documento ou áudio gravado na tela (§34.6).
  async enviarAnexo(numeroBruto: string, dto: EnviarAnexoDto, usuarioId?: string) {
    const legenda = this.validarTexto(dto.legenda, false);
    const numero = await this.exigirJanela(numeroBruto);
    const base64 = dto.conteudoBase64.includes(',') ? dto.conteudoBase64.split(',')[1] : dto.conteudoBase64;
    let arquivo: Buffer = Buffer.from(base64, 'base64');
    let mime = dto.mime.split(';')[0].trim().toLowerCase();
    const invalido = validarMidiaSaidaWhatsapp(dto.tipo, mime, arquivo.length);
    if (invalido) throw new UnprocessableEntityException({ erro: 'anexo_invalido', mensagem: invalido });

    let nome = (dto.nome || '').trim().slice(0, 120) || 'arquivo';
    let aviso: string | undefined;
    if (dto.tipo === TipoMidiaSaidaWhatsapp.AUDIO) {
      try {
        arquivo = await converterParaVoz(arquivo);
        mime = MIME_VOZ;
        nome = `audio-${dataHojeBrasil()}.ogg`;
      } catch (e) {
        // Sem conversão não há voz que a Meta aceite. Quando o envio seria real,
        // recusa; fora disso (simulado/retido), guarda o original para a conversa.
        const d = await this.envio.decidir(numero);
        if (d.decisao === DecisaoEnvioWhatsapp.ENVIA) {
          throw new UnprocessableEntityException({ erro: 'audio_sem_conversao', mensagem: `Não foi possível preparar o áudio para o WhatsApp: ${(e as Error).message}` });
        }
        aviso = (e as Error).message;
      }
    }
    const ref = await this.guardarArquivo(arquivo, mime);
    const titular = await this.mensagens.titularDoNumero(numero);
    const tipoMeta = TIPO_META[dto.tipo];
    const r = await this.registrarEnvio(
      { numero, titularId: titular?.id ?? null, tipo: tipoMeta, texto: tipoMeta === 'audio' ? null : legenda, usuarioId, midia: { ref, tipo: mime, nome } },
      () => this.envio.enviarMidia({ destino: numero, tipo: tipoMeta, arquivo, mime, nomeArquivo: nome, legenda: tipoMeta === 'audio' ? null : legenda }),
    );
    return aviso ? { ...r, motivo: [r.motivo, aviso].filter(Boolean).join(' · ') } : r;
  }

  // Resultado de uma simulação do painel mandado ao cliente (§34.7): o PDF
  // (opcional) com as linhas que a tela recebeu do serviço, e o texto.
  async enviarSimulacao(numeroBruto: string, dto: EnviarSimulacaoDto, usuarioId?: string) {
    const texto = this.validarTexto(dto.texto, true);
    const numero = await this.exigirJanela(numeroBruto);
    const titular = await this.mensagens.titularDoNumero(numero);
    let pdf: { resultado: StatusSaida; motivo?: string } | null = null;
    if (dto.pdf) {
      const lead = titular ? null : await this.mensagens.leadDoNumero(numero);
      const perfil = await this.prisma.db.mensagemWhatsapp.findFirst({ where: { numero, nomePerfil: { not: null } }, orderBy: { momento: 'desc' }, select: { nomePerfil: true } });
      const html = htmlSimulacaoPdf({
        titulo: dto.pdf.titulo,
        para: titular?.nome ?? lead?.nome ?? perfil?.nomePerfil ?? 'você',
        destaque: dto.pdf.destaque ?? null,
        linhas: dto.pdf.linhas,
        observacoes: dto.pdf.observacoes ?? [],
        emitidaEm: dataHojeBrasil(),
      });
      const arquivo = await comNavegador((b) => htmlParaPdf(b, html));
      const nome = nomeArquivoSimulacao(dto.pdf.titulo);
      const ref = await this.guardarArquivo(arquivo, 'application/pdf');
      pdf = await this.registrarEnvio(
        { numero, titularId: titular?.id ?? null, tipo: 'document', texto: null, usuarioId, midia: { ref, tipo: 'application/pdf', nome } },
        () => this.envio.enviarMidia({ destino: numero, tipo: 'document', arquivo, mime: 'application/pdf', nomeArquivo: nome }),
      );
    }
    const textoR = await this.registrarEnvio({ numero, titularId: titular?.id ?? null, tipo: 'text', texto, usuarioId }, () => this.envio.enviarTexto({ destino: numero, texto }));
    return { pdf, texto: textoR };
  }

  async arquivoMidia(id: string) {
    const m = await this.prisma.db.mensagemWhatsapp.findUnique({ where: { id } });
    if (!m?.midiaRef) throw new NotFoundException({ erro: 'sem_midia', mensagem: 'Anexo ainda não baixado ou indisponível' });
    return { buffer: await fs.readFile(join(UPLOADS_WHATSAPP, m.midiaRef)), tipo: m.midiaTipo ?? 'application/octet-stream', nome: m.midiaNome ?? m.midiaRef };
  }

  // ---------------- Ferramenta de teste (fora de produção) ----------------

  // Simula uma mensagem recebida, passando pela MESMA fila do webhook real.
  async simularEntrada(numeroBruto: string, texto: string) {
    const numero = normalizarWhatsapp(numeroBruto);
    if (!numero) throw new UnprocessableEntityException({ erro: 'numero_invalido', mensagem: 'Número inválido. Use DDD + número.' });
    const agora = Date.now();
    const evento = {
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            contacts: [{ wa_id: numero, profile: { name: 'Teste (simulado)' } }],
            messages: [{ from: numero, id: `wamid.TESTE.${agora}`, timestamp: String(Math.floor(agora / 1000)), type: 'text', text: { body: (texto ?? '').trim() || 'Mensagem de teste' } }],
          },
        }],
      }],
    };
    await this.fila.add(JOB_EVENTO_META, evento, { removeOnComplete: true, removeOnFail: 50 });
    return { enfileirado: true, numero };
  }
}
