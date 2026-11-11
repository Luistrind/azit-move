import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { diaBrasil } from '@azit/utils';
import { PrismaService } from '../../database/prisma.service';
import { AnaliseService } from '../analise/analise.service';
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
    private readonly analise: AnaliseService,
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
          criadaEm: diaBrasil(a.createdAt),
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
          return `• ${c.tipo} · ${c.fornecedor} · ${diaBrasil(c.dataConsulta)} · ${c.situacao}${c.motivoFalha ? ` · falha: ${c.motivoFalha}` : ''}\n  ${campos || 'sem campos mapeados'}\n  payload bruto: ${tamBruto > 2 ? `${tamBruto} chars — use obter_consulta_bruta("${c.tipo}")` : 'vazio'}`;
        });
        const indiceDocs = insumos.documentos.map(
          (d) =>
            `• "${d.nome}" (${d.tipoDeclarado} · ${d.media}) — ${d.textoExtraido ? `texto de ${d.textoExtraido.length.toLocaleString('pt-BR')} chars${partesDe(d.textoExtraido) > 1 ? ` em ${partesDe(d.textoExtraido)} partes (parte=1…${partesDe(d.textoExtraido)})` : ''}` : 'sem texto'}${d.paginasImagem.length ? ` + ${d.paginasImagem.length} página(s) renderizada(s)` : ''} — use obter_documento("${d.nome}")`,
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

    // Payload bruto em PARTES (31/10/2026, caso Althieres: Camada 1 e Processos da
    // BigData com ~1,4 milhão de chars; o corte seco em 100 mil deixava 1 dos 9
    // processos visível). Duas saídas: `compacto` (textos longos encurtados, listas
    // de andamentos/petições/decisões reduzidas às últimas — cabe quase sempre numa
    // chamada) e paginação determinística por `parte` sobre o MESMO JSON.
    registrar(
      'obter_consulta_bruta',
      {
        title: 'Obter o payload bruto de UMA consulta (em partes)',
        description:
          'Retorna o payload BRUTO de uma consulta de birô da análise (uma por chamada). Use o tipo exatamente como listado no dossiê (ex.: CAMADA1, SCORE_QUOD, RESTRITIVOS, BOAVISTA_SCORE, SCORE_POSITIVO, DISTRIBUICAO_PROCESSOS, PROCESSOS, KYC). ' +
          'Cada chamada devolve no máximo ~100 mil caracteres. Comece com compacto=true (textos longos encurtados; andamentos, petições e decisões reduzidos aos mais recentes — número, classe, assunto, vara, polo, status e valores ficam inteiros). ' +
          'Se ainda assim vier em partes, ou se precisar do texto integral, chame de novo com compacto=false e parte=1, 2, 3… até a última (o cabeçalho diz "parte i de N").',
        inputSchema: {
          analiseId: z.string().min(1).describe('id da análise'),
          tipo: z.string().min(2).describe('tipo da consulta, como no dossiê'),
          parte: z.number().int().min(1).optional().describe('qual parte do payload (1 = primeira; default 1)'),
          compacto: z.boolean().optional().describe('true = versão compacta (textos longos encurtados, listas de andamentos reduzidas); default false'),
        },
      },
      async ({ analiseId, tipo, parte, compacto }: { analiseId: string; tipo: string; parte?: number; compacto?: boolean }) => {
        const c = await this.prisma.db.consultaExterna.findFirst({
          where: { analiseId, tipo: tipo.toUpperCase() as never },
          orderBy: { dataConsulta: 'desc' },
        });
        if (!c) return { content: [{ type: 'text', text: `Consulta ${tipo} não encontrada na análise ${analiseId}.` }], isError: true };
        const bruto = c.resultado ?? {};
        const corpo = JSON.stringify(compacto ? compactarPayload(bruto) : bruto, null, 0);
        const total = Math.max(1, Math.ceil(corpo.length / TAMANHO_PARTE));
        const i = Math.min(Math.max(1, parte ?? 1), total);
        const trecho = corpo.slice((i - 1) * TAMANHO_PARTE, i * TAMANHO_PARTE);
        const cabecalho =
          `CONSULTA ${c.tipo} · ${c.fornecedor} · ${diaBrasil(c.dataConsulta)} · ${c.situacao}${c.motivoFalha ? ` · falha: ${c.motivoFalha}` : ''}` +
          ` · ${compacto ? 'COMPACTO' : 'INTEGRAL'} · ${corpo.length.toLocaleString('pt-BR')} chars · parte ${i} de ${total}` +
          (total > 1 ? (i < total ? ` — continue com parte=${i + 1}` : ' — última parte') : '') +
          (i > 1 ? ' (trecho de JSON cortado no meio: junte as partes antes de ler)' : '');
        return { content: [{ type: 'text', text: `${cabecalho}\n${trecho}` }] };
      },
    );

    registrar(
      'obter_documento',
      {
        title: 'Obter o conteúdo de UM documento anexado (em partes)',
        description:
          'Retorna o conteúdo de um documento anexado da análise (um por chamada): texto INTEGRAL extraído do PDF e/ou as páginas renderizadas como imagem (CNH-e, digitalizados). Use o nome exatamente como listado no índice do dossiê. ' +
          'Cada chamada devolve no máximo ~100 mil caracteres de texto: o cabeçalho diz "parte i de N" — se N > 1, chame de novo com parte=2, 3… até a última antes de concluir qualquer leitura (extratos longos têm os lançamentos espalhados por todas as partes). As imagens vêm só na parte 1.',
        inputSchema: {
          analiseId: z.string().min(1).describe('id da análise'),
          nome: z.string().min(1).describe('nome do arquivo, como no índice do dossiê'),
          parte: z.number().int().min(1).optional().describe('qual parte do texto (1 = primeira; default 1)'),
        },
      },
      async ({ analiseId, nome, parte }: { analiseId: string; nome: string; parte?: number }) => {
        const d = await this.assistente.lerDocumento(analiseId, nome);
        if (!d) return { content: [{ type: 'text', text: `Documento "${nome}" não encontrado na análise ${analiseId} — confira o nome exato no dossiê.` }], isError: true };
        const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];
        if (d.media.startsWith('image/')) {
          content.push({ type: 'image', data: d.base64, mimeType: d.media });
          content.push({ type: 'text', text: `(A imagem acima é o anexo "${d.nome}", tipo declarado: ${d.tipoDeclarado}.)` });
        } else {
          const total = d.textoExtraido ? partesDe(d.textoExtraido) : 1;
          const i = Math.min(Math.max(1, parte ?? 1), total);
          if (d.textoExtraido) {
            const trecho = d.textoExtraido.slice((i - 1) * TAMANHO_PARTE, i * TAMANHO_PARTE);
            const cabecalho =
              `===== ANEXO "${d.nome}" (PDF · ${d.tipoDeclarado}) — texto extraído · ${d.textoExtraido.length.toLocaleString('pt-BR')} chars · parte ${i} de ${total}` +
              (total > 1 ? (i < total ? ` — continue com parte=${i + 1}` : ' — última parte') : '') +
              ' =====';
            content.push({ type: 'text', text: `${cabecalho}\n${trecho}\n===== fim da parte ${i} de ${total} =====` });
          }
          // Imagens só na primeira parte (repetir em cada parte estouraria a resposta).
          if (i === 1) for (const pagina of d.paginasImagem) content.push({ type: 'image', data: pagina, mimeType: 'image/png' });
          if (i === 1 && d.paginasImagem.length > 0) {
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
        // Mesmo efeito do pipeline da API (decisão 28/10): a "Média 3M" do
        // relatório vira a renda apurada do comprador principal, se ainda vazia.
        const preencheu = await this.analise
          .preencherPeloSistemaPorId(analiseId)
          .catch((e: Error) => { this.logger.warn(`preenchimento pelo sistema falhou (${analiseId}): ${e.message}`); return false; });
        return { content: [{ type: 'text', text: `Relatório salvo na análise ${analiseId} — já visível na tela do analista.${preencheu ? ' A renda apurada do comprador principal foi preenchida a partir da Média 3M do relatório (o analista pode corrigir).' : ''}` }] };
      },
    );

    return server;
  }
}

