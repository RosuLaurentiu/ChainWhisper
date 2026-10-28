export type LinkTradeV2CreationStoredRow = Readonly<{
  id: string; ownerKey: string; activeOwner?: string; createdAt: number; revision: number; sealed: string;
}>;
export type LinkTradeV2CreationStore = Readonly<{
  claim(row: LinkTradeV2CreationStoredRow): Promise<void>;
  read(id: string): Promise<LinkTradeV2CreationStoredRow | null>;
  active(ownerKey: string): Promise<LinkTradeV2CreationStoredRow | null>;
  latest(ownerKey: string): Promise<LinkTradeV2CreationStoredRow | null>;
  replace(row: LinkTradeV2CreationStoredRow, expectedRevision: number): Promise<void>;
  close?(): void;
}>;

/** Unique active-owner index and guarded writes serialize creations across tabs. */
export const createIndexedDbLinkTradeV2CreationStore = (factory: IDBFactory = indexedDB): LinkTradeV2CreationStore => {
  let opening: Promise<IDBDatabase> | undefined;
  const database = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('chainwhisper-link-creation-recovery-v1', 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('creations', { keyPath: 'id' });
      store.createIndex('activeOwner', 'activeOwner', { unique: true });
      store.createIndex('ownerCreated', ['ownerKey', 'createdAt']);
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
    request.onerror = () => reject(new Error('Link recovery storage could not open.'));
    request.onblocked = () => { blocked = true; reject(new Error('Link recovery storage is blocked by another tab.')); };
  });
  const read = async (select: (store: IDBObjectStore) => IDBRequest) => {
    const db = await database();
    return new Promise<LinkTradeV2CreationStoredRow | null>((resolve, reject) => {
      const tx = db.transaction('creations', 'readonly'), request = select(tx.objectStore('creations'));
      let row: LinkTradeV2CreationStoredRow | null = null;
      request.onsuccess = () => { row = request.result?.value ?? request.result ?? null; };
      tx.oncomplete = () => resolve(row);
      tx.onerror = tx.onabort = () => reject(new Error('Link recovery storage could not read.'));
    });
  };
  const write = async (row: LinkTradeV2CreationStoredRow, expectedRevision?: number) => {
    const db = await database();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('creations', 'readwrite', { durability: 'strict' }), store = tx.objectStore('creations');
      let conflict = false;
      if (expectedRevision === undefined) store.add(row);
      else {
        const request = store.get(row.id);
        request.onsuccess = () => {
          const current = request.result as LinkTradeV2CreationStoredRow | undefined;
          if (!current || current.revision !== expectedRevision || row.revision !== expectedRevision + 1 ||
              current.ownerKey !== row.ownerKey || current.createdAt !== row.createdAt) { conflict = true; tx.abort(); return; }
          store.put(row);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error(conflict ? 'Link creation changed in another tab.' :
        tx.error?.name === 'ConstraintError' ? 'A Link creation is already pending.' : 'Link recovery storage could not commit.'));
    });
  };
  return Object.freeze({
    claim: row => write(row), replace: (row, revision) => write(row, revision),
    read: id => read(store => store.get(id)),
    active: ownerKey => read(store => store.index('activeOwner').get(ownerKey)),
    latest: ownerKey => read(store => store.index('ownerCreated').openCursor(IDBKeyRange.bound([ownerKey, 0], [ownerKey, Number.MAX_SAFE_INTEGER]), 'prev')),
    close: () => { opening?.then(db => db.close()).catch(() => {}); opening = undefined; }
  });
};
