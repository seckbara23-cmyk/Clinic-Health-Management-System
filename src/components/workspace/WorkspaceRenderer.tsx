'use client'

// ── Workspace Renderer (Phase 14.2.6 — foundation) ─────────────────
//
// A GENERIC, presentational renderer for a resolved WorkspaceSpec: it can
// render widget cards, quick-action cards, sections, empty states, and
// locked/mandatory badges — driven entirely by data, with zero specialty-
// specific markup. It performs NO navigation, opens NO dialog, calls NO AI,
// and makes NO write — this is a READ-ONLY, informational view (used today
// only by the "My Workspace" preview in Settings). It does not replace, and is
// not mounted on, the live dashboard page.

import { useTranslations } from 'next-intl'
import {
  Sparkles, BarChart2, ClipboardList, Zap, CalendarDays, CalendarClock, FlaskConical,
  AlertOctagon, TrendingUp, ScanLine, Stethoscope, Pill, CalendarPlus, Receipt,
  PackageCheck, Lock, LayoutGrid, ListChecks,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { WorkspaceSpec } from '@/lib/workspace/types'
import { cn } from '@/lib/utils'

const ICONS: Record<string, React.ElementType> = {
  Sparkles, BarChart2, ClipboardList, Zap, CalendarDays, CalendarClock, FlaskConical,
  AlertOctagon, TrendingUp, ScanLine, Stethoscope, Pill, CalendarPlus, Receipt, PackageCheck,
}

function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name] ?? LayoutGrid
  return <C className={className} />
}

export function WorkspaceRenderer({ spec }: { spec: WorkspaceSpec }) {
  const t = useTranslations('workspace')

  return (
    <div className="space-y-5">
      {/* Widgets section */}
      <section>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
          <LayoutGrid className="h-3.5 w-3.5" /> {t('sectionWidgets')}
        </p>
        {spec.dashboardWidgets.length === 0 ? (
          <EmptyState label={t('emptyWidgets')} />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {spec.dashboardWidgets.map(w => (
              <Card key={w.id} className="border-gray-200">
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                    <Icon name={w.def.icon} className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{t(`widget_${w.id}`)}</p>
                    <p className="text-[11px] uppercase text-gray-400">{w.def.size}</p>
                  </div>
                  {w.locked && (
                    <Badge variant="outline" className="shrink-0 gap-1 text-amber-600">
                      <Lock className="h-3 w-3" /> {t('locked')}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Quick actions section */}
      <section>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
          <ListChecks className="h-3.5 w-3.5" /> {t('sectionQuickActions')}
        </p>
        {spec.quickActions.length === 0 ? (
          <EmptyState label={t('emptyActions')} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {spec.quickActions.map(a => (
              <span
                key={a.id}
                className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-700"
              >
                <Icon name={a.def.icon} className="h-3.5 w-3.5 text-teal-700" />
                {t(`action_${a.id}`)}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className={cn('rounded-lg border border-dashed bg-gray-50 px-3 py-6 text-center text-sm text-gray-400')}>
      {label}
    </div>
  )
}
