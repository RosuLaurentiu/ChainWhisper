import { getAddress } from '@coti-io/coti-ethers';

export type BrowserWalletRuntimeScopeSession = Readonly<{
  address: string;
  chainId: number | null;
  source?: string;
  walletId: string;
}>;

const normalizeAddress = (value: string): string | null => {
  try {
    return getAddress(value.trim()).toLowerCase();
  } catch {
    return null;
  }
};

export const buildBrowserOwnerDataScopeKey = (walletAddress: string): string =>
  normalizeAddress(walletAddress) ?? '';

export const buildBrowserWalletRuntimeScopeKey = ({
  activeSignerSource,
  deploymentFingerprint,
  expectedChainId,
  session,
  variant = 'default',
  walletAddress
}: {
  activeSignerSource: string | null | undefined;
  deploymentFingerprint: string;
  expectedChainId: bigint;
  session: BrowserWalletRuntimeScopeSession | null;
  variant?: string;
  walletAddress: string;
}): string | null => {
  const owner = normalizeAddress(walletAddress);
  const sessionOwner = session ? normalizeAddress(session.address) : null;
  const sessionChainId = session?.chainId;
  const fingerprint = deploymentFingerprint.trim();
  const walletId = session?.walletId.trim() ?? '';
  const source = session?.source?.trim() || 'injected';
  const scopeVariant = variant.trim();

  if (
    activeSignerSource !== 'metamask' ||
    !session ||
    !owner ||
    sessionOwner !== owner ||
    !Number.isSafeInteger(sessionChainId) ||
    Number(sessionChainId) <= 0 ||
    BigInt(sessionChainId as number) !== expectedChainId ||
    !fingerprint ||
    !walletId ||
    !scopeVariant
  ) {
    return null;
  }

  return [
    fingerprint,
    expectedChainId.toString(),
    owner,
    walletId,
    source,
    scopeVariant
  ].join(':');
};
