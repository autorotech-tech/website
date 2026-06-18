export type UiSyncStatus = 'idle' | 'hydrating' | 'syncing' | 'synced' | 'error' | 'offline'

let status: UiSyncStatus = 'idle'
const listeners = new Set<(s: UiSyncStatus) => void>()

export function getUiSyncStatus(): UiSyncStatus {
  return status
}

export function setUiSyncStatus(next: UiSyncStatus): void {
  if (status === next) return
  status = next
  for (const fn of listeners) fn(next)
}

export function subscribeUiSyncStatus(fn: (s: UiSyncStatus) => void): () => void {
  listeners.add(fn)
  fn(status)
  return () => listeners.delete(fn)
}

export function uiSyncStatusLabel(s: UiSyncStatus): string {
  switch (s) {
    case 'hydrating':
      return 'Loading from server...'
    case 'syncing':
      return 'Saving...'
    case 'synced':
      return 'Synced'
    case 'error':
      return 'Sync error'
    case 'offline':
      return 'Local (server unavailable)'
    default:
      return '—'
  }
}
