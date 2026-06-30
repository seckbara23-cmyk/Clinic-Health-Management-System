/**
 * Jest config for CHMS unit tests.
 *
 * Scope is deliberately narrow: pure TypeScript modules (no Next runtime, no
 * JSX) under src/, transpiled to CommonJS via ts-jest in a node environment.
 * Component/integration tests can add a jsdom project later.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: { module: 'commonjs', esModuleInterop: true, isolatedModules: true } },
    ],
  },
}
