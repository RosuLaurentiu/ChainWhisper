import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { buildCurrentDexQuoteReview, CurrentDexQuoteProtectionError, CURRENT_DEX_ACCEPT_ABI, prepareCurrentDexAcceptance } from './currentDexQuoteReview';

const address = `0x${'11'.repeat(20)}`, hash = `0x${'22'.repeat(32)}`;
const fixture = () => {
  const intent = { chainId: 7082400n, core: address, principal: address, runtimeHash: hash, releaseId: hash,
    operationId: 7n, contextHash: hash, deadline: 100n, maximumInput: 500n, minimumOutput: 300n,
    rateNumerator: 3n, rateDenominator: 4n };
  const receipt = { chainId: intent.chainId, core: address, principal: address, runtimeHash: hash, releaseId: hash,
    operationId: 7n, block: { number: 50n, hash, timestamp: 90n }, kind: 'quote' as const,
    operation: { phase: 'quote-prepared' as const, status: 2, releaseReason: 0, quotePrepared: true, funded: false,
      contextHash: hash, deadline: 100n, epochId: 1n, fixedCursor: 8n, stageRevision: 30n },
    amounts: { filled: true, maximumInput: 500n, actualInput: 400n, refund: 100n, grossOutput: 303n, fee: 3n, netOutput: 300n } };
  return { receipt, intent, now: 99n, input: { symbol: 'IN', decimals: 6 }, output: { symbol: 'OUT', decimals: 18 } };
};

