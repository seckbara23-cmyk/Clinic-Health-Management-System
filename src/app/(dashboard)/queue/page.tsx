'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import {
  UserCheck, PhoneCall, Stethoscope, CheckCircle, Loader2,
  XCircle, AlertCircle, Clock, Users,
} from 'lucide-react'
import { QueueRowSkeleton } from '@/components/ui/skeleton'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { useAppointments, useUpdateAppointmentStatus, useCheckInPatient, useCallPatient } from '@/hooks/useAppointments'
import { useCreateConsultation } from '@/hooks/useConsultations'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { InsightsPanel } from '@/components/ai/InsightsPanel'
import type { Appointment, AppointmentStatus } from '@/types/database'

const today = new Date().toISOString().split('T')[0]

const PRIORITY_BADGE: Record<string, string> = {
  normal:    'bg-gray-100 text-gray-600',
  urgent:    'bg-amber-100 text-amber-700',
  emergency: 'bg-red-100 text-red-700 font-semibold',
}

function waitingDuration(arrivedAt: string | null, now: Date): string {
  if (!arrivedAt) return '—'
  const mins = Math.floor((now.getTime() - new Date(arrivedAt).getTime()) / 60_000)
  if (mins < 1) return '< 1 min'
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
}

function waitingMinutes(arrivedAt: string | null, now: Date): number {
  if (!arrivedAt) return 0
  return Math.floor((now.getTime() - new Date(arrivedAt).getTime()) / 60_000)
}

const ACTIVE_STATUSES: AppointmentStatus[] = ['scheduled', 'waiting', 'called', 'in_consultation', 'in_queue', 'in_progress']
const CLOSED_STATUSES: AppointmentStatus[] = ['completed', 'cancelled', 'no_show']

