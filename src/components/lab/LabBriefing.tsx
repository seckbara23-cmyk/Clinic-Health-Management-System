'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles, Clock, AlertOctagon, FlaskConical, Timer, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buildLabBriefing, type LabOrderLite } from '@/lib/lab-workflow'

/**
 * Deterministic, single-card executive lab briefing (not a wall of cards).
 * Pure summary of the RLS-loaded orders — no diagnosis, no treatment advice.
 */
export function LabBriefing({ orders, nowMs }: { orders: LabOrderLite[]; nowMs: number }) {
  const t = useTranslations('labOrders')
  const b = useMemo(() => buildLabBriefing(orders, nowMs), [orders, nowMs])

  const chips = [
    { show: b.critical > 0, icon: AlertOctagon, label: t('briefCritical', { n: b.critical }), cls: 'border-red-200 bg-red-50 text-red-700' },
    { show: b.urgent > 0, icon: Timer, label: t('briefUrgent', { n: b.urgent }), cls: 'border-amber-200 bg-amber-50 text-amber-700' },
    { show: b.awaitingReview > 0, icon: FlaskConical, label: t('briefAwaitingReview', { n: b.awaitingReview }), cls: 'border-teal-200 bg-teal-50 text-teal-700' },
    { show: b.pending > 0, icon: Clock, label: t('briefPending', { n: b.pending }), cls: 'border-blue-200 bg-blue-50 text-blue-700' },
    { show: b.longestWaitHours != null, icon: Clock, label: t('briefLongestWait', { h: b.longestWaitHours ?? 0 }), cls: 'border-gray-200 bg-gray-50 text-gray-600' },
  ].filter(c => c.show)

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-teal-600" />
        <h2 className="text-sm font-semibold text-gray-900">{t('briefTitle')}</h2>
        {b.critical > 0 && <Badge variant="destructive">{t('needsAttention')}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{t('briefConfidence')}</span>
      </div>

      <p className="mt-2 flex items-center gap-2 text-sm text-gray-700">
        {b.hasIssues
          ? <>{t('briefSummary', { pending: b.pending, review: b.awaitingReview })}</>
          : <><CheckCircle2 className="h-4 w-4 text-emerald-500" /> {t('briefNoIssues')}</>}
      </p>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <span key={i} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${c.cls}`}>
              <c.icon className="h-3 w-3" /> {c.label}
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-tight text-muted-foreground/70">{t('briefDisclaimer')}</p>
    </section>
  )
}
