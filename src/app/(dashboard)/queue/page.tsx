'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Users, Clock, Stethoscope, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppointments, useUpdateAppointmentStatus } from '@/hooks/useAppointments'
import { useClinic } from '@/context/ClinicContext'
import { formatTime, cn } from '@/lib/utils'
import type { Appointment, AppointmentStatus } from '@/types/database'

const today = new Date().toISOString().split('T')[0]

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  scheduled:      { label: 'Planifié',         color: 'text-gray-600',   bg: 'bg-gray-50 border-gray-200' },
  in_queue:       { label: 'En file',          color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  in_progress:    { label: 'En consultation',  color: 'text-emerald-700',bg: 'bg-emerald-50 border-emerald-200' },
  completed:      { label: 'Terminé',          color: 'text-gray-400',   bg: 'bg-gray-50 border-gray-100' },
  cancelled:      { label: 'Annulé',           color: 'text-red-400',    bg: 'bg-red-50 border-red-100' },
  no_show:        { label: 'Absent',           color: 'text-amber-500',  bg: 'bg-amber-50 border-amber-100' },
}

const priorityBadge: Record<string, string> = {
  normal:    'bg-gray-100 text-gray-600',
  urgent:    'bg-amber-100 text-amber-700',
  emergency: 'bg-red-100 text-red-700',
}

const nextStatus: Partial<Record<AppointmentStatus, AppointmentStatus>> = {
  scheduled:   'in_queue',
  in_queue:    'in_progress',
  in_progress: 'completed',
}

const nextLabel: Partial<Record<AppointmentStatus, string>> = {
  scheduled:   'Faire entrer en file',
  in_queue:    'Débuter consultation',
  in_progress: 'Terminer',
}

export default function QueuePage() {
  const { clinic } = useClinic()
  const supabase = createClient()
  const qc = useQueryClient()
  const { data: allAppts, isLoading } = useAppointments(today)
  const updateStatus = useUpdateAppointmentStatus()
  const [now, setNow] = useState(new Date())

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Realtime subscription
  useEffect(() => {
    if (!clinic) return
    const ch = supabase
      .channel('queue-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments', filter: `clinic_id=eq.${clinic.id}` },
        () => qc.invalidateQueries({ queryKey: ['appointments', today] }),
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [clinic, supabase, qc])

  const active = allAppts?.filter(a => !['cancelled', 'no_show'].includes(a.status)) ?? []
  const byStatus = (s: AppointmentStatus) => active.filter(a => a.status === s)

  const columns: { status: AppointmentStatus; icon: React.ElementType; count: number }[] = [
    { status: 'scheduled',   icon: Clock,        count: byStatus('scheduled').length },
    { status: 'in_queue',    icon: Users,        count: byStatus('in_queue').length },
    { status: 'in_progress', icon: Stethoscope,  count: byStatus('in_progress').length },
    { status: 'completed',   icon: CheckCircle,  count: byStatus('completed').length },
  ]

  function advance(appt: Appointment) {
    const next = nextStatus[appt.status as AppointmentStatus]
    if (next) updateStatus.mutate({ id: appt.id, status: next })
  }

  function markNoShow(appt: Appointment) {
    updateStatus.mutate({ id: appt.id, status: 'no_show' })
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar
        title="Salle d'attente"
        description={`${now.toLocaleDateString('fr-SN', { weekday: 'long', day: 'numeric', month: 'long' })} — ${now.toLocaleTimeString('fr-SN', { hour: '2-digit', minute: '2-digit' })}`}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Summary row */}
        <div className="grid grid-cols-4 gap-4">
          {columns.map(({ status, icon: Icon, count }) => {
            const cfg = statusConfig[status]
            return (
              <Card key={status} className={cn('border', cfg.bg)}>
                <CardContent className="p-4 flex items-center gap-3">
                  <Icon className={cn('h-5 w-5', cfg.color)} />
                  <div>
                    <p className={cn('text-xl font-bold', cfg.color)}>{count}</p>
                    <p className="text-xs text-gray-500">{cfg.label}</p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        )}

        {/* Active queue board — 3 columns */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(['scheduled', 'in_queue', 'in_progress'] as AppointmentStatus[]).map(status => {
              const appts = byStatus(status)
              const cfg = statusConfig[status]
              return (
                <div key={status}>
                  <CardHeader className="px-0 pt-0 pb-3">
                    <CardTitle className={cn('text-sm flex items-center gap-2', cfg.color)}>
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-current text-white text-xs font-bold">
                        {appts.length}
                      </span>
                      {cfg.label}
                    </CardTitle>
                  </CardHeader>
                  <div className="space-y-3">
                    {appts.length === 0 && (
                      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-400">
                        Aucun patient
                      </div>
                    )}
                    {appts.map(appt => (
                      <QueueCard
                        key={appt.id}
                        appt={appt}
                        onAdvance={() => advance(appt)}
                        onNoShow={() => markNoShow(appt)}
                        isPending={updateStatus.isPending}
                        advanceLabel={nextLabel[appt.status as AppointmentStatus]}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* No-shows + cancelled today */}
        {(() => {
          const closed = allAppts?.filter(a => a.status === 'no_show' || a.status === 'cancelled') ?? []
          if (closed.length === 0) return null
          return (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Absents / Annulés</p>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                {closed.map(appt => (
                  <div key={appt.id} className="rounded-lg border border-dashed p-3 flex items-center justify-between opacity-60">
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        {(appt as { patient?: { full_name?: string } }).patient?.full_name ?? '—'}
                      </p>
                      <p className="text-xs text-gray-400">{formatTime(appt.scheduled_at)}</p>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize">{statusConfig[appt.status].label}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function QueueCard({
  appt, onAdvance, onNoShow, isPending, advanceLabel,
}: {
  appt: Appointment
  onAdvance: () => void
  onNoShow: () => void
  isPending: boolean
  advanceLabel?: string
}) {
  const patient = (appt as { patient?: { full_name?: string; patient_number?: string } }).patient
  const doctor  = (appt as { doctor?: { full_name?: string } }).doctor
  const cfg = statusConfig[appt.status]

  return (
    <div className={cn('rounded-lg border p-4 space-y-3', cfg.bg)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{patient?.full_name ?? '—'}</p>
          <p className="text-xs text-gray-500 font-mono">{patient?.patient_number}</p>
        </div>
        <span className={cn('text-xs font-semibold rounded-full px-2 py-0.5', priorityBadge[appt.priority])}>
          {appt.priority}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatTime(appt.scheduled_at)}
        </span>
        {doctor && <span className="truncate">{doctor.full_name}</span>}
      </div>

      {appt.notes && <p className="text-xs text-gray-500 italic truncate">{appt.notes}</p>}

      {advanceLabel && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={onAdvance}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : advanceLabel}
          </Button>
          {appt.status === 'scheduled' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              onClick={onNoShow}
              disabled={isPending}
              title="Marquer absent"
            >
              <AlertCircle className="h-3.5 w-3.5" />
            </Button>
          )}
          {appt.status === 'in_progress' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
              onClick={onNoShow}
              disabled={isPending}
              title="Annuler"
            >
              <XCircle className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