// ---------- payload bruto em partes ----------
const TAMANHO_PARTE = 100_000;
const partesDe = (texto: string) => Math.max(1, Math.ceil(texto.length / TAMANHO_PARTE));
const TEXTO_MAX = 400;
const LISTA_MAX = 5;
// Listas que carregam o volume dos processos na BigData (andamentos, petições,
// decisões, publicações) — no modo compacto ficam só as últimas LISTA_MAX.
const LISTAS_VOLUMOSAS = /^(updates|petitions|decisions|publications|movements|movimenta|andamentos|peticoes|decisoes|publicacoes|hearings|audiencias)/i;

/** Versão compacta de um payload de birô: encurta textos longos e reduz listas volumosas. */
export function compactarPayload(valor: unknown, chave = ''): unknown {
  if (typeof valor === 'string') {
    return valor.length > TEXTO_MAX ? `${valor.slice(0, TEXTO_MAX)}…[+${valor.length - TEXTO_MAX} chars]` : valor;
  }
  if (Array.isArray(valor)) {
    const lista = LISTAS_VOLUMOSAS.test(chave) && valor.length > LISTA_MAX
      ? [...valor.slice(-LISTA_MAX), { _omitidos: valor.length - LISTA_MAX, _nota: `${valor.length} itens no total; mostrados os ${LISTA_MAX} últimos — peça compacto=false para o integral` }]
      : valor;
    return lista.map((v) => compactarPayload(v, chave));
  }
  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) saida[k] = compactarPayload(v, k);
    return saida;
  }
  return valor;
}
