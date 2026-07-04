'use client'

import { Loader2, AlertTriangle, Lock, WifiOff, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Standardized async-state primitives (Phase 13). One consistent look for
 * loading / error / permission-denied / offline across the app, so every module
 * behaves the same. Presentational only — no data access.
 */

export function LoadingState({ label, className }: { label?: string; className?: string }) {
  const t = useTranslations('states')
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 py-10 text-gray-400', className)}>
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{label ?? t('loading')}</p>
    </div>
  )
}

export function ErrorState({ message, onRetry, className }: { message?: string; onRetry?: () => void; className?: string }) {
  const t = useTranslations('states')
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-10 text-center', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
        <AlertTriangle className="h-6 w-6 text-red-500" />
      </div>
      <p className="max-w-sm text-sm text-gray-600">{message ?? t('serverError')}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" /> {t('retry')}
        </Button>
      )}
    </div>
  )
}

export function PermissionDenied({ message, className }: { message?: string; className?: string }) {
  const t = useTranslations('states')
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-12 text-center text-gray-400', className)}>
      <Lock className="h-10 w-10 opacity-40" />
      <p className="max-w-sm text-sm">{message ?? t('permissionDenied')}</p>
    </div>
  )
}

export function OfflineNotice({ className }: { className?: string }) {
  const t = useTranslations('states')
  return (
    <div className={cn('flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800', className)}>
      <WifiOff className="h-4 w-4 shrink-0" /> {t('offline')}
    </div>
  )
}
