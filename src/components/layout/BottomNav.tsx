'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, ClipboardList, CalendarDays, Receipt } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export function BottomNav() {
  const pathname = usePathname()
  const t = useTranslations('bottomNav')

  const items = [
    { href: '/dashboard',    labelKey: 'home',         icon: LayoutDashboard },
    { href: '/patients',     labelKey: 'patients',     icon: Users },
    { href: '/queue',        labelKey: 'queue',        icon: ClipboardList },
    { href: '/appointments', labelKey: 'appointments', icon: CalendarDays },
    { href: '/billing',      labelKey: 'billing',      icon: Receipt },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white safe-area-inset-bottom md:hidden">
      <div className="grid h-16 grid-cols-5">
        {items.map(({ href, labelKey, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                active ? 'text-teal-700' : 'text-gray-400 hover:text-gray-600'
              )}
            >
              <Icon className={cn('h-5 w-5', active && 'text-teal-700')} />
              {t(labelKey)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
