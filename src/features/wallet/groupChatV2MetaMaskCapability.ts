import type { OnboardInfo } from '@coti-io/coti-ethers';
import {
  bindGroupChatV2MetaMaskCapability,
  type GroupChatV2MetaMaskCapability
} from '../../lib/groupChatV2Chain';
import {
  issueOwnerCotiMetaMaskCapability,
  type OwnerCotiMetaMaskOnboardInfoCommitter
} from './ownerCotiMetaMaskCapability';
import type { BrowserWalletSignerLease } from './hooks/useWalletOnboarding';

export type GroupChatV2MetaMaskCapabilityOnboardInfoCommitter =
  OwnerCotiMetaMaskOnboardInfoCommitter;

export type IssueGroupChatV2MetaMaskCapabilityArgs = Readonly<{
  assertLeaseCurrent: (lease: BrowserWalletSignerLease) => Promise<void>;
  assertLeaseSnapshotCurrent: (lease: BrowserWalletSignerLease) => void;
  commitOnboardInfo?: GroupChatV2MetaMaskCapabilityOnboardInfoCommitter;
  expectedChainId: bigint;
  expectedOwnerAddress: string;
  lease: BrowserWalletSignerLease;
  requirePrivacy: boolean;
  sessionOnboardInfo?: Readonly<Record<string, OnboardInfo>>;
}>;

/** Disabled unless the exact reviewed Group Chat V2 manifest is active. */
export const issueGroupChatV2MetaMaskCapability = (
  args: IssueGroupChatV2MetaMaskCapabilityArgs
): Promise<GroupChatV2MetaMaskCapability> => issueOwnerCotiMetaMaskCapability({
  ...args,
  capabilityLabel: 'ChainWhisper Group Chat V2',
  bindCapability: bindGroupChatV2MetaMaskCapability
});
