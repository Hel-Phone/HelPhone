/**
 * src/lib/cacheQuarantine.ts — IndexedDB-backed quarantine store for poisoned cache entries (#898).
 * Records problematic URLs and auto-repairs them on retry.
 */

export interface QuarantinedEntry {
  url: string
  reason: 'poisoned' | 'opaque-response' | 'hash-mismatch' | 'other'
  detectedAt: number
  responseSize?: number
  retryCount?: number
}

const QUARANTINE_DB_NAME = 'helphone-cache-quarantine'
const QUARANTINE_STORE_NAME = 'quarantined'
const DB_VERSION = 1

let dbInstance: IDBDatabase | null = null

/**
 * Open or get cached IndexedDB instance.
 */
async function getDatabase(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUARANTINE_DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(QUARANTINE_STORE_NAME)) {
        const store = db.createObjectStore(QUARANTINE_STORE_NAME, { keyPath: 'url' })
        store.createIndex('detectedAt', 'detectedAt', { unique: false })
      }
    }
  })
}

/**
 * Add URL to quarantine after integrity failure or opaque response.
 */
export async function quarantineResponse(url: string, reason: string): Promise<void> {
  try {
    const db = await getDatabase()
    const tx = db.transaction([QUARANTINE_STORE_NAME], 'readwrite')
    const store = tx.objectStore(QUARANTINE_STORE_NAME)

    const entry: QuarantinedEntry = {
      url,
      reason: (reason as any) || 'other',
      detectedAt: Date.now(),
      retryCount: 0,
    }

    store.put(entry)

    // Also remove from all caches
    const cacheNames = await caches.keys()
    for (const name of cacheNames) {
      const cache = await caches.open(name)
      await cache.delete(url)
    }
  } catch (err) {
    console.error('Failed to quarantine response', url, err)
  }
}

/**
 * Check if URL is quarantined.
 */
export async function isQuarantined(url: string): Promise<boolean> {
  try {
    const db = await getDatabase()
    const tx = db.transaction([QUARANTINE_STORE_NAME], 'readonly')
    const store = tx.objectStore(QUARANTINE_STORE_NAME)

    return new Promise((resolve) => {
      const request = store.get(url)
      request.onsuccess = () => resolve(!!request.result)
      request.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}

/**
 * Retrieve all quarantined entries.
 */
export async function listQuarantined(): Promise<QuarantinedEntry[]> {
  try {
    const db = await getDatabase()
    const tx = db.transaction([QUARANTINE_STORE_NAME], 'readonly')
    const store = tx.objectStore(QUARANTINE_STORE_NAME)

    return new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve((request.result as QuarantinedEntry[]) || [])
      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    console.error('Failed to list quarantined entries', err)
    return []
  }
}

/**
 * Remove URL from quarantine after successful repair.
 */
export async function unquarantine(url: string): Promise<void> {
  try {
    const db = await getDatabase()
    const tx = db.transaction([QUARANTINE_STORE_NAME], 'readwrite')
    const store = tx.objectStore(QUARANTINE_STORE_NAME)
    store.delete(url)
  } catch (err) {
    console.error('Failed to unquarantine URL', url, err)
  }
}

/**
 * Remove all quarantined entries.
 */
export async function clearQuarantine(): Promise<void> {
  try {
    const db = await getDatabase()
    const tx = db.transaction([QUARANTINE_STORE_NAME], 'readwrite')
    const store = tx.objectStore(QUARANTINE_STORE_NAME)
    store.clear()
  } catch (err) {
    console.error('Failed to clear quarantine', err)
  }
}

/**
 * Get quarantine statistics.
 */
export async function getQuarantineStats(): Promise<{
  total: number
  poisoned: number
  opaque: number
  mismatch: number
  oldestMs: number
}> {
  try {
    const entries = await listQuarantined()
    const now = Date.now()

    return {
      total: entries.length,
      poisoned: entries.filter((e) => e.reason === 'poisoned').length,
      opaque: entries.filter((e) => e.reason === 'opaque-response').length,
      mismatch: entries.filter((e) => e.reason === 'hash-mismatch').length,
      oldestMs: entries.length > 0 ? Math.min(...entries.map((e) => e.detectedAt)) : now,
    }
  } catch {
    return { total: 0, poisoned: 0, opaque: 0, mismatch: 0, oldestMs: Date.now() }
  }
}
