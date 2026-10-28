import { describe, expect, it } from 'vitest';
import { CurrentSwapJourneyTiming, currentSwapTimingVisible } from './currentSwapJourneyTiming';

const identity = { candidate: 'test-candidate', core: 'public-core', graph: 'public-graph', profile: 'fast-pool' };
describe('session swap journey timing', () => {
  it.each(['fast-pool', 'cheap-async'])('keeps %s public readiness and mined funding separate from private display', profile => {
    let now = 0;
    const clock = new CurrentSwapJourneyTiming({}, { ...identity, profile }, () => now);
    now = 10; clock.quoteSubmitted('quote-tx'); clock.bindOperation('7');
    expect(clock.snapshot().quoteClickToPrivatePreviewDisplayedMs).toBeNull();
    now = 30; clock.previewDisplayed('7');
    now = 35; const accept = clock.acceptRequested();
    now = 55; clock.acceptDecision(accept, true);
    now = 60; clock.acceptSubmitted(accept, 'accept-tx');
    // Receipt/funding observation is not a terminal display milestone.
    now = 80;
    expect(clock.snapshot().quoteClickToVerifiedResultDisplayedMs).toBeNull();
    expect(clock.snapshot().acceptConfirmationToVerifiedResultDisplayedMs).toBeNull();
    now = 100; clock.deliveryDisplayed('7', 'accept-tx');
    expect(clock.snapshot()).toMatchObject({ operationId: '7', quoteTransactionHash: 'quote-tx', acceptTransactionHash: 'accept-tx',
      quoteClickToPrivatePreviewDisplayedMs: 30, acceptRequestToVerifiedResultDisplayedMs: 65,
      acceptConfirmationToVerifiedResultDisplayedMs: 45, quoteClickToVerifiedResultDisplayedMs: 100 });
    now = 200; clock.previewDisplayed('7'); clock.deliveryDisplayed('7', 'retry-tx');
    expect(clock.snapshot().quoteClickToVerifiedResultDisplayedMs).toBe(100);
    expect(clock.snapshot().terminalTransactionHash).toBe('accept-tx');
  });
  it('keeps cancelled review separate and uses the submitted retry', () => {
    let now = 0;
    const clock = new CurrentSwapJourneyTiming({}, identity, () => now);
    clock.bindOperation('7');
    now = 10; const cancelled = clock.acceptRequested();
    now = 20; clock.acceptDecision(cancelled, false); clock.acceptDecision(cancelled, true); clock.acceptSubmitted(cancelled, 'bad');
    expect(clock.snapshot().acceptTransactionHash).toBeNull();
    now = 40; const retry = clock.acceptRequested();
    now = 50; clock.acceptDecision(retry, true); clock.acceptSubmitted(retry, 'retry');
    now = 70; clock.deliveryDisplayed('7', 'retry');
    expect(clock.snapshot()).toMatchObject({ acceptTransactionHash: 'retry', acceptRequestToVerifiedResultDisplayedMs: 30,
      acceptAttempts: [{ cancelled: true, submitted: false, requestToConfirmationMs: null },
        { cancelled: false, submitted: true, requestToConfirmationMs: 10 }] });
  });
  it('does not correlate another operation, or restore clocks in a fresh session', () => {
    let now = 0;
    const scope = {}, clock = new CurrentSwapJourneyTiming(scope, identity, () => now);
    clock.bindOperation('7'); now = 10;
    expect(clock.previewDisplayed('8')).toBe(false);
    expect(clock.deliveryDisplayed('8', 'other')).toBe(false);
    expect(clock.snapshot().quoteClickToVerifiedResultDisplayedMs).toBeNull();
    const reset = new CurrentSwapJourneyTiming({}, identity, () => now);
    expect(reset.scope).not.toBe(scope);
    expect(reset.snapshot().operationId).toBeNull();
    expect(reset.snapshot().quoteClickToPrivatePreviewDisplayedMs).toBeNull();
  });
  it('measures observed setup and review waits without storing their private payload', async () => {
    let now = 0;
    const clock = new CurrentSwapJourneyTiming({}, identity, () => now);
    await clock.observeWait('setup', async () => { now = 10; return { privateAmount: 'SECRET' }; });
    await clock.observeWait('review', async () => { now = 30; return false; }, true);
    expect(clock.snapshot().waits).toEqual([{ kind: 'setup', elapsedMs: 10 }, { kind: 'review', elapsedMs: 20, confirmed: false }]);
    expect(JSON.stringify(clock.snapshot())).not.toContain('SECRET');
  });
  it('requires a connected visible view and document before a display milestone', () => {
    const element = { isConnected: true, closest: () => null } as unknown as HTMLElement;
    expect(currentSwapTimingVisible(element, true, true)).toBe(true);
    expect(currentSwapTimingVisible(element, false, true)).toBe(false);
    expect(currentSwapTimingVisible(element, true, false)).toBe(false);
    expect(currentSwapTimingVisible(null, true, true)).toBe(false);
    expect(currentSwapTimingVisible({ isConnected: false } as HTMLElement, true, true)).toBe(false);
    expect(currentSwapTimingVisible({ isConnected: true, closest: () => ({}) } as unknown as HTMLElement, true, true)).toBe(false);
  });
  it.each([() => { throw new Error('No clock'); }, () => Number.NaN, () => -1])('does not block actions when the diagnostic clock is unavailable', async now => {
    const clock = new CurrentSwapJourneyTiming({}, identity, now);
    clock.bindOperation('7'); clock.previewDisplayed('7');
    const attempt = clock.acceptRequested(); clock.acceptDecision(attempt, true); clock.acceptSubmitted(attempt, 'accept');
    await expect(clock.observeWait('setup', async () => 'ready')).resolves.toBe('ready');
    await expect(clock.observeWait('setup', async () => { throw new Error('Original failure'); })).rejects.toThrow('Original failure');
    clock.deliveryDisplayed('7', null);
    expect(clock.snapshot()).toMatchObject({ acceptTransactionHash: 'accept', terminalTransactionHash: null,
      quoteClickToPrivatePreviewDisplayedMs: null, acceptConfirmationToVerifiedResultDisplayedMs: null,
      quoteClickToVerifiedResultDisplayedMs: null, waits: [{ kind: 'setup', elapsedMs: null }, { kind: 'setup (failed)', elapsedMs: null }] });
  });
  it('does not report a backward clock or an unknown asynchronous terminal hash as measured', () => {
    let now = 10;
    const clock = new CurrentSwapJourneyTiming({}, identity, () => now);
    const attempt = clock.acceptRequested(); clock.acceptDecision(attempt, true); clock.acceptSubmitted(attempt, 'funding');
    now = 9; clock.deliveryDisplayed('7', null);
    expect(clock.snapshot()).toMatchObject({ acceptTransactionHash: 'funding', terminalTransactionHash: null,
      acceptConfirmationToVerifiedResultDisplayedMs: null, quoteClickToVerifiedResultDisplayedMs: null });
  });
});
