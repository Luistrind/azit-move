import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { promises as fs } from 'fs';
import { join } from 'path';
import { DecisaoEnvioWhatsapp } from '@azit/types';
import { janelaRespostaWhatsapp, JANELA_RESPOSTA_WHATSAPP_HORAS, normalizarWhatsapp } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { QUEUE_NAMES } from '../queues/queues.module';
import { WhatsappEnvioService } from './whatsapp-envio.service';
import { UPLOADS_WHATSAPP, WhatsappMensagensService } from './whatsapp-mensagens.service';
import { JOB_EVENTO_META } from './whatsapp.processor';

// ============================================================
// Conversas do WhatsApp — doc 02 §24 (opção C, decisão Luís 19/09; construída
// em 15/11). O número dedicado fica SÓ na API: a resposta do cliente chega pelo
// webhook e é atendida aqui. A conversa é do NÚMERO canônico, ligada ao titular
// quando casa com o cadastro. A tela junta as mensagens trocadas aos lembretes
// enviados àquele número, sem duplicar registro (o lembrete continua sendo
// LembretePagamento).
// ============================================================

// Lembretes que aparecem na conversa: os que saíram e os simulados (marcados).
const SITUACOES_NA_CONVERSA = ['ENVIADO', 'ENTREGUE', 'LIDO', 'SIMULADO'] as const;
const LIMITE_TEXTO = 4096; // limite da Meta para mensagem de texto

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

  // ---------------- Lista ----------------

  async listar() {
    const [grupos, naoLidas] = await Promise.all([
      this.prisma.db.mensagemWhatsapp.groupBy({ by: ['numero'], _max: { momento: true } }),
      this.prisma.db.mensagemWhatsapp.groupBy({ by: ['numero'], where: { direcao: 'ENTRADA', lidaEm: null }, _count: { _all: true } }),
    ]);
    const mapaNaoLidas = new Map(naoLidas.map((n) => [n.numero, n._count._all]));
    const itens = await Promise.all(
      grupos.map(async (g) => {
        const [ultima, comPerfil, titular] = await Promise.all([
          this.prisma.db.mensagemWhatsapp.findFirst({ where: { numero: g.numero }, orderBy: { momento: 'desc' } }),
          this.prisma.db.mensagemWhatsapp.findFirst({ where: { numero: g.numero, nomePerfil: { not: null } }, orderBy: { momento: 'desc' }, select: { nomePerfil: true } }),
          // Pelo cadastro de AGORA: se o WhatsApp do titular foi corrigido depois, a conversa passa a ser dele.
          this.mensagens.titularDoNumero(g.numero),
        ]);
        return {
          numero: g.numero,
          titular,
          nomePerfil: comPerfil?.nomePerfil ?? null,
          ultimaEm: g._max.momento?.toISOString() ?? null,
          ultimaDirecao: ultima?.direcao ?? null,
          ultimaPrevia: (ultima?.texto ?? (ultima ? `(${ultima.tipo})` : '')).slice(0, 120),
          naoLidas: mapaNaoLidas.get(g.numero) ?? 0,
        };
      }),
    );
    // Com mensagem não lida primeiro; dentro de cada grupo, a mais recente primeiro.
    return itens.sort((a, b) => (b.naoLidas > 0 ? 1 : 0) - (a.naoLidas > 0 ? 1 : 0) || (b.ultimaEm ?? '').localeCompare(a.ultimaEm ?? ''));
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
    const contratos = titular
      ? await this.prisma.db.contratoCredito.findMany({
          where: { conta: { titularId: titular.id }, status: 'ATIVO' },
          select: { id: true, numero: true, ativo: { select: { placa: true, modelo: true } } },
        })
      : [];
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
        temMidia: !!m.midiaId,
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

    return {
      numero,
      titular,
      nomePerfil: [...mensagens].reverse().find((m) => m.nomePerfil)?.nomePerfil ?? null,
      contratos,
      janela: { aberta: janela.aberta, ate: janela.ate?.toISOString() ?? null, horas: JANELA_RESPOSTA_WHATSAPP_HORAS },
      // O que acontece com uma resposta para este número, agora (doc 02 §23.2).
      envio: { producao: decisao.producao, decisao: decisao.decisao, motivo: decisao.motivo, enviaDeVerdade: decisao.decisao === DecisaoEnvioWhatsapp.ENVIA },
      itens,
    };
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

  // Resposta em texto livre — só dentro da janela de 24 h (§24 item 3).
  async responder(numeroBruto: string, texto: string, usuarioId?: string) {
    const numero = normalizarWhatsapp(numeroBruto);
    if (!numero) throw new UnprocessableEntityException({ erro: 'numero_invalido', mensagem: 'Número de WhatsApp inválido' });
    const t = (texto ?? '').trim();
    if (!t || t.length > LIMITE_TEXTO) {
      throw new UnprocessableEntityException({ erro: 'texto_invalido', mensagem: `Escreva a resposta (até ${LIMITE_TEXTO.toLocaleString('pt-BR')} caracteres)` });
    }
    const ultimaEntrada = await this.prisma.db.mensagemWhatsapp.findFirst({ where: { numero, direcao: 'ENTRADA' }, orderBy: { momento: 'desc' } });
    if (!janelaRespostaWhatsapp(ultimaEntrada?.momento, new Date()).aberta) {
      throw new UnprocessableEntityException({
        erro: 'janela_fechada',
        mensagem: `A Meta só permite texto livre até ${JANELA_RESPOSTA_WHATSAPP_HORAS} horas depois da última mensagem do cliente. Passado esse prazo, só saem os modelos aprovados (os lembretes).`,
      });
    }
    const titular = await this.mensagens.titularDoNumero(numero);
    const registro = await this.prisma.db.mensagemWhatsapp.create({
      data: { direcao: 'SAIDA', numero, titularId: titular?.id ?? null, tipo: 'text', texto: t, usuarioId, momento: new Date(), status: 'enviando' },
    });
    const r = await this.envio.enviarTexto({ destino: numero, texto: t });
    if (r.resultado === 'ENVIADO') {
      await this.prisma.db.mensagemWhatsapp.update({ where: { id: registro.id }, data: { mensagemId: r.mensagemId, status: 'enviada' } });
      return { resultado: 'enviada' as const };
    }
    const status = r.resultado === 'SIMULADO' ? 'simulada' : r.resultado === 'RETIDO' ? 'retida' : 'falhou';
    await this.prisma.db.mensagemWhatsapp.update({ where: { id: registro.id }, data: { status, falhaMotivo: r.motivo } });
    return { resultado: status as 'simulada' | 'retida' | 'falhou', motivo: r.motivo };
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
