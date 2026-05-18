'use client'

import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setLocale } from '@/lib/locale/actions'
import { cn } from '@/lib/utils'

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function switchTo(next: string) {
    startTransition(async () => {
      await setLocale(next)
      router.refresh()
    })
  }

  return (
    <div className={cn('flex items-center gap-1 text-xs font-semibold', className)}>
      <button
        onClick={() => switchTo('fr')}
        disabled={locale === 'fr' || isPending}
        aria-label="Français"
        aria-pressed={locale === 'fr'}
        className={cn(
          'transition-colors disabled:cursor-default',
          locale === 'fr' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
        )}
      >
        FR
      </button>
      <span className="select-none text-gray-300" aria-hidden="true">/</span>
      <button
        onClick={() => switchTo('en')}
        disabled={locale === 'en' || isPending}
        aria-label="English"
        aria-pressed={locale === 'en'}
        className={cn(
          'transition-colors disabled:cursor-default',
          locale === 'en' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
        )}
      >
        EN
      </button>
    </div>
  )
}
