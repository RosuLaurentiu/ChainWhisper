import { formatUnits, parseUnits } from '@coti-io/coti-ethers';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE, currentCheapDexCandidateKey, type CurrentCheapDexIdentity } from './dexV2Deployment';
import { currentDexPendingStorage, readCurrentDexPendingAttempt, type CurrentDexRecordScope } from './currentDexPendingAttempt';

// Its token-funding admission requires 18 decimals before any funds can move.
export const CURRENT_DEX_TOKEN_DECIMALS = 18;
export const parseCurrentDexTokenAmount = (value: string, field: string, positive = false): bigint => {
  const input = value.trim();
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(input)) {
    throw new Error(`${field}: enter a token amount with at most 18 decimal places.`);
  }
  const amount = parseUnits(input, CURRENT_DEX_TOKEN_DECIMALS);
  if (amount >= 1n << 256n || (positive && amount === 0n)) throw new Error(`${field}: amount is outside the supported range.`);
  return amount;
};
export const formatCurrentDexTokenAmount = (amount: bigint): string => formatUnits(amount, CURRENT_DEX_TOKEN_DECIMALS);

export type CurrentDexDisplayToken = Readonly<{ address: string; label: string; decimals: number }>;
export type CurrentDexDisplayPair = Readonly<{
  marketId: string;
  tokens: readonly [CurrentDexDisplayToken, CurrentDexDisplayToken];
}>;

const preparedDisplay = (candidate: typeof STAGED_SHARED_HISTORY_DEX_CANDIDATE) => {
const tokens = Object.freeze(candidate.tokenMetadata.map(token =>
  Object.freeze({ address: token.address, label: token.symbol, decimals: token.decimals })));
const pairs = Object.freeze(candidate.pairs.map(pair => Object.freeze({
  marketId: pair.marketId,
  tokens: Object.freeze(pair.tokens.map(address => {
    const token = tokens.find(token => token.address === address);
    if (!token) throw new Error('Prepared DEX pair token metadata is absent.');
    return token;
  })) as readonly [CurrentDexDisplayToken, CurrentDexDisplayToken]
})));
return Object.freeze({ tokens, pairs });
};
// decision-034: one contract version. Display metadata does not grant signing or token-funding admission.
const HISTORY_DISPLAY = preparedDisplay(STAGED_SHARED_HISTORY_DEX_CANDIDATE);
const PRIMARY_PAIR = HISTORY_DISPLAY.pairs.find(pair => pair.marketId === STAGED_SHARED_HISTORY_DEX_CANDIDATE.marketId) ?? HISTORY_DISPLAY.pairs[0];
export const CURRENT_DEX_DISPLAY_TOKENS = HISTORY_DISPLAY.tokens;
export const CURRENT_DEX_DISPLAY_PAIR = Object.freeze([PRIMARY_PAIR.tokens[0].label, PRIMARY_PAIR.tokens[1].label] as const);
export const CURRENT_DEX_POOL_LABELS: readonly string[] = CURRENT_DEX_DISPLAY_PAIR;
export const currentDexTokenLabel = (address: string): string => {
  const token = CURRENT_DEX_DISPLAY_TOKENS.find(token => token.address.toLowerCase() === address.toLowerCase());
  if (!token) throw new Error('Token is outside the current DEX pair.');
  return token.label;
};

export const readCurrentDexDisplay = (identity: CurrentCheapDexIdentity): Readonly<{
  tokens: readonly CurrentDexDisplayToken[]; pairs: readonly CurrentDexDisplayPair[]
}> => {
  currentCheapDexCandidateKey(identity);
  return HISTORY_DISPLAY;
};

export const currentDexDisplayToken = (identity: CurrentCheapDexIdentity, address: string): CurrentDexDisplayToken => {
  const token = readCurrentDexDisplay(identity).tokens.find(token => token.address.toLowerCase() === address.toLowerCase());
  if (!token) throw new Error('Token is outside the selected DEX candidate.');
  return token;
};

export const currentDexDisplayPair = (
  identity: CurrentCheapDexIdentity, tokenIn: string, tokenOut: string
): CurrentDexDisplayPair & Readonly<{ tokenIn: CurrentDexDisplayToken; tokenOut: CurrentDexDisplayToken }> => {
  const input = currentDexDisplayToken(identity, tokenIn);
  const output = currentDexDisplayToken(identity, tokenOut);
  if (input.address === output.address) throw new Error('DEX pair tokens must be distinct.');
  const pair = readCurrentDexDisplay(identity).pairs.find(pair =>
    pair.tokens.some(token => token.address === input.address) && pair.tokens.some(token => token.address === output.address));
  if (!pair) throw new Error('Pair is outside the selected DEX candidate.');
  return Object.freeze({ ...pair, tokenIn: input, tokenOut: output });
};

export const parseDexCandidateTokenAmount = (
  identity: CurrentCheapDexIdentity, address: string, value: string, field: string, positive = false
): bigint => {
  const { decimals } = currentDexDisplayToken(identity, address);
  const input = value.trim();
  if (!new RegExp(`^(0|[1-9][0-9]*)(?:\\.[0-9]{1,${decimals}})?$`).test(input)) {
    throw new Error(`${field}: enter a token amount with at most ${decimals} decimal places.`);
  }
  const amount = parseUnits(input, decimals);
  if (amount >= 1n << 256n || (positive && amount === 0n)) throw new Error(`${field}: amount is outside the supported range.`);
  return amount;
};

export const formatDexCandidateTokenAmount = (identity: CurrentCheapDexIdentity, address: string, amount: bigint): string => {
  const { decimals } = currentDexDisplayToken(identity, address);
  if (amount < 0n || amount >= 1n << 256n) throw new Error('Token amount is outside the supported range.');
  return formatUnits(amount, decimals);
};

// A saved or unreadable attempt blocks a new action; only the existing recovery path can resolve it.
// decision-033: the wallet rejected the request and the chain nonce check proved that nothing was sent.
export const CURRENT_UNSENT_RELEASED_MESSAGE =
  'The wallet rejected this request. The chain shows that nothing was sent, and the saved action is released. You can start again.';
// decision-033 part B: saved DEX records are separate for each chain, candidate and wallet.
// No connected wallet means no record scope: nothing is read and nothing can be saved.
export const currentDexRecordScope = (candidate: { chainId: bigint | number | string; graph: string },
  owner: string | null | undefined): CurrentDexRecordScope | undefined =>
  owner && /^0x[0-9a-fA-F]{40}$/.test(owner) ? { chainId: candidate.chainId, graph: candidate.graph, owner } : undefined;
export const hasCurrentDexPendingAction = (scope?: CurrentDexRecordScope): boolean => {
  if (typeof window === 'undefined') return false;
  try { return Boolean(readCurrentDexPendingAttempt(currentDexPendingStorage(scope))); }
  catch { return true; }
};
