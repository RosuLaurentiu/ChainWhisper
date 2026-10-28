import { describe, expect, it } from 'vitest';
import { captureWalletActionIntent, readWalletActionIntent } from './walletActionIntent';

describe('wallet action intent', () => {
  it('captures and freezes nested plain data synchronously', () => {
    const action = { kind: 'create', amount: 1n, terms: { recipient: 'alice', parts: [1n, 2n] } };
    const intent = captureWalletActionIntent(action);

    action.kind = 'cancel';
    action.amount = 99n;
    action.terms.recipient = 'mallory';
    action.terms.parts[0] = 99n;

    expect(readWalletActionIntent(intent)).toEqual({
      kind: 'create',
      amount: 1n,
      terms: { recipient: 'alice', parts: [1n, 2n] }
    });
    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.action)).toBe(true);
    expect(Object.isFrozen(intent.action.terms)).toBe(true);
    expect(intent.intentId).toMatch(/^wallet-action-\d+$/);
  });

  it('rejects structural lookalikes and non-plain action data', () => {
    expect(() => readWalletActionIntent({ intentId: 'wallet-action-1', action: {} } as never))
      .toThrow(/captured by the active runtime/i);
    expect(() => captureWalletActionIntent({ value: new Date() }))
      .toThrow(/only plain data/i);
  });
});
