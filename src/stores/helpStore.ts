import { LwwElementSet } from '../lib/crdt'
import type { LwwOperation } from '../lib/crdt'
import type { SecureStorage } from '../lib/secureStorage'
export interface OfflineHelpRecord { status: string; lat: number; lng: number; updatedAt: number }
export const helpStore = new LwwElementSet<OfflineHelpRecord>('browser')
export const upsertOfflineHelp = (id: string, value: OfflineHelpRecord) => helpStore.set(id, value, value.updatedAt)
export const removeOfflineHelp = (id: string, updatedAt = Date.now()) => helpStore.delete(id, updatedAt)

const PERSIST_KEY = 'help-store'

/** Encrypt the store's operations into secure storage. Locations are sensitive. */
export async function persistHelpStore(storage: SecureStorage, store = helpStore) {
  const { operations, entries } = store.snapshot()
  await storage.setItem(PERSIST_KEY, JSON.stringify([...operations, ...entries]))
}

/** Merge previously persisted operations back in. Returns false if nothing was stored. */
export async function hydrateHelpStore(storage: SecureStorage, store = helpStore) {
  const raw = await storage.getItem(PERSIST_KEY)
  if (raw === null) return false
  store.merge(JSON.parse(raw) as LwwOperation<OfflineHelpRecord>[])
  return true
}
