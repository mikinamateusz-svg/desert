import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: [
    {
      command: 'node e2e/fixtures/mock-server.mjs',
      port: 4444,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm run dev',
      port: 3002,
      reuseExistingServer: !process.env.CI,
      env: { INTERNAL_API_URL: 'http://localhost:4444' },
    },
  ],
});
