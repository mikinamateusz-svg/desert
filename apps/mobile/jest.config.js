/** @type {import('jest').Config} */
module.exports = {
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'es2020', esModuleInterop: true, jsx: 'react-jsx', verbatimModuleSyntax: false } }] },
  moduleNameMapper: {
    // Stub out theme tokens for unit tests (pure logic doesn't need real values)
    '^../theme$': '<rootDir>/src/utils/__tests__/__mocks__/theme.ts',
    '^../theme/tokens$': '<rootDir>/src/utils/__tests__/__mocks__/theme.ts',
  },
};
