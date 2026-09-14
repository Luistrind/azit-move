import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../database/prisma.service';
import { PREAMBULO_INSUMOS, PROMPT_ASSISTENTE_ANALISE } from './prompt-assistente';

// Mesmo diretório onde a esteira grava os anexos (proposta.service).
const UPLOADS_DIR = join(process.cwd(), 'uploads', 'documentos');

// Guardas de tamanho: payload bruto de birô pode ser enorme (processos) e o
// request da API aceita até 32 MB — truncamos com sinalização, nunca em silêncio.
const MAX_CHARS_POR_CONSULTA = 120_000;
const MAX_BYTES_POR_DOC = 9 * 1024 * 1024;
const MAX_BYTES_DOCS_TOTAL = 20 * 1024 * 1024;

const MEDIA_POR_EXTENSAO: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export type ResumoIa = {
  status: 'gerando' | 'concluido' | 'falha' | 'nao_configurado';
  texto?: string;
  modelo?: string;
  geradoEm?: string;
  erro?: string;
  insumos?: { consultas: number; documentos: number; documentosIgnorados: number };
};

// ============================================================
// ASSISTENTE DE ANÁLISE (IA — 14/09, pedido do Luís): gera o RELATÓRIO
// CADASTRAL RESUMIDO automático da análise a partir das consultas de birô
// (payloads brutos) e dos documentos anexados (CNH, demonstrativos Uber/99,
// extratos), usando a API do Claude com pesquisa na internet habilitada.
//
// O prompt é o do Luís, verbatim (prompt-assistente.ts). O resumo é APOIO ao
// analista: nunca aprova, nunca reprova, nunca transita status — a tela
// continua fazendo tudo o que já faz. Roda em FILA (a chamada leva minutos);
// sem ANTHROPIC_API_KEY configurada, registra 'nao_configurado' com aviso na
// tela (Regra 12: placeholder funcional, nunca buraco).
// ============================================================
@Injectable()
export class AssistenteAnaliseService {
  private readonly logger = new Logger(AssistenteAnaliseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async salvar(analiseId: string, resumo: ResumoIa) {
    await this.prisma.db.analiseCadastro.update({
      where: { id: analiseId },
      data: { resumoIa: resumo as unknown as Prisma.InputJsonValue },
    });
  }

  // Marca "gerando" imediatamente (a tela mostra o estado) — o worker gera.
  async marcarGerando(analiseId: string) {
    await this.salvar(analiseId, { status: 'gerando' });
  }

  // Insumos do relatório — FONTE ÚNICA entre o pipeline automático (API) e o
  // connector MCP do claude.ai (14/09): cadastro estruturado, consultas com
  // payload bruto (truncagem sinalizada) e documentos anexados como binário.
  async coletarInsumos(analiseId: string): Promise<null | {
    analiseId: string;
    titularPrincipalNome: string | null;
    cadastroTexto: string;
    consultasTexto: string[];
    documentos: { nome: string; tipoDeclarado: string; media: string; base64: string }[];
    documentosIgnorados: string[];
    totalConsultas: number;
  }> {
    const analise = await this.prisma.db.analiseCadastro.findFirst({
      where: { id: analiseId },
      include: {
        proposta: {
          select: {
            id: true,
            valorEntrada: true,
            valorParcela: true,
            numeroParcelas: true,
            documentos: { select: { id: true, tipo: true, arquivoRef: true, titularId: true } },
          },
        },
        participantes: true,
        consultas: { orderBy: { dataConsulta: 'asc' } },
      },
    });
    if (!analise) return null;

    const titulares = await this.prisma.db.titular.findMany({
      where: { id: { in: analise.participantes.map((p) => p.titularId) } },
      select: { id: true, nome: true, cpfCnpj: true, whatsapp: true, email: true, cidade: true, estado: true, profissao: true },
    });

    let bytesDocs = 0;
    const documentos: { nome: string; tipoDeclarado: string; media: string; base64: string }[] = [];
    const ignorados: string[] = [];

    // 1. Documentos anexados como binário (PDF/imagem), com guardas de tamanho.
    for (const doc of analise.proposta.documentos) {
      const ext = (doc.arquivoRef.split('.').pop() ?? '').toLowerCase();
      const media = MEDIA_POR_EXTENSAO[ext];
      if (!media) {
        ignorados.push(`${doc.arquivoRef} (formato .${ext} não suportado pela leitura automática)`);
        continue;
      }
      let buffer: Buffer;
      try {
        buffer = await fs.readFile(join(UPLOADS_DIR, doc.id));
      } catch {
        ignorados.push(`${doc.arquivoRef} (arquivo não localizado no armazenamento)`);
        continue;
      }
      if (buffer.length > MAX_BYTES_POR_DOC || bytesDocs + buffer.length > MAX_BYTES_DOCS_TOTAL) {
        ignorados.push(`${doc.arquivoRef} (arquivo grande demais para leitura automática)`);
        continue;
      }
      bytesDocs += buffer.length;
      documentos.push({ nome: doc.arquivoRef, tipoDeclarado: doc.tipo, media, base64: buffer.toString('base64') });
    }

    // 2. Dados cadastrais estruturados do sistema.
    const principal = analise.participantes.find((p) => p.papel === 'COMPRADOR_PRINCIPAL');
    const cadastro = {
      participantes: analise.participantes.map((p) => {
        const t = titulares.find((x) => x.id === p.titularId);
        return {
          papel: p.papel,
          nome: t?.nome,
          cpf: t?.cpfCnpj,
          cidade: t?.cidade,
          uf: t?.estado,
          profissao: t?.profissao,
          rendaDeclarada: p.rendaDeclarada,
          rendaPresumidaBiro: p.rendaPresumida,
          rendaApuradaPeloAnalista: p.rendaApurada,
        };
      }),
      proposta: {
        valorEntrada: analise.proposta.valorEntrada,
        valorParcela: analise.proposta.valorParcela,
        numeroParcelas: analise.proposta.numeroParcelas,
      },
      documentosIgnoradosNaLeitura: ignorados,
    };

    // 3. Consultas de birô — payload BRUTO por consulta, truncado com sinal.
    const consultasTexto = analise.consultas.map((c) => {
      let corpo = JSON.stringify(c.resultado ?? {}, null, 0);
      if (corpo.length > MAX_CHARS_POR_CONSULTA) corpo = corpo.slice(0, MAX_CHARS_POR_CONSULTA) + ' [TRUNCADO]';
      return `CONSULTA ${c.tipo} · fornecedor: ${c.fornecedor} · data: ${c.dataConsulta.toISOString().slice(0, 10)} · situação: ${c.situacao}${c.motivoFalha ? ` · falha: ${c.motivoFalha}` : ''}\n${corpo}`;
    });

    return {
      analiseId: analise.id,
      titularPrincipalNome: titulares.find((t) => t.id === principal?.titularId)?.nome ?? null,
      cadastroTexto: `DADOS CADASTRAIS DO SISTEMA:\n${JSON.stringify(cadastro, null, 1)}`,
      consultasTexto,
      documentos,
      documentosIgnorados: ignorados,
      totalConsultas: analise.consultas.length,
    };
  }

  // Executado pelo worker da fila RESUMO_ANALISE.
  async gerar(analiseId: string): Promise<{ resultado: string }> {
    const apiKey = this.config.get<string>('anthropic.apiKey');
    if (!apiKey) {
      await this.salvar(analiseId, {
        status: 'nao_configurado',
        erro: 'ANTHROPIC_API_KEY não configurada no ambiente — o resumo automático fica indisponível até configurá-la',
      });
      return { resultado: 'nao_configurado' };
    }

    const insumos = await this.coletarInsumos(analiseId);
    if (!insumos) return { resultado: 'analise_nao_encontrada' };

    try {
      // Documentos antes do texto (recomendação da API), com legenda por anexo.
      const conteudo: Anthropic.ContentBlockParam[] = [];
      for (const d of insumos.documentos) {
        conteudo.push(
          d.media === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.base64 } }
            : { type: 'image', source: { type: 'base64', media_type: d.media as 'image/png', data: d.base64 } },
        );
        conteudo.push({ type: 'text', text: `(O arquivo acima é o anexo "${d.nome}", tipo declarado: ${d.tipoDeclarado}.)` });
      }
      conteudo.push({ type: 'text', text: insumos.cadastroTexto });
      for (const c of insumos.consultasTexto) conteudo.push({ type: 'text', text: c });

      const client = new Anthropic({ apiKey });
      const modelo = this.config.get<string>('anthropic.modelo') ?? 'claude-opus-5';
      const stream = client.messages.stream({
        model: modelo,
        max_tokens: 16000,
        system: [
          {
            type: 'text',
            text: `${PROMPT_ASSISTENTE_ANALISE}\n\n──────────────────────────────\n\n${PREAMBULO_INSUMOS}`,
            cache_control: { type: 'ephemeral' },
          },
        ],
        // Pesquisa na internet (item 17 do prompt): camada de verificação para
        // processos judiciais e fatos públicos materiais.
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 } as Anthropic.ToolUnion],
        messages: [{ role: 'user', content: conteudo }],
      });
      const resposta = await stream.finalMessage();

      const texto = resposta.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      if (!texto) throw new Error(`Modelo não devolveu texto (stop: ${resposta.stop_reason})`);

      await this.salvar(analiseId, {
        status: 'concluido',
        texto,
        modelo,
        geradoEm: new Date().toISOString(),
        insumos: { consultas: insumos.totalConsultas, documentos: insumos.documentos.length, documentosIgnorados: insumos.documentosIgnorados.length },
      });
      this.logger.log(`Resumo IA da análise ${analiseId} gerado (${texto.length} chars · ${insumos.totalConsultas} consultas · ${insumos.documentos.length} docs)`);
      return { resultado: 'concluido' };
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 500) ?? 'erro desconhecido';
      this.logger.error(`Resumo IA da análise ${analiseId} FALHOU: ${msg}`);
      await this.salvar(analiseId, { status: 'falha', erro: msg, geradoEm: new Date().toISOString() });
      return { resultado: 'falha' };
    }
  }
}
