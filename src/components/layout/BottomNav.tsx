'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, ClipboardList, CalendarDays, Receipt } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { href: '/dashboard',    label: 'Accueil',  icon: LayoutDashboard },
  { href: '/patients',     label: 'Patients', icon: Users },
  { href: '/queue',        label: 'File',     icon: ClipboardList },
  { href: '/appointments', label: 'RDV',      icon: CalendarDays },
  { href: '/billing',      label: 'Factures', icon: Receipt },
]

export function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white safe-area-inset-bottom md:hidden">
      <div className="grid h-16 grid-cols-5">
        {items.map(({ href, label, icon: Icon }) => {
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
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
