import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getProviderErrorMessage } from '../../../src/lib/appShared';
import { buildBrowserOwnerDataScopeKey } from '../../../src/lib/browserWalletRuntimeScope';
import { runWalletTransactionFlow } from '../../../src/lib/walletTransactionFlow';
import { createLeaseGuardedEip1193Provider } from '../../../src/features/wallet/hooks/useSharedWalletSigner';
import {
  useWalletOnboarding,
  type BrowserWalletSignerLease
} from '../../../src/features/wallet/hooks/useWalletOnboarding';

const transactionHash = `0x${'ab'.repeat(32)}`;
function WalletLifecycleHarness() {
  const [action, setAction] = useState('idle');
  const [error, setError] = useState('');
  const [nickname, setNickname] = useState('');
  const [ownerScopedMarker, setOwnerScopedMarker] = useState('');
  const leaseRef = useRef<BrowserWalletSignerLease | null>(null);
  const loadMyNicknameFromChainRef = useRef(async () => '');
  const wallet = useWalletOnboarding({
    allowPassiveBrowserRestore: false,
    loadMyNicknameFromChainRef,
    setError,
    setMyNickname: setNickname
  });
  const ownerDataScopeKey = buildBrowserOwnerDataScopeKey(wallet.walletAddress);
  useEffect(() => {
    setOwnerScopedMarker('');
  }, [ownerDataScopeKey]);

  const run = (label: string, operation: () => Promise<unknown> | unknown) => {
    setAction(`${label}:pending`);
    setError('');
    void Promise.resolve()
      .then(operation)
      .then(() => setAction(`${label}:ok`))
      .catch((cause) => {
        setAction(`${label}:failed`);
        setError(getProviderErrorMessage(cause, `${label} failed.`));
      });
  };

  const guardedSend = async () => {
    const lease = leaseRef.current;
    if (!lease) throw new Error('Capture the wallet lease first.');
    await runWalletTransactionFlow({
      chainId: lease.chainId,
      provider: lease.sessionProvider,
      providerKey: lease.session.walletId,
      walletAddress: lease.address
    }, async () => {
      const provider = createLeaseGuardedEip1193Provider(
        lease.sessionProvider,
        () => wallet.assertBrowserWalletSignerLeaseCurrent(lease),
        () => wallet.assertBrowserWalletSignerLeaseSnapshotCurrent(lease)
      );
      const result = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: lease.address,
          to: '0x2222222222222222222222222222222222222222',
          data: '0x12345678',
          value: '0x0'
        }]
      });
      if (result !== transactionHash) throw new Error('Mock wallet returned another transaction.');
    });
  };

  return (
    <main>
      <h1>Wallet lifecycle harness</h1>
      <button onClick={() => run('connect', () =>
        wallet.connectAndOnboard('metamask', { preparePrivacy: false })
      )}>
        Connect
      </button>
      <button onClick={() => run('capture', () => {
        leaseRef.current = wallet.captureBrowserWalletSignerLease();
      })}>
        Capture lease
      </button>
      <button onClick={() => run('replace', () => {
        const replacement = wallet.injectedWalletOptions.find((option) => option.provider === window.ethereum);
        if (!replacement) throw new Error('Replacement provider was not discovered.');
        return wallet.connectAndOnboard(replacement.id, { preparePrivacy: false });
      })}>
        Connect replacement
      </button>
      <button onClick={() => run('activate', () =>
        wallet.activateBrowserWalletSession('metamask', { preparePrivacy: false })
      )}>
        Activate same wallet
      </button>
      <button onClick={() => run('send', guardedSend)}>Guarded send</button>
      <button onClick={() => setOwnerScopedMarker('loaded-history')}>Seed owner data</button>
      <output data-testid="action">{action}</output>
      <output data-testid="error">{error}</output>
      <output data-testid="wallet-address">{wallet.walletAddress}</output>
      <output data-testid="chain-id">{wallet.chainId ?? ''}</output>
      <output data-testid="status">{wallet.status}</output>
      <output data-testid="nickname">{nickname}</output>
      <output data-testid="owner-data-scope">{ownerDataScopeKey}</output>
      <output data-testid="owner-scoped-marker">{ownerScopedMarker}</output>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Wallet lifecycle harness root is missing.');
createRoot(root).render(<WalletLifecycleHarness />);
