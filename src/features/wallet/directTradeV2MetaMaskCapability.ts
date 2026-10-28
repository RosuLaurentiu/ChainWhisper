import type { OnboardInfo } from '@coti-io/coti-ethers';
import {
  bindDirectTradeV2MetaMaskCapability,
  type DirectTradeV2MetaMaskCapability
} from '../../lib/directTradeV2Actions';
import {
  issueOwnerCotiMetaMaskCapability,
  type OwnerCotiMetaMaskOnboardInfoCommitter
} from './ownerCotiMetaMaskCapability';
import type { BrowserWalletSignerLease } from './hooks/useWalletOnboarding';

export type IssueDirectTradeV2MetaMaskCapabilityArgs = Readonly<{
  assertLeaseCurrent: (lease: BrowserWalletSignerLease) => Promise<void>;
  assertLeaseSnapshotCurrent: (lease: BrowserWalletSignerLease) => void;
  commitOnboardInfo?: OwnerCotiMetaMaskOnboardInfoCommitter;
  expectedChainId: bigint;
  expectedOwnerAddress: string;
  lease: BrowserWalletSignerLease;
  requirePrivacy: boolean;
  sessionOnboardInfo?: Readonly<Record<string, OnboardInfo>>;
}>;

/** Inactive until the exact Direct Trade V2 deployment is attested and activated. */
export const issueDirectTradeV2MetaMaskCapability = (
  args: IssueDirectTradeV2MetaMaskCapabilityArgs
): Promise<DirectTradeV2MetaMaskCapability> => issueOwnerCotiMetaMaskCapability({
  ...args,
  capabilityLabel: 'Direct Trade V2',
  bindCapability: bindDirectTradeV2MetaMaskCapability
});
