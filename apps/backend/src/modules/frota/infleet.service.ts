import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';
import type { TipoOcorrenciaVeiculo } from '@prisma/client';
import type { DadosOcorrencia } from './ocorrencia.service';

// ============================================================
// Robô do Infleet — doc 02 §25.4 (decisão Luís 20/09). O fornecedor RECUSOU
// dar credencial de integração, então o operador digita usuário e senha na
// tela e o backend entra num navegador headless, como uma pessoa.
//
// REGRAS INVIOLÁVEIS DA CREDENCIAL:
//   - a senha NUNCA é gravada (banco, log, auditoria) nem enfileirada (o
//     payload do BullMQ mora no Redis) — por isso a importação roda na
//     própria requisição, com a credencial só em memória;
//   - nada aqui loga o conteúdo de `senha`, e o navegador é fechado no finally.
//
// Como funciona: depois do login, a própria tela de multas chama a API deles
// (GraphQL, operação listTrafficInfractionsKanban). O robô intercepta essa
// chamada para reaproveitar a MESMA consulta e o token da sessão, e então
// pagina por conta própria — muito mais estável do que ler o HTML da tela.
// ============================================================

const URL_APP = 'https://app.infleet.com.br';
const URL_MULTAS = `${URL_APP}/expenses/fines`;
const URL_API = 'https://api.infleet.com.br/v1/graphql';
const OPERACAO = 'listTrafficInfractionsKanban';
const PAGINA = 100;
const LIMITE_PAGINAS = 20;

interface ChamadaCapturada {
  query: string;
  variables: Record<string, unknown>;
  authorization: string;
}

// Procura, em profundidade, a primeira chave cujo nome casa com o padrão.
function buscar(obj: unknown, padrao: RegExp, profundidade = 0): unknown {
  if (!obj || typeof obj !== 'object' || profundidade > 4) return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (padrao.test(k) && v !== null && v !== undefined && typeof v !== 'object') return v;
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      const achou = buscar(v, padrao, profundidade + 1);
      if (achou !== undefined) return achou;
    }
  }
  return undefined;
}

function texto(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

// Valor pode vir em centavos (inteiro grande) ou em reais (decimal).
function centavos(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) >= 1000 ? v : Math.round(v * 100);
  if (typeof v === 'string') {
    const limpo = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = Number(limpo);
    return Number.isFinite(n) ? Math.round(n * 100) : undefined;
  }
  return undefined;
}

