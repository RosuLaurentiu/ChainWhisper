import type { OnboardInfo } from '@coti-io/coti-ethers';
import {
  bindOwnerTradeV2MetaMaskCapability,
  type OwnerTradeV2MetaMaskCapability
} from '../../lib/ownerTradeV2Capability';
import {
  issueOwnerCotiMetaMaskCapability,
  type OwnerCotiMetaMaskOnboardInfoCommitter
} from './ownerCotiMetaMaskCapability';
import type { BrowserWalletSignerLease } from './hooks/useWalletOnboarding';

export type IssueOtcV2MetaMaskCapabilityArgs = Readonly<{
  assertLeaseCurrent: (lease: BrowserWalletSignerLease) => Promise<void>;
  assertLeaseSnapshotCurrent: (lease: BrowserWalletSignerLease) => void;
  commitOnboardInfo?: OwnerCotiMetaMaskOnboardInfoCommitter;
  expectedChainId: bigint;
  expectedOwnerAddress: string;
  lease: BrowserWalletSignerLease;
  requirePrivacy: boolean;
  sessionOnboardInfo?: Readonly<Record<string, OnboardInfo>>;
}>;

/** Issues the owner-only capability shared by the attested OTC V2 suite. */
export const issueOtcV2MetaMaskCapability = (
  args: IssueOtcV2MetaMaskCapabilityArgs
): Promise<OwnerTradeV2MetaMaskCapability> => issueOwnerCotiMetaMaskCapability({
  ...args,
  capabilityLabel: 'OTC V2',
  bindCapability: bindOwnerTradeV2MetaMaskCapability
});
