import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/otcV2DeploymentCatalog', () => ({ OTC_V2_DEPLOYMENT_CATALOG: { status: 'active' } }));

describe('in-chat trade store', () => {
  it('uses the current V2 no-fee rule instead of a retired escrow fee read', async () => {
    const { useInChatTradeStore } = await import('./inChatTradeStore');
    expect(useInChatTradeStore.getState().tradeRequiredFeeWei).toBe(0n);
  });
});
