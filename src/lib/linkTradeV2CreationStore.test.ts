import { describe, expect, it, vi } from 'vitest';
import { createIndexedDbLinkTradeV2CreationStore } from './linkTradeV2CreationStore';

const row = { id: 'creation', ownerKey: 'owner', activeOwner: 'owner', createdAt: 1, revision: 1, sealed: 'encrypted' };

const fixture = () => {
  const tx = {
    error: null as DOMException | null,
    oncomplete: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    onabort: undefined as (() => void) | undefined,
    objectStore: () => ({ add: vi.fn() })
  };
  const db = { transaction: () => tx, close: vi.fn() };
  const opening = { result: db, onsuccess: undefined as (() => void) | undefined };
  const factory = { open: () => { queueMicrotask(() => opening.onsuccess?.()); return opening; } };
  return { tx, store: createIndexedDbLinkTradeV2CreationStore(factory as unknown as IDBFactory) };
};

describe('Link IndexedDB write completion', () => {
  it('waits for abort before classifying an active-owner constraint failure', async () => {
    const { tx, store } = fixture();
    const write = store.claim(row);
    const result = write.catch((error: Error) => error.message);
    await Promise.resolve(); await Promise.resolve();
    tx.onerror?.();
    tx.error = new DOMException('Do not display private storage details', 'ConstraintError');
    tx.onabort?.();
    expect(await result).toBe('A Link creation is already pending.');
  });

  it('does not reject a handled request error if the transaction completes', async () => {
    const { tx, store } = fixture();
    const write = store.claim(row);
    const result = write.then(() => 'committed', () => 'rejected');
    await Promise.resolve(); await Promise.resolve();
    tx.onerror?.();
    tx.oncomplete?.();
    expect(await result).toBe('committed');
  });
});
