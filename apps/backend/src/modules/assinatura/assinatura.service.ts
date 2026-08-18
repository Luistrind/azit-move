import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../database/prisma.service';
import { NotificacaoService } from '../notificacao/notificacao.service';
import { ZapSignService, SignatarioEntrada } from './zapsign.service';

// Assinatura digital ZapSign F1 (doc 02 §21): o documento congelado no snapshot
// vai à plataforma; os webhooks (via fila — Regra 4) marcam as assinaturas no
// CONTRATO nos MESMOS campos do fluxo atual (assinaturaTitularEm/AzitEm) — o
// gate da ativação (assinaturas → entrada → dia zero) fica intacto.

// PDF assinado: mesmo storage dos documentos da proposta (uploads/ — G1 do
// desenho; substituível por S3 na decisão 5).
const UPLOADS_DIR = join(process.cwd(), 'uploads', 'assinaturas');

interface SignatarioEstado {
  papel: string;
  nome: string;
  signerToken: string;
  signUrl: string;
  visualizouEm?: string;
  assinouEm?: string;
}

// Seed dos parâmetros (F1.1): testemunhas do contrato assinado nº 2026080004;
// dados do assinante Azit (João Pedro) completados pelo Luís na tela.
const PARAMETROS_SEED = {
  azitNome: 'João Pedro',
  azitCpf: '',
  azitWhatsapp: '',
  testemunha1Nome: 'Luís Carlos dos Santos Trindade',
  testemunha1Cpf: '152.508.967-66',
  testemunha1Whatsapp: '27992962772',
  testemunha2Nome: 'Arthur Almeida Luz Félix',
  testemunha2Cpf: '863.278.825-60',
  testemunha2Whatsapp: '',
  envioAutomaticoWhatsapp: true,
};

export interface ParametrosAssinaturaDto {
  azitNome: string;
  azitCpf: string;
  azitWhatsapp: string;
  testemunha1Nome: string;
  testemunha1Cpf: string;
  testemunha1Whatsapp: string;
  testemunha2Nome: string;
  testemunha2Cpf: string;
  testemunha2Whatsapp: string;
  envioAutomaticoWhatsapp: boolean;
}

@Injectable()
export class AssinaturaService {
  private readonly logger = new Logger(AssinaturaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zapSign: ZapSignService,
    private readonly notificacao: NotificacaoService,
  ) {}

  // Linha única, criada sob demanda com o seed — consumida pelo envio à
  // ZapSign e pela formalização (testemunhas impressas no contrato).
  async obterParametros() {
    const existente = await this.prisma.db.parametroAssinatura.findFirst();
    if (existente) return existente;
    return this.prisma.db.parametroAssinatura.create({ data: PARAMETROS_SEED });
  }

