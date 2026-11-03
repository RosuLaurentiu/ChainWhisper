import { readCurrentSharedDexTokenFunds } from '../../lib/currentSharedDexTokenFunds';
import { decryptPrivateUint256Output } from '../../lib/privateUint256';
import { issueOwnerCotiMetaMaskCapability, type IssueOwnerCotiMetaMaskCapabilityArgs } from './ownerCotiMetaMaskCapability';
import { resolvePreparedDexScope } from '../../lib/currentDexPreparedScope';
import type { CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
import { sendCotiScopedRead } from '../../lib/appShared/core';
import { createBrowserWalletRuntimeReadGuard } from '../../lib/browserWalletRuntimeScope';

type IssueArgs = Omit<IssueOwnerCotiMetaMaskCapabilityArgs<unknown>,
  'bindCapability' | 'capabilityLabel' | 'requirePrivacy' | 'refreshPrivacy'> & { candidate?: CurrentCheapDexCandidateKey };

// Read-only. Require an already unlocked session; this path cannot start onboarding.
export const issueCurrentSharedDexTokenFundsCapability = (args: IssueArgs) => {
  const { key: candidate } = resolvePreparedDexScope(args.candidate);
  const aesKey = args.sessionOnboardInfo?.[args.expectedOwnerAddress.toLowerCase()]?.aesKey?.trim();
  if (args.expectedChainId !== 7082400n || !aesKey) {
    throw new Error('Unlock the selected Testnet owner privacy before reading beta funds.');
  }
  return issueOwnerCotiMetaMaskCapability({ ...args, capabilityLabel: 'beta token funds', requirePrivacy: true, refreshPrivacy: false,
    bindCapability: async ({ assertCurrent, assertSnapshotCurrent, readProvider, signer, ownerAddress }) => {
      const guard = async () => { await assertCurrent(); assertSnapshotCurrent();
        if (signer.getUserOnboardInfo()?.aesKey?.trim() !== aesKey) throw new Error('Owner privacy is unavailable.'); };
      return Object.freeze({ read: async (assertCallerCurrent: () => void = () => {}) => {
        const readScope = createBrowserWalletRuntimeReadGuard(() => { assertCallerCurrent(); assertSnapshotCurrent(); });
        const check = async () => { readScope.assertCurrent(); await guard(); readScope.assertCurrent(); };
        const rpc = async (method: string, params: unknown[]) => {
          await check(); const value = await sendCotiScopedRead(readProvider, readScope, method, params); await check(); return value;
        };
        try {
        const raw = await rpc('eth_getBlockByNumber', ['latest', false]) as Record<string, unknown> | null;
        if (!raw || typeof raw.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(raw.hash) ||
          !['number', 'timestamp'].every(key => typeof raw[key] === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(raw[key] as string))) {
          throw new Error('Beta funds canonical block is unavailable.');
        }
        return await readCurrentSharedDexTokenFunds({ owner: ownerAddress, candidate,
          head: { number: BigInt(raw.number as string), hash: raw.hash, timestamp: BigInt(raw.timestamp as string) },
          rpc, assertCurrent: check, decrypt: cipher => decryptPrivateUint256Output(signer, cipher) });
        } finally { readScope.close(); }
      } });
    }
  });
};
