import { expect, test, type Page } from '@playwright/test';

const COTI_CHAIN_ID_HEX = '0x282b34';
const ALICE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ALICE_CASE_VARIANT = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
const BOB = '0x3333333333333333333333333333333333333333';

type WalletHarnessControl = {
  announceProvider: () => void;
  announceUnrelatedProvider: () => void;
  replaceProvider: () => void;
  clearTrace: () => void;
  emit: (eventName: string) => void;
  gateNextAccounts: () => void;
  releaseAccounts: () => void;
  setAccount: (account: string) => void;
  setChainId: (chainId: string) => void;
  setTransientChainId: (chainId: string) => void;
  trace: string[];
};

const installWalletHarnessProvider = async (page: Page) => {
  await page.addInitScript(({ account: initialAccount, chainId }) => {
    const listeners = new Map<string, Set<() => void>>();
    const trace: string[] = [];
    let account = initialAccount;
    let selectedChainId = chainId;
    let transientChainId = '';
    let gateAccounts = false;
    let releaseAccounts: (() => void) | null = null;
    const provider = {
      isMetaMask: true,
      request: async ({ method }: { method: string }) => {
        trace.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
          if (method === 'eth_accounts' && gateAccounts) {
            gateAccounts = false;
            trace.push('eth_accounts:gated');
            await new Promise<void>((resolve) => { releaseAccounts = resolve; });
          }
          return [account];
        }
        if (method === 'eth_chainId') {
          if (transientChainId) {
            const value = transientChainId;
            transientChainId = '';
            trace.push(`eth_chainId:transient:${value}`);
            return value;
          }
          return selectedChainId;
        }
        if (method === 'wallet_requestPermissions') {
          return [{ parentCapability: 'eth_accounts', caveats: [] }];
        }
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        if (method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`;
        return null;
      },
      on: (eventName: string, handler: () => void) => {
        const handlers = listeners.get(eventName) ?? new Set<() => void>();
        handlers.add(handler);
        listeners.set(eventName, handlers);
      },
      removeListener: (eventName: string, handler: () => void) => {
        listeners.get(eventName)?.delete(handler);
      }
    };
    const control: WalletHarnessControl = {
      announceUnrelatedProvider: () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { provider: { request: async () => { throw new Error('Unselected provider must not be used.'); } },
          info: { name: 'Unrelated wallet', rdns: 'org.example.unselected', uuid: 'unselected-wallet' } }
      })),
      replaceProvider: () => {
        const replacementListeners = new Map<string, Set<() => void>>();
        const replacement = {
          isMetaMask: true,
          request: async ({ method }: { method: string }) => {
            trace.push(`replacement:${method}`);
            if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
            if (method === 'eth_chainId') return selectedChainId;
            if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts', caveats: [] }];
            if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
            if (method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`;
            return null;
          },
          on: (eventName: string, handler: () => void) => {
            const handlers = replacementListeners.get(eventName) ?? new Set<() => void>();
            handlers.add(handler);
            replacementListeners.set(eventName, handlers);
          },
          removeListener: (eventName: string, handler: () => void) => replacementListeners.get(eventName)?.delete(handler)
        };
        Object.defineProperty(window, 'ethereum', { configurable: true, value: replacement });
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
          detail: { provider: replacement,
            info: { name: 'MetaMask replacement', rdns: 'io.metamask', uuid: 'replacement-wallet' } }
        }));
      },
      announceProvider: () => {
        trace.push('event:eip6963:announceProvider');
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
          detail: {
            provider,
            info: {
              name: 'MetaMask rediscovered',
              rdns: 'io.metamask',
              uuid: 'rediscovered-provider-metadata'
            }
          }
        }));
      },
      clearTrace: () => { trace.splice(0, trace.length); },
      emit: (eventName) => {
        trace.push(`event:${eventName}`);
        for (const handler of listeners.get(eventName) ?? []) handler();
      },
      gateNextAccounts: () => { gateAccounts = true; },
      releaseAccounts: () => {
        const release = releaseAccounts;
        releaseAccounts = null;
        release?.();
      },
      setAccount: (nextAccount) => { account = nextAccount; },
      setChainId: (nextChainId) => { selectedChainId = nextChainId; },
      setTransientChainId: (nextChainId) => { transientChainId = nextChainId; },
      trace
    };
    Object.defineProperty(window, '__walletHarnessControl', { configurable: true, value: control });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
  }, { account: ALICE, chainId: COTI_CHAIN_ID_HEX });
};