  async atualizarParametros(dto: Partial<ParametrosAssinaturaDto>, usuarioId?: string) {
    const atual = await this.obterParametros();
    const atualizado = await this.prisma.db.parametroAssinatura.update({
      where: { id: atual.id },
      data: {
        azitNome: dto.azitNome?.trim() ?? atual.azitNome,
        azitCpf: dto.azitCpf?.trim() ?? atual.azitCpf,
        azitWhatsapp: (dto.azitWhatsapp ?? atual.azitWhatsapp).replace(/\D/g, ''),
        testemunha1Nome: dto.testemunha1Nome?.trim() ?? atual.testemunha1Nome,
        testemunha1Cpf: dto.testemunha1Cpf?.trim() ?? atual.testemunha1Cpf,
        testemunha1Whatsapp: (dto.testemunha1Whatsapp ?? atual.testemunha1Whatsapp).replace(/\D/g, ''),
        testemunha2Nome: dto.testemunha2Nome?.trim() ?? atual.testemunha2Nome,
        testemunha2Cpf: dto.testemunha2Cpf?.trim() ?? atual.testemunha2Cpf,
        testemunha2Whatsapp: (dto.testemunha2Whatsapp ?? atual.testemunha2Whatsapp).replace(/\D/g, ''),
        envioAutomaticoWhatsapp: dto.envioAutomaticoWhatsapp ?? atual.envioAutomaticoWhatsapp,
      },
    });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'parametros_assinatura_alterados',
        entidade: 'parametro_assinatura',
        entidadeId: atualizado.id,
        antes: atual as unknown as Prisma.InputJsonValue,
        depois: atualizado as unknown as Prisma.InputJsonValue,
      },
    });
    return atualizado;
  }

  // Passo do operador: envia o contrato formalizado para assinatura digital.
  // Criação SÓ no clique (G2 do desenho: documento criado consome o plano).
  async enviar(contratoId: string, usuarioId?: string) {
    const contrato = await this.prisma.db.contratoCredito.findFirst({
      where: { id: contratoId },
      include: {
        documentoAssinatura: true,
        conta: { include: { titular: { select: { nome: true, cpfCnpj: true, whatsapp: true, email: true } } } },
        vinculosPapel: { include: { titular: { select: { nome: true, cpfCnpj: true, whatsapp: true, email: true } } } },
      },
    });
    if (!contrato) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Contrato não encontrado' });
    if (contrato.status !== 'AGUARDANDO_ASSINATURA') {
      throw new UnprocessableEntityException({ erro: 'estado_invalido', mensagem: 'O contrato não está aguardando assinatura' });
    }
    if (contrato.documentoAssinatura && contrato.documentoAssinatura.status !== 'recusado' && contrato.documentoAssinatura.status !== 'cancelado') {
      throw new UnprocessableEntityException({
        erro: 'ja_enviado',
        mensagem: 'Este contrato já tem um documento de assinatura em andamento',
      });
    }
    const snapshot = contrato.snapshotJson as null | { documento?: string };
    if (!snapshot?.documento) {
      throw new UnprocessableEntityException({ erro: 'sem_documento', mensagem: 'Contrato sem documento gerado no snapshot' });
    }

    // Signatários (doc 02 §21 F1.1): compradores (ordem 1) → testemunhas padrão
    // (ordem 2) → João Pedro pela Azit (ordem 3). O disparo do link é da ZapSign,
    // por WhatsApp, quando o telefone existe e a chave está ligada.
    const params = await this.obterParametros();
    const zap = params.envioAutomaticoWhatsapp;
    const titular = contrato.conta.titular;
    const signatarios: SignatarioEntrada[] = [
      { papel: 'titular', nome: titular.nome, cpf: titular.cpfCnpj, telefone: titular.whatsapp, email: titular.email ?? undefined, ordem: 1, envioWhatsapp: zap },
    ];
    for (const v of contrato.vinculosPapel) {
      if (v.papel === 'COMPRADOR_SECUNDARIO') {
        signatarios.push({ papel: 'solidario', nome: v.titular.nome, cpf: v.titular.cpfCnpj, telefone: v.titular.whatsapp, ordem: 1, envioWhatsapp: zap });
      } else if (v.papel === 'GARANTIDOR') {
        signatarios.push({ papel: 'garantidor', nome: v.titular.nome, cpf: v.titular.cpfCnpj, telefone: v.titular.whatsapp, ordem: 1, envioWhatsapp: zap });
      }
    }
    // Testemunhas padrão (art. 784 III CPC) — as mesmas impressas no contrato.
    if (params.testemunha1Nome) {
      signatarios.push({ papel: 'testemunha1', nome: params.testemunha1Nome, cpf: params.testemunha1Cpf || undefined, telefone: params.testemunha1Whatsapp || undefined, ordem: 2, envioWhatsapp: zap });
    }
    if (params.testemunha2Nome) {
      signatarios.push({ papel: 'testemunha2', nome: params.testemunha2Nome, cpf: params.testemunha2Cpf || undefined, telefone: params.testemunha2Whatsapp || undefined, ordem: 2, envioWhatsapp: zap });
    }
    // Quem assina pela Azit é uma pessoa nomeada (F1.1) — sem WhatsApp
    // cadastrado, cai no link manual do operador.
    signatarios.push({
      papel: 'azit',
      nome: params.azitNome || 'Azit Comércio de Veículos LTDA',
      cpf: params.azitCpf || undefined,
      telefone: params.azitWhatsapp || undefined,
      ordem: 3,
      envioWhatsapp: zap,
    });

    const doc = await this.zapSign.criarDocumento({
      nome: `Contrato ${contrato.numero} — venda com reserva de domínio`,
      markdown: snapshot.documento,
      externalId: contrato.id,
      signatarios,
    });

    const estado: SignatarioEstado[] = doc.signatarios.map((s) => ({ ...s }));
    const registro = contrato.documentoAssinatura
      ? await this.prisma.db.documentoAssinatura.update({
          where: { id: contrato.documentoAssinatura.id },
          data: {
            docToken: doc.docToken,
            status: 'enviado',
            signatarios: estado as unknown as Prisma.InputJsonValue,
            motivoRecusa: null,
            pdfAssinadoRef: null,
            simulado: doc.simulado,
            enviadoEm: new Date(),
            concluidoEm: null,
          },
        })
      : await this.prisma.db.documentoAssinatura.create({
          data: {
            contratoCreditoId: contrato.id,
            docToken: doc.docToken,
            signatarios: estado as unknown as Prisma.InputJsonValue,
            simulado: doc.simulado,
          },
        });
    await this.prisma.db.logAuditoria.create({
      data: {
        usuarioId,
        acao: 'assinatura_digital_enviada',
        entidade: 'contrato_credito',
        entidadeId: contrato.id,
        depois: { docToken: doc.docToken, simulado: doc.simulado, signatarios: estado.length },
      },
    });
    return this.status(contrato.id, registro.id);
  }

  // Estado para a tela de conclusão (cartão por signatário + links).
  async status(contratoId: string, documentoId?: string) {
    const d = await this.prisma.db.documentoAssinatura.findFirst({
      where: documentoId ? { id: documentoId } : { contratoCreditoId: contratoId },
    });
    if (!d) return { existe: false as const, disponivel: this.zapSign.configurado };
    const signatarios = (d.signatarios as unknown as SignatarioEstado[]) ?? [];
    return {
      existe: true as const,
      disponivel: true,
      id: d.id,
      status: d.status,
      simulado: d.simulado,
      motivoRecusa: d.motivoRecusa,
      pdfDisponivel: !!d.pdfAssinadoRef,
      enviadoEm: d.enviadoEm.toISOString(),
      concluidoEm: d.concluidoEm?.toISOString() ?? null,
      signatarios: signatarios.map((s) => ({
        papel: s.papel,
        nome: s.nome,
        signUrl: s.signUrl,
        visualizouEm: s.visualizouEm ?? null,
        assinouEm: s.assinouEm ?? null,
      })),
    };
  }

  async baixarPdfAssinado(contratoId: string): Promise<{ nome: string; buffer: Buffer }> {
    const d = await this.prisma.db.documentoAssinatura.findFirst({ where: { contratoCreditoId: contratoId } });
    if (!d?.pdfAssinadoRef) {
      throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'PDF assinado ainda não disponível' });
    }
    const buffer = await fs.readFile(join(UPLOADS_DIR, d.pdfAssinadoRef));
    return { nome: d.pdfAssinadoRef, buffer };
  }

  // Processamento do webhook (roda na FILA — Regra 4; idempotente: reenvio da
  // ZapSign com o mesmo evento não duplica efeito).
  async processarEvento(payload: {
    event_type?: string;
    token?: string; // docToken
    external_id?: string; // contratoId
    status?: string;
    rejected_reason?: string | null;
    signer_who_signed?: { token?: string };
    signers?: { token: string; status?: string; signed_at?: string | null; times_viewed?: number; last_view_at?: string | null }[];
  }) {
    const d = await this.prisma.db.documentoAssinatura.findFirst({
      where: payload.token
        ? { docToken: payload.token }
        : payload.external_id
          ? { contratoCreditoId: payload.external_id }
          : { id: '__nunca__' },
      include: { contrato: { select: { id: true, numero: true, propostaPacoteId: true } } },
    });
    if (!d) {
      this.logger.warn(`Webhook ZapSign para documento desconhecido (token=${payload.token ?? '—'}) — ignorado`);
      return;
    }
    if (['assinado', 'cancelado'].includes(d.status) && payload.event_type !== 'doc_signed') return;

    const signatarios = (d.signatarios as unknown as SignatarioEstado[]) ?? [];
    const agora = new Date().toISOString();

    if (payload.event_type === 'doc_refused') {
      await this.prisma.db.documentoAssinatura.update({
        where: { id: d.id },
        data: { status: 'recusado', motivoRecusa: payload.rejected_reason ?? 'Recusado pelo signatário' },
      });
      await this.notificacao.emitir(
        `Contrato ${d.contrato.numero}: assinatura RECUSADA`,
        payload.rejected_reason ?? undefined,
        `/propostas`,
      );
      return;
    }

    // doc_signed / doc_viewed: sincroniza signatários pelo payload (ou marca o
    // signer_who_signed quando a lista não vem).
    if (payload.signers?.length) {
      for (const s of payload.signers) {
        const alvo = signatarios.find((x) => x.signerToken === s.token);
        if (!alvo) continue;
        if (s.signed_at && !alvo.assinouEm) alvo.assinouEm = s.signed_at;
        if ((s.times_viewed ?? 0) > 0 && !alvo.visualizouEm) alvo.visualizouEm = s.last_view_at ?? agora;
      }
    } else if (payload.signer_who_signed?.token) {
      const alvo = signatarios.find((x) => x.signerToken === payload.signer_who_signed?.token);
      if (alvo && !alvo.assinouEm) alvo.assinouEm = agora;
    }

    // Gate jurídico do contrato: COMPRADORES (titular/solidário/garantidor)
    // fecham assinaturaTitularEm; testemunhas contam só para o status geral.
    const clientes = signatarios.filter((s) => ['titular', 'solidario', 'garantidor'].includes(s.papel));
    const azit = signatarios.find((s) => s.papel === 'azit');
    const clientesOk = clientes.length > 0 && clientes.every((s) => !!s.assinouEm);
    const todosOk = signatarios.length > 0 && signatarios.every((s) => !!s.assinouEm);

    // Integração com o fluxo EXISTENTE: as datas jurídicas entram nos mesmos
    // campos que o gate da ativação já valida. Placeholder F1.2 (mock removido
    // 18/08): a assinatura do contrato ÂNCORA vale para TODO o pacote (apartados
    // como o seguro) até o envelope da F2 assinar cada instrumento na ZapSign.
    const alvoPacote = d.contrato.propostaPacoteId
      ? { propostaPacoteId: d.contrato.propostaPacoteId }
      : { id: d.contratoCreditoId };
    const carimbos = {
      ...(clientesOk ? { assinaturaTitularEm: new Date(clientes[0].assinouEm as string) } : {}),
      ...(azit?.assinouEm ? { assinaturaAzitEm: new Date(azit.assinouEm) } : {}),
    };
    if (Object.keys(carimbos).length > 0) {
      await this.prisma.db.contratoCredito.updateMany({ where: alvoPacote, data: carimbos });
    }

    let pdfAssinadoRef = d.pdfAssinadoRef;
    if (todosOk && !pdfAssinadoRef && d.docToken && !d.simulado) {
      // G1 do desenho: o link do PDF assinado expira em 60 min — baixa JÁ.
      try {
        const det = await this.zapSign.detalharDocumento(d.docToken);
        if (det.signedFileUrl) {
          const buffer = await this.zapSign.baixarArquivo(det.signedFileUrl);
          await fs.mkdir(UPLOADS_DIR, { recursive: true });
          pdfAssinadoRef = `${d.id}.pdf`;
          await fs.writeFile(join(UPLOADS_DIR, pdfAssinadoRef), buffer);
        }
      } catch (e) {
        this.logger.error(`Falha ao baixar PDF assinado do contrato ${d.contrato.numero}: ${(e as Error).message}`);
      }
    }

    await this.prisma.db.documentoAssinatura.update({
      where: { id: d.id },
      data: {
        signatarios: signatarios as unknown as Prisma.InputJsonValue,
        status: todosOk ? 'assinado' : signatarios.some((s) => s.assinouEm) ? 'parcialmente_assinado' : d.status,
        concluidoEm: todosOk ? new Date() : null,
        pdfAssinadoRef,
      },
    });

    if (todosOk && d.status !== 'assinado') {
      await this.notificacao.emitir(
        `Contrato ${d.contrato.numero} assinado por todos`,
        'Assinatura digital concluída — pronto para cobrar a entrada.',
        `/propostas`,
      );
    }
  }

  // Dev: simula todos os signatários assinando (E2E sem credenciais).
  async simularAssinaturas(contratoId: string) {
    const d = await this.prisma.db.documentoAssinatura.findFirst({ where: { contratoCreditoId: contratoId } });
    if (!d) throw new NotFoundException({ erro: 'nao_encontrado', mensagem: 'Documento de assinatura não encontrado' });
    const signatarios = (d.signatarios as unknown as SignatarioEstado[]) ?? [];
    await this.processarEvento({
      event_type: 'doc_signed',
      token: d.docToken ?? undefined,
      signers: signatarios.map((s) => ({ token: s.signerToken, signed_at: new Date().toISOString(), times_viewed: 1 })),
    });
    return this.status(contratoId);
  }
}
