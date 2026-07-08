'use client'

// ── Employee identity card (Phase 42) ─────────────────────────────
//
// A read-only, at-a-glance summary of a person's identity: Role · Department ·
// Primary Specialty · Professional title · License · Employee ID · Clinic ·
// Status. Presentational only — it receives already-resolved display strings, so
// it is pure and holds no data-fetching or authorization logic.

import { useTranslations } from 'next-intl'
import { IdCard } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export interface IdentityCardProps {
  role: string                    // already-resolved role label
  department: string | null       // resolved department label
  specialty: string | null        // resolved specialty label (doctors only)
  title: string | null            // professional title / position
  license: string | null          // professional license number
  employeeId: string | null       // matricule / employee number
  clinic: string | null
  active: boolean
}

export function IdentityCard(p: IdentityCardProps) {
  const t = useTranslations('identity')
  const dash = t('none')
  const rows: Array<{ label: string; value: string }> = [
    { label: t('fieldRole'),       value: p.role },
    { label: t('fieldDepartment'), value: p.department || dash },
    { label: t('fieldSpecialty'),  value: p.specialty || dash },
    { label: t('fieldTitle'),      value: p.title || dash },
    { label: t('fieldLicense'),    value: p.license || dash },
    { label: t('fieldEmployeeId'), value: p.employeeId || dash },
    { label: t('fieldClinic'),     value: p.clinic || dash },
    { label: t('fieldStatus'),     value: p.active ? t('statusActive') : t('statusInactive') },
  ]

  return (
    <Card>
      <CardContent className="p-5">
        <p className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <IdCard className="h-4 w-4 text-teal-700" /> {t('cardTitle')}
        </p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {rows.map(r => (
            <div key={r.label}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{r.label}</dt>
              <dd className="mt-0.5 truncate text-sm text-gray-800" title={r.value}>{r.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
