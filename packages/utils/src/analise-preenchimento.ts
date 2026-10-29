// ============================================================
// Preenchimento da Análise de Cadastro PELO SISTEMA (decisão Luís 28/10/2026,
// doc 02 §14): o que as consultas e o relatório do assistente já dizem não
// volta a ser pedido ao analista em caixinha. Funções PURAS — recebem o que
// o birô/relatório devolveu e dizem o que o sistema pode preencher sozinho.
// O analista continua podendo corrigir tudo na tela; a sugestão de processos
// nunca marca nada (COC-06 é decisão humana).
// ============================================================

// Nome sem acento, sem caixa, sem espaços duplicados — comparação de nome
// oficial do birô ("JEFERSON PEREIRA RIBEIRO") com o cadastrado.
export function normalizarNome(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface IdentidadeCamada1Input {
  nomeCadastrado: string;
  nomeOficial: string | null | undefined;
  // Situação do CPF já julgada por quem conhece as situações aceitas (Camada 1).
  cpfRegular: boolean;
  indicacaoObito: boolean;
}

// Identidade validada pela consulta Camada 1: CPF regular, sem óbito e nome
// oficial igual ao cadastrado (sem acento/caixa). Qualquer divergência deixa
// a decisão com o analista — o motivo diz por quê.
export function identidadeConfereCamada1(i: IdentidadeCamada1Input): { confere: boolean; motivo: string } {
  if (!i.nomeOficial) return { confere: false, motivo: 'nome oficial não retornado pelo birô' };
  if (!i.cpfRegular) return { confere: false, motivo: 'CPF não está regular na Receita' };
  if (i.indicacaoObito) return { confere: false, motivo: 'indicação de óbito no CPF' };
  const a = normalizarNome(i.nomeCadastrado);
  const b = normalizarNome(i.nomeOficial);
  if (!a || a !== b) return { confere: false, motivo: `nome oficial "${i.nomeOficial}" difere do cadastrado "${i.nomeCadastrado}"` };
  return { confere: true, motivo: 'nome oficial confere e CPF regular, sem indicação de óbito' };
}

export interface RendaMediaRelatorio {
  centavos: number;
  // "R$ 10,5 mil" (forma compacta do WhatsApp) — valor arredondado pelo relatório.
  aproximado: boolean;
  trecho: string;
}

// Limites de sanidade: fora disto o relatório provavelmente não trouxe a média
// (ou trouxe outra coisa) — melhor deixar vazio do que gravar lixo.
const RENDA_MIN_CENTAVOS = 30_000; // R$ 300
const RENDA_MAX_CENTAVOS = 20_000_000; // R$ 200.000

// "R$ 10.548,15" | "R$ 10548,15" | "R$ 10.548" | "R$ 10,5 mil" | "R$ 10 mil" → centavos.
export function valorBrasileiroParaCentavos(bruto: string, mil: boolean): number | null {
  const s = bruto.trim();
  if (!s) return null;
  let reais: number;
  if (mil) {
    // "10,5" / "10.5" / "10" — separador decimal pode ser vírgula ou ponto.
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
    if (!Number.isFinite(n)) return null;
    reais = n * 1000;
  } else if (/,\d{1,2}$/.test(s)) {
    // Com centavos: pontos são milhar.
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    reais = n;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "10.548" — pontos de milhar, sem centavos.
    reais = Number(s.replace(/\./g, ''));
  } else if (/^\d+(\.\d{1,2})?$/.test(s)) {
    // "10548" ou "10548.15" (formato de máquina).
    reais = Number(s);
  } else {
    return null;
  }
  return Math.round(reais * 100);
}

// Lê a "Média 3M: R$ [valor]/mês" do RELATÓRIO CADASTRAL RESUMIDO (formato do
// prompt oficial, item 21). Aceita a forma exata e a compacta ("R$ 10,5 mil"),
// variações de caixa/espaço e um parêntese antes dos dois-pontos ("Média 3M
// (meses completos): …"). Devolve null quando não há média legível.
export function extrairRendaMediaRelatorio(texto: string | null | undefined): RendaMediaRelatorio | null {
  if (!texto) return null;
  const re = /m[eé]dia\s*3\s*m(?:eses)?\b[^\n:]{0,60}:\s*(?:≈\s*|~\s*|aprox\.?\s*)?R\$\s*([\d.,]+)\s*(mil)?/i;
  const m = re.exec(texto);
  if (!m) return null;
  const bruto = m[1].replace(/[.,]+$/, '');
  const mil = !!m[2];
  const centavos = valorBrasileiroParaCentavos(bruto, mil);
  if (centavos === null || centavos < RENDA_MIN_CENTAVOS || centavos > RENDA_MAX_CENTAVOS) return null;
  return { centavos, aproximado: mil, trecho: m[0].replace(/\s+/g, ' ').trim() };
}

// --- Processos financeiros/patrimoniais (sugestão de COC-06) ------------------

export interface ProcessoSugerido {
  numero: string | null;
  assunto: string;
  poloPassivo: boolean | null; // null = payload não diz o polo
  status: string | null;
}

export interface SugestaoProcessos {
  sugerir: boolean;
  processos: ProcessoSugerido[];
  motivo: string;
}

// Assuntos do item 11 do prompt oficial (jurídico financeiro/patrimonial).
const ASSUNTOS_FINANCEIROS = [
  'busca e apreens',
  'execu',
  'cobran',
  'monitori',
  'aliena',
  'reintegra',
  'recupera',
  'inadimpl',
  'insolv',
  'falenc',
  'fraude',
];
const STATUS_ENCERRADOS = ['arquiv', 'baixad', 'extint', 'encerr', 'transit'];

function textoDe(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

// Acha a lista de processos no payload bruto da BigDataCorp (dataset
// `processes`): Lawsuits[] pode vir em result.Processes, result.Lawsuits ou
// num bloco aninhado — busca em profundidade pelo primeiro array "Lawsuits".
function acharLawsuits(no: unknown, profundidade = 0): Record<string, unknown>[] | null {
  if (!no || typeof no !== 'object' || profundidade > 6) return null;
  if (Array.isArray(no)) {
    for (const item of no) {
      const r = acharLawsuits(item, profundidade + 1);
      if (r) return r;
    }
    return null;
  }
  const o = no as Record<string, unknown>;
  if (Array.isArray(o.Lawsuits) && (o.Lawsuits.length === 0 || typeof o.Lawsuits[0] === 'object')) {
    return o.Lawsuits as Record<string, unknown>[];
  }
  for (const v of Object.values(o)) {
    const r = acharLawsuits(v, profundidade + 1);
    if (r) return r;
  }
  return null;
}

// Sugere "processos relevantes" quando a consulta de processos traz processo
// financeiro/patrimonial ATIVO com o cliente no polo passivo (ou polo não
// informado). `cpf` (só dígitos) identifica o cliente entre as partes.
export function sugerirProcessosRelevantes(bruto: unknown, cpf?: string | null): SugestaoProcessos {
  const lista = acharLawsuits(bruto);
  if (!lista) return { sugerir: false, processos: [], motivo: 'consulta de processos sem lista de processos' };
  if (lista.length === 0) return { sugerir: false, processos: [], motivo: 'nenhum processo retornado' };
  const cpfDigitos = (cpf ?? '').replace(/\D/g, '');
  const achados: ProcessoSugerido[] = [];
  for (const p of lista) {
    const assunto = [p.MainSubject, p.Subject, p.OtherSubjects, p.Type, p.Name, p.CourtType]
      .map((v) => (Array.isArray(v) ? v.map(textoDe).join(' ') : textoDe(v)))
      .join(' · ')
      .trim();
    const assuntoN = normalizarNome(assunto);
    if (!ASSUNTOS_FINANCEIROS.some((k) => assuntoN.includes(k))) continue;
    const status = textoDe(p.Status) || null;
    if (status && STATUS_ENCERRADOS.some((k) => normalizarNome(status).includes(k))) continue;
    let poloPassivo: boolean | null = null;
    const partes = Array.isArray(p.Parties) ? (p.Parties as Record<string, unknown>[]) : [];
    const doCliente = partes.filter((pt) => cpfDigitos && textoDe(pt.Doc).replace(/\D/g, '') === cpfDigitos);
    if (doCliente.length) {
      poloPassivo = doCliente.some((pt) => /passiv|defendant|reu|réu/i.test(`${textoDe(pt.Polarity)} ${textoDe(pt.Type)}`));
    }
    if (poloPassivo === false) continue;
    achados.push({ numero: textoDe(p.Number) || null, assunto: assunto.slice(0, 160), poloPassivo, status });
  }
  if (!achados.length) {
    return { sugerir: false, processos: [], motivo: 'não foram identificados processos financeiros/patrimoniais ativos contra o cliente' };
  }
  return {
    sugerir: true,
    processos: achados,
    motivo: `${achados.length} processo(s) financeiro(s)/patrimonial(is) ativo(s)${achados.some((a) => a.poloPassivo) ? ' com o cliente no polo passivo' : ''}`,
  };
}
