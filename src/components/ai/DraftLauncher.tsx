'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useClinic } from '@/context/ClinicContext'
import { useDraft } from '@/hooks/useDraft'
import { canGenerateDraft, DRAFT_TYPES } from '@/lib/ai/drafts'
import { AI_UI_ENABLED } from '@/lib/ai/ui'
import { DraftPanel } from './DraftPanel'
import type { DraftType } from '@/lib/ai/types'
import type { Role } from '@/types/database'

// Entry point for AI-assisted drafting on a patient/consultation. Visible only
// to doctors/admins when the AI UI flag is on. Each button GENERATES a draft
// (read-only) which the clinician then reviews/edits. Nothing is saved here.
export function DraftLauncher({ patientId }: { patientId: string; consultationId?: string }) {
  const t = useTranslations('copilot')
  const { profile } = useClinic()
  const draft = useDraft()
  const [active, setActive] = useState<DraftType | null>(null)

  const role = profile?.role as Role | undefined
  if (!AI_UI_ENABLED) return null
  if (!role || !canGenerateDraft(role)) return null

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-teal-600" />
        <h2 className="text-sm font-semibold text-gray-900">{t('draftsTitle')}</h2>
        <span className="text-xs text-muted-foreground">— {t('draftsSubtitle')}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {DRAFT_TYPES.map((type: DraftType) => (
          <Button
            key={type}
            size="sm"
            variant="outline"
            disabled={draft.isPending}
            onClick={() => {
              setActive(type)
              draft.mutate({ draftType: type, patientId })
            }}
          >
            {draft.isPending && active === type && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t(`draftType_${type}`)}
          </Button>
        ))}
      </div>

      {draft.isError && <p className="mt-3 text-sm text-red-600">{draft.error.message}</p>}

      {draft.data && (
        <div className="mt-4">
          <DraftPanel key={draft.data.draft.generatedAt} draft={draft.data.draft} />
        </div>
      )}
    </div>
  )
}
