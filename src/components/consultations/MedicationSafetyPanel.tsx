'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { ShieldCheck, ShieldAlert } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SafetyAlerts } from '@/components/pharmacy/SafetyAlerts'
import { useMedicationSafety } from '@/hooks/useMedicationSafety'
import type { Medication } from '@/types/database'

/**
 * Read-only medication-safety summary for the patient's currently active
 * medications. Reuses the Phase 8 engine (duplicate therapy, allergy, stock,
 * near-expiry, formulary, substitutions). Warnings only — never blocks.
 */
export function MedicationSafetyPanel({
  activeMeds, allergies,
}: { activeMeds: Medication[]; allergies: string[] | null }) {
  const t = useTranslations('consultationDetail')
  const safety = useMedicationSafety()

  const lines = useMemo(
    () => activeMeds.map(m => ({ medication_id: m.medication_id ?? null, name: m.name })),
    [activeMeds],
  )
  const warnings = useMemo(
    () => safety.analyzeLines(lines, allergies),
    [safety, lines, allergies],
  )

  const hasWarnings = warnings.length > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          {hasWarnings
            ? <ShieldAlert className="h-4 w-4 text-amber-500" />
            : <ShieldCheck className="h-4 w-4 text-emerald-500" />}
          {t('safetyTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activeMeds.length === 0 ? (
          <p className="text-sm text-gray-400">{t('safetyNoMeds')}</p>
        ) : hasWarnings ? (
          <SafetyAlerts warnings={warnings} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <ShieldCheck className="h-4 w-4" /> {t('safetyAllClear')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
