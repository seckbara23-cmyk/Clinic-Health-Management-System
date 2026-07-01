'use client'

import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AI_UI_ENABLED, confidenceVariant, warningVariant, summarizeInsights } from '@/lib/ai/ui'
import { useInsights } from '@/hooks/useInsights'

type Variant = 'dashboard' | 'patient' | 'pharmacy' | 'lab' | 'billing' | 'queue' | 'appointments'

// Which tool categories each page panel runs. Dashboard is a cross-cutting
// briefing (no filter); the others are page-specific.
const VARIANT_CATEGORIES: Record<Variant, string[] | undefined> = {
  dashboard: undefined,
  patient: ['patient'],
  pharmacy: ['pharmacy'],
  lab: ['lab'],
  billing: ['billing'],
  queue: ['queue'],
  appointments: ['appointments'],
}

const VARIANT_TITLE_KEY: Record<Variant, string> = {
  dashboard: 'insightsDashboard',
  patient: 'insightsPatient',
  pharmacy: 'insightsPharmacy',
  lab: 'insightsLab',
  billing: 'insightsBilling',
  queue: 'insightsQueue',
  appointments: 'insightsAppointments',
}

// Embedded, read-only AI insight panel (Phase 2). Renders one compact card per
// tool result — each with its source/citation — plus an overall confidence
// badge. Hidden entirely when the AI UI flag is off, while loading, or when the
// caller's role yields no insights for this page (respects RLS + role gating).
export function InsightsPanel({ variant }: { variant: Variant }) {
  const t = useTranslations('copilot')
  const { data, isLoading, isError } = useInsights(VARIANT_CATEGORIES[variant])

  if (!AI_UI_ENABLED) return null
  if (isLoading || isError) return null

  const results = data?.results ?? []
  if (results.length === 0) return null

  const title = t(VARIANT_TITLE_KEY[variant])
  const { hasCritical } = summarizeInsights(results)
  const confidence = data!.response.confidence

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-teal-600" />
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {hasCritical && <Badge variant="destructive">{t('needsAttention')}</Badge>}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {t('confidence')}:
          <Badge variant={confidenceVariant(confidence.level)}>
            {{ high: t('confidenceHigh'), medium: t('confidenceMedium'), low: t('confidenceLow') }[confidence.level]}
          </Badge>
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((r) => (
          <div key={r.toolId} className="rounded-lg border bg-card p-3">
            <p className="text-sm font-medium text-foreground">
              {r.summaryLine ?? `${r.dataCategory}: ${r.count}`}
            </p>
            {(r.warnings ?? []).map((w, i) => (
              <div key={i} className="mt-1.5">
                <Badge variant={warningVariant(w.level)}>{w.message}</Badge>
              </div>
            ))}
            {/* Source / citation — required on every insight card */}
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t('sources')}: <span className="font-medium text-foreground">{r.citation.source}</span>
              {r.citation.date && <> · {r.citation.date}</>}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-tight text-muted-foreground">{t('disclaimer')}</p>
    </section>
  )
}
