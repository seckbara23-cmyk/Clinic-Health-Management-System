'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { confidenceVariant, warningVariant } from '@/lib/ai/ui'
import type { StructuredAIResponse } from '@/lib/ai/types'

// Renders a structured Copilot response as cards: summary, warnings, sources
// (explainability), and a confidence badge. No diagnoses; data-only.
export function StructuredResponse({ data }: { data: StructuredAIResponse }) {
  const t = useTranslations('copilot')
  const confidenceLabel = {
    high: t('confidenceHigh'),
    medium: t('confidenceMedium'),
    low: t('confidenceLow'),
  }[data.confidence.level]

  return (
    <div className="space-y-3">
      {/* Summary */}
      <p className="whitespace-pre-line text-sm text-foreground">{data.summary}</p>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="space-y-1.5">
          {data.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <Badge variant={warningVariant(w.level)}>{w.level}</Badge>
              <span className="text-sm text-muted-foreground">{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sources (explainability) */}
      {data.citations.length > 0 && (
        <div className="rounded-md border bg-muted/30 p-2">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{t('sources')}</p>
          <ul className="space-y-1">
            {data.citations.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.source}</span>
                {c.date && <span>· {c.date}</span>}
                {c.detail && <span>· {c.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Confidence */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('confidence')}:</span>
        <Badge variant={confidenceVariant(data.confidence.level)}>{confidenceLabel}</Badge>
        {data.confidence.basedOn.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('basedOn')}: {data.confidence.basedOn.join(', ')}
          </span>
        )}
        {data.confidence.note && (
          <span className="text-xs text-muted-foreground">— {data.confidence.note}</span>
        )}
      </div>
    </div>
  )
}
