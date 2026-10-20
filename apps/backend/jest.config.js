// Testes unitários do backend (jest + ts-jest). Os specs ficam ao lado do código
// (`*.spec.ts`) e instanciam o service à mão com dublês — nada de banco, Redis ou
// Asaas. O motor financeiro continua testado em @azit/utils (vitest). O CI roda
// `pnpm --filter backend test` depois do `prisma generate` (os tipos vêm de lá).
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.spec.json' }],
  },
};
