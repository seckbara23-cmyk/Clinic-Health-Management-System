'use client'

import { useQueryClient, useMutationState } from '@tanstack/react-query'
import { WifiOff, RefreshCw, Loader2 } from 'lucide-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

// Global connection + sync indicator. Shown only when offline or when there are
// queued offline mutations waiting to sync. Offers a manual "retry now".
export function ConnectionBanner() {
  const t = useTranslations('offlineBanner')
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()
  const pending = useMutationState({ filters: { predicate: (m) => m.state.isPaused } }).length

  if (isOnline && pending === 0) return null

  const syncing = isOnline && pending > 0

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-3">
      <div
        className={cn(
          'pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm',
          syncing ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-amber-200 bg-amber-50 text-amber-800',
        )}
      >
        {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WifiOff className="h-3.5 w-3.5" />}
        <span>
          {syncing ? t('syncing', { count: pending }) : pending > 0 ? t('offlineWithQueue', { count: pending }) : t('offline')}
        </span>
        {syncing && (
          <button
            className="ml-1 inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 hover:bg-blue-200"
            onClick={() => queryClient.resumePausedMutations()}
          >
            <RefreshCw className="h-3 w-3" /> {t('retry')}
          </button>
        )}
      </div>
    </div>
  )
}