function data(v: unknown): string | undefined {
  const s = texto(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// Mapeia o registro do Infleet para a nossa ocorrência. Os nomes das chaves
// deles não são documentados, então a busca é por padrão — e o registro
// ORIGINAL fica guardado em `bruto` para conferência e reprocessamento.
export function mapearInfracao(no: Record<string, unknown>): DadosOcorrencia | null {
  const placa = texto(buscar(no, /^(licensePlate|plate|placa)$/i)) ?? texto(buscar(no, /plate|placa/i));
  const dataFato = data(buscar(no, /(infraction|occurrence|event|violation).*(date|at)|^date$|dataInfracao/i));
  if (!placa || !dataFato) return null;
  const descricaoInfracao = texto(buscar(no, /(description|descricao|infractionType|reason|natureza)/i));
  const ehNotificacao = /notifica/i.test(texto(buscar(no, /(type|status|stage|kind)/i)) ?? '');
  const valor = centavos(buscar(no, /(amount|value|valor|price|total)/i));
  return {
    placa: placa.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    tipo: (ehNotificacao ? 'NOTIFICACAO' : 'MULTA') as TipoOcorrenciaVeiculo,
    orgao: texto(buscar(no, /(agency|orgao|department|autuador|issuer)/i)),
    numeroAuto: texto(buscar(no, /(ait|infractionNumber|notificationNumber|autoNumber|^number$|^code$|protocol)/i)),
    descricao: descricaoInfracao,
    dataFato,
    dataVencimento: data(buscar(no, /(due|payment|vencimento|expir)/i)),
    prazoIndicacao: data(buscar(no, /(indica|nomination|driverDeadline|limitDate)/i)),
    valor: valor ?? 0,
    origem: 'infleet',
    origemRef: texto(buscar(no, /^id$/i)),
    bruto: no as never,
  };
}

// Percorre a resposta do GraphQL e junta todos os registros que pareçam infrações.
function extrairNos(dados: unknown, achados: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(dados)) {
    for (const item of dados) extrairNos(item, achados);
    return achados;
  }
  if (dados && typeof dados === 'object') {
    const o = dados as Record<string, unknown>;
    const pareceInfracao = Object.keys(o).some((k) => /plate|placa/i.test(k)) && Object.keys(o).some((k) => /date|at$/i.test(k));
    if (pareceInfracao) achados.push(o);
    else for (const v of Object.values(o)) extrairNos(v, achados);
  }
  return achados;
}

@Injectable()
export class InfleetService {
  private readonly logger = new Logger(InfleetService.name);

  // Busca as infrações no Infleet. A credencial existe só nesta chamada.
  async buscarInfracoes(usuario: string, senha: string): Promise<{ infracoes: DadosOcorrencia[]; naoMapeadas: number; amostraBruta: unknown | null }> {
    if (!usuario?.trim() || !senha) {
      throw new UnprocessableEntityException({ erro: 'credencial_obrigatoria', mensagem: 'Informe usuário e senha do Infleet' });
    }
    let navegador: Browser | null = null;
    try {
      navegador = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      const contexto = await navegador.newContext({ locale: 'pt-BR', viewport: { width: 1440, height: 900 } });
      const pagina = await contexto.newPage();

      // Intercepta a chamada que a própria tela faz — dali vêm a consulta e o token.
      let capturada: ChamadaCapturada | null = null;
      pagina.on('request', (req) => {
        if (capturada || !req.url().startsWith(URL_API)) return;
        try {
          const corpo = req.postData();
          if (!corpo) return;
          const json = JSON.parse(corpo) as { operationName?: string; query?: string; variables?: Record<string, unknown> };
          if (json.operationName === OPERACAO && json.query) {
            const auth = req.headers()['authorization'];
            if (auth) capturada = { query: json.query, variables: json.variables ?? {}, authorization: auth };
          }
        } catch {
          /* corpo não-JSON: ignora */
        }
      });

      await pagina.goto(URL_APP, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await this.entrar(pagina, usuario, senha);
      await pagina.goto(URL_MULTAS, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await pagina.waitForTimeout(6_000); // a tela dispara a consulta ao montar

      if (!capturada) {
        throw new UnprocessableEntityException({
          erro: 'consulta_nao_capturada',
          mensagem: 'Entrei no Infleet, mas a tela de multas não carregou as infrações no tempo esperado. Tente de novo; se repetir, eles podem ter mudado a tela.',
        });
      }

      // Pagina por conta própria, reaproveitando consulta + token da sessão.
      const { query, variables, authorization } = capturada as ChamadaCapturada;
      const brutos: Record<string, unknown>[] = [];
      for (let pag = 0; pag < LIMITE_PAGINAS; pag++) {
        const resp = await contexto.request.post(URL_API, {
          headers: { authorization, 'content-type': 'application/json' },
          data: { operationName: OPERACAO, query, variables: { ...variables, limit: PAGINA, offset: pag * PAGINA } },
        });
        if (!resp.ok()) {
          this.logger.warn(`Infleet respondeu ${resp.status()} na página ${pag + 1}`);
          break;
        }
        const json = (await resp.json()) as { data?: unknown; errors?: { message?: string }[] };
        if (json.errors?.length) {
          this.logger.warn(`Infleet retornou erro: ${json.errors[0]?.message ?? 'sem detalhe'}`);
          break;
        }
        const nos = extrairNos(json.data);
        brutos.push(...nos);
        if (nos.length < PAGINA) break;
      }

      const infracoes: DadosOcorrencia[] = [];
      let naoMapeadas = 0;
      let amostraBruta: unknown | null = null;
      for (const no of brutos) {
        const m = mapearInfracao(no);
        if (m) infracoes.push(m);
        else {
          naoMapeadas += 1;
          amostraBruta ??= no;
        }
      }
      this.logger.log(`Infleet: ${brutos.length} registro(s) lido(s), ${infracoes.length} mapeado(s)`);
      return { infracoes, naoMapeadas, amostraBruta };
    } finally {
      await navegador?.close().catch(() => undefined);
    }
  }

  // Login genérico: acha os campos pelo tipo, não por nome — a tela deles pode
  // mudar de rótulo sem quebrar o robô.
  private async entrar(pagina: import('playwright').Page, usuario: string, senha: string) {
    const campoUsuario = pagina.locator('input[type="email"], input[name*="mail" i], input[name*="user" i], input[type="text"]').first();
    const campoSenha = pagina.locator('input[type="password"]').first();
    await campoUsuario.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {
      throw new UnprocessableEntityException({ erro: 'tela_login', mensagem: 'A tela de login do Infleet não abriu como esperado' });
    });
    await campoUsuario.fill(usuario.trim());
    await campoSenha.fill(senha);
    await pagina.locator('button[type="submit"], button:has-text("Entrar")').first().click();
    // Sucesso = sair da tela de login. Se continuar nela, credencial ou 2FA.
    const entrou = await pagina
      .waitForFunction(() => !document.querySelector('input[type="password"]'), undefined, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!entrou) {
      throw new UnprocessableEntityException({
        erro: 'login_recusado',
        mensagem: 'O Infleet não aceitou o login. Confira usuário e senha; se a conta pedir verificação em duas etapas ou CAPTCHA, o robô não consegue entrar.',
      });
    }
  }
}
