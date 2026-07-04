'use client'

import { useTranslations } from 'next-intl'
import {
  Phone, Droplet, IdCard, ShieldCheck, MessageSquare, FileCheck2, CircleUserRound,
  CalendarClock, CalendarPlus, Wallet, Pill, FlaskConical,
} from 'lucide-react'
import { useFormatters } from '@/hooks/useFormatters'
import { age, cn } from '@/lib/utils'
import type { HealthScore } from '@/lib/patient-intel'
import type { PatientCapabilities } from '@/lib/patient-intel'
import type { Patient } from '@/types/database'

export interface PatientMetrics {
  lastConsult: string | null
  upcomingAppointment: string | null
  outstandingBalance: number
  activePrescriptions: number
  pendingLabOrders: number
}

/**
 * Executive patient summary — identity, status chips, quick metrics and the
 * operational completeness score. Read-only; role-aware via `caps`.
 */
export function PatientHeader({
  patient, healthScore, metrics, caps,
}: {
  patient: Patient
  healthScore: HealthScore
  metrics: PatientMetrics
  caps: PatientCapabilities
}) {
  const t = useTranslations('patientProfile')
  const { formatDate, formatCurrency } = useFormatters()

  const genderLabel =
    patient.gender === 'male' ? t('genderMale')
    : patient.gender === 'female' ? t('genderFemale')
    : patient.gender === 'other' ? t('genderOther') : null

  const chips = [
    { show: !patient.deleted_at, icon: CircleUserRound, label: t('chipActive'), cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    { show: !!patient.insurance_payer_type, icon: ShieldCheck, label: t('chipInsured'), cls: 'border-blue-200 bg-blue-50 text-blue-700' },
    { show: patient.sms_opt_in, icon: MessageSquare, label: t('chipSms'), cls: 'border-violet-200 bg-violet-50 text-violet-700' },
    { show: patient.consent_given, icon: FileCheck2, label: t('chipConsent'), cls: 'border-teal-200 bg-teal-50 text-teal-700' },
  ].filter(c => c.show)

  const metricCards = [
    { show: caps.medical, icon: CalendarClock, label: t('metricLastConsult'), value: metrics.lastConsult ? formatDate(metrics.lastConsult) : t('metricNone') },
    { show: caps.appointments || caps.medical, icon: CalendarPlus, label: t('metricUpcoming'), value: metrics.upcomingAppointment ? formatDate(metrics.upcomingAppointment) : t('metricNone') },
    { show: caps.financial, icon: Wallet, label: t('metricBalance'), value: formatCurrency(metrics.outstandingBalance), tone: metrics.outstandingBalance > 0 ? 'warn' : 'ok' },
    { show: caps.medical || caps.medications, icon: Pill, label: t('metricActiveRx'), value: String(metrics.activePrescriptions) },
    { show: caps.medical || caps.labs, icon: FlaskConical, label: t('metricPendingLabs'), value: String(metrics.pendingLabOrders) },
  ].filter(m => m.show)

  const scoreColor =
    healthScore.score >= 80 ? 'text-emerald-600' : healthScore.score >= 50 ? 'text-amber-600' : 'text-red-600'
  const scoreRing =
    healthScore.score >= 80 ? 'stroke-emerald-500' : healthScore.score >= 50 ? 'stroke-amber-500' : 'stroke-red-500'

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-start gap-4">
        {/* Avatar + identity */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xl font-bold text-teal-700">
            {patient.full_name[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-gray-900 md:text-xl">{patient.full_name}</h1>
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
            {/* Status chips */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map(c => (
                <span key={c.label} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', c.cls)}>
                  <c.icon className="h-3 w-3" /> {c.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Completeness score */}
        <div className="ml-auto flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0">
            <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-gray-100" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.5" fill="none"
                className={scoreRing} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${(healthScore.score / 100) * 97.4} 97.4`}
              />
            </svg>
            <div className={cn('absolute inset-0 flex items-center justify-center text-sm font-bold', scoreColor)}>
              {healthScore.score}%
            </div>
          </div>
          <div className="max-w-[10rem] text-xs text-gray-500">
            <p className="font-semibold text-gray-700">{t('scoreTitle')}</p>
            {healthScore.missing.length === 0
              ? <p className="text-emerald-600">{t('scoreComplete')}</p>
              : <p>{t('scoreMissing', { fields: healthScore.missing.map(m => t(`scoreField_${m}`)).join(', ') })}</p>}
          </div>
        </div>
      </div>

      {/* Quick metrics */}
      {metricCards.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 border-t pt-3 sm:grid-cols-3 lg:grid-cols-5">
          {metricCards.map(m => (
            <div
              key={m.label}
              className={cn(
                'rounded-xl border px-3 py-2',
                m.tone === 'warn' ? 'border-amber-200 bg-amber-50' : m.tone === 'ok' ? 'border-emerald-200 bg-emerald-50' : 'bg-gray-50',
              )}
            >
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                <m.icon className="h-3 w-3" /> {m.label}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-gray-800">{m.value}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
