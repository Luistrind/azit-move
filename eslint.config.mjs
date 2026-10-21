// Guardrails mecânicos das Regras 15 e 16 (CLAUDE.md, 20/10/2026):
//  • Regra 15 — toda data e todo "hoje" vêm do fuso America/Sao_Paulo pelos
//    helpers de packages/utils/src/datas.ts (único arquivo isento).
//  • Regra 16 — "uma conta, uma função": fórmula de negócio só existe em
//    packages/utils (calculations.ts / precificacao.ts); fora dali é proibido
//    Math.pow / ** e qualquer "dia em milissegundos" escrito à mão.
// Este lint roda no CI (.github/workflows/ci.yml) e derruba a build.
//
// Rodar local: `pnpm lint` (raiz) ou `pnpm --filter backend lint`.
import tseslint from 'typescript-eslint';

const AJUDA = 'Use os helpers de @azit/utils (packages/utils/src/datas.ts): dataHojeBrasil()/diaBrasil() para instantes, dataCalendarioUTC()/formatarDiaBR() para colunas de data, somarDiasISO()/partesBrasil() para aritmética.';

const REGRAS_DATAS = [
  {
    // x.toISOString().slice(0, 10) / .substring(0, 10) / .split('T')[0]
    selector:
      'CallExpression[callee.property.name=/^(slice|substring|substr|split)$/][callee.object.type="CallExpression"][callee.object.callee.property.name="toISOString"]',
    message: `Dia derivado de toISOString() é o dia em UTC — depois das 21h em Brasília já é amanhã (Regra 15). ${AJUDA}`,
  },
  {
    // new Date().getDate(), d.getDay(), d.setHours(0,0,0,0) … (hora LOCAL do servidor/navegador)
    selector: 'CallExpression[callee.property.name=/^(get|set)(Date|Day|Month|FullYear|Hours|Minutes)$/]',
    message: `Métodos de hora LOCAL do Date seguem o fuso do servidor (UTC em produção), não o do negócio (Regra 15). ${AJUDA} Se for aritmética pura de calendário, use os métodos UTC (getUTCDate, setUTCDate…).`,
  },
  {
    // d.toLocaleDateString('pt-BR') sem { timeZone }
    selector:
      'CallExpression[callee.property.name=/^toLocale(Date|Time)String$/]:not(:has(ObjectExpression.arguments > Property[key.name="timeZone"]))',
    message: `toLocaleDateString/toLocaleTimeString sem { timeZone } formata no fuso do servidor (Regra 15). ${AJUDA}`,
  },
];

const AJUDA_FORMULAS = 'Chame a função de @azit/utils (packages/utils/src/calculations.ts: valorPresenteMensal, taxaDiariaEquivalente, taxaPeriodoEquivalente, pmtPrice, FATOR_PRAZO_*/FATOR_VALOR_*) ou um motor de precificacao.ts; constante de dia é DIA_MS de datas.ts. Nunca refaça a conta no service ou na tela, nem "só para exibir".';

const REGRAS_FORMULAS = [
  {
    // Math.pow(...) — juros compostos / valor presente reescritos fora de utils
    selector: 'CallExpression[callee.object.name="Math"][callee.property.name="pow"]',
    message: `Math.pow fora de packages/utils é fórmula duplicada (Regra 16). ${AJUDA_FORMULAS}`,
  },
  {
    selector: 'BinaryExpression[operator="**"], AssignmentExpression[operator="**="]',
    message: `Potência (**) fora de packages/utils é fórmula duplicada (Regra 16). ${AJUDA_FORMULAS}`,
  },
  {
    // 86400000 / 86_400_000 / 864e5 (todos viram o mesmo valor no AST)
    selector: 'Literal[value=86400000]',
    message: `Dia em milissegundos escrito à mão (Regra 16): use DIA_MS de @azit/utils — ou, para contar dias, diasCalendarioEntre/diasAtrasoCalendario.`,
  },
  {
    // 24 * 60 * 60 * 1000 (em qualquer ordem) — a mesma constante disfarçada de conta
    selector: 'BinaryExpression[operator="*"]:has(Literal[value=24]):has(Literal[value=60]):has(Literal[value=1000])',
    message: `24 × 60 × 60 × 1000 é DIA_MS reescrito (Regra 16): importe DIA_MS de @azit/utils.`,
  },
];

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', '.claude/**', 'deploy/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    // datas.ts é a fonte única; testes comparam datas fixas em UTC e não rodam em produção.
    ignores: ['packages/utils/src/datas.ts', '**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    // Registrado (sem regras ligadas) só para os `eslint-disable @typescript-eslint/*`
    // já existentes no código não virarem "regra desconhecida".
    plugins: { '@typescript-eslint': tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-restricted-syntax': ['error', ...REGRAS_DATAS],
    },
  },
  {
    // Regra 16: fora da casa das fórmulas valem AS DUAS famílias de regras
    // (este bloco substitui o anterior para os arquivos que casa — flat config).
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    ignores: [
      'packages/utils/src/datas.ts',
      'packages/utils/src/calculations.ts',
      'packages/utils/src/precificacao.ts',
      '**/*.test.ts',
      '**/*.spec.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...REGRAS_DATAS, ...REGRAS_FORMULAS],
    },
  },
];
