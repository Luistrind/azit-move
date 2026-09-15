import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PrismaService } from '../../database/prisma.service';
import { AssistenteAnaliseService } from '../analise/assistente-analise.service';
import { PROMPT_ASSISTENTE_ANALISE, REGRAS_DEMONSTRATIVOS } from '../analise/prompt-assistente';

// ============================================================
// MCP — connector do Azit Hub para o claude.ai (decisão Luís 14/09):
// o relatório cadastral pode ser gerado DENTRO do claude.ai (coberto pela
// assinatura), com o Claude puxando o dossiê daqui e salvando o resultado de
// volta na análise. Ferramentas:
//   1. listar_analises          — análises recentes (referência por nome)
//   2. obter_prompt_relatorio   — o prompt oficial (fonte única do sistema)
//   3. obter_dossie_analise     — cadastro + consultas brutas + documentos
//   4. salvar_relatorio_analise — grava o relatório no resumoIa (tela mostra)
// Somente leitura de análise + escrita do resumo — nenhuma outra escrita.
// ============================================================
@Injectable()
export class McpAzitService {
  private readonly logger = new Logger(McpAzitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assistente: AssistenteAnaliseService,
  ) {}

  // Um servidor NOVO por request (modo stateless do Streamable HTTP).
  criarServidor(): McpServer {
    const server = new McpServer({ name: 'azit-hub', version: '1.0.0' });

    // TS2589 (instanciação profunda) na inferência dos generics do SDK com
    // shapes zod — os handlers são tipados à mão e o registro cai para o
    // overload amplo. Validação em runtime segue via zod no próprio SDK.
    const registrar = server.registerTool.bind(server) as (
      name: string,
      config: { title?: string; description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cb: (args: any) => Promise<unknown>,
    ) => void;

    registrar(
      'listar_analises',
      {
        title: 'Listar análises de cadastro',
        description:
          'Lista as análises de cadastro mais recentes do Azit Hub (id, titular, status, se já tem relatório do assistente). Use para localizar a análise que o usuário citou por nome.',
        inputSchema: { limite: z.number().int().min(1).max(50).optional().describe('máximo de análises (default 15)') },
      },
      async ({ limite }: { limite?: number }) => {
        const analises = await this.prisma.db.analiseCadastro.findMany({
          orderBy: { createdAt: 'desc' },
          take: limite ?? 15,
          include: {
            participantes: { where: { papel: 'COMPRADOR_PRINCIPAL' }, include: { titular: { select: { nome: true } } } },
          },
        });
        const linhas = analises.map((a) => ({
          analiseId: a.id,
          titular: a.participantes[0]?.titular.nome ?? '—',
          status: a.status,
          criadaEm: a.createdAt.toISOString().slice(0, 10),
          temRelatorio: !!(a.resumoIa as { texto?: string } | null)?.texto,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(linhas, null, 1) }] };
      },
    );

    registrar(
      'obter_prompt_relatorio',
      {
        title: 'Obter o prompt oficial do relatório',
        description:
          'Retorna o prompt oficial do RELATÓRIO CADASTRAL RESUMIDO da Azit Move (regras de renda bruta, crédito, jurídico, criminal, KYC e formato). Siga-o à risca ao gerar o relatório.',
      },
      async () => ({ content: [{ type: 'text', text: `${PROMPT_ASSISTENTE_ANALISE}\n\n──────────────────────────────\n\n${REGRAS_DEMONSTRATIVOS}` }] }),
    );

    // O claude.ai TRUNCA tool results grandes (caso real 14/09: payloads de
    // processos + CNH renderizada estouraram e derrubaram os demonstrativos).
    // O dossiê é uma VISÃO GERAL leve; consulta bruta e documento saem UM POR
    // CHAMADA pelas duas ferramentas seguintes.
    registrar(
      'obter_dossie_analise',
      {
        title: 'Obter o dossiê de uma análise (visão geral)',
        description:
          'Visão geral de uma análise: dados cadastrais + oferta escolhida, RESUMO de cada consulta de birô e o ÍNDICE dos documentos anexados. NÃO traz os payloads brutos nem o conteúdo dos arquivos — puxe cada um com obter_consulta_bruta e obter_documento (uma chamada por item, para não estourar o limite de resposta). Informe o analiseId (de listar_analises) ou um trecho do nome do titular.',
        inputSchema: {
          analiseId: z.string().min(1).optional().describe('id da análise'),
          nomeTitular: z.string().min(3).optional().describe('trecho do nome do comprador principal, se não tiver o id'),
        },
      },
      async ({ analiseId, nomeTitular }: { analiseId?: string; nomeTitular?: string }) => {
        let id = analiseId;
        if (!id && nomeTitular) {
          const p = await this.prisma.db.participanteAnalise.findFirst({
            where: { papel: 'COMPRADOR_PRINCIPAL', titular: { nome: { contains: nomeTitular, mode: 'insensitive' } } },
            orderBy: { analise: { createdAt: 'desc' } },
            select: { analiseId: true },
          });
          id = p?.analiseId;
        }
        if (!id) {
          return { content: [{ type: 'text', text: 'Análise não encontrada — use listar_analises e confirme o id ou o nome.' }], isError: true };
        }
        const insumos = await this.assistente.coletarInsumos(id);
        if (!insumos) {
          return { content: [{ type: 'text', text: `Análise ${id} não encontrada.` }], isError: true };
        }
        const consultas = await this.prisma.db.consultaExterna.findMany({
          where: { analiseId: id },
          orderBy: { dataConsulta: 'asc' },
          select: { tipo: true, fornecedor: true, dataConsulta: true, situacao: true, motivoFalha: true, resultado: true },
        });
        const resumoConsultas = consultas.map((c) => {
          const r = (c.resultado ?? {}) as Record<string, unknown>;
          const campos = Object.entries(r)
            .filter(([k, v]) => k !== 'bruto' && v !== null && typeof v !== 'object')
            .map(([k, v]) => `${k}=${String(v).slice(0, 120)}`)
            .join(' · ');
          const tamBruto = JSON.stringify((r as { bruto?: unknown }).bruto ?? null)?.length ?? 0;
          return `• ${c.tipo} · ${c.fornecedor} · ${c.dataConsulta.toISOString().slice(0, 10)} · ${c.situacao}${c.motivoFalha ? ` · falha: ${c.motivoFalha}` : ''}\n  ${campos || 'sem campos mapeados'}\n  payload bruto: ${tamBruto > 2 ? `${tamBruto} chars — use obter_consulta_bruta("${c.tipo}")` : 'vazio'}`;
        });
        const indiceDocs = insumos.documentos.map(
          (d) =>
            `• "${d.nome}" (${d.tipoDeclarado} · ${d.media}) — ${d.textoExtraido ? `texto de ${d.textoExtraido.length} chars` : 'sem texto'}${d.paginasImagem.length ? ` + ${d.paginasImagem.length} página(s) renderizada(s)` : ''} — use obter_documento("${d.nome}")`,
        );
        return {
          content: [
            {
              type: 'text',
              text:
                `DOSSIÊ DA ANÁLISE ${insumos.analiseId} (titular: ${insumos.titularPrincipalNome ?? '—'})\n\n${insumos.cadastroTexto}\n\n` +
                `CONSULTAS DE BIRÔ (resumo — puxe o payload integral de cada uma com obter_consulta_bruta):\n${resumoConsultas.join('\n')}\n\n` +
                `DOCUMENTOS ANEXADOS (índice — leia cada um com obter_documento):\n${indiceDocs.join('\n')}` +
                (insumos.documentosIgnorados.length ? `\n\nDocumentos NÃO lidos automaticamente: ${insumos.documentosIgnorados.join('; ')}` : '') +
                `\n\nIMPORTANTE: para o relatório, leia TODOS os documentos (um obter_documento por vez) e os payloads brutos relevantes (um obter_consulta_bruta por vez).`,
            },
          ],
        };
      },
    );

    registrar(
      'obter_consulta_bruta',
      {
        title: 'Obter o payload bruto de UMA consulta',
        description:
          'Retorna o payload BRUTO integral de uma consulta de birô da análise (uma por chamada). Use o tipo exatamente como listado no dossiê (ex.: CAMADA1, SCORE_QUOD, RESTRITIVOS, BOAVISTA_SCORE, SCORE_POSITIVO, DISTRIBUICAO_PROCESSOS, PROCESSOS, KYC).',
        inputSchema: {
          analiseId: z.string().min(1).describe('id da análise'),
          tipo: z.string().min(2).describe('tipo da consulta, como no dossiê'),
        },
      },
      async ({ analiseId, tipo }: { analiseId: string; tipo: string }) => {
        const c = await this.prisma.db.consultaExterna.findFirst({
          where: { analiseId, tipo: tipo.toUpperCase() as never },
          orderBy: { dataConsulta: 'desc' },
        });
        if (!c) return { content: [{ type: 'text', text: `Consulta ${tipo} não encontrada na análise ${analiseId}.` }], isError: true };
        let corpo = JSON.stringify(c.resultado ?? {}, null, 0);
        if (corpo.length > 100_000) corpo = corpo.slice(0, 100_000) + ' [TRUNCADO]';
        return {
          content: [
            {
              type: 'text',
              text: `CONSULTA ${c.tipo} · ${c.fornecedor} · ${c.dataConsulta.toISOString().slice(0, 10)} · ${c.situacao}${c.motivoFalha ? ` · falha: ${c.motivoFalha}` : ''}\n${corpo}`,
            },
          ],
        };
      },
    );

    registrar(
      'obter_documento',
      {
        title: 'Obter o conteúdo de UM documento anexado',
        description:
          'Retorna o conteúdo de um documento anexado da análise (um por chamada): texto extraído do PDF e/ou as páginas renderizadas como imagem (CNH-e, digitalizados). Use o nome exatamente como listado no índice do dossiê.',
        inputSchema: {
          analiseId: z.string().min(1).describe('id da análise'),
          nome: z.string().min(1).describe('nome do arquivo, como no índice do dossiê'),
        },
      },
      async ({ analiseId, nome }: { analiseId: string; nome: string }) => {
        const d = await this.assistente.lerDocumento(analiseId, nome);
        if (!d) return { content: [{ type: 'text', text: `Documento "${nome}" não encontrado na análise ${analiseId} — confira o nome exato no dossiê.` }], isError: true };
        const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];
        if (d.media.startsWith('image/')) {
          content.push({ type: 'image', data: d.base64, mimeType: d.media });
          content.push({ type: 'text', text: `(A imagem acima é o anexo "${d.nome}", tipo declarado: ${d.tipoDeclarado}.)` });
        } else {
          if (d.textoExtraido) {
            content.push({ type: 'text', text: `===== ANEXO "${d.nome}" (PDF · ${d.tipoDeclarado}) — texto extraído =====\n${d.textoExtraido}\n===== fim =====` });
          }
          for (const pagina of d.paginasImagem) content.push({ type: 'image', data: pagina, mimeType: 'image/png' });
          if (d.paginasImagem.length > 0) {
            content.push({ type: 'text', text: `(${d.paginasImagem.length} página(s) renderizada(s) do anexo "${d.nome}"${d.textoExtraido ? ' — o texto extraído era curto; os dados podem estar na imagem' : ''}.)` });
          }
          if (!d.textoExtraido && d.paginasImagem.length === 0) {
            content.push({ type: 'text', text: `⚠ ANEXO "${d.nome}": sem texto extraível nem renderização possível — trate como documento não lido e sinalize no relatório.` });
          }
        }
        return { content };
      },
    );

    registrar(
      'salvar_relatorio_analise',
      {
        title: 'Salvar o relatório na análise',
        description:
          'Grava o RELATÓRIO CADASTRAL RESUMIDO gerado nesta conversa de volta na análise do Azit Hub — ele aparece na tela do analista. Envie o texto final completo, no formato do prompt oficial.',
        inputSchema: {
          analiseId: z.string().min(1).describe('id da análise (o mesmo do dossiê)'),
          texto: z.string().min(50).describe('o relatório final completo'),
        },
      },
      async ({ analiseId, texto }: { analiseId: string; texto: string }) => {
        const analise = await this.prisma.db.analiseCadastro.findFirst({ where: { id: analiseId }, select: { id: true } });
        if (!analise) {
          return { content: [{ type: 'text', text: `Análise ${analiseId} não encontrada.` }], isError: true };
        }
        await this.prisma.db.analiseCadastro.update({
          where: { id: analiseId },
          data: {
            resumoIa: {
              status: 'concluido',
              texto,
              modelo: 'claude.ai · connector MCP',
              geradoEm: new Date().toISOString(),
            } as unknown as Prisma.InputJsonValue,
          },
        });
        await this.prisma.db.logAuditoria.create({
          data: {
            acao: 'resumo_ia_salvo_via_mcp',
            entidade: 'analise',
            entidadeId: analiseId,
            depois: { chars: texto.length },
          },
        });
        this.logger.log(`Relatório salvo via MCP na análise ${analiseId} (${texto.length} chars)`);
        return { content: [{ type: 'text', text: `Relatório salvo na análise ${analiseId} — já visível na tela do analista.` }] };
      },
    );

    return server;
  }
}
