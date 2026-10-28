import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPrivateBookV2Review, executePrivateBookV2Review } from './privateBookV2Review';
import type { OtcV2ActionRuntime } from './otcV2ActionRuntime';
import { PRIVATE_BOOK_V2_RUNTIME_HASH, type PrivateBookV2Action, type PrivateBookV2OrderView } from './privateBookV2Actions';

vi.mock('./otcV2ActionRuntime', () => ({ assertOtcV2ActionRuntime: (value: OtcV2ActionRuntime) => value }));
const address = (byte: string) => `0x${byte.repeat(20)}`;
const view: PrivateBookV2OrderView = { orderId: '1', maker: address('11'), status: 'open', mode: 'private-pair', offerAsset: { assetType: 'private-erc20', token: address('22'), publicAmount: '0' }, requestAsset: { assetType: 'private-erc20', token: address('33'), publicAmount: '0' }, priceTerms: { offerAmount: '1', requestAmount: '2' }, revision: '1', fillCount: '0', fillPolicy: { partialFillsAllowed: false, minPartialFillBps: '0', maxFills: '0' }, createdAt: '1', expiresAt: '0', rootOrderId: '1', replacementOrderId: '0', replacesOrderId: '0', offerLocked: true, offerTokenCodeHash: `0x${'11'.repeat(32)}`, requestTokenCodeHash: `0x${'22'.repeat(32)}`, pairKey: `0x${'33'.repeat(32)}` };
const metadata = () => ({ symbol: 'TOKEN', decimals: 0 });
const create = (): Extract<PrivateBookV2Action, { kind: 'create' }> => ({ kind: 'create', offerAsset: { assetType: 'private-erc20', token: address('22'), amount: 10n }, requestAsset: { assetType: 'private-erc20', token: address('33') }, priceTerms: { offerAmount: 1n, requestAmount: 2n }, expiresAt: 0n });
const fill = (): Extract<PrivateBookV2Action, { kind: 'fill' }> => ({ kind: 'fill', orderId: 1n, expectedRevision: 1n, terms: { mode: 'private-pair', maxRequestAmount: 20n, fillBehavior: 'remaining-at-reviewed-price', priceTerms: { offerAmount: 1n, requestAmount: 2n } } });
let alive = true;
const execute = vi.fn();
const read = vi.fn(async () => view);
const readAccount = vi.fn(async () => ({ orderId: '1', sequence: '1', totalOfferAmount: '10', totalRequestAmount: '20', remainingOfferAmount: '4' }));
const runtime = (): OtcV2ActionRuntime => ({ isCurrent: () => alive, deployments: { 'private-v2': { contractAddress: address('44'), runtimeBytecodeHash: PRIVATE_BOOK_V2_RUNTIME_HASH } }, privateBook: { ownerAddress: address('11'), execute, read, readAccount } } as unknown as OtcV2ActionRuntime);
beforeEach(() => { alive = true; vi.clearAllMocks(); read.mockResolvedValue(view); execute.mockResolvedValue({ action: 'create', transactionHash: 'test' }); });

