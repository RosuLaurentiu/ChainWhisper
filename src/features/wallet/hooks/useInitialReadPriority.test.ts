import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useInitialReadPriority from './useInitialReadPriority';

const hooks = vi.hoisted(() => ({ state: null as string | null, deps: [] as unknown[],
  cleanup: undefined as (() => void) | undefined }));
vi.mock('react', () => ({
  useState: () => [hooks.state, (value: string) => { hooks.state = value; }],
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    if (deps.some((value, index) => value !== hooks.deps[index])) {
      hooks.cleanup?.(); hooks.deps = deps; hooks.cleanup = effect();
    }
  }
}));
beforeEach(() => {
  hooks.state = null; hooks.deps = []; hooks.cleanup = undefined;
  vi.useFakeTimers(); vi.stubGlobal('window', globalThis);
});
afterEach(() => { hooks.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('releases cold background work as soon as first content or a terminal error settles', () => {
  expect(useInitialReadPriority('chat-owner-A', true)).toBe(true);
  expect(useInitialReadPriority('chat-owner-A', false)).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds a stalled startup without leaking permission to another wallet or route', async () => {
  expect(useInitialReadPriority('chat-owner-A', true)).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(useInitialReadPriority('chat-owner-A', true)).toBe(false);
  expect(useInitialReadPriority('dex-owner-A', true)).toBe(true);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(useInitialReadPriority('chat-owner-B', true)).toBe(true);
  await vi.advanceTimersByTimeAsync(29_000);
  expect(useInitialReadPriority('chat-owner-B', true)).toBe(true);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(useInitialReadPriority('chat-owner-B', true)).toBe(false);
});

it('does not defer a disconnected scope and removes an obsolete timer', () => {
  useInitialReadPriority('owner-A', true);
  expect(useInitialReadPriority(null, true)).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
