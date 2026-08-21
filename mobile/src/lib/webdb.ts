// One connection to one database.
//
// Two modules each opening the same IndexedDB at their own version is a
// deadlock, not a merge: the second open needs an upgrade, the upgrade waits
// for every other connection to close, and the first connection is being held
// open for the life of the tab. Nothing errors — onupgradeneeded simply never
// fires and the promise never settles, so the screen that was waiting on it
// just sits there.
//
// So there is one place that knows the version and every store in it.

const DB_NAME = "inkline";
const VERSION = 2;

/** Every store, declared together, because they are created together. */
export const STORES = {
  designs: "designs",
  projectAssets: "project-assets",
  /**
   * Editable project manifests.
   *
   * These used to live in localStorage, which is capped somewhere around five
   * megabytes. A manifest holds the drawing's geometry and grows with it, so
   * that cap was reachable in one sitting — and the write that crossed it threw
   * QuotaExceededError, which surfaced as a raw browser message and lost the
   * edit. The layer images were already here for the same reason.
   */
  projectManifests: "project-manifests",
} as const;

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of Object.values(STORES)) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onblocked = () =>
        reject(new Error("Another tab is holding this design library open. Close it and reload."));
      request.onerror = () => {
        // Don't cache a failed connection for the life of the tab.
        connection = null;
        reject(request.error);
      };
    });
  }
  return connection;
}

export function withStore<T>(
  store: (typeof STORES)[keyof typeof STORES],
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = work(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}
