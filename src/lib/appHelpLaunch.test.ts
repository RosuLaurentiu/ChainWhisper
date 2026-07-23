import { describe, expect, it } from 'vitest';
import {
  getAppHelpReadinessTopicId,
  normalizeAppHelpLaunchContext
} from './appHelpLaunch';

describe('App Help launch context', () => {
  it('keeps only allowlisted launch fields', () => {
    expect(
      normalizeAppHelpLaunchContext({
        origin: 'chat',
        topicId: 'privacy-and-recovery',
        reason: 'privacy-locked',
        address: '0x123',
        balance: '100',
        error: 'raw provider error',
        message: 'private message',
        txHash: '0xdeadbeef'
      })
    ).toEqual({
      origin: 'chat',
      topicId: 'privacy-and-recovery',
      reason: 'privacy-locked'
    });
  });

  it('drops unknown topics and reasons without dropping a trusted origin', () => {
    expect(
      normalizeAppHelpLaunchContext({
        origin: 'portal',
        topicId: 'not-a-topic',
        reason: 'raw-error'
      })
    ).toEqual({ origin: 'portal' });
  });

  it('rejects unknown origins', () => {
    expect(normalizeAppHelpLaunchContext({ origin: '/chat' })).toBeNull();
  });

  it('maps each readiness reason to the closest trusted topic', () => {
    expect(getAppHelpReadinessTopicId('wallet-needed')).toBe('getting-started');
    expect(getAppHelpReadinessTopicId('privacy-locked')).toBe('privacy-and-recovery');
    expect(getAppHelpReadinessTopicId('account-needed')).toBe('owner-and-chainwhisper-accounts');
    expect(getAppHelpReadinessTopicId('funds-needed')).toBe('account-funding');
    expect(getAppHelpReadinessTopicId('wrong-network')).toBe('readiness-troubleshooting');
    expect(getAppHelpReadinessTopicId('generic-error')).toBe('readiness-troubleshooting');
  });
});