export default function QueuePage() {
  const router = useRouter()
  const { clinic, profile } = useClinic()
  const supabase = createClient()
  const qc = useQueryClient()
  const t = useTranslations('queue')
  const { formatTime, intlLocale } = useFormatters()
  const { data: allAppts, isLoading } = useAppointments(today)
  const updateStatus = useUpdateAppointmentStatus()
  const checkIn = useCheckInPatient()
  const callPatient = useCallPatient()
  const createConsultation = useCreateConsultation()
  const [now, setNow] = useState(new Date())

  const STATUS_CONFIG: Record<string, { label: string; dot: string; row: string }> = {
    scheduled:       { label: t('statusScheduled'),  dot: 'bg-gray-400',    row: '' },
    waiting:         { label: t('statusWaiting'),    dot: 'bg-blue-500',    row: 'bg-blue-50/40' },
    called:          { label: t('statusCalled'),     dot: 'bg-amber-500',   row: 'bg-amber-50/40' },
    in_consultation: { label: t('statusInConsult'),  dot: 'bg-emerald-500', row: 'bg-emerald-50/40' },
    completed:       { label: t('statusCompleted'),  dot: 'bg-gray-300',    row: '' },
    cancelled:       { label: t('statusCancelled'),  dot: 'bg-red-400',     row: '' },
    no_show:         { label: t('statusNoShow'),     dot: 'bg-amber-400',   row: '' },
    in_queue:        { label: t('statusInQueue'),    dot: 'bg-blue-400',    row: 'bg-blue-50/40' },
    in_progress:     { label: t('statusInProgress'), dot: 'bg-emerald-500', row: 'bg-emerald-50/40' },
  }

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!clinic) return
    const ch = supabase
      .channel('queue-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments', filter: `clinic_id=eq.${clinic.id}` },
        () => qc.invalidateQueries({ queryKey: ['appointments', clinic.id, today] }),
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [clinic, supabase, qc])

  const active = allAppts?.filter(a => ACTIVE_STATUSES.includes(a.status as AppointmentStatus)) ?? []
  const closed = allAppts?.filter(a => CLOSED_STATUSES.includes(a.status as AppointmentStatus)) ?? []

  const count = (s: string) => (allAppts ?? []).filter(a => a.status === s).length

  async function handleStartConsultation(appt: Appointment) {
    if (!profile) return
    const doctorId = appt.doctor_id ?? profile.id
    try {
      const result = await createConsultation.mutateAsync({
        patient_id: appt.patient_id,
        appointment_id: appt.id,
        doctor_id: doctorId,
      })
      await updateStatus.mutateAsync({ id: appt.id, status: 'in_consultation' })
      router.push(`/consultations/${result.id}`)
    } catch {
      toast.error(t('errorStartConsult'))
    }
  }

  const isPending = updateStatus.isPending || checkIn.isPending || callPatient.isPending || createConsultation.isPending

  const tableHeaders = (
    <tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
      <th className="text-left px-4 py-2.5 font-medium w-12">{t('colNumber')}</th>
      <th className="text-left px-4 py-2.5 font-medium">{t('colPatient')}</th>
      <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">{t('colReason')}</th>
      <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">{t('colArrival')}</th>
      <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">{t('colWait')}</th>
      <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">{t('colDoctor')}</th>
      <th className="text-left px-4 py-2.5 font-medium">{t('colStatus')}</th>
      <th className="text-right px-4 py-2.5 font-medium">{t('colActions')}</th>
    </tr>
  )

  return (
    <div className="flex flex-col h-full">
      <Topbar
        title={t('title')}
        description={`${now.toLocaleDateString(intlLocale, { weekday: 'long', day: 'numeric', month: 'long' })} — ${now.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' })}`}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        <InsightsPanel variant="queue" />

        {/* Stats strip */}
        <div className="flex flex-wrap gap-3">
          {[
            { label: t('statScheduled'), value: count('scheduled'),                                        icon: Clock,       color: 'text-gray-500' },
            { label: t('statWaiting'),   value: count('waiting') + count('in_queue'),                      icon: Users,       color: 'text-blue-600' },
            { label: t('statCalled'),    value: count('called'),                                            icon: PhoneCall,   color: 'text-amber-600' },
            { label: t('statInConsult'), value: count('in_consultation') + count('in_progress'),            icon: Stethoscope, color: 'text-emerald-600' },
            { label: t('statDone'),      value: count('completed'),                                         icon: CheckCircle, color: 'text-gray-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2.5 shadow-sm">
              <Icon className={cn('h-4 w-4', color)} />
              <span className={cn('text-lg font-bold tabular-nums', color)}>{value}</span>
              <span className="text-xs text-gray-500">{label}</span>
            </div>
          ))}
        </div>

        {isLoading && (
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b bg-gray-50">
              <div className="h-4 w-32 bg-gray-200 animate-pulse rounded" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>{tableHeaders}</thead>
                <tbody className="divide-y divide-gray-100">
                  {Array.from({ length: 5 }).map((_, i) => <QueueRowSkeleton key={i} />)}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Active queue */}
        {!isLoading && (
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b bg-gray-50">
              <p className="text-sm font-semibold text-gray-700">
                {t('activeQueueLabel', { count: active.length })}
              </p>
            </div>

            {active.length === 0 ? (
              <div className="py-16 text-center">
                <Users className="mx-auto h-10 w-10 text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">{t('emptyQueue')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>{tableHeaders}</thead>
                  <tbody className="divide-y divide-gray-100">
                    {active.map(appt => {
                      const patient = (appt as { patient?: { full_name?: string; patient_number?: string } }).patient
                      const doctor  = (appt as { doctor?: { full_name?: string } }).doctor
                      const cfg = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.scheduled

                      return (
                        <tr key={appt.id} className={cn('transition-colors hover:bg-gray-50/60', cfg.row)}>
                          <td className="px-4 py-3">
                            {appt.queue_number ? (
                              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-white text-xs font-bold">
                                {appt.queue_number}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 leading-tight">{patient?.full_name ?? '—'}</div>
                            <div className="text-xs text-gray-400 font-mono">{patient?.patient_number}</div>
                            <span className={cn('mt-1 inline-flex text-xs rounded-full px-1.5 py-0.5', PRIORITY_BADGE[appt.priority])}>
                              {appt.priority}
                            </span>
                          </td>

                          <td className="px-4 py-3 hidden md:table-cell text-gray-600 max-w-36 truncate">
                            {appt.title !== 'Consultation' ? appt.title : (appt.notes ?? 'Consultation')}
                          </td>

                          <td className="px-4 py-3 hidden lg:table-cell text-gray-500">
                            {appt.arrived_at ? formatTime(appt.arrived_at) : '—'}
                          </td>

                          <td className="px-4 py-3 hidden lg:table-cell">
                            {appt.arrived_at ? (
                              <span className={cn(
                                'font-mono text-xs font-medium',
                                waitingMinutes(appt.arrived_at, now) > 30 ? 'text-red-600' : 'text-gray-700'
                              )}>
                                {waitingDuration(appt.arrived_at, now)}
                              </span>
                            ) : '—'}
                          </td>

                          <td className="px-4 py-3 hidden md:table-cell text-gray-500 max-w-28 truncate">
                            {doctor?.full_name ?? <span className="text-gray-300">{t('notAssigned')}</span>}
                          </td>

                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
                              <span className={cn('h-2 w-2 rounded-full flex-shrink-0', cfg.dot)} />
                              {cfg.label}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-right">
                            <QueueActions
                              appt={appt}
                              isPending={isPending}
                              onCheckIn={() => checkIn.mutate(appt.id)}
                              onCall={() => callPatient.mutate(appt.id)}
                              onStartConsultation={() => handleStartConsultation(appt)}
                              onComplete={() => updateStatus.mutate({ id: appt.id, status: 'completed' })}
                              onNoShow={() => updateStatus.mutate({ id: appt.id, status: 'no_show' })}
                              onCancel={() => updateStatus.mutate({ id: appt.id, status: 'cancelled' })}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Closed entries */}
        {!isLoading && closed.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{t('closedLabel')}</p>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
              {closed.map(appt => {
                const patient = (appt as { patient?: { full_name?: string } }).patient
                const cfg = STATUS_CONFIG[appt.status] ?? STATUS_CONFIG.completed
                return (
                  <div key={appt.id} className="rounded-lg border border-dashed p-3 flex items-center justify-between opacity-60">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">{patient?.full_name ?? '—'}</p>
                      <p className="text-xs text-gray-400">{formatTime(appt.scheduled_at)}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 ml-2 flex-shrink-0">
                      <span className={cn('h-2 w-2 rounded-full', cfg.dot)} />
                      {cfg.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function QueueActions({
  appt, isPending, onCheckIn, onCall, onStartConsultation, onComplete, onNoShow, onCancel,
}: {
  appt: Appointment
  isPending: boolean
  onCheckIn: () => void
  onCall: () => void
  onStartConsultation: () => void
  onComplete: () => void
  onNoShow: () => void
  onCancel: () => void
}) {
  const t = useTranslations('queue')
  const s = appt.status

  if (s === 'scheduled' || s === 'in_queue') {
    return (
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" className="h-7 text-xs gap-1" onClick={onCheckIn} disabled={isPending}>
          <UserCheck className="h-3.5 w-3.5" /> {t('btnCheckIn')}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
          onClick={onNoShow} disabled={isPending} title={t('tooltipMarkAbsent')}>
          <AlertCircle className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }

  if (s === 'waiting') {
    return (
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
          onClick={onCall} disabled={isPending}>
          <PhoneCall className="h-3.5 w-3.5" /> {t('btnCall')}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-gray-400 hover:text-red-500 hover:bg-red-50"
          onClick={onNoShow} disabled={isPending} title={t('tooltipMarkAbsent')}>
          <AlertCircle className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }

  if (s === 'called') {
    return (
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
          onClick={onStartConsultation} disabled={isPending}>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
          {t('btnStartConsult')}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-gray-400 hover:text-red-500 hover:bg-red-50"
          onClick={onCancel} disabled={isPending} title={t('tooltipCancel')}>
          <XCircle className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }

  if (s === 'in_progress' || s === 'in_consultation') {
    return (
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
        onClick={onComplete} disabled={isPending}>
        <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> {t('btnComplete')}
      </Button>
    )
  }

  return null
}
