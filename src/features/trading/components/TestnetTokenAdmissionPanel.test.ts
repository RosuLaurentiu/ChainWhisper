import { describe, expect, it } from 'vitest';
import type { TestnetTokenAdmissionState } from '../../../lib/chainWhisperTestnetTokenAdmission';
import {
  getTestnetTokenAuthorizationFailureMessage,
  isTestnetTokenAuthorizationApplied
} from './TestnetTokenAdmissionPanel';

const state = (approved: boolean): TestnetTokenAdmissionState => Object.freeze({
  complete: approved ? 1 : 0,
  total: 1,
  next: null,
  operations: Object.freeze([Object.freeze({
    approved,
    getter: 'approvedTokenCodeHash',
    id: 'standard:publicBase',
    setter: 'setTokenApproval',
    targetAddress: `0x${'11'.repeat(20)}`,
    targetKey: 'standard',
    targetLabel: 'Standard OTC',
    tokenAddress: `0x${'22'.repeat(20)}`,
    tokenKey: 'publicBase',
    tokenLabel: 'cwTUB'
  })])
});

describe('TestnetTokenAdmissionPanel helpers', () => {
  it('recognizes a transaction that completed before a post-confirmation read error', () => {
    expect(isTestnetTokenAuthorizationApplied(state(true), 'standard:publicBase')).toBe(true);
    expect(isTestnetTokenAuthorizationApplied(state(false), 'standard:publicBase')).toBe(false);
  });

  it('preserves safe wallet rejection and RPC recovery guidance', () => {
    expect(getTestnetTokenAuthorizationFailureMessage({ code: 4001, message: 'User rejected' })).toBe(
      'The wallet request was rejected. No order or token transfer was submitted; you can safely retry this step.'
    );
    expect(getTestnetTokenAuthorizationFailureMessage({
      code: -32603,
      data: { cause: { message: 'Failed to fetch' } },
      message: 'could not coalesce error'
    })).toContain('MetaMask lost its RPC connection.');
  });
});
