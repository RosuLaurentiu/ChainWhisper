import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireCachedImageUrl } from './ChatImage';

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let reject!: Deferred<T>['reject'];
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatImage URL cache', () => {
  it('shares one in-flight load and keeps the URL alive until the final release', async () => {
    const pending = createDeferred<string>();
    const load = vi.fn(() => pending.promise);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const first = acquireCachedImageUrl('shared-key', load);
    const second = acquireCachedImageUrl('shared-key', load);

    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(first.promise).toBe(second.promise);

    pending.resolve('blob:shared');
    await expect(first.promise).resolves.toBe('blob:shared');
    await expect(second.promise).resolves.toBe('blob:shared');

    first.release();
    expect(revoke).not.toHaveBeenCalled();

    second.release();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:shared');
  });

  it('revokes a late result after every consumer releases without touching a retry', async () => {
    const stale = createDeferred<string>();
    const fresh = createDeferred<string>();
    const staleSignals: AbortSignal[] = [];
    const loadStale = vi.fn((signal: AbortSignal) => {
      staleSignals.push(signal);
      return stale.promise;
    });
    const loadFresh = vi.fn(() => fresh.promise);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const abandoned = acquireCachedImageUrl('late-key', loadStale);
    await Promise.resolve();
    abandoned.release();
    expect(staleSignals).toHaveLength(1);
    expect(staleSignals[0]?.aborted).toBe(true);
    const retry = acquireCachedImageUrl('late-key', loadFresh);

    stale.resolve('blob:stale');
    fresh.resolve('blob:fresh');
    await expect(abandoned.promise).resolves.toBe('blob:stale');
    await expect(retry.promise).resolves.toBe('blob:fresh');

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:stale');

    retry.release();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenLastCalledWith('blob:fresh');
  });

  it('evicts a rejected load so retry can succeed', async () => {
    const failure = new Error('download failed');
    const loadFailure = vi.fn(() => Promise.reject(failure));
    const loadRetry = vi.fn(() => Promise.resolve('blob:retry'));
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const failed = acquireCachedImageUrl('retry-key', loadFailure);
    await expect(failed.promise).rejects.toBe(failure);
    failed.release();

    const retry = acquireCachedImageUrl('retry-key', loadRetry);
    await expect(retry.promise).resolves.toBe('blob:retry');
    expect(loadRetry).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();

    retry.release();
    retry.release();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:retry');
  });
});
