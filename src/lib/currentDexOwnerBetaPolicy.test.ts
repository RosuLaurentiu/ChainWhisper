import { describe, expect, it } from 'vitest';
import { CURRENT_OWNER_BETA, checkCurrentOwnerBetaWindow, assertCurrentOwnerBetaWindow, isCurrentOwnerBetaRecovery } from './currentDexOwnerBetaPolicy';

describe('owner-controlled Testnet App policy', () => {
  const window = { activatedAt: 2_000_000_000n, startingNonce: 220 };
  const check = (now = window.activatedAt, nonce = 220, recovery = false, gasCap = 110_000_000n, gasPrice = 50_000_000n) =>
    checkCurrentOwnerBetaWindow(window, now, nonce, recovery, gasCap, gasPrice);
  it('binds the approved activation and rejects a changed owner, chain or candidate', () => {
    const activation = CURRENT_OWNER_BETA.activation!;
    expect(Object.isFrozen(activation)).toBe(true);
    expect(activation.startingNonce).toBe(220);
    expect(activation.legacyReservationHash).toBe('0x8fc3d42c0f418a860455579df8cb8fde8bafc069e6065a35046713bedb5e4567');
    const admitted = (graph = CURRENT_OWNER_BETA.graph, owner = CURRENT_OWNER_BETA.owner, chain = 7082400n) =>
      assertCurrentOwnerBetaWindow(graph, owner, CURRENT_OWNER_BETA.core, chain, activation.activatedAt, 220, false, 110_000_000n, 50_000_000n);
    expect(() => admitted()).not.toThrow();
    expect(() => admitted('changed')).toThrow('inactive');
    expect(() => admitted(undefined, '0x0000000000000000000000000000000000000001')).toThrow('inactive');
    expect(() => admitted(undefined, undefined, 1n)).toThrow('inactive');
  });
  it('allows normal use and recovery after the old nonce and time limits', () => {
    expect(() => check()).not.toThrow();
    expect(() => check(window.activatedAt, 269)).not.toThrow();
    expect(() => check(window.activatedAt, 270)).not.toThrow();
    expect(() => check(window.activatedAt, 319, true)).not.toThrow();
    for (const recovery of [false,true]) expect(() => check(window.activatedAt + 10_000_000n, 10_000, recovery)).not.toThrow();
    for (const nonce of [219, NaN, Infinity, 220.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => check(window.activatedAt, nonce, true)).toThrow();
  });
  it('retains activation, transaction fit and signing-price checks', () => {
    expect(() => check(window.activatedAt - 1n)).toThrow();
    expect(() => check(window.activatedAt + 86400n)).not.toThrow();
    expect(() => check(window.activatedAt + 86400n, 270, true)).not.toThrow();
    expect(() => check(window.activatedAt + 604800n, 270, true)).not.toThrow();
    for (const cap of [0n, 110_000_001n]) expect(() => check(window.activatedAt, 220, false, cap)).toThrow();
    expect(() => check(window.activatedAt, 220, false, 110_000_000n, 50_000_001n)).toThrow();
  });
  it('keeps recovery action classification without restricting normal work', () => {
    for(const action of ['cancel','recover'])expect(isCurrentOwnerBetaRecovery('swap',action)).toBe(true);
    for(const action of ['quote','accept','approve','refill'])expect(isCurrentOwnerBetaRecovery('swap',action)).toBe(false);
    for(const action of ['snapshot','withdraw','close','clear-create','clear-top-up','allowance-cleanup'])expect(isCurrentOwnerBetaRecovery('pool',action)).toBe(true);
    for(const action of ['create','top-up','approve-create','activate','resume','transfer'])expect(isCurrentOwnerBetaRecovery('pool',action)).toBe(false);
    for(const action of ['snapshot','refresh','claim','close'])expect(isCurrentOwnerBetaRecovery('limit',action)).toBe(true);
    for(const action of ['create','topup','approve-topup','reprice','pause','resume'])expect(isCurrentOwnerBetaRecovery('limit',action)).toBe(false);
    for(const action of ['initial','refill'])expect(isCurrentOwnerBetaRecovery('funding',action)).toBe(false);
  });
});
