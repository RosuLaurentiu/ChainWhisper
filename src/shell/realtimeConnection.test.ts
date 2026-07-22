import { describe, expect, it } from 'vitest';
import { ignoreRealtimeSubscriptionAction } from './realtimeConnection';

describe('ignoreRealtimeSubscriptionAction', () => {
  it('contains synchronous cleanup failures', () => {
    expect(() =>
      ignoreRealtimeSubscriptionAction(() => {
        throw new Error('provider already closed');
      })
    ).not.toThrow();
  });

  it('contains asynchronous cleanup failures', async () => {
    ignoreRealtimeSubscriptionAction(() => Promise.reject(new Error('subscription cancelled')));

    await Promise.resolve();
    await Promise.resolve();
  });
});