const control = (
  page: Page,
  command:
    | 'announce-provider'
    | 'announce-unrelated-provider'
    | 'replace-provider'
    | 'clear-trace'
    | 'emit'
    | 'gate-next-accounts'
    | 'release-accounts'
    | 'set-account'
    | 'set-chain-id'
    | 'set-transient-chain-id',
  value = ''
) => page.evaluate(({ command: selected, value: argument }) => {
  const harness = (window as unknown as { __walletHarnessControl: WalletHarnessControl })
    .__walletHarnessControl;
  if (selected === 'announce-provider') harness.announceProvider();
  else if (selected === 'announce-unrelated-provider') harness.announceUnrelatedProvider();
  else if (selected === 'replace-provider') harness.replaceProvider();
  else if (selected === 'clear-trace') harness.clearTrace();
  else if (selected === 'emit') harness.emit(argument);
  else if (selected === 'gate-next-accounts') harness.gateNextAccounts();
  else if (selected === 'release-accounts') harness.releaseAccounts();
  else if (selected === 'set-account') harness.setAccount(argument);
  else if (selected === 'set-chain-id') harness.setChainId(argument);
  else if (selected === 'set-transient-chain-id') harness.setTransientChainId(argument);
}, { command, value });

const connectAndCapture = async (page: Page) => {
  await page.goto('/tests/browser/fixtures/wallet-lifecycle-harness.html');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByTestId('action')).toHaveText('connect:ok');
  await expect(page.getByTestId('wallet-address')).toHaveText(ALICE);
  await page.getByRole('button', { name: 'Capture lease' }).click();
  await expect(page.getByTestId('action')).toHaveText('capture:ok');
};

