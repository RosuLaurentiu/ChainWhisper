import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { buildBrowserWalletRuntimeScopeKey } from '../../../src/lib/browserWalletRuntimeScope';
import {
  buildChatReactionsV1RuntimeScopeKey,
  type ChatReactionsV1DeploymentConfig
} from '../../../src/lib/chatReactionsV1Deployment';

const OWNER = '0x1111111111111111111111111111111111111111';
const CHAIN_ID = 7_082_400;
const reactionConfig = Object.freeze({
  status: 'active',
  manifest: Object.freeze({
    chainId: BigInt(CHAIN_ID),
    contractAddress: '0x2222222222222222222222222222222222222222',
    deploymentBlock: 100n,
    runtimeBytecodeHash: `0x${'22'.repeat(32)}`,
    directChatV2: Object.freeze({
      contractAddress: '0x3333333333333333333333333333333333333333',
      deploymentBlock: 80n,
      runtimeBytecodeHash: `0x${'33'.repeat(32)}`
    }),
    groupChatV2: Object.freeze({
      contractAddress: '0x4444444444444444444444444444444444444444',
      deploymentBlock: 90n,
      runtimeBytecodeHash: `0x${'44'.repeat(32)}`
    })
  }),
  finalityLagBlocks: 5n,
  fingerprint: 'reactions-runtime-lifecycle'
}) satisfies ChatReactionsV1DeploymentConfig;

type Session = Readonly<{
  address: string;
  chainId: number | null;
  source: string;
  walletId: string;
}>;
type RuntimeName = 'direct-chat' | 'direct-trade' | 'group-chat' | 'otc-history' | 'reactions';
type RuntimeCount = Readonly<{ generations: number; closures: number }>;
type RuntimeCounts = Readonly<Record<RuntimeName, RuntimeCount>>;

const initialSession: Session = Object.freeze({
  address: OWNER,
  chainId: CHAIN_ID,
  source: 'injected',
  walletId: 'metamask'
});
const initialCount = Object.freeze({ generations: 0, closures: 0 });
const initialCounts: RuntimeCounts = Object.freeze({
  'direct-chat': initialCount,
  'direct-trade': initialCount,
  'group-chat': initialCount,
  'otc-history': initialCount,
  reactions: initialCount
});

const useRuntimeLifecycle = (
  name: RuntimeName,
  scopeKey: string | null,
  setCounts: Dispatch<SetStateAction<RuntimeCounts>>
) => {
  useEffect(() => {
    if (!scopeKey) return;
    setCounts((current) => ({
      ...current,
      [name]: { ...current[name], generations: current[name].generations + 1 }
    }));
    return () => setCounts((current) => ({
      ...current,
      [name]: { ...current[name], closures: current[name].closures + 1 }
    }));
  }, [name, scopeKey, setCounts]);
};

function BrowserRuntimeLifecycleHarness() {
  const [session, setSession] = useState<Session>(initialSession);
  const [privacyReady, setPrivacyReady] = useState(true);
  const [transientLiveChainId, setTransientLiveChainId] = useState<number | null>(CHAIN_ID);
  const [, setEquivalentCallbackEpoch] = useState(0);
  const [counts, setCounts] = useState<RuntimeCounts>(initialCounts);
  const scopes = useMemo(() => {
    const shared = {
      activeSignerSource: 'metamask',
      expectedChainId: BigInt(CHAIN_ID),
      session,
      walletAddress: OWNER
    } as const;
    return {
      directChat: buildBrowserWalletRuntimeScopeKey({
        ...shared,
        deploymentFingerprint: 'direct-chat-v2'
      }),
      directTrade: buildBrowserWalletRuntimeScopeKey({
        ...shared,
        deploymentFingerprint: 'direct-trade-v2'
      }),
      groupChat: privacyReady
        ? buildBrowserWalletRuntimeScopeKey({
            ...shared,
            deploymentFingerprint: 'group-chat-v2',
            variant: 'privacy-ready'
          })
        : null,
      otcHistory: buildBrowserWalletRuntimeScopeKey({
        ...shared,
        deploymentFingerprint: 'otc-v2',
        variant: privacyReady ? 'private' : 'public'
      }),
      reactions: buildChatReactionsV1RuntimeScopeKey({
        activeSignerSource: 'metamask',
        config: reactionConfig,
        session,
        walletAddress: OWNER
      })
    };
  }, [privacyReady, session]);

  useRuntimeLifecycle('direct-chat', scopes.directChat, setCounts);
  useRuntimeLifecycle('direct-trade', scopes.directTrade, setCounts);
  useRuntimeLifecycle('group-chat', scopes.groupChat, setCounts);
  useRuntimeLifecycle('otc-history', scopes.otcHistory, setCounts);
  useRuntimeLifecycle('reactions', scopes.reactions, setCounts);

  return (
    <main>
      <h1>Browser runtime lifecycle harness</h1>
      <button onClick={() => {
        setSession((current) => ({ ...current }));
        setEquivalentCallbackEpoch((current) => current + 1);
      }}>
        Refresh equivalent wallet wrappers
      </button>
      <button onClick={() => setTransientLiveChainId(null)}>
        Simulate transient live chain gap
      </button>
      <button onClick={() => setPrivacyReady(false)}>Lock privacy</button>
      <button onClick={() => setPrivacyReady(true)}>Unlock privacy</button>
      <button onClick={() => setSession((current) => ({ ...current, chainId: 1 }))}>
        Commit real chain change
      </button>
      <button onClick={() => setSession((current) => ({ ...current, chainId: CHAIN_ID }))}>
        Restore committed chain
      </button>
      <output data-testid="transient-live-chain">{String(transientLiveChainId)}</output>
      {(Object.keys(counts) as RuntimeName[]).map((name) => (
        <section key={name}>
          <output data-testid={`${name}-generations`}>{counts[name].generations}</output>
          <output data-testid={`${name}-closures`}>{counts[name].closures}</output>
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Browser runtime lifecycle harness root is missing.');
createRoot(root).render(<BrowserRuntimeLifecycleHarness />);
