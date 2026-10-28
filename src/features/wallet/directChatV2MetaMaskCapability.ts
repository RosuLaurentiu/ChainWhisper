import type { OnboardInfo } from '@coti-io/coti-ethers';
import {
  bindDirectChatV2MetaMaskCapability,
  type DirectChatV2MetaMaskCapability
} from '../../lib/directChatV2Chain';
import {
  issueOwnerCotiMetaMaskCapability,
  type OwnerCotiMetaMaskOnboardInfoCommitter
} from './ownerCotiMetaMaskCapability';
import type { BrowserWalletSignerLease } from './hooks/useWalletOnboarding';

export type DirectChatV2MetaMaskCapabilityOnboardInfoCommitter =
  OwnerCotiMetaMaskOnboardInfoCommitter;

export type IssueDirectChatV2MetaMaskCapabilityArgs = Readonly<{
  assertLeaseCurrent: (lease: BrowserWalletSignerLease) => Promise<void>;
  assertLeaseSnapshotCurrent: (lease: BrowserWalletSignerLease) => void;
  commitOnboardInfo?: DirectChatV2MetaMaskCapabilityOnboardInfoCommitter;
  expectedChainId: bigint;
  expectedOwnerAddress: string;
  lease: BrowserWalletSignerLease;
  requirePrivacy: boolean;
  sessionOnboardInfo?: Readonly<Record<string, OnboardInfo>>;
}>;

/** Inactive until the reviewed Chat V2 deployment and manual prompt gate are activated. */
export const issueDirectChatV2MetaMaskCapability = (
  args: IssueDirectChatV2MetaMaskCapabilityArgs
): Promise<DirectChatV2MetaMaskCapability> => issueOwnerCotiMetaMaskCapability({
  ...args,
  capabilityLabel: 'ChainWhisper Chat V2',
  bindCapability: bindDirectChatV2MetaMaskCapability
});
