import { formatUnits } from '@coti-io/coti-ethers';
import { buildOtcV2ConfirmationDetails, type OtcV2ConfirmationDetails } from './otcV2Confirmation';
import { assertOtcV2ActionRuntime, type OtcV2ActionRuntime } from './otcV2ActionRuntime';
import { preparePrivateBookV2Intent, isPrivateBookV2RuntimeHash, type PrivateBookV2Action } from './privateBookV2Actions';
import { preparePrivateBookV2CreateTerms, preparePrivateBookV2FillTerms, normalizePrivateBookV2Price } from './privateBookV2Terms';
import type { RecurringTradeV2TokenMetadataResolver } from './recurringTradeV2Snapshot';
import { EMPTY_PRIVATE_UINT256_INPUT } from './privateUint256';
import { captureWalletActionIntent, readWalletActionIntent, type WalletActionIntent } from './walletActionIntent';

export type PrivateBookV2Review = Readonly<{ details: OtcV2ConfirmationDetails }>;
const REVIEWS = new WeakMap<object, Readonly<{ runtime: OtcV2ActionRuntime; intent: WalletActionIntent<PrivateBookV2Action> }>>();
const assertBook = (runtime: OtcV2ActionRuntime) => {
  assertOtcV2ActionRuntime(runtime);
  if (!runtime.isCurrent() || !runtime.privateBook || !isPrivateBookV2RuntimeHash(runtime.deployments['private-v2'].runtimeBytecodeHash)) throw new Error('The promoted private book runtime is not current.');
  return runtime.privateBook;
};
const token = (asset: { assetType: 'native' | 'erc20' | 'private-erc20'; token?: string }, resolver: RecurringTradeV2TokenMetadataResolver) => {
  const metadata = asset.assetType === 'native' ? { symbol: 'COTI', decimals: 18 } : resolver(asset.assetType, asset.token!);
  if (!metadata.symbol.trim() || !Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 255) throw new Error('Private book token metadata is invalid.');
  return { ...metadata, symbol: metadata.symbol.trim() };
};
const amount = (value: bigint, metadata: { symbol: string; decimals: number }) => `${formatUnits(value, metadata.decimals)} ${metadata.symbol}`;

