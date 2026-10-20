// Guardrail mecânico da Regra 15 (CLAUDE.md, 20/10/2026): toda data e todo
// "hoje" do sistema vêm do fuso America/Sao_Paulo pelos helpers de
// packages/utils/src/datas.ts. Este lint roda no CI (.github/workflows/ci.yml)
// e derruba a build. Único arquivo isento: o próprio datas.ts.
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
];
