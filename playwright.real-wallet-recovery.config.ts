import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/real-wallet',
  testMatch: 'chat-v2-recovery.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/real-wallet-recovery',
  timeout: 45 * 60 * 1_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4176',
    headless: false,
    screenshot: 'off',
    trace: 'off',
    video: 'off'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4176 --strictPort',
    reuseExistingServer: false,
    timeout: 60_000,
    url: 'http://127.0.0.1:4176/tests/real-wallet/harness/'
  },
  projects: [{ name: 'real-wallet-recovery-manual' }]
});
