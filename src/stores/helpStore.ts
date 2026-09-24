import { LwwElementSet, LwwOperation } from '../lib/crdt'
import { swChannel, postToServiceWorker, getInstanceId } from '../lib/swChannel'

export interface OfflineHelpRecord { status: string; lat: number; lng: number; updatedAt: number }

export const helpStore = new LwwElementSet<OfflineHelpRecord>('browser')

export const upsertOfflineHelp = (id: string, value: OfflineHelpRecord) => {
  const op = helpStore.set(id, value, value.updatedAt)
  broadcastHelpOperation(op)
  return op
}

export const removeOfflineHelp = (id: string, updatedAt = Date.now()) => {
  const op = helpStore.delete(id, updatedAt)
  broadcastHelpOperation(op)
  return op
}

// Issue #516: CRDT operations are multi-tab. After a local mutation the
// operation rides the BroadcastChannel so every other open tab can apply it
// (and the leader tab is the sole writer to /api/sync via the SW).
function broadcastHelpOperation(op: LwwOperation<OfflineHelpRecord>) {
  const payload = { store: 'helpStore', operations: [op], vectorClock: { ...helpStore.clock } }
  swChannel.post('CRDT_SYNC', payload)
  postToServiceWorker({ type: 'CRDT_SYNC', source: getInstanceId(), payload, timestamp: Date.now() })
}

/** Subscribe to remote CRDT operations arriving via the channel/SW. */
export function initHelpStoreChannelSync(): () => void {
  const applyToStore = (payload: any) => {
    if (!payload || payload.store !== 'helpStore' || !Array.isArray(payload.operations)) return
    for (const op of payload.operations) {
      helpStore.apply(op)
    }
  }
  const onMessage = (message: any) => {
    if (message?.type === 'CRDT_SYNC') applyToStore(message.payload)
  }
  const unsubChannel = swChannel.subscribe(onMessage)
  const unsubSw = subscribeToServiceWorkerMessages(onMessage)

  return () => {
    unsubChannel()
    unsubSw()
  }
}

function subscribeToServiceWorkerMessages(handler: (message: any) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return () => {}
  const listener = (event: MessageEvent) => handler(event.data)
  navigator.serviceWorker.addEventListener('message', listener)
  return () => navigator.serviceWorker.removeEventListener('message', listener)
}