/**
 * Values kept in IndexedDB by key, for what localStorage cannot hold, such as a folder's handle,
 * which only a structured clone keeps.
 */

const DB = 'ratchet-ui';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB did not open'));
  });
}

async function run(
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  const db = await open();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => {
        const result: unknown = req.result;
        resolve(result);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'));
    });
  } finally {
    db.close();
  }
}

/** the value kept under a key; undefined when none is */
export const getValue = (key: string): Promise<unknown> => run('readonly', (s) => s.get(key));

export async function setValue(key: string, value: unknown): Promise<void> {
  await run('readwrite', (s) => s.put(value, key));
}

export async function deleteValue(key: string): Promise<void> {
  await run('readwrite', (s) => s.delete(key));
}
