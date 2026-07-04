'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  Stethoscope, Pill, FlaskConical, Receipt, CalendarClock, Loader2, History,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConsultations } from '@/hooks/useConsultations'
import { usePrescriptions } from '@/hooks/usePrescriptions'
import { useLabOrders } from '@/hooks/useLab'
import { useInvoices } from '@/hooks/useInvoices'
import { useAppointments } from '@/hooks/useAppointments'
import { useFormatters } from '@/hooks/useFormatters'

type EventKind = 'consultation' | 'prescription' | 'lab' | 'invoice' | 'appointment'

interface TimelineEvent {
  id: string
  kind: EventKind
  date: string
  title: string
  subtitle?: string
  href?: string
  isCurrent?: boolean
}

const ICON: Record<EventKind, React.ElementType> = {
  consultation: Stethoscope,
  prescription: Pill,
  lab: FlaskConical,
  invoice: Receipt,
  appointment: CalendarClock,
}
const ICON_COLOR: Record<EventKind, string> = {
  consultation: 'text-teal-600 bg-teal-50',
  prescription: 'text-indigo-600 bg-indigo-50',
  lab: 'text-amber-600 bg-amber-50',
  invoice: 'text-emerald-600 bg-emerald-50',
  appointment: 'text-blue-600 bg-blue-50',
}

/**
 * Read-only chronological history for the patient. Every hook here is
 * patient-scoped and shares its react-query key with the rest of the app, so
 * mounting this panel does not trigger duplicate network requests.
 */
export function ClinicalTimeline({
  patientId, currentConsultationId,
}: { patientId: string; currentConsultationId: string }) {
  const t = useTranslations('consultationDetail')
  const { formatDate, formatCurrency } = useFormatters()

  const { data: consultations, isLoading: lc } = useConsultations(patientId)
  const { data: prescriptions, isLoading: lp } = usePrescriptions(undefined, patientId)
  const { data: labOrders, isLoading: ll } = useLabOrders(patientId)
  const { data: invoices, isLoading: li } = useInvoices(undefined, patientId)
  const { data: appointments, isLoading: la } = useAppointments(undefined, patientId)

  const loading = lc || lp || ll || li || la

  const events = useMemo<TimelineEvent[]>(() => {
    const out: TimelineEvent[] = []

    for (const c of consultations ?? []) {
      out.push({
        id: `c-${c.id}`,
        kind: 'consultation',
        date: c.created_at,
        title: c.diagnosis?.trim() || c.chief_complaint?.trim() || t('timelineConsultation'),
        subtitle: c.ended_at ? t('timelineEnded') : t('timelineOngoing'),
        href: `/consultations/${c.id}`,
        isCurrent: c.id === currentConsultationId,
      })
    }

    for (const p of prescriptions ?? []) {
      const count = Array.isArray(p.medications) ? p.medications.length : 0
      out.push({
        id: `p-${p.id}`,
        kind: 'prescription',
        date: p.created_at,
        title: t('timelinePrescription', { count }),
        subtitle: t(`rxStatus_${p.status}` as 'rxStatus_active'),
      })
    }

    for (const o of labOrders ?? []) {
      const items = o.items ?? []
      const abnormal = items.filter(i => i.flag && i.flag !== 'normal').length
      const done = o.status === 'completed' || o.status === 'reviewed'
      out.push({
        id: `l-${o.id}`,
        kind: 'lab',
        date: o.created_at,
        title: t('timelineLab', { count: items.length }),
        subtitle: done
          ? (abnormal > 0 ? t('timelineLabAbnormal', { count: abnormal }) : t('timelineLabDone'))
          : t(`labStatus_${o.status}` as 'labStatus_ordered'),
        href: '/lab',
      })
    }

    for (const inv of invoices ?? []) {
      const paid = inv.status === 'paid'
      out.push({
        id: `i-${inv.id}`,
        kind: 'invoice',
        date: inv.created_at,
        title: formatCurrency(Number(inv.total_amount), inv.currency),
        subtitle: paid ? t('invoicePaid') : t('invoiceUnpaid'),
        href: '/billing',
      })
    }

    for (const a of appointments ?? []) {
      // Skip the appointment that spawned this consultation's timeline noise;
      // still show scheduled follow-ups and past visits.
      out.push({
        id: `a-${a.id}`,
        kind: 'appointment',
        date: a.scheduled_at,
        title: a.title || t('timelineAppointment'),
        subtitle: t(`apptStatus_${a.status}` as 'apptStatus_scheduled'),
        href: '/appointments',
      })
    }

    return out.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime())
  }, [consultations, prescriptions, labOrders, invoices, appointments, currentConsultationId, formatCurrency, t])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4 text-teal-700" /> {t('timelineTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
          </div>
        ) : events.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">{t('timelineEmpty')}</p>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            <ol className="relative ml-4 border-l border-gray-200 py-2 pr-3">
              {events.map(ev => {
                const Icon = ICON[ev.kind]
                const Row = (
                  <div className="flex items-start gap-2.5 py-2">
                    <span className={`-ml-[1.35rem] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-white ${ICON_COLOR[ev.kind]}`}>
                      <Icon className="h-3 w-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-gray-800">{ev.title}</p>
                        {ev.isCurrent && (
                          <span className="shrink-0 rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">
                            {t('timelineCurrent')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">
                        {formatDate(ev.date)}{ev.subtitle ? ` · ${ev.subtitle}` : ''}
                      </p>
                    </div>
                  </div>
                )
                return (
                  <li key={ev.id}>
                    {ev.href && !ev.isCurrent
                      ? <Link href={ev.href} className="block rounded-lg transition-colors hover:bg-gray-50">{Row}</Link>
                      : Row}
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
