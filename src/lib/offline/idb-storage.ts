import { openDB, type IDBPDatabase } from 'idb'

// IndexedDB-backed key/value store for the React-Query persister.
// One DB, one object store. The query cache lives under a single key; the
// owner (user id) is tracked separately so we can wipe on user switch/logout.
const DB_NAME = 'chms-offline'
const STORE = 'kv'

let dbPromise: Promise<IDBPDatabase> | null = null
function getDB() {
  if (typeof indexedDB === 'undefined') return null
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      },
    })
  }
  return dbPromise
}

// AsyncStorage shape expected by createAsyncStoragePersister.
export const idbStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const db = getDB(); if (!db) return null
    return (await (await db).get(STORE, key)) ?? null
  },
  setItem: async (key: string, value: string): Promise<void> => {
    const db = getDB(); if (!db) return
    await (await db).put(STORE, value, key)
  },
  removeItem: async (key: string): Promise<void> => {
    const db = getDB(); if (!db) return
    await (await db).delete(STORE, key)
  },
}

// Wipe the entire offline store (logout / user switch / version mismatch).
export async function clearOfflineStore(): Promise<void> {
  try {
    const db = getDB(); if (!db) return
    await (await db).clear(STORE)
  } catch { /* ignore */ }
}
