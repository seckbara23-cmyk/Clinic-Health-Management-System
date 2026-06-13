'use client'

import { WifiOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export default function OfflinePage() {
  const t = useTranslations('offline')
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
        <WifiOff className="h-8 w-8 text-gray-400" />
      </div>
      <h1 className="text-xl font-bold text-gray-900">{t('title')}</h1>
      <p className="max-w-sm text-sm text-gray-500">{t('description')}</p>
      <Button onClick={() => window.location.reload()}>{t('retry')}</Button>
    </div>
  )
}
