import { describe, expect, it } from 'vitest';
import { preparePrivateBookV2CreateTerms, preparePrivateBookV2FillTerms, privateBookV2Uint, PRIVATE_BOOK_V2_AMOUNT_MAX, normalizePrivateBookV2RecoveryAction, privateBookV2RecoveryActionNeedsPrivacy } from './privateBookV2Terms';

describe('private Book persisted action boundary', () => {
  const create = () => ({ kind: 'create', offerAsset: { assetType: 'private-erc20', token: `0x${'AB'.repeat(20)}`, amount: 10n },
    requestAsset: { assetType: 'erc20', token: `0x${'CD'.repeat(20)}` }, priceTerms: { offerAmount: 6n, requestAmount: 4 }, expiresAt: '0' });
  it.each([true, false])('normalizes budget visibility %s without budget material', visible => {
    const normalized = normalizePrivateBookV2RecoveryAction({ kind: 'budget-visibility', orderId: 7n, expectedRevision: 2, visible });
    expect(normalized).toEqual({ kind: 'budget-visibility', orderId: '7', expectedRevision: '2', visible });
    expect(privateBookV2RecoveryActionNeedsPrivacy(normalized)).toBe(visible);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(normalizePrivateBookV2RecoveryAction(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
  });
  it('rejects visibility coercion, invalid identity and any saved original budget', () => {
    const action = { kind: 'budget-visibility', orderId: '7', expectedRevision: '2', visible: true };
    for (const visible of [undefined, null, 1, 0, 'true', 'false']) {
      expect(() => normalizePrivateBookV2RecoveryAction({ ...action, visible })).toThrow();
    }
    for (const [field, value] of [['orderId', '0'], ['expectedRevision', 1n << 64n], ['expectedRevision', '01']]) {
      expect(() => normalizePrivateBookV2RecoveryAction({ ...action, [field as string]: value })).toThrow();
    }
    for (const field of ['budget', 'originalBudget', 'totalOfferAmount', 'offerBudget', 'signature', 'ciphertextHigh']) {
      expect(() => normalizePrivateBookV2RecoveryAction({ ...action, [field]: '123456789' })).toThrow();
    }
  });
  it('roundtrips each supported action and each fill mode as normalized JSON', () => {
    const priceTerms = { offerAmount: '3', requestAmount: '2' };
    const actions = [create(), { ...create(), kind: 'replace', originalOrderId: 7n },
      ...[{ mode: 'private-pair', maxRequestAmount: 20n },
        { mode: 'private-offer-public-request', publicRequestAmount: 20 },
        { mode: 'public-offer-private-request', publicOfferAmount: '10', maxPrivateRequestAmount: '20' }].map(terms =>
        ({ kind: 'fill', orderId: '7', expectedRevision: 2n, terms: { ...terms, fillBehavior: 'remaining-at-reviewed-price', priceTerms } })),
      { kind: 'cancel', orderId: 7 }, { kind: 'reclaim-expired', orderId: 7n }, { kind: 'withdraw-native-credit' }];
    for (const action of actions) {
      const normalized = normalizePrivateBookV2RecoveryAction(action);
      expect(normalizePrivateBookV2RecoveryAction(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
      expect(Object.isFrozen(normalized)).toBe(true);
    }
    expect(normalizePrivateBookV2RecoveryAction(create())).toEqual({ kind: 'create',
      offerAsset: { assetType: 'private-erc20', token: `0x${'ab'.repeat(20)}`, amount: '10' },
      requestAsset: { assetType: 'erc20', token: `0x${'cd'.repeat(20)}` }, priceTerms, expiresAt: '0' });
    expect(privateBookV2RecoveryActionNeedsPrivacy(normalizePrivateBookV2RecoveryAction(create()))).toBe(true);
    expect(privateBookV2RecoveryActionNeedsPrivacy(normalizePrivateBookV2RecoveryAction({ ...create(), offerAsset: { assetType: 'native', amount: 10 }, requestAsset: { assetType: 'private-erc20', token: `0x${'cd'.repeat(20)}` } }))).toBe(false);
    expect(privateBookV2RecoveryActionNeedsPrivacy(normalizePrivateBookV2RecoveryAction(actions[2]))).toBe(true);
    expect(privateBookV2RecoveryActionNeedsPrivacy(normalizePrivateBookV2RecoveryAction(actions[actions.length - 1]))).toBe(false);
  });
  it('rejects unknown kinds and extra fields at every stored boundary', () => {
    for (const key of ['privateKey', 'aesKey', 'signature', 'encryptedOfferBudget', 'onSubmitted']) {
      expect(() => normalizePrivateBookV2RecoveryAction({ ...create(), [key]: 'secret' })).toThrow();
      expect(() => normalizePrivateBookV2RecoveryAction({ ...create(), offerAsset: { ...create().offerAsset, [key]: 'secret' } })).toThrow();
      expect(() => normalizePrivateBookV2RecoveryAction({ ...create(), priceTerms: { ...create().priceTerms, [key]: 'secret' } })).toThrow();
      expect(() => normalizePrivateBookV2RecoveryAction({ kind: 'fill', orderId: '7', expectedRevision: '2', terms: { mode: 'private-pair', fillBehavior: 'remaining-at-reviewed-price', maxRequestAmount: '20', priceTerms: create().priceTerms, [key]: 'secret' } })).toThrow();
    }
    expect(() => normalizePrivateBookV2RecoveryAction({ kind: 'set-budget-visibility', orderId: '7' })).toThrow();
    expect(() => normalizePrivateBookV2RecoveryAction({ kind: 'withdraw-native-credit', orderId: '7' })).toThrow();
    expect(() => normalizePrivateBookV2RecoveryAction({ kind: 'cancel', orderId: '7', [Symbol('key')]: 'secret' })).toThrow();
    let read = false;
    expect(() => normalizePrivateBookV2RecoveryAction({ get kind() { read = true; return 'withdraw-native-credit'; } })).toThrow();
    expect(read).toBe(false);
  });
  it('rejects malformed addresses, unsafe values, overflow and invalid existing terms', () => {
    for (const token of ['0x1234', `0x${'00'.repeat(20)}`, 'example.eth']) {
      expect(() => normalizePrivateBookV2RecoveryAction({ ...create(), offerAsset: { ...create().offerAsset, token } })).toThrow();
    }
    for (const amount of [Number.MAX_SAFE_INTEGER + 1, '01', -1n, 0n, PRIVATE_BOOK_V2_AMOUNT_MAX + 1n]) {
      expect(() => normalizePrivateBookV2RecoveryAction({ ...create(), offerAsset: { ...create().offerAsset, amount } })).toThrow();
    }
    expect(() => normalizePrivateBookV2RecoveryAction({ ...create(), expiresAt: 1n << 64n })).toThrow();
    expect(() => normalizePrivateBookV2RecoveryAction({ kind: 'cancel', orderId: '0' })).toThrow();
    expect(() => normalizePrivateBookV2RecoveryAction({ kind: 'fill', orderId: '7', expectedRevision: 1n << 64n, terms: {} })).toThrow();
    expect(() => normalizePrivateBookV2RecoveryAction({ ...create(), priceTerms: { offerAmount: 0, requestAmount: 1 } })).toThrow();
    expect(() => normalizePrivateBookV2RecoveryAction({ ...create(), offerAsset: { assetType: 'erc20', token: `0x${'ab'.repeat(20)}`, amount: '10' } })).toThrow();
  });
  it('copies and freezes nested values before the caller can change them', () => {
    const input = create(); const normalized = normalizePrivateBookV2RecoveryAction(input);
    input.offerAsset.amount = 99n; input.priceTerms.offerAmount = 100n;
    expect(normalized).toMatchObject({ offerAsset: { amount: '10' }, priceTerms: { offerAmount: '3', requestAmount: '2' } });
    if (normalized.kind !== 'create') throw new Error('Expected create.');
    expect(Object.isFrozen(normalized.offerAsset)).toBe(true);
    expect(Object.isFrozen(normalized.requestAsset)).toBe(true);
    expect(Object.isFrozen(normalized.priceTerms)).toBe(true);
  });
});

describe('promoted private book terms', () => {
  it('keeps the public price independent of the private budget and rounds request up', () => {
    const input = { offerAssetType: 'private-erc20', requestAssetType: 'private-erc20', priceTerms: { offerAmount: 6n, requestAmount: 4n } } as const;
    const small = preparePrivateBookV2CreateTerms({ ...input, offerBudget: 10n });
    const large = preparePrivateBookV2CreateTerms({ ...input, offerBudget: 100n });
    expect(small.priceTerms).toEqual({ offerAmount: 3n, requestAmount: 2n });
    expect(large.priceTerms).toEqual(small.priceTerms);
    expect(small.totalRequestAmount).toBe(7n);
    expect(small.privateOfferBudget).toBe(10n);
    expect(small.publicOfferAmount).toBe(0n);
    expect(small.publicRequestAmount).toBe(0n);
  });
  it('exposes only the public offer budget for the public-offer hybrid', () => {
    const result = preparePrivateBookV2CreateTerms({ offerAssetType: 'erc20', requestAssetType: 'private-erc20', offerBudget: 10n, priceTerms: { offerAmount: 1n, requestAmount: 2n } });
    expect(result).toMatchObject({ publicOfferAmount: 10n, publicRequestAmount: 0n, privateOfferBudget: 0n, privateInputCount: 0 });
  });
  it('uses the reserved-zero packing and encrypts zero for the public-request hybrid', () => {
    const common = { fillBehavior: 'remaining-at-reviewed-price', priceTerms: { offerAmount: 1n, requestAmount: 2n } } as const;
    expect(preparePrivateBookV2FillTerms({ ...common, mode: 'private-pair', maxRequestAmount: 20n }).privateFill).toBe(20n << 128n);
    expect(preparePrivateBookV2FillTerms({ ...common, mode: 'private-offer-public-request', publicRequestAmount: 20n })).toMatchObject({ privateFill: 0n, publicFillAmount: 20n, privateInputCount: 1 });
    expect(preparePrivateBookV2FillTerms({ ...common, mode: 'public-offer-private-request', publicOfferAmount: 10n, maxPrivateRequestAmount: 20n })).toMatchObject({ privateFill: 20n, publicFillAmount: 10n });
  });
  it('rejects unsupported protections rather than dropping them', () => {
    const input = { mode: 'private-pair', maxRequestAmount: 20n, priceTerms: { offerAmount: 1n, requestAmount: 2n }, fillBehavior: 'remaining-at-reviewed-price', minOfferAmount: 10n } as const;
    expect(() => preparePrivateBookV2FillTerms(input)).toThrow(/minimum output/);
    expect(() => preparePrivateBookV2FillTerms({ ...input, fillBehavior: undefined } as never)).toThrow(/must be reviewed/);
  });
  it.each([Number.MAX_SAFE_INTEGER + 1, -1, 1.1, '', '01', '0x10', ' 1', true, null])('rejects lossy or noncanonical integer %s', value => {
    expect(() => privateBookV2Uint(value, 'Amount')).toThrow();
  });
  it('rejects total request overflow and zero-output fill budgets', () => {
    expect(() => preparePrivateBookV2CreateTerms({ offerAssetType: 'private-erc20', requestAssetType: 'erc20', offerBudget: PRIVATE_BOOK_V2_AMOUNT_MAX, priceTerms: { offerAmount: 1n, requestAmount: 2n } })).toThrow(/range/);
    expect(() => preparePrivateBookV2FillTerms({ mode: 'private-pair', fillBehavior: 'remaining-at-reviewed-price', maxRequestAmount: 1n, priceTerms: { offerAmount: 1n, requestAmount: 2n } })).toThrow(/one offer unit/);
  });
});
