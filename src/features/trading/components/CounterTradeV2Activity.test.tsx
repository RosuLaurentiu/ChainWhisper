import { describe, expect, it, vi } from 'vitest';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import { counterActivityOrderKey, resolveCounterActivityRuntime, isCounterActivitySelectionCurrent } from './CounterTradeV2Activity';

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

import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Activity from './CounterTradeV2Activity';

it('associates the review trigger with the detail surface and blocks it during an action', () => {
  const row = { ...reference, maker: owner, taker: owner, offerToken: current, requestToken: old, privatePair: false, status: 2, expiresAt: '0', key: 'event' };
  const activity = { snapshot: { orders: [row], history: [row], complete: true }, busy: false, error: '', refresh: vi.fn(), loadOlder: vi.fn() } as unknown as ComponentProps<typeof Activity>['activity'];
  const props: ComponentProps<typeof Activity> = { activity, runtime: runtime(old), lifecycle: 'history', activeFilter: 'all', tokenInfoByKey: {}, search: '', pairFilter: 'all', typeFilter: 'all', sortMode: '', actionInProgress: false, onSelect: vi.fn() };
  const markup = renderToStaticMarkup(createElement(Activity, props));
  expect(markup).toContain('aria-controls="counter-trade-review"');
  expect(markup).toMatch(/<button[^>]*aria-controls="counter-trade-review"[^>]*>Review counter 1/);
  const busy = renderToStaticMarkup(createElement(Activity, { ...props, actionInProgress: true }));
  expect(busy).toMatch(/<button[^>]*disabled=""[^>]*aria-controls="counter-trade-review"/);
});


describe('Counter review selection scope', () => {
  const root = runtime(old);
  const selection = { reference, root, lifecycle: 'history' as const, group: 'history' as const };
  const scope = { root, wallet: owner, group: 'history' as const, lifecycle: 'history' as const, rows: [reference] };
  it('requires the same runtime, wallet, lifecycle, group, and full contract identity', () => {
    expect(isCounterActivitySelectionCurrent(selection, scope)).toBe(true);
    expect(isCounterActivitySelectionCurrent(selection, { ...scope, root: undefined })).toBe(false);
    expect(isCounterActivitySelectionCurrent(selection, { ...scope, root: runtime(old) })).toBe(false);
    expect(isCounterActivitySelectionCurrent(selection, { ...scope, wallet: current })).toBe(false);
    expect(isCounterActivitySelectionCurrent(selection, { ...scope, group: 'active' })).toBe(false);
    expect(isCounterActivitySelectionCurrent(selection, { ...scope, lifecycle: 'active' })).toBe(false);
    expect(isCounterActivitySelectionCurrent(selection, { ...scope, rows: [{ ...reference, escrow: current }] })).toBe(false);
    expect(isCounterActivitySelectionCurrent(null, scope)).toBe(false);
  });
});