/** Captures and validates the exact action before the shared confirmation UI receives its data. */
export const buildPrivateBookV2Review = async ({ runtime, action, resolveTokenMetadata }: {
  runtime: OtcV2ActionRuntime; action: PrivateBookV2Action; resolveTokenMetadata: RecurringTradeV2TokenMetadataResolver;
}): Promise<PrivateBookV2Review> => {
  const book = assertBook(runtime); const intent = captureWalletActionIntent(action); const bound = readWalletActionIntent(intent);
  const view = bound.kind === 'fill' || bound.kind === 'budget-visibility' ? await book.read(bound.orderId) : undefined;
  // Validation-only input; this ciphertext is never sent. The action adapter supplies native encryption.
  await preparePrivateBookV2Intent(bound, async () => EMPTY_PRIVATE_UINT256_INPUT, view);
  assertBook(runtime);
  const summaryRows = [{ label: 'Access', value: 'Public order book' }];
  const approvals: Array<{ kind: 'erc20' | 'private-erc20'; symbol: string }> = [];
  let privateInputs = 0;
  if (bound.kind === 'budget-visibility' && view) {
    if (view.maker !== book.ownerAddress.toLowerCase()) throw new Error('Only the maker can change budget visibility.');
    if (bound.visible) {
      const account = await book.readAccount(bound.orderId);
      if (account.orderId !== view.orderId || account.sequence !== view.revision || BigInt(account.totalOfferAmount) <= 0n ||
          BigInt(account.remainingOfferAmount) > BigInt(account.totalOfferAmount)) throw new Error('The original budget snapshot is stale or invalid.');
      summaryRows.push({ label: 'Publish original budget', value: amount(BigInt(account.totalOfferAmount), token(view.offerAsset, resolveTokenMetadata)) });
    } else summaryRows.push({ label: 'Action', value: 'Hide the current public budget' });
    summaryRows.push({ label: 'Disclosure', value: 'Published amounts remain in chain history. Hiding cannot erase earlier disclosure.' });
  } else if (bound.kind === 'create' || bound.kind === 'replace') {
    const terms = preparePrivateBookV2CreateTerms({ offerAssetType: bound.offerAsset.assetType, requestAssetType: bound.requestAsset.assetType, offerBudget: bound.offerAsset.amount, priceTerms: bound.priceTerms });
    const offer = token(bound.offerAsset, resolveTokenMetadata); const request = token(bound.requestAsset, resolveTokenMetadata);
    summaryRows.push({ label: 'Offer budget', value: amount(terms.offerBudget, offer) },
      { label: 'Public price', value: `${amount(terms.priceTerms.offerAmount, offer)} for ${amount(terms.priceTerms.requestAmount, request)}` },
      { label: 'Request at full budget', value: amount(terms.totalRequestAmount, request) },
      { label: 'Budget disclosure', value: bound.offerAsset.assetType === 'private-erc20' ? 'Private on-chain; visible to you' : 'Public offer amount on-chain' },
      { label: 'Payment rounding', value: 'Each fill rounds its payment up. Split fills can pay more than one full fill.' });
    if (bound.offerAsset.assetType !== 'native') approvals.push({ kind: bound.offerAsset.assetType, symbol: offer.symbol });
    privateInputs = terms.privateInputCount;
  } else if (bound.kind === 'fill' && view) {
    const terms = preparePrivateBookV2FillTerms(bound.terms); const price = normalizePrivateBookV2Price(view.priceTerms);
    const offer = token(view.offerAsset, resolveTokenMetadata); const request = token(view.requestAsset, resolveTokenMetadata);
    summaryRows.push({ label: 'Public price', value: `${amount(price.offerAmount, offer)} for ${amount(price.requestAmount, request)}` },
      { label: 'Maximum payment', value: amount(terms.approvalAmount, request) },
      { label: 'Output', value: 'Up to available inventory. No minimum output; an empty order returns zero.' },
      { label: 'Unused payment', value: 'Returned by escrow' },
      { label: 'Public amounts', value: view.offerAsset.assetType === 'private-erc20' && view.requestAsset.assetType === 'private-erc20' ? 'Price is public; token amounts stay private' : 'The public token leg is visible on-chain' });
    if (view.requestAsset.assetType !== 'native') approvals.push({ kind: view.requestAsset.assetType, symbol: request.symbol });
    privateInputs = 1;
  } else {
    summaryRows.push({ label: 'Action', value: bound.kind === 'withdraw-native-credit' ? 'Withdraw escrow credit' : bound.kind === 'cancel' ? 'Cancel order and return remaining offer' : 'Reclaim expired offer' });
  }
  const details = buildOtcV2ConfirmationDetails({ cotiPrivateInputCount: privateInputs, approvals, summaryRows });
  // Prevent confirmation-time changes to either rows or the captured action.
  for (const row of [...details.tradeSummary, ...details.confirmationStats]) Object.freeze(row);
  Object.freeze(details.tradeSummary); Object.freeze(details.confirmationStats);
  const review = Object.freeze({ details }); REVIEWS.set(review, Object.freeze({ runtime, intent })); return review;
};

export const executePrivateBookV2Review = async ({ runtime, review, confirm }: {
  runtime: OtcV2ActionRuntime; review: PrivateBookV2Review; confirm: (details: OtcV2ConfirmationDetails) => Promise<boolean>;
}) => {
  const bound = REVIEWS.get(review);
  if (!bound || bound.runtime !== runtime) throw new Error('Private book review belongs to another runtime or was not prepared locally.');
  assertBook(runtime);
  if (!await confirm(review.details)) return undefined;
  const book = assertBook(runtime);
  return book.execute(readWalletActionIntent(bound.intent));
};
