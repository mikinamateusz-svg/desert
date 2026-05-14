/**
 * Jest config for integration tests that hit a real Postgres + PostGIS.
 *
 * These tests live alongside their target service as `*.integration.spec.ts`
 * and are EXCLUDED from the default `pnpm test` run (the regular config
 * uses a negative lookbehind regex). They run via `pnpm test:integration`,
 * which requires `INTEGRATION_DATABASE_URL` to be set.
 *
 * The test files themselves skip entirely when `INTEGRATION_DATABASE_URL`
 * is missing — so locals without Docker get a "no tests run" notice rather
 * than a hard failure.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: ['node_modules/(?!(expo-server-sdk)/)'],
  testEnvironment: 'node',
  // Real DB ops + seed/teardown can be slower than unit tests; the per-
  // test default of 5s is too tight for CI Postgres cold-start.
  testTimeout: 30_000,
};
