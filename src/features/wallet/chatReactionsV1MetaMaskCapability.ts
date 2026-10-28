import type { OnboardInfo } from '@coti-io/coti-ethers';
import {
  bindChatReactionsV1MetaMaskCapability,
  type ChatReactionsV1MetaMaskCapability
} from '../../lib/chatReactionsV1Actions';
import {
  issueOwnerCotiMetaMaskCapability,
  type OwnerCotiMetaMaskOnboardInfoCommitter
} from './ownerCotiMetaMaskCapability';
import type { BrowserWalletSignerLease } from './hooks/useWalletOnboarding';

export type IssueChatReactionsV1MetaMaskCapabilityArgs = Readonly<{
  assertLeaseCurrent: (lease: BrowserWalletSignerLease) => Promise<void>;
  assertLeaseSnapshotCurrent: (lease: BrowserWalletSignerLease) => void;
  commitOnboardInfo?: OwnerCotiMetaMaskOnboardInfoCommitter;
  expectedChainId: bigint;
  expectedOwnerAddress: string;
  lease: BrowserWalletSignerLease;
  sessionOnboardInfo?: Readonly<Record<string, OnboardInfo>>;
}>;

/** Public reactions never request the COTI privacy key. */
export const issueChatReactionsV1MetaMaskCapability = (
  args: IssueChatReactionsV1MetaMaskCapabilityArgs
): Promise<ChatReactionsV1MetaMaskCapability> => issueOwnerCotiMetaMaskCapability({
  ...args,
  requirePrivacy: false,
  capabilityLabel: 'ChatReactionsV1',
  bindCapability: bindChatReactionsV1MetaMaskCapability
});
