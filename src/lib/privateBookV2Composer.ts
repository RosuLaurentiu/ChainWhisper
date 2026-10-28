import type { TradeAssetPayload, TradeSnapshot } from './appShared/core';
import type { OtcV2ActionRuntime } from './otcV2ActionRuntime';
import type { OtcV2ConfirmationDetails } from './otcV2Confirmation';
import { isPrivateBookV2RuntimeHash, type PrivateBookV2Action } from './privateBookV2Actions';
import { getPrivateBookV2Projection } from './privateBookV2Consumer';
import { buildPrivateBookV2Review, executePrivateBookV2Review } from './privateBookV2Review';
import { normalizePrivateBookV2Price, preparePrivateBookV2CreateTerms } from './privateBookV2Terms';
import { projectPrivateBookV2Snapshot } from './oneOffTradeV2Snapshot';

type Token = Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol' | 'decimals'>;
type CreateAction = Extract<PrivateBookV2Action, { kind: 'create' | 'replace' }>;

/** A standard offer-token unit keeps a private budget out of the public price numerator. */
export const buildPrivateBookV2ComposerAction = ({ offerToken, requestToken, offerBudget, requestAtBudget, expiresAt, editingTrade, disclosePrivateBudget }: {
  offerToken: Token; requestToken: Token; offerBudget: bigint; requestAtBudget: bigint;
  expiresAt: number; editingTrade?: TradeSnapshot | null; disclosePrivateBudget: boolean;
}): CreateAction => {
  if (offerToken.kind === 'native' || requestToken.kind === 'native') throw new Error('This form supports ERC20 trades.');
  if (offerToken.kind === 'private-erc20' && disclosePrivateBudget) throw new Error('Create with a private budget, then choose Publish original budget in Manage offer.');
  if (!Number.isInteger(offerToken.decimals) || offerToken.decimals < 0 || offerToken.decimals > 38 || offerBudget <= 0n || requestAtBudget <= 0n) throw new Error('Private book creation terms are invalid.');
  const offerUnit = 10n ** BigInt(offerToken.decimals);
  const priceTerms = normalizePrivateBookV2Price({ offerAmount: offerUnit, requestAmount: (requestAtBudget * offerUnit + offerBudget - 1n) / offerBudget });
  preparePrivateBookV2CreateTerms({ offerAssetType: offerToken.kind, requestAssetType: requestToken.kind, offerBudget, priceTerms });
  const common = { offerAsset: Object.freeze({ assetType: offerToken.kind, token: offerToken.tokenAddress, amount: offerBudget }),
    requestAsset: Object.freeze({ assetType: requestToken.kind, token: requestToken.tokenAddress }), priceTerms, expiresAt };
  return Object.freeze(editingTrade ? { ...common, kind: 'replace', originalOrderId: editingTrade.tradeId } : { ...common, kind: 'create' });
};

/** Confirmed custody is kept separate from a later display-read failure. Never fabricate capacity. */
export const executePrivateBookV2Composer = async ({ runtime, action, offerToken, requestToken, walletAddress, editingTrade, confirm }: {
  runtime: OtcV2ActionRuntime; action: CreateAction; offerToken: Token; requestToken: Token; walletAddress: string;
  editingTrade?: TradeSnapshot | null; confirm: (details: OtcV2ConfirmationDetails) => Promise<boolean>;
}) => {
  const deployment = runtime.deployments['private-v2'];
  if (!runtime.isCurrent() || !runtime.privateBook || !isPrivateBookV2RuntimeHash(deployment.runtimeBytecodeHash)) throw new Error('Refresh the promoted private book runtime before creating.');
  const resolveTokenMetadata = (kind: 'erc20' | 'private-erc20', address: string) => {
    const token = [offerToken, requestToken].find(value => value.kind === kind && value.tokenAddress?.toLowerCase() === address.toLowerCase());
    if (!token) throw new Error('Private book token metadata does not match the reviewed pair.');
    return { symbol: token.symbol, decimals: token.decimals };
  };
  if (action.kind === 'replace') {
    const book = editingTrade && getPrivateBookV2Projection(editingTrade);
    if (!book || !editingTrade?.v2 || editingTrade.tradeId !== Number(action.originalOrderId) || editingTrade.maker.toLowerCase() !== walletAddress.toLowerCase() || editingTrade.status !== 'open' ||
        editingTrade.v2.chainId !== deployment.chainId || editingTrade.v2.contractAddress.toLowerCase() !== deployment.contractAddress.toLowerCase() || editingTrade.escrowContract?.toLowerCase() !== deployment.contractAddress.toLowerCase()) throw new Error('This edit does not match your current private book order.');
    const current = await runtime.privateBook.read(action.originalOrderId);
    if (current.orderId !== String(action.originalOrderId) || current.maker.toLowerCase() !== walletAddress.toLowerCase() || current.status !== 'open' || current.fillCount !== '0' || current.revision !== editingTrade.v2.revision) throw new Error('Refresh the open, unfilled private book order before editing.');
  }
  const review = await buildPrivateBookV2Review({ runtime, action, resolveTokenMetadata });
  const confirmed = await executePrivateBookV2Review({ runtime, review, confirm });
  if (!confirmed) return undefined;
  const tradeId = Number(confirmed.orderId);
  if (!Number.isSafeInteger(tradeId) || tradeId <= 0) throw new Error('The confirmed private book order ID is invalid.');
  const result = { tradeId, escrowContract: deployment.contractAddress, txHash: confirmed.transactionHash };
  try {
    if (!runtime.isCurrent()) throw new Error('The wallet session changed after confirmation.');
    const view = await runtime.privateBook.read(confirmed.orderId!);
    if (!runtime.isCurrent() || view.orderId !== String(tradeId) || view.maker.toLowerCase() !== walletAddress.toLowerCase()) throw new Error('The confirmed order display does not match its maker or ID.');
    const snapshot = projectPrivateBookV2Snapshot({ view, deployment, resolveTokenMetadata, viewer: walletAddress });
    return { ...result, snapshot, refreshError: undefined };
  } catch {
    return { ...result, snapshot: undefined, refreshError: 'Trade confirmed. Its display is pending a refresh. Keep the order ID; do not create it again.' };
  }
};
