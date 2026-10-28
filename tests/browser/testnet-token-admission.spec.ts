import { expect, test } from '@playwright/test';

const OWNER = '0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d';

test('renders the one-at-a-time owner setup and gates mobile QR from configuration', async ({ page }) => {
  await page.route('https://testnet.coti.io/rpc', (route) => route.abort('failed'));
  await page.addInitScript(({ owner }) => {
    const methods: string[] = [];
    const provider = {
      isMetaMask: true,
      request: async ({ method }: { method: string }) => {
        methods.push(method);
        if (method === 'eth_chainId') return '0x6c11a0';
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [owner];
        throw new Error(`Unexpected wallet method ${method}`);
      },
      on: () => undefined,
      removeListener: () => undefined
    };
    Object.defineProperty(window, '__testnetAdmissionWalletMethods', {
      configurable: true,
      value: methods
    });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
  }, { owner: OWNER });

  await page.goto('/testnet-token-admission.html');
  await expect(page.getByRole('heading', { name: 'Token policy setup' })).toBeVisible();
  await expect(page.getByText('This tool never asks for a private key')).toBeVisible();
  await expect(page.getByText('0/16')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect MetaMask' })).toBeVisible();
  const cipherTradeMobile = page.getByRole('button', { name: 'Connect CipherTrade Mobile' });
  await expect(cipherTradeMobile).toBeVisible();
  if (await cipherTradeMobile.isEnabled()) {
    await expect(page.getByText('CipherTrade Mobile QR requires VITE_WALLETCONNECT_PROJECT_ID.')).toHaveCount(0);
  } else {
    await expect(cipherTradeMobile).toBeDisabled();
    await expect(page.getByText('CipherTrade Mobile QR requires VITE_WALLETCONNECT_PROJECT_ID.')).toBeVisible();
  }
  expect(await page.evaluate(
    () => (window as unknown as { __testnetAdmissionWalletMethods?: string[] }).__testnetAdmissionWalletMethods ?? []
  )).not.toContain('eth_sendTransaction');
});

test('live-attests the exact deployed admission candidate through the browser RPC', async ({ page }) => {
  test.skip(process.env.CW_LIVE_TESTNET_ADMISSION !== '1', 'Manual read-only COTI testnet gate.');
  test.setTimeout(120_000);
  await page.goto('/testnet-token-admission.html');
  await expect(page.getByText(/Attestation complete at block \d+/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('0/16')).toBeVisible();
  await expect(page.getByText('ChainWhisperDirectOTCEscrowV2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve operation 1' })).toBeDisabled();
});
