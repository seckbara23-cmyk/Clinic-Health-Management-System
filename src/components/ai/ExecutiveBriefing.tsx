'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  Sparkles, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, AlertOctagon,
  ArrowUpRight, Users, CalendarDays, FlaskConical, Pill, Receipt, BarChart2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AI_UI_ENABLED, confidenceVariant } from '@/lib/ai/ui'
import { useInsights } from '@/hooks/useInsights'
import { useClinic } from '@/context/ClinicContext'
import {
  buildExecutiveBriefing,
  type BriefingSection, type BriefingSectionGroup, type BriefingStatus,
} from '@/lib/ai/briefing'
import type { AIConfidenceLevel, AIWarningLevel } from '@/lib/ai/types'
import type { Role } from '@/types/database'

const SECTION_ICON: Record<BriefingSection, React.ElementType> = {
  patientFlow: Users,
  appointments: CalendarDays,
  laboratory: FlaskConical,
  pharmacy: Pill,
  finance: Receipt,
  operations: BarChart2,
}

const STATUS_STYLE: Record<BriefingStatus, {
  badge: 'success' | 'warning' | 'destructive'; Icon: React.ElementType; color: string
}> = {
  normal:    { badge: 'success',     Icon: CheckCircle2,  color: 'text-emerald-500' },
  attention: { badge: 'warning',     Icon: AlertTriangle, color: 'text-amber-500' },
  critical:  { badge: 'destructive', Icon: AlertOctagon,  color: 'text-red-500' },
}

const LEVEL_DOT: Record<AIWarningLevel, string> = {
  info: 'bg-blue-400',
  warning: 'bg-amber-400',
  critical: 'bg-red-500',
}

/**
 * Dashboard AI presentation layer — one prioritized "executive briefing" card
 * instead of a grid of mostly-zero insight cards. Read-only. Reuses the existing
 * insight feed (useInsights) and the deterministic engine; only the rendering
 * changes. Hidden entirely when the AI UI flag is off.
 */
export function ExecutiveBriefing() {
  const t = useTranslations('briefing')
  const { profile } = useClinic()
  const { data, isLoading, isError } = useInsights()
  const [override, setOverride] = useState<boolean | null>(null)

  if (!AI_UI_ENABLED) return null
  if (isLoading || isError || !data) return null

  const role = (profile?.role ?? 'admin') as Role
  const briefing = buildExecutiveBriefing(data.results, data.response.confidence.level, role)
  const { status, actionCount, sections } = briefing
  const s = STATUS_STYLE[status]
  // Progressive disclosure: collapsed by default when Normal, expanded when
  // Attention/Critical — until the user toggles.
  const open = override ?? (status !== 'normal')

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-teal-600" />
        <h2 className="text-sm font-semibold text-gray-900">{t('title')}</h2>
        <Badge variant={s.badge}>{t(`status_${status}`)}</Badge>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('confidence')}:
          <Badge variant={confidenceVariant(data.response.confidence.level as AIConfidenceLevel)}>
            {t(`confidence_${data.response.confidence.level}`)}
          </Badge>
        </span>
      </header>

      {/* Summary line */}
      <div className="mt-3 flex items-start gap-2">
        <s.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.color}`} />
        <p className="text-sm text-gray-700">
          {status === 'normal' ? t('summaryNormal') : t('summaryAttention', { count: actionCount })}
        </p>
      </div>

      {status === 'normal' ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-400">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" /> {t('noIssues')}
        </p>
      ) : (
        <>
          {/* Recommended next actions */}
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {t('nextActions')}
            </p>
            <div className="flex flex-wrap gap-2">
              {briefing.nextActions.map(a => {
                const Icon = SECTION_ICON[a.section]
                return (
                  <Link
                    key={a.section}
                    href={a.href}
                    className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-teal-300 hover:bg-teal-50"
                  >
                    <Icon className="h-3.5 w-3.5 text-teal-600" />
                    {t(`action_${a.section}`)}
                    <ArrowUpRight className="h-3 w-3 opacity-50" />
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Progressive disclosure toggle */}
          <button
            type="button"
            onClick={() => setOverride(!open)}
            className="mt-3 flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? t('hideDetails') : t('viewDetails')}
          </button>

          {/* Grouped, collapsible detail sections */}
          {open && (
            <div className="mt-3 space-y-2">
              {sections.map(section => <SectionBlock key={section.section} group={section} />)}
            </div>
          )}
        </>
      )}

      {/* Subtle safety note */}
      <p className="mt-3 border-t pt-2 text-[11px] leading-tight text-muted-foreground/70">
        {t('disclaimer')}
      </p>
    </section>
  )
}

function SectionBlock({ group }: { group: BriefingSectionGroup }) {
  const t = useTranslations('briefing')
  const [open, setOpen] = useState(true)
  const Icon = SECTION_ICON[group.section]

  return (
    <div className="overflow-hidden rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 bg-gray-50/60 px-3 py-2 text-left hover:bg-gray-100/60"
      >
        <Icon className="h-4 w-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-800">{t(`section_${group.section}`)}</span>
        <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[group.level]}`} />
        <Badge variant="secondary" className="ml-auto text-xs">{group.items.length}</Badge>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
      </button>

      {open && (
        <ul className="divide-y">
          {group.items.map(item => (
            <li key={item.dataCategory} className="flex items-start gap-2.5 px-3 py-2.5">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[item.level]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-700">{t(`item_${item.dataCategory}`, { count: item.count })}</p>
                {/* Citation — preserved, shown only here in the expanded detail. */}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t('source')}: <span className="font-medium text-gray-500">{item.citation.source}</span>
                  {item.citation.date && <> · {item.citation.date}</>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
