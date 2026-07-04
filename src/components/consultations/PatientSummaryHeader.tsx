'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  Phone, Droplet, Pill, CalendarClock, Wallet, AlertTriangle, IdCard, ExternalLink,
} from 'lucide-react'
import { useFormatters } from '@/hooks/useFormatters'
import { age } from '@/lib/utils'
import type { Medication } from '@/types/database'

export interface PatientSummary {
  id: string
  full_name: string
  patient_number: string
  date_of_birth: string | null
  gender: string | null
  blood_type: string | null
  phone: string | null
  allergies: string[] | null
  /** Chronic conditions — not in the current schema; shown only when present. */
  chronic_conditions?: string[] | null
}

interface Props {
  patient: PatientSummary
  activeMeds: Medication[]
  lastConsultDate: string | null
  outstandingBalance: number
  currency?: string
}

/**
 * Compact, responsive summary shown at the top of the consultation workspace.
 * Read-only — every value comes from RLS-scoped queries resolved by the caller.
 */
export function PatientSummaryHeader({
  patient, activeMeds, lastConsultDate, outstandingBalance, currency = 'XOF',
}: Props) {
  const t = useTranslations('consultationDetail')
  const { formatDate, formatCurrency } = useFormatters()

  const genderLabel =
    patient.gender === 'male' ? t('genderM')
    : patient.gender === 'female' ? t('genderF')
    : patient.gender === 'other' ? t('genderOther') : null

  const initials = patient.full_name.slice(0, 1).toUpperCase()
  const allergies = patient.allergies ?? []
  const chronic = patient.chronic_conditions ?? []

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal-100 text-lg font-bold text-teal-700">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-gray-900">{patient.full_name}</h1>
              <Link
                href={`/patients/${patient.id}`}
                className="text-gray-300 hover:text-teal-600"
                title={t('openProfile')}
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1 font-mono text-blue-600">
                <IdCard className="h-3 w-3" /> {patient.patient_number}
              </span>
              {patient.date_of_birth && <span>· {age(patient.date_of_birth)} {t('ageUnit')}</span>}
              {genderLabel && <span>· {genderLabel}</span>}
              {patient.blood_type && (
                <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                  <Droplet className="h-3 w-3" /> {patient.blood_type}
                </span>
              )}
              {patient.phone && (
                <a href={`tel:${patient.phone}`} className="inline-flex items-center gap-1 hover:text-blue-600">
                  <Phone className="h-3 w-3" /> {patient.phone}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Right-aligned stat chips */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StatChip
            icon={CalendarClock}
            label={t('summaryLastConsult')}
            value={lastConsultDate ? formatDate(lastConsultDate) : t('summaryNone')}
          />
          <StatChip
            icon={Wallet}
            label={t('summaryBalance')}
            value={formatCurrency(outstandingBalance, currency)}
            tone={outstandingBalance > 0 ? 'warn' : 'ok'}
          />
        </div>
      </div>

      {/* Allergies + chronic + active meds */}
      <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-3">
        <SummaryList
          icon={AlertTriangle}
          iconClass="text-red-500"
          title={t('summaryAllergies')}
          empty={t('summaryNoAllergies')}
          items={allergies}
          chipClass="border-red-200 bg-red-50 text-red-700"
        />
        <SummaryList
          icon={Pill}
          iconClass="text-teal-600"
          title={t('summaryActiveMeds')}
          empty={t('summaryNoMeds')}
          items={activeMeds.map(m => m.name)}
          chipClass="border-teal-200 bg-teal-50 text-teal-700"
        />
        {chronic.length > 0 ? (
          <SummaryList
            icon={Droplet}
            iconClass="text-violet-600"
            title={t('summaryChronic')}
            empty=""
            items={chronic}
            chipClass="border-violet-200 bg-violet-50 text-violet-700"
          />
        ) : (
          <div className="text-xs text-gray-400">
            <p className="mb-1 font-semibold uppercase tracking-wide">{t('summaryChronic')}</p>
            <p>{t('summaryNone')}</p>
          </div>
        )}
      </div>
    </section>
  )
}

function StatChip({
  icon: Icon, label, value, tone = 'neutral',
}: { icon: React.ElementType; label: string; value: string; tone?: 'neutral' | 'ok' | 'warn' }) {
  const toneClass =
    tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800'
    : tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-gray-200 bg-gray-50 text-gray-700'
  return (
    <div className={`rounded-xl border px-3 py-1.5 ${toneClass}`}>
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function SummaryList({
  icon: Icon, iconClass, title, empty, items, chipClass,
}: {
  icon: React.ElementType; iconClass: string; title: string; empty: string
  items: string[]; chipClass: string
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        <Icon className={`h-3 w-3 ${iconClass}`} /> {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.slice(0, 8).map((it, i) => (
            <span key={`${it}-${i}`} className={`rounded-full border px-2 py-0.5 text-xs ${chipClass}`}>
              {it}
            </span>
          ))}
          {items.length > 8 && <span className="text-xs text-gray-400">+{items.length - 8}</span>}
        </div>
      )}
    </div>
  )
}
