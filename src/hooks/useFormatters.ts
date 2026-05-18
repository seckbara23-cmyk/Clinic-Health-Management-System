'use client'

import { useLocale } from 'next-intl'

const INTL_LOCALE: Record<string, string> = {
  fr: 'fr-SN',
  en: 'en-US',
}

export function useFormatters() {
  const locale = useLocale()
  const intlLocale = INTL_LOCALE[locale] ?? 'fr-SN'

  return {
    locale,
    intlLocale,

    formatDate(date: string | Date, opts?: Intl.DateTimeFormatOptions): string {
      return new Intl.DateTimeFormat(intlLocale, opts ?? { dateStyle: 'medium' }).format(
        new Date(date),
      )
    },

    formatTime(date: string | Date): string {
      return new Intl.DateTimeFormat(intlLocale, { timeStyle: 'short' }).format(new Date(date))
    },

    formatCurrency(amount: number, currency = 'XOF'): string {
      if (locale === 'en') {
        const formatted = new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(amount)
        return `${formatted} ${currency}`
      }
      return new Intl.NumberFormat('fr-SN', { style: 'currency', currency }).format(amount)
    },

    formatRelativeTime(date: string | Date): string {
      const diff = new Date(date).getTime() - Date.now()
      const abs = Math.abs(diff)
      const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto' })
      if (abs < 60_000) return rtf.format(Math.round(diff / 1_000), 'second')
      if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
      if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour')
      return rtf.format(Math.round(diff / 86_400_000), 'day')
    },
  }
}
