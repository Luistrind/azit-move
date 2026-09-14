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

    registrar(
      'obter_dossie_analise',
      {
        title: 'Obter o dossiê de uma análise',
        description:
          'Retorna os insumos completos de uma análise: dados cadastrais, payload BRUTO de cada consulta de birô e os documentos anexados (CNH, demonstrativos, extratos) como arquivos. Informe o analiseId (de listar_analises) ou um trecho do nome do titular.',
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
        const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } })[] = [
          { type: 'text', text: `DOSSIÊ DA ANÁLISE ${insumos.analiseId} (titular: ${insumos.titularPrincipalNome ?? '—'})\n\n${insumos.cadastroTexto}` },
          ...insumos.consultasTexto.map((t) => ({ type: 'text' as const, text: t })),
        ];
        for (const d of insumos.documentos) {
          if (d.media.startsWith('image/')) {
            content.push({ type: 'image', data: d.base64, mimeType: d.media });
            content.push({ type: 'text', text: `(A imagem acima é o anexo "${d.nome}", tipo declarado: ${d.tipoDeclarado}.)` });
          } else if (d.textoExtraido) {
            // PDF digital: TEXTO extraído no servidor — o claude.ai não lê PDF
            // binário de tool result (causa da renda errada no caso 14/09).
            content.push({
              type: 'text',
              text: `===== ANEXO "${d.nome}" (PDF · tipo declarado: ${d.tipoDeclarado}) — texto extraído do documento =====\n${d.textoExtraido}\n===== fim do anexo "${d.nome}" =====`,
            });
          } else {
            content.push({
              type: 'text',
              text: `⚠ ANEXO "${d.nome}" (PDF · tipo declarado: ${d.tipoDeclarado}): sem texto extraível (provável digitalização/imagem). NÃO foi possível ler o conteúdo — trate como documento não lido e sinalize no relatório.`,
            });
          }
        }
        if (insumos.documentosIgnorados.length) {
          content.push({ type: 'text', text: `Documentos NÃO lidos automaticamente: ${insumos.documentosIgnorados.join('; ')}` });
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