test.describe('mounted owner-wallet lifecycle', () => {
  test.beforeEach(async ({ page }) => installWalletHarnessProvider(page));

  test('retires an old lease after explicitly selecting a distinct provider and admits only a fresh lease', async ({ page }) => {
    await connectAndCapture(page);
    await control(page, 'announce-unrelated-provider');
    await page.getByRole('button', { name: 'Guarded send' }).click();
    await expect(page.getByTestId('action')).toHaveText('send:ok');
    await control(page, 'replace-provider');
    await page.getByRole('button', { name: 'Connect replacement' }).click();
    await expect(page.getByTestId('action')).toHaveText('replace:ok');
    await expect(page.getByTestId('wallet-address')).toHaveText(ALICE);
    await control(page, 'clear-trace');
    await page.getByRole('button', { name: 'Guarded send' }).click();
    await expect(page.getByTestId('action')).toHaveText('send:failed');
    expect(await page.evaluate(() => (window as unknown as { __walletHarnessControl: WalletHarnessControl })
      .__walletHarnessControl.trace.filter((entry) => entry.endsWith('eth_sendTransaction')))).toEqual([]);
    await page.getByRole('button', { name: 'Capture lease' }).click();
    await expect(page.getByTestId('action')).toHaveText('capture:ok');
    await control(page, 'clear-trace');
    await page.getByRole('button', { name: 'Guarded send' }).click();
    await expect(page.getByTestId('action')).toHaveText('send:ok');
    expect(await page.evaluate(() => (window as unknown as { __walletHarnessControl: WalletHarnessControl })
      .__walletHarnessControl.trace)).toEqual(['replacement:eth_accounts', 'replacement:eth_chainId', 'replacement:eth_sendTransaction']);
  });

  test('keeps one guarded send valid through a same-wallet activation and provider-event burst', async ({ page }) => {
    await connectAndCapture(page);
    await control(page, 'gate-next-accounts');
    await page.getByRole('button', { name: 'Guarded send' }).click();
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __walletHarnessControl: WalletHarnessControl })
        .__walletHarnessControl.trace.includes('eth_accounts:gated')
    )).toBe(true);

    await page.getByRole('button', { name: 'Activate same wallet' }).click();
    await control(page, 'announce-provider');
    await control(page, 'emit', 'accountsChanged');
    await control(page, 'emit', 'chainChanged');
    await control(page, 'emit', 'connect');
    await expect(page.getByTestId('action')).toHaveText('activate:ok');
    await control(page, 'release-accounts');

    await expect(page.getByTestId('action')).toHaveText('send:ok');
    const sends = await page.evaluate(() =>
      (window as unknown as { __walletHarnessControl: WalletHarnessControl })
        .__walletHarnessControl.trace.filter((entry) => entry === 'eth_sendTransaction').length
    );
    expect(sends).toBe(1);
    await expect(page.getByTestId('error')).toHaveText('');
  });

  test('keeps the connected wallet idle and performs one live authority check for one send', async ({ page }) => {
    await connectAndCapture(page);
    await control(page, 'clear-trace');
    await page.waitForTimeout(250);
    expect(await page.evaluate(() =>
      (window as unknown as { __walletHarnessControl: WalletHarnessControl })
        .__walletHarnessControl.trace
    )).toEqual([]);

    await page.getByRole('button', { name: 'Guarded send' }).click();
    await expect(page.getByTestId('action')).toHaveText('send:ok');
    expect(await page.evaluate(() =>
      (window as unknown as { __walletHarnessControl: WalletHarnessControl })
        .__walletHarnessControl.trace
    )).toEqual(['eth_accounts', 'eth_chainId', 'eth_sendTransaction']);
  });

  test('preserves mounted owner data for a casing-only account refresh and clears it for another owner', async ({ page }) => {
    await connectAndCapture(page);
    await page.getByRole('button', { name: 'Seed owner data' }).click();
    await expect(page.getByTestId('owner-scoped-marker')).toHaveText('loaded-history');
    await expect(page.getByTestId('owner-data-scope')).toHaveText(ALICE);

    await control(page, 'set-account', ALICE_CASE_VARIANT);
    await control(page, 'emit', 'accountsChanged');
    await expect(page.getByTestId('wallet-address')).toHaveText(ALICE_CASE_VARIANT);
    await expect(page.getByTestId('owner-data-scope')).toHaveText(ALICE);
    await expect(page.getByTestId('owner-scoped-marker')).toHaveText('loaded-history');

    await control(page, 'set-account', BOB);
    await control(page, 'emit', 'accountsChanged');
    await expect(page.getByTestId('wallet-address')).toHaveText(BOB);
    await expect(page.getByTestId('owner-data-scope')).toHaveText(BOB);
    await expect(page.getByTestId('owner-scoped-marker')).toHaveText('');
  });

  test('does not retire a guarded send for one transient chain refresh during its prompt', async ({ page }) => {
    await connectAndCapture(page);
    await control(page, 'clear-trace');
    await control(page, 'gate-next-accounts');
    await page.getByRole('button', { name: 'Guarded send' }).click();
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __walletHarnessControl: WalletHarnessControl })
        .__walletHarnessControl.trace.includes('eth_accounts:gated')
    )).toBe(true);

    await control(page, 'set-transient-chain-id', '0x1');
    await control(page, 'emit', 'chainChanged');
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __walletHarnessControl: WalletHarnessControl })
        .__walletHarnessControl.trace.includes('eth_chainId:transient:0x1')
    )).toBe(true);
    const flowState = await page.evaluate(async () => {
      const flow = await import('/src/lib/walletTransactionFlow.ts');
      return {
        active: flow.isWalletTransactionFlowActive(),
        prompt: flow.isWalletTransactionPromptActive(),
        trace: flow.readWalletTransactionFlowTrace()
      };
    });
    expect(flowState.active).toBe(true);
    expect(flowState.prompt).toBe(true);
    expect(flowState.trace).toEqual(expect.arrayContaining([
      expect.stringContaining('chain-refresh-change-deferred-during-prompt')
    ]));
    await control(page, 'release-accounts');

    await expect(page.getByTestId('action')).toHaveText('send:ok');
    await expect(page.getByTestId('chain-id')).toHaveText(String(Number.parseInt(COTI_CHAIN_ID_HEX, 16)));
    await expect(page.getByTestId('error')).toHaveText('');
    expect(await page.evaluate(() =>
      (window as unknown as { __walletHarnessControl: WalletHarnessControl })
        .__walletHarnessControl.trace.filter((entry) => entry === 'eth_sendTransaction').length
    )).toBe(1);
  });

  test('revokes the captured lease after a real account change and submits nothing', async ({ page }) => {
    await connectAndCapture(page);
    await control(page, 'set-account', BOB);
    await control(page, 'emit', 'accountsChanged');
    await expect(page.getByTestId('wallet-address')).toHaveText(BOB);

    await page.getByRole('button', { name: 'Guarded send' }).click();
    await expect(page.getByTestId('action')).toHaveText('send:failed');
    await expect(page.getByTestId('error')).toContainText('No transaction was sent');
    const sends = await page.evaluate(() =>
      (window as unknown as { __walletHarnessControl: WalletHarnessControl })
        .__walletHarnessControl.trace.filter((entry) => entry === 'eth_sendTransaction').length
    );
    expect(sends).toBe(0);
  });

  test('revokes the captured lease after a real network change and submits nothing', async ({ page }) => {
    await connectAndCapture(page);
    await control(page, 'set-chain-id', '0x1');
    await control(page, 'emit', 'chainChanged');
    await expect(page.getByTestId('chain-id')).toHaveText('1');

    await page.getByRole('button', { name: 'Guarded send' }).click();
    await expect(page.getByTestId('action')).toHaveText('send:failed');
    await expect(page.getByTestId('error')).toContainText('No transaction was sent');
    const sends = await page.evaluate(() =>
      (window as unknown as { __walletHarnessControl: WalletHarnessControl })
        .__walletHarnessControl.trace.filter((entry) => entry === 'eth_sendTransaction').length
    );
    expect(sends).toBe(0);
  });
});