describe('current DEX quote review', () => {
  it('shows authenticated rejected amounts without issuing acceptance or asking to confirm', async () => {
    const f = fixture();
    f.intent.minimumOutput = 301n;
    const confirm = vi.fn(async () => true);
    try { buildCurrentDexQuoteReview(f); expect.fail('Protection failure must throw'); }
    catch (error) {
      expect(error).toBeInstanceOf(CurrentDexQuoteProtectionError);
      const review = (error as CurrentDexQuoteProtectionError).review;
      expect(review.primaryLabel).toBe('Close');
      expect(review.secondaryLabel).toBeNull();
      expect(review.summaryRows.map(row => row.label)).toEqual(['You pay', 'You receive', 'Average price']);
      expect(review.message).toContain('Below your minimum output');
    }
    await expect(prepareCurrentDexAcceptance({ ...f, now: () => f.now,
      readReceipt: async () => f.receipt, confirm })).rejects.toBeInstanceOf(CurrentDexQuoteProtectionError);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('does not invent a price for a valid no-fill quote or expose invalid receipt amounts', () => {
    const f = fixture();
    f.receipt.amounts = { filled: false, maximumInput: 500n, actualInput: 0n, refund: 500n, grossOutput: 0n, fee: 0n, netOutput: 0n };
    try { buildCurrentDexQuoteReview(f); expect.fail('No fill cannot be accepted'); }
    catch (error) {
      expect(error).toBeInstanceOf(CurrentDexQuoteProtectionError);
      expect((error as CurrentDexQuoteProtectionError).review.summaryRows[2].value).toBe('Unavailable (no fill)');
    }
    f.receipt.amounts.refund--;
    try { buildCurrentDexQuoteReview(f); expect.fail('Bad accounting must throw'); }
    catch (error) { expect(error).not.toBeInstanceOf(CurrentDexQuoteProtectionError); }
  });
  const currentFixture = (profile: 'fast-pool' | 'cheap-async') => {
    const f = fixture();
    return { ...f, intent: { ...f.intent, profile, minimumInput: 400n },
      receipt: { ...f.receipt, operation: { profile, phase: 'quote-prepared' as const,
        ready: true, stage: profile === 'cheap-async' ? 4 : undefined, contextHash: hash, deadline: 100n } } };
  };

  it('reviews each current mode without legacy status and encodes its exact acceptance', async () => {
    for (const profile of ['fast-pool', 'cheap-async'] as const) {
      const f = currentFixture(profile), readReceipt = vi.fn(async () => structuredClone(f.receipt));
      const review = buildCurrentDexQuoteReview(f);
      expect(review.summaryRows).toHaveLength(3);
      expect(review.summaryRows).toContainEqual({ label: 'You pay', value: '0.0004 IN' });
      expect(review.stats).toEqual([]);
      expect(review.message).toBe('Expected amounts, after fees.');
      const result = await prepareCurrentDexAcceptance({ ...f, now: () => 99n, readReceipt, confirm: async () => true });
      expect(readReceipt).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ readyToSign: false, data: new Interface(CURRENT_DEX_ACCEPT_ABI)
        .encodeFunctionData(profile === 'fast-pool' ? 'acceptFastPoolV1' : 'acceptPrivateSwapV1', [7n, hash]) });
    }
  });

  it('rejects wrong current mode, missing fill protection, unavailable and changed receipts', async () => {
    for (const profile of ['fast-pool', 'cheap-async'] as const) {
      const changes: Array<(f: ReturnType<typeof currentFixture>) => void> = [
        f => { f.receipt.operation.profile = profile === 'fast-pool' ? 'cheap-async' : 'fast-pool'; },
        f => { f.receipt.operation.ready = false; },
        f => { f.intent.minimumInput = 401n; }, f => { f.intent.minimumInput = 501n; },
        f => { f.now = 100n; }, f => { f.receipt.amounts.refund--; },
        f => { f.receipt.amounts.netOutput--; }, f => { f.intent.minimumOutput++; },
        f => { f.intent.rateNumerator = 4n; }
      ];
      for (const change of changes) { const f = currentFixture(profile); change(f); expect(() => buildCurrentDexQuoteReview(f)).toThrow(); }
      const f = currentFixture(profile);
      expect(() => buildCurrentDexQuoteReview({ ...f, intent: { ...f.intent, minimumInput: undefined } })).toThrow('minimum fill');
      await expect(prepareCurrentDexAcceptance({ ...f, now: () => 99n, readReceipt: async () => f.receipt,
        confirm: async () => { f.receipt.amounts.grossOutput++; f.receipt.amounts.netOutput++; return true; } })).rejects.toThrow('changed during review');
    }
  });

  it('returns only unsigned bound calldata after confirmation and a second read; cancellation stops', async () => {
    for (const accepted of [false, true]) {
      const f = fixture(), readReceipt = vi.fn(async () => structuredClone(f.receipt));
      const confirm = vi.fn(async () => {
        // A caller changing its draft while the dialog is open cannot change this intent.
        f.intent.operationId = 8n;
        f.intent.contextHash = `0x${'33'.repeat(32)}`;
        f.intent.maximumInput = 600n;
        f.input.decimals = -1;
        return accepted;
      });
      const result = await prepareCurrentDexAcceptance({ ...f, now: () => 99n, readReceipt, confirm });
      expect(confirm).toHaveBeenCalledOnce();
      expect(readReceipt).toHaveBeenCalledTimes(accepted ? 2 : 1);
      if (!accepted) expect(result).toBeNull();
      else {
        expect(result).toEqual({ chainId: 7082400n, from: address, to: address, value: 0n,
          data: new Interface(CURRENT_DEX_ACCEPT_ABI).encodeFunctionData('acceptPrivateSwapV1', [7n, hash]),
          readyToSign: false, operationId: 7n, contextHash: hash, reviewedBlock: f.receipt.block });
        expect(Object.isFrozen(result)).toBe(true);
      }
    }
  });

  it('rejects changes during human review and does not trust a mutable receipt baseline', async () => {
    const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
      f => { f.now = 100n; }, f => { f.receipt.operation.funded = true; },
      f => { f.receipt.operation.contextHash = `0x${'33'.repeat(32)}`; },
      f => { f.receipt.amounts.grossOutput++; f.receipt.amounts.netOutput++; },
      f => { f.receipt.block.number--; }, f => { f.receipt.block.hash = `0x${'33'.repeat(32)}`; },
      f => { f.receipt.principal = `0x${'33'.repeat(20)}`; }
    ];
    for (const change of changes) {
      const f = fixture(), readReceipt = vi.fn(async () => f.receipt);
      await expect(prepareCurrentDexAcceptance({ ...f, now: () => f.now, readReceipt,
        confirm: async () => { change(f); return true; } })).rejects.toThrow();
      expect(readReceipt).toHaveBeenCalledTimes(2);
    }
    const f = fixture(), readReceipt = vi.fn().mockResolvedValueOnce(f.receipt).mockRejectedValueOnce(new Error('Session revoked'));
    await expect(prepareCurrentDexAcceptance({ ...f, now: () => 99n, readReceipt, confirm: async () => true })).rejects.toThrow('Session revoked');
  });

  it('shows only charged input, net output and average price for a partial fill', () => {
    const review = buildCurrentDexQuoteReview(fixture());
    expect(review.summaryRows).toEqual([
      { label: 'You pay', value: '0.0004 IN' },
      { label: 'You receive', value: '0.0000000000000003 OUT' },
      { label: 'Average price', value: '0.0 OUT per IN (rounded down)' }
    ]);
    expect(review.stats).toEqual([]);
    expect(review.fundingMoves).toEqual([]);
  });

  it('rejects stale, funded, wrong-identity and protection-violating reviews', () => {
    const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
      f => { f.now = 100n; }, f => { f.now = 89n; }, f => { f.receipt.operation.funded = true; },
      f => { f.receipt.operation.status = 3; }, f => { f.receipt.operation.quotePrepared = false; },
      f => { f.receipt.operation.contextHash = `0x${'33'.repeat(32)}`; }, f => { f.intent.chainId = 1n; },
      f => { f.intent.principal = `0x${'33'.repeat(20)}`; }, f => { f.intent.operationId = 8n; },
      f => { f.intent.runtimeHash = `0x${'33'.repeat(32)}`; }, f => { f.intent.minimumOutput = 301n; },
      f => { f.intent.rateNumerator = 4n; }, f => { f.intent.rateDenominator = 0n; },
      f => { f.receipt.amounts.refund = 99n; }, f => { f.receipt.amounts.grossOutput = 304n; },
      f => { f.receipt.amounts.filled = false; }, f => { f.intent.maximumInput = 501n; }
    ];
    for (const mutate of mutations) { const f = fixture(); mutate(f); expect(() => buildCurrentDexQuoteReview(f)).toThrow(); }
  });

  it('preserves uint256 values and compares price without floating-point rounding', () => {
    const f = fixture(), max = (1n << 256n) - 1n;
    f.intent.maximumInput = max; f.intent.minimumOutput = max; f.intent.rateNumerator = 1n; f.intent.rateDenominator = 1n;
    f.receipt.amounts = { filled: true, maximumInput: max, actualInput: max, refund: 0n, grossOutput: max, fee: 0n, netOutput: max };
    expect(() => buildCurrentDexQuoteReview(f)).not.toThrow();
    f.receipt.amounts.netOutput = max - 1n; f.receipt.amounts.grossOutput = max - 1n;
    f.intent.minimumOutput = 0n;
    expect(() => buildCurrentDexQuoteReview(f)).toThrow('protections');
  });
});
