'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Stethoscope, CalendarDays, Pill, FlaskConical, Receipt, PackageCheck,
  History, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import type {
  Consultation, Appointment, Prescription, LabOrder, Invoice, MedicationDispensing,
} from '@/types/database'
import type { PatientTimelineType } from '@/lib/patient-intel'

interface RichEvent {
  id: string
  type: PatientTimelineType
  date: string
  title: string
  status?: string
  details: { label: string; value: string }[]
}

const ICON: Record<PatientTimelineType, React.ElementType> = {
  consultation: Stethoscope,
  appointment: CalendarDays,
  prescription: Pill,
  lab: FlaskConical,
  invoice: Receipt,
  dispensing: PackageCheck,
}
const ICON_COLOR: Record<PatientTimelineType, string> = {
  consultation: 'text-teal-600 bg-teal-50',
  appointment: 'text-blue-600 bg-blue-50',
  prescription: 'text-indigo-600 bg-indigo-50',
  lab: 'text-amber-600 bg-amber-50',
  invoice: 'text-emerald-600 bg-emerald-50',
  dispensing: 'text-lime-600 bg-lime-50',
}

/**
 * Merged, newest-first patient timeline with expandable details. Mirrors the
 * pure `mergePatientTimeline` contract; the rich per-type rendering lives here.
 * `include` scopes which record types appear (role-aware).
 */
export function PatientTimeline({
  consultations, appointments, prescriptions, labOrders, invoices, dispensings,
  include,
}: {
  consultations?: Consultation[]
  appointments?: Appointment[]
  prescriptions?: Prescription[]
  labOrders?: LabOrder[]
  invoices?: Invoice[]
  dispensings?: MedicationDispensing[]
  include?: PatientTimelineType[]
}) {
  const t = useTranslations('patientProfile')
  const { formatDate, formatTime, formatCurrency } = useFormatters()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const events = useMemo<RichEvent[]>(() => {
    const allow = include ? new Set(include) : null
    const out: RichEvent[] = []

    if (!allow || allow.has('consultation')) for (const c of consultations ?? []) {
      out.push({
        id: `c-${c.id}`, type: 'consultation', date: c.created_at,
        title: c.chief_complaint?.trim() || t('timelineConsultation'),
        status: c.ended_at ? 'ended' : 'ongoing',
        details: [
          ...(c.diagnosis ? [{ label: t('diagnosisLabel'), value: c.diagnosis }] : []),
          ...(c.treatment_plan ? [{ label: t('treatmentLabel'), value: c.treatment_plan }] : []),
          ...(c.follow_up_date ? [{ label: t('followUpShort'), value: formatDate(c.follow_up_date) }] : []),
        ],
      })
    }
    if (!allow || allow.has('appointment')) for (const a of appointments ?? []) {
      out.push({
        id: `a-${a.id}`, type: 'appointment', date: a.scheduled_at,
        title: a.title || t('timelineAppointment'), status: a.status,
        details: [
          { label: t('timeLabel'), value: formatTime(a.scheduled_at) },
          ...(a.notes ? [{ label: t('notesLabel'), value: a.notes }] : []),
        ],
      })
    }
    if (!allow || allow.has('prescription')) for (const p of prescriptions ?? []) {
      const meds = Array.isArray(p.medications) ? p.medications : []
      out.push({
        id: `p-${p.id}`, type: 'prescription', date: p.created_at,
        title: t('timelinePrescription', { count: meds.length }), status: p.status,
        details: meds.map(m => ({ label: m.name, value: [m.dosage, m.frequency, m.duration].filter(Boolean).join(' · ') })),
      })
    }
    if (!allow || allow.has('lab')) for (const l of labOrders ?? []) {
      const items = l.items ?? []
      out.push({
        id: `l-${l.id}`, type: 'lab', date: l.created_at,
        title: items.length === 1 ? items[0].test_name : t('timelineLab', { count: items.length }),
        status: l.status,
        details: items.filter(i => i.result_value).map(i => ({
          label: i.test_name, value: `${i.result_value}${i.unit ? ` ${i.unit}` : ''}${i.flag && i.flag !== 'normal' ? ` (${i.flag})` : ''}`,
        })),
      })
    }
    if (!allow || allow.has('invoice')) for (const inv of invoices ?? []) {
      out.push({
        id: `i-${inv.id}`, type: 'invoice', date: inv.created_at,
        title: `${inv.invoice_number} — ${formatCurrency(Number(inv.total_amount), inv.currency)}`,
        status: inv.status,
        details: [{ label: t('amountPaidLabel'), value: formatCurrency(Number(inv.amount_paid), inv.currency) }],
      })
    }
    if (!allow || allow.has('dispensing')) for (const d of dispensings ?? []) {
      out.push({
        id: `d-${d.id}`, type: 'dispensing', date: d.dispensed_at ?? d.created_at,
        title: d.medication_name, status: d.status,
        details: [{ label: t('quantityLabel'), value: `×${d.quantity_dispensed}` }],
      })
    }

    return out.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime())
  }, [consultations, appointments, prescriptions, labOrders, invoices, dispensings, include, t, formatDate, formatTime, formatCurrency])

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4 text-teal-700" /> {t('timelineTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {events.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">{t('noTimeline')}</p>
        ) : (
          <div className="max-h-[36rem] overflow-y-auto">
            <ol className="relative ml-4 border-l border-gray-200 py-2 pr-3">
              {events.map(ev => {
                const Icon = ICON[ev.type]
                const isOpen = expanded.has(ev.id)
                const hasDetails = ev.details.length > 0
                return (
                  <li key={ev.id}>
                    <div className="flex items-start gap-2.5 py-2">
                      <span className={cn('-ml-[1.35rem] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-white', ICON_COLOR[ev.type])}>
                        <Icon className="h-3 w-3" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => hasDetails && toggle(ev.id)}
                          className={cn('flex w-full items-center gap-2 text-left', hasDetails && 'cursor-pointer')}
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{ev.title}</span>
                          {ev.status && (
                            <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                              {t(`tlStatus_${ev.status}`)}
                            </span>
                          )}
                          {hasDetails && (isOpen
                            ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />)}
                        </button>
                        <p className="text-xs text-gray-400">{formatDate(ev.date)}</p>
                        {isOpen && hasDetails && (
                          <div className="mt-1.5 space-y-1 rounded-lg bg-gray-50 p-2">
                            {ev.details.map((d, i) => (
                              <div key={i} className="flex justify-between gap-2 text-xs">
                                <span className="min-w-0 truncate text-gray-500">{d.label}</span>
                                <span className="shrink-0 font-medium text-gray-700">{d.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
