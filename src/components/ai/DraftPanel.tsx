'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { confidenceVariant, warningVariant } from '@/lib/ai/ui'
import type { StructuredDraft } from '@/lib/ai/types'

// Renders a StructuredDraft for clinician review. Editable textareas per section
// (local state only — NOTHING is saved automatically; the clinician copies the
// reviewed text into the record via the normal form). Shows the mandatory draft
// badge + disclaimer, warnings, sources and confidence.
export function DraftPanel({ draft }: { draft: StructuredDraft }) {
  const t = useTranslations('copilot')
  // Local-only edits. The parent remounts this via key={draft.generatedAt} when
  // a fresh draft is generated, so no reset effect is needed.
  const [sections, setSections] = useState(draft.sections)

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-amber-50/40 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-teal-600" />
        <h3 className="text-sm font-semibold text-gray-900">{draft.title}</h3>
        <Badge variant="warning">{t('draftBadge')}</Badge>
        <Badge variant={confidenceVariant(draft.confidence.level)}>
          {t('confidence')}: {{ high: t('confidenceHigh'), medium: t('confidenceMedium'), low: t('confidenceLow') }[draft.confidence.level]}
        </Badge>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {t('generatedAt')}: {draft.generatedAt.replace('T', ' ').slice(0, 16)}
        </span>
      </div>

      {/* Mandatory review notice */}
      <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {t('draftDisclaimer')}
      </p>

      {/* Warnings (e.g. allergies) */}
      {draft.warnings.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {draft.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <Badge variant={warningVariant(w.level)}>{w.level}</Badge>
              <span className="text-sm text-gray-700">{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Editable sections (local only) */}
      <div className="space-y-3">
        {sections.map((s, i) => (
          <div key={s.key}>
            <label className="mb-1 block text-xs font-semibold text-gray-600">{s.label}</label>
            <textarea
              className="w-full rounded-md border bg-white p-2 text-sm"
              rows={Math.min(8, Math.max(2, s.content.split('\n').length + 1))}
              value={s.content}
              readOnly={!s.editable}
              onChange={(e) => {
                const next = [...sections]
                next[i] = { ...s, content: e.target.value }
                setSections(next)
              }}
            />
          </div>
        ))}
      </div>

      {/* Sources */}
      {draft.citations.length > 0 && (
        <div className="mt-3 rounded-md border bg-white/70 p-2">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{t('sources')}</p>
          <ul className="space-y-0.5">
            {draft.citations.map((c, i) => (
              <li key={i} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.source}</span>
                {c.date && <> · {c.date}</>}
                {c.detail && <> · {c.detail}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-tight text-muted-foreground">{t('draftReviewNote')}</p>
    </div>
  )
}
