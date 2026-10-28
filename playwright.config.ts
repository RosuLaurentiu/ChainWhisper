import { defineConfig, devices } from '@playwright/test';

// These fixtures bind different chains. A test must use the matching build;
// changing the injected wallet cannot change the app's contract manifest.
const testnetTests = /(?:current-dex-(?:journey|slippage)|testnet-token-admission|trading-agent-workspace|trading-keyboard-flow|wallet-header|private-liquidity)\.spec\.ts/;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry'
  },
  webServer: [{
    command: 'npx vite --mode development --host 127.0.0.1 --port 4175 --strictPort',
    env: { VITE_CHAINWHISPER_NETWORK_ID: 'coti-mainnet' },
    reuseExistingServer: false,
    // HTML can respond before Vite finishes the shared stylesheet. Wait for
    // that required resource so cold compilation is part of server startup.
    url: 'http://127.0.0.1:4175/src/styles.css'
  }, {
    command: 'npm run prepare:testnet-candidate && npx vite --mode coti-testnet-candidate --host 127.0.0.1 --port 4174 --strictPort',
    // A different Vite mode can expose the same URL with a different contract
    // manifest. Reusing it makes browser results depend on an unrelated local
    // process instead of the configuration this suite is meant to verify.
    reuseExistingServer: false,
    url: 'http://127.0.0.1:4174/src/styles.css'
  }],
  projects: [
    {
      name: 'chromium-mainnet',
      testIgnore: testnetTests,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4175' }
    },
    {
      name: 'chromium-testnet',
      testMatch: testnetTests,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174' }
    }
  ]
});