describe('private book review and exact execution (runtime admission mocked)', () => {
  it('reviews the original budget, with irreversible-history disclosure, and does not execute automatically', async () => {
    const review = await buildPrivateBookV2Review({ runtime: runtime(), action: { kind: 'budget-visibility', orderId: '1', expectedRevision: '1', visible: true }, resolveTokenMetadata: metadata });
    expect(review.details.tradeSummary).toContainEqual({ label: 'Publish original budget', value: '10 TOKEN' });
    expect(review.details.tradeSummary.find(row => row.label === 'Disclosure')?.value).toMatch(/cannot erase/i);
    expect(JSON.stringify(review.details)).not.toContain('4 TOKEN'); expect(execute).not.toHaveBeenCalled();
  });
  it('does not request private amounts when hiding a published budget', async () => {
    const review = await buildPrivateBookV2Review({ runtime: runtime(), action: { kind: 'budget-visibility', orderId: '1', expectedRevision: '1', visible: false }, resolveTokenMetadata: metadata });
    expect(readAccount).not.toHaveBeenCalled();
    expect(review.details.tradeSummary.find(row => row.label === 'Action')?.value).toMatch(/Hide/);
  });
  it('shows public price, private budget, exact input count and rounding without publishing terms', async () => {
    const r = runtime(); const review = await buildPrivateBookV2Review({ runtime: r, action: create(), resolveTokenMetadata: metadata });
    expect(review.details.tradeSummary).toContainEqual({ label: 'Offer budget', value: '10 TOKEN' });
    expect(review.details.tradeSummary).toContainEqual({ label: 'Public price', value: '1 TOKEN for 2 TOKEN' });
    expect(review.details.tradeSummary).toContainEqual({ label: 'Budget disclosure', value: 'Private on-chain; visible to you' });
    expect(review.details.confirmationStats).toContainEqual({ label: 'COTI private inputs', value: '1 confirmation' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('states public-offer disclosure and skips its ignored private create input', async () => {
    const action = { ...create(), offerAsset: { assetType: 'erc20', token: address('22'), amount: 10n } } as const;
    const review = await buildPrivateBookV2Review({ runtime: runtime(), action, resolveTokenMetadata: metadata });
    expect(review.details.tradeSummary).toContainEqual({ label: 'Budget disclosure', value: 'Public offer amount on-chain' });
    expect(review.details.confirmationStats).toContainEqual({ label: 'COTI private inputs', value: '0 confirmations' });
  });
  it('reviews current price and maximum payment and discloses zero-output/clipping', async () => {
    const review = await buildPrivateBookV2Review({ runtime: runtime(), action: fill(), resolveTokenMetadata: metadata });
    expect(review.details.tradeSummary).toContainEqual({ label: 'Maximum payment', value: '20 TOKEN' });
    expect(review.details.tradeSummary.find(row => row.label === 'Output')?.value).toMatch(/No minimum output.*empty order returns zero/);
    expect(read).toHaveBeenCalledWith(1n);
  });
  it('preserves the exact captured action through confirmation and rejects structural/cross-runtime review', async () => {
    const r = runtime(); const mutable = create();
    const review = await buildPrivateBookV2Review({ runtime: r, action: mutable, resolveTokenMetadata: metadata });
    // The caller can still edit its original form object.
    (mutable.offerAsset as { amount: bigint }).amount = 99n;
    await executePrivateBookV2Review({ runtime: r, review, confirm: async details => { expect(Object.isFrozen(details.tradeSummary)).toBe(true); return true; } });
    expect(execute.mock.calls[0][0].offerAsset.amount).toBe(10n);
    await expect(executePrivateBookV2Review({ runtime: runtime(), review, confirm: async () => true })).rejects.toThrow(/another runtime/);
    await expect(executePrivateBookV2Review({ runtime: r, review: { details: review.details }, confirm: async () => true })).rejects.toThrow(/not prepared locally/);
  });
  it('does not execute declined confirmation or a review whose runtime closes during confirmation', async () => {
    const r = runtime(); const review = await buildPrivateBookV2Review({ runtime: r, action: create(), resolveTokenMetadata: metadata });
    await expect(executePrivateBookV2Review({ runtime: r, review, confirm: async () => false })).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    await expect(executePrivateBookV2Review({ runtime: r, review, confirm: async () => { alive = false; return true; } })).rejects.toThrow(/not current/);
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects stale price/revision and old minimum-output fields before confirmation', async () => {
    const action = fill();
    await expect(buildPrivateBookV2Review({ runtime: runtime(), action: { ...action, expectedRevision: 2n }, resolveTokenMetadata: metadata })).rejects.toThrow(/stale/);
    await expect(buildPrivateBookV2Review({ runtime: runtime(), action: { ...action, terms: { ...action.terms, priceTerms: { offerAmount: 1n, requestAmount: 3n } } }, resolveTokenMetadata: metadata })).rejects.toThrow(/price differs/);
    await expect(buildPrivateBookV2Review({ runtime: runtime(), action: { ...action, terms: { ...action.terms, minOfferAmount: 1n } } as never, resolveTokenMetadata: metadata })).rejects.toThrow(/minimum output/);
    expect(execute).not.toHaveBeenCalled();
  });
});
