'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Plus, Users, CalendarDays, Receipt } from 'lucide-react'
import { cn } from '@/lib/utils'

const ACTIONS = [
  { label: 'Nouveau patient',  icon: Users,        event: 'fab:create-patient',     color: 'bg-blue-600' },
  { label: 'Nouveau RDV',     icon: CalendarDays, event: 'fab:create-appointment', color: 'bg-violet-600' },
  { label: 'Nouvelle facture', icon: Receipt,      event: 'fab:create-invoice',     color: 'bg-emerald-600' },
]

export function FloatingActionButton() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Close on navigation
  useEffect(() => { setOpen(false) }, [pathname])

  // Hide on patient detail — it has its own sticky action bar
  if (pathname.match(/^\/patients\/[^/]+/)) return null

  function fire(event: string) {
    window.dispatchEvent(new CustomEvent(event))
    setOpen(false)
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="fixed bottom-[76px] right-4 z-50 flex flex-col items-end gap-3 md:hidden">
        {open && ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <div key={action.event} className="flex items-center gap-3">
              <span className="rounded-full bg-gray-900/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
                {action.label}
              </span>
              <button
                className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-lg text-white active:scale-95 transition-transform',
                  action.color
                )}
                onClick={() => fire(action.event)}
                aria-label={action.label}
              >
                <Icon className="h-5 w-5" />
              </button>
            </div>
          )
        })}

        <button
          className={cn(
            'flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-xl text-white transition-all duration-200 active:scale-95',
            open ? 'bg-gray-700 rotate-45' : 'bg-teal-700'
          )}
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Fermer' : 'Actions rapides'}
        >
          <Plus className="h-7 w-7" />
        </button>
      </div>
    </>
  )
}
