import { describe, expect, it, vi } from 'vitest';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import { counterActivityOrderKey, resolveCounterActivityRuntime } from './CounterTradeV2Activity';

vi.mock('./CounterTradeV2Controls', () => ({ CounterTradeV2ParticipantControls: () => null }));
type Runtime = NonNullable<OtcV2ActionRuntime['counter']>;
const owner = `0x${'44'.repeat(20)}`;
const current = `0x${'11'.repeat(20)}`, old = `0x${'22'.repeat(20)}`;
const reference = { chainId: '7082400', escrow: old, id: '1' };
const runtime = (escrow: string, address = owner): Runtime => ({ ownerAddress: address,
  readContext: { deployment: { chainId: '7082400', contractAddress: escrow } }
} as unknown as Runtime);

describe('Counter activity exact runtime selection', () => {
  it('keeps equal IDs in different Counter contracts distinct', () => {
    expect(counterActivityOrderKey(reference)).not.toBe(counterActivityOrderKey({ ...reference, escrow: current }));
  });
  it('uses the retained runtime, never the current runtime with the same ID', async () => {
    const selected = runtime(old), forReference = vi.fn().mockResolvedValue(selected);
    const root = { ...runtime(current), forReference };
    expect(await resolveCounterActivityRuntime(root, reference)).toBe(selected);
    expect(forReference).toHaveBeenCalledExactlyOnceWith(reference);
  });
  it('allows a current-only runtime only for its exact contract', async () => {
    const root = runtime(current);
    expect(await resolveCounterActivityRuntime(root, { ...reference, escrow: current })).toBe(root);
    await expect(resolveCounterActivityRuntime(root, reference)).rejects.toThrow();
  });
  it.each(['contract', 'owner', 'chain'] as const)('rejects a resolved wrong %s instead of mounting current controls', async kind => {
    const selected = runtime(kind === 'contract' ? current : old, kind === 'owner' ? current : owner);
    const target = kind === 'chain' ? { ...selected, readContext: { ...selected.readContext,
      deployment: { ...selected.readContext.deployment, chainId: '1' } } } : selected;
    await expect(resolveCounterActivityRuntime({ ...runtime(current), forReference: vi.fn().mockResolvedValue(target) }, reference)).rejects.toThrow();
  });
  it('does not fall back after failed retained resolution', async () => {
    const forReference = vi.fn().mockRejectedValue(new Error('unavailable'));
    await expect(resolveCounterActivityRuntime({ ...runtime(current), forReference }, reference)).rejects.toThrow('unavailable');
    expect(forReference).toHaveBeenCalledOnce();
  });
  it('rejects a late selection after the wallet/runtime view changes', async () => {
    let active = true;
    const root = { ...runtime(current), forReference: vi.fn(async () => { active = false; return runtime(old); }) };
    await expect(resolveCounterActivityRuntime(root, reference, () => active)).rejects.toThrow();
  });
});
