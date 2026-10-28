import type { OnboardInfo } from '@coti-io/coti-ethers';
import {
  bindPrivateLiquidityMetaMaskCapability,
  type PrivateLiquidityMetaMaskCapability
} from '../../lib/privateLiquidityActions';
import {
  issueOwnerCotiMetaMaskCapability,
  type OwnerCotiMetaMaskOnboardInfoCommitter
} from './ownerCotiMetaMaskCapability';
import type { BrowserWalletSignerLease } from './hooks/useWalletOnboarding';

export type PrivateLiquidityMetaMaskCapabilityOnboardInfoCommitter =
  OwnerCotiMetaMaskOnboardInfoCommitter;

export type IssuePrivateLiquidityMetaMaskCapabilityArgs = Readonly<{
  assertLeaseCurrent: (lease: BrowserWalletSignerLease) => Promise<void>;
  assertLeaseSnapshotCurrent: (lease: BrowserWalletSignerLease) => void;
  commitOnboardInfo?: PrivateLiquidityMetaMaskCapabilityOnboardInfoCommitter;
  expectedChainId: bigint;
  expectedOwnerAddress: string;
  lease: BrowserWalletSignerLease;
  refreshPrivacy?: boolean;
  requirePrivacy: boolean;
  sessionOnboardInfo?: Readonly<Record<string, OnboardInfo>>;
}>;

/** Inactive until a reviewed private-liquidity deployment manifest is activated. */
export const issuePrivateLiquidityMetaMaskCapability = (
  args: IssuePrivateLiquidityMetaMaskCapabilityArgs
): Promise<PrivateLiquidityMetaMaskCapability> => issueOwnerCotiMetaMaskCapability({
  ...args,
  capabilityLabel: 'Private Liquidity V1',
  bindCapability: bindPrivateLiquidityMetaMaskCapability
});
