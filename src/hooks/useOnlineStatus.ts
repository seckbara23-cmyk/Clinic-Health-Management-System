'use client'

import { useSyncExternalStore } from 'react'
import { onlineManager } from '@tanstack/react-query'

// Reactive online/offline status backed by TanStack's onlineManager (which
// listens to window online/offline events). SSR snapshot is `true`.
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  )
}
