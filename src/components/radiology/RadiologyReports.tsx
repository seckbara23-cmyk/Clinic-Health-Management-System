'use client'

// ── Signed radiology reports — patient chart surface (Phase 39) ────
//
// Read-only surface that shows a patient's SIGNED radiology reports inside the
// consultation / chart, so the ordering doctor sees finalized reports in context.
// Only signed/amended reports are shown (an unsigned report is never final). No
// interpretation — it displays exactly what the radiologist authored and signed.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Radiation, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { usePatientRadiologyReports } from '@/hooks/useRadiology'
import type { RadiologyReport } from '@/lib/radiology/types'

export function RadiologyReports({ patientId }: { patientId: string }) {
  const t = useTranslations('radiology')
  const { data: reports } = usePatientRadiologyReports(patientId)
  const [open, setOpen] = useState<string | null>(null)

  if (!reports || reports.length === 0) return null   // stay invisible when there is nothing to show

  return (
    <Card className="border-teal-100">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2 border-b pb-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-700 text-white"><Radiation className="h-4 w-4" /></div>
          <p className="text-sm font-semibold text-gray-900">{t('chartTitle')}</p>
          <Badge variant="outline" className="ml-auto text-[10px]">{reports.length}</Badge>
        </div>
        <div className="divide-y">
          {reports.map((r: RadiologyReport) => {
            const isOpen = open === r.id
            return (
              <div key={r.id} className="py-1.5">
                <button onClick={() => setOpen(isOpen ? null : r.id)} className="flex w-full items-center gap-2 text-left">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                  <span className="text-sm font-medium text-gray-900">{r.modality ? t(`mod_${r.modality}`, {}) : ''} {r.examType ?? ''}</span>
                  <Badge variant="outline" className="ml-auto text-[10px]">{t(`rs_${r.reportStatus}`, {})} · {t('versionLabel', { n: r.version })}</Badge>
                  {r.signedAt && <span className="text-[10px] text-gray-400">{t('chartSigned', { date: r.signedAt.slice(0, 10) })}</span>}
                </button>
                {isOpen && (
                  <div className="mt-1 space-y-1.5 pl-5">
                    {([['sec_technique', r.technique], ['sec_resultats', r.findings], ['sec_conclusion', r.conclusion], ['sec_recommandations', r.recommendations]] as const).map(([labelKey, body]) => body && body.trim() ? (
                      <div key={labelKey}>
                        <p className="text-[11px] font-semibold text-gray-600">{t(labelKey)}</p>
                        <p className="whitespace-pre-wrap text-xs text-gray-800">{body}</p>
                      </div>
                    ) : null)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
