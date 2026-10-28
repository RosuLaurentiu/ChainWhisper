import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { OnboardInfo } from '@coti-io/coti-ethers';
import type { Eip1193Provider } from '../../../src/lib/appShared';
import useAccountFundsSigners from '../../../src/features/wallet/hooks/useAccountFundsSigners';
import type {
  BrowserWalletSession,
  BrowserWalletSignerLease
} from '../../../src/features/wallet/hooks/useWalletOnboarding';

const OWNER = '0x1111111111111111111111111111111111111111';
const CHAIN_ID = 7_082_400;
const provider: Eip1193Provider = {
  request: async ({ method }) => {
    if (method === 'eth_accounts') return [OWNER];
    if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`;
    return null;
  }
};
const session: BrowserWalletSession = {
  address: OWNER,
  chainId: CHAIN_ID,
  provider,
  source: 'injected',
  walletId: 'metamask',
  walletLabel: 'MetaMask'
};
const lease: BrowserWalletSignerLease = {
  activeAddress: OWNER,
  activeChainId: CHAIN_ID,
  activeProvider: provider,
  activeSignerSource: 'metamask',
  address: OWNER,
  chainId: CHAIN_ID,
  epoch: 1,
  session,
  sessionProvider: provider,
  signingProvider: provider,
  source: 'injected'
};
const assertCurrent = async () => undefined;
const assertSnapshotCurrent = () => undefined;
const captureLease = () => lease;
const ensureNetwork = async () => undefined;
const getConnectedProvider = () => provider;
const resolvePromptProvider = async () => provider;
const ignoreWalletAesHealth = () => undefined;

function TradingRuntimeLifecycleHarness() {
  const [chainId, setChainId] = useState<number | null>(CHAIN_ID);
  const [sessionOnboardInfo, setSessionOnboardInfo] = useState<Record<string, OnboardInfo>>({
    [OWNER.toLowerCase()]: { aesKey: 'stable-test-aes' } as OnboardInfo
  });
  const { getOwnerFundsSigner } = useAccountFundsSigners({
    assertBrowserWalletSignerLeaseCurrent: assertCurrent,
    assertBrowserWalletSignerLeaseSnapshotCurrent: assertSnapshotCurrent,
    browserWalletSession: session,
    captureBrowserWalletSignerLease: captureLease,
    chainId,
    currentInjectedWalletOption: { id: 'metamask' },
    ensureCotiNetwork: ensureNetwork,
    getConnectedProvider,
    ownerAesKey: '',
    ownerWalletAddress: OWNER,
    preferredBrowserWalletId: 'metamask',
    resolveWalletPromptProvider: resolvePromptProvider,
    sessionOnboardInfo,
    setChainId,
    setSessionOnboardInfo,
    setWalletAesHealth: ignoreWalletAesHealth
  });
  const getDirectTradeCapability = useCallback(
    () => getOwnerFundsSigner(false),
    [getOwnerFundsSigner]
  );
  const [runtimeGeneration, setRuntimeGeneration] = useState(0);
  const [runtimeClosures, setRuntimeClosures] = useState(0);

  useEffect(() => {
    setRuntimeGeneration((current) => current + 1);
    return () => setRuntimeClosures((current) => current + 1);
  }, [getDirectTradeCapability]);

  return (
    <main>
      <h1>Trading runtime lifecycle harness</h1>
      <button onClick={() => setSessionOnboardInfo((previous) => ({ ...previous }))}>
        Refresh equivalent privacy
      </button>
      <output data-testid="runtime-generation">{runtimeGeneration}</output>
      <output data-testid="runtime-closures">{runtimeClosures}</output>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Trading runtime lifecycle harness root is missing.');
createRoot(root).render(<TradingRuntimeLifecycleHarness />);
