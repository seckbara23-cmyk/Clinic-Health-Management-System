'use client'

import Link from 'next/link'
import { Bell, Search, Clock, FlaskConical, Receipt, AlertTriangle, Menu } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useClinic } from '@/context/ClinicContext'
import { useSidebar } from '@/context/SidebarContext'
import { useNotifications, type Notification } from '@/hooks/useNotifications'
import { formatDate, cn } from '@/lib/utils'

interface TopbarProps {
  title: string
  description?: string
}

const notifIcon: Record<Notification['type'], React.ElementType> = {
  follow_up: Clock,
  lab_result: FlaskConical,
  overdue_invoice: AlertTriangle,
  unpaid_invoice: Receipt,
}

const notifColor: Record<Notification['type'], string> = {
  follow_up:      'text-amber-500 bg-amber-50',
  lab_result:     'text-blue-500 bg-blue-50',
  overdue_invoice:'text-red-500 bg-red-50',
  unpaid_invoice: 'text-orange-500 bg-orange-50',
}

export function Topbar({ title, description }: TopbarProps) {
  const { clinic } = useClinic()
  const { openMobile } = useSidebar()
  const { data: notifications } = useNotifications()
  const count = notifications?.length ?? 0

  return (
    <header className="flex h-14 items-center justify-between border-b bg-white px-4 md:h-16 md:px-6">
      <div className="flex items-center gap-3 min-w-0">
        {/* Hamburger — mobile only */}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          onClick={openMobile}
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-gray-900 md:text-lg">{title}</h1>
          {description && <p className="hidden text-xs text-gray-500 sm:block">{description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Rechercher..." className="w-64 pl-9 h-9" />
        </div>
        <span className="hidden text-xs text-gray-500 md:block">
          {formatDate(new Date(), { dateStyle: 'full' })}
        </span>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {count > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="text-sm font-semibold">Notifications</p>
              {count > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                  {count}
                </span>
              )}
            </div>
            {count === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-gray-400">
                <Bell className="h-8 w-8 opacity-30" />
                <p className="text-sm">Aucune notification</p>
              </div>
            ) : (
              <ul className="max-h-80 overflow-y-auto divide-y">
                {notifications!.map(n => {
                  const Icon = notifIcon[n.type]
                  return (
                    <li key={n.id}>
                      <Link
                        href={n.href}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', notifColor[n.type])}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-900">{n.label}</p>
                          <p className="truncate text-xs text-gray-500 mt-0.5">{n.detail}</p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </PopoverContent>
        </Popover>

        {clinic && (
          <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-700">
            {clinic.subscription_plan.toUpperCase()}
          </span>
        )}
      </div>
    </header>
  )
}
