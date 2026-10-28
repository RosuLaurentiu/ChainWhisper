import { AbiCoder, getAddress, keccak256 } from 'ethers';

export const PRIVATE_LIQUIDITY_V1_MAX_SWAP_POSITIONS = 8;

export type PrivateLiquidityDirection = 'base-to-quote' | 'quote-to-base';
export type PrivateLiquidityPositionStatus = 'active' | 'paused' | 'closed';

export type PrivateLiquiditySideTerms = Readonly<{
  baseAmount: string;
  quoteAmount: string;
}>;

export type PrivateLiquidityPositionIdentity = Readonly<{
  chainId: string;
  contractAddress: string;
  positionId: string;
}>;

export type PrivateLiquidityPosition = Readonly<{
  identity: PrivateLiquidityPositionIdentity;
  owner: string;
  pairKey: string;
  baseToken: string;
  quoteToken: string;
  buyTerms: PrivateLiquiditySideTerms;
  sellTerms: PrivateLiquiditySideTerms;
  status: PrivateLiquidityPositionStatus;
  revision: string;
  buySideAvailable: boolean;
  sellSideAvailable: boolean;
  privacyOwner: string | null;
  createdAt: string;
  lastActivityBlock: string;
}>;

const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/;

export const parsePrivateLiquidityUint = (value: string, label: string): bigint => {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical unsigned decimal string.`);
  }
  return BigInt(value);
};

export const normalizePrivateLiquidityAddress = (value: string, label: string): string => {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} must be a valid EVM address.`);
  }
};

export const buildPrivateLiquidityPairKey = (baseToken: string, quoteToken: string): string => {
  const base = normalizePrivateLiquidityAddress(baseToken, 'Base token');
  const quote = normalizePrivateLiquidityAddress(quoteToken, 'Quote token');
  if (BigInt(base) >= BigInt(quote)) {
    throw new Error('Private-liquidity pairs must use canonical ascending token order.');
  }
  return keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address'], [base, quote]));
};

export const buildPrivateLiquidityPositionKey = (
  identity: PrivateLiquidityPositionIdentity
): string => {
  const chainId = parsePrivateLiquidityUint(identity.chainId, 'Chain ID');
  const positionId = parsePrivateLiquidityUint(identity.positionId, 'Position ID');
  if (chainId <= 0n || positionId <= 0n) {
    throw new Error('Private-liquidity chain and position IDs must be positive.');
  }
  const contractAddress = normalizePrivateLiquidityAddress(
    identity.contractAddress,
    'Private-liquidity contract'
  );
  return `private-liquidity-v1:${chainId}:${contractAddress}:${positionId}`;
};

export const validatePrivateLiquidityTerms = (
  terms: PrivateLiquiditySideTerms,
  label: string
): Readonly<{ baseAmount: bigint; quoteAmount: bigint }> => {
  const baseAmount = parsePrivateLiquidityUint(terms.baseAmount, `${label} base amount`);
  const quoteAmount = parsePrivateLiquidityUint(terms.quoteAmount, `${label} quote amount`);
  if (baseAmount <= 0n || quoteAmount <= 0n) {
    throw new Error(`${label} terms must be positive.`);
  }
  return Object.freeze({ baseAmount, quoteAmount });
};

export const validatePrivateLiquidityPosition = (
  position: PrivateLiquidityPosition
): PrivateLiquidityPosition => {
  buildPrivateLiquidityPositionKey(position.identity);
  const owner = normalizePrivateLiquidityAddress(position.owner, 'Position owner');
  const baseToken = normalizePrivateLiquidityAddress(position.baseToken, 'Base token');
  const quoteToken = normalizePrivateLiquidityAddress(position.quoteToken, 'Quote token');
  const pairKey = buildPrivateLiquidityPairKey(baseToken, quoteToken);
  if (position.pairKey.toLowerCase() !== pairKey.toLowerCase()) {
    throw new Error('Position pair key does not match its canonical tokens.');
  }
  validatePrivateLiquidityTerms(position.buyTerms, 'Buy');
  validatePrivateLiquidityTerms(position.sellTerms, 'Sell');
  const revision = parsePrivateLiquidityUint(position.revision, 'Position revision');
  parsePrivateLiquidityUint(position.createdAt, 'Position creation time');
  parsePrivateLiquidityUint(position.lastActivityBlock, 'Position activity block');
  if (revision <= 0n) {
    throw new Error('Position revision must be positive.');
  }
  if (position.privacyOwner !== null) {
    const privacyOwner = normalizePrivateLiquidityAddress(position.privacyOwner, 'Privacy owner');
    if (privacyOwner !== owner) {
      throw new Error('Position privacy owner must match the current NFT owner.');
    }
  }
  return position;
};

