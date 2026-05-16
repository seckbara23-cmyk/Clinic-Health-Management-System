'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, CalendarDays, Clock, ChevronLeft, ChevronRight, Pencil, X, List } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useAppointments,
  useWeekAppointments,
  useCreateAppointment,
  useUpdateAppointmentStatus,
  useUpdateAppointment,
} from '@/hooks/useAppointments'
import { usePatients } from '@/hooks/usePatients'
import { useDoctors } from '@/hooks/useDoctors'
import { formatTime, formatDate, cn } from '@/lib/utils'
import type { Appointment, AppointmentPriority } from '@/types/database'

const createSchema = z.object({
  patient_id: z.string().min(1, 'Patient requis'),
  scheduled_at: z.string().min(1, 'Date/heure requise'),
  duration_min: z.number().min(5).optional(),
  priority: z.enum(['normal', 'urgent', 'emergency']).optional(),
  doctor_id: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})
type CreateForm = z.infer<typeof createSchema>

const editSchema = z.object({
  scheduled_at: z.string().min(1, 'Date/heure requise'),
  duration_min: z.number().min(5).optional(),
  priority: z.enum(['normal', 'urgent', 'emergency']).optional(),
  doctor_id: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})
type EditForm = z.infer<typeof editSchema>

const statusColors: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-800',
  in_queue: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-violet-100 text-violet-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-600',
  no_show: 'bg-red-100 text-red-800',
}
const statusLabels: Record<string, string> = {
  scheduled: 'Planifié', in_queue: 'En attente', in_progress: 'En cours',
  completed: 'Terminé', cancelled: 'Annulé', no_show: 'Absent',
}
const priorityColors: Record<string, string> = {
  normal: 'bg-gray-100 text-gray-600',
  urgent: 'bg-orange-100 text-orange-700',
  emergency: 'bg-red-100 text-red-700',
}

function getWeekStart(dateStr: string) {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

function getWeekDays(weekStart: string) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d.toISOString().split('T')[0]
  })
}

export default function AppointmentsPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Appointment | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate] = useState(today)
  const weekStart = getWeekStart(date)

  const { data: appointments, isLoading } = useAppointments(viewMode === 'list' ? date : undefined)
  const { data: weekAppts, isLoading: weekLoading } = useWeekAppointments(weekStart)
  const { data: patients } = usePatients()
  const { data: doctors } = useDoctors()
  const createMutation = useCreateAppointment()
  const statusMutation = useUpdateAppointmentStatus()
  const updateMutation = useUpdateAppointment()

  const createForm = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { duration_min: 30, priority: 'normal' },
  })

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { duration_min: 30, priority: 'normal' },
  })

  function prevDay() {
    const d = new Date(date); d.setDate(d.getDate() - 1)
    setDate(d.toISOString().split('T')[0])
  }
  function nextDay() {
    const d = new Date(date); d.setDate(d.getDate() + 1)
    setDate(d.toISOString().split('T')[0])
  }

  async function onCreate(data: CreateForm) {
    await createMutation.mutateAsync({
      patient_id: data.patient_id,
      scheduled_at: data.scheduled_at,
      duration_min: data.duration_min ?? 30,
      priority: (data.priority ?? 'normal') as AppointmentPriority,
      notes: data.notes ?? null,
      title: 'Consultation',
      status: 'scheduled',
      doctor_id: data.doctor_id ?? null,
    })
    setCreateOpen(false)
    createForm.reset()
  }

  function openEdit(appt: Appointment) {
    setEditTarget(appt)
    editForm.reset({
      scheduled_at: appt.scheduled_at.slice(0, 16),
      duration_min: appt.duration_min,
      priority: appt.priority as AppointmentPriority,
      doctor_id: appt.doctor_id,
      notes: appt.notes,
    })
  }

  async function onEdit(data: EditForm) {
    if (!editTarget) return
    await updateMutation.mutateAsync({
      id: editTarget.id,
      scheduled_at: data.scheduled_at,
      duration_min: data.duration_min ?? 30,
      priority: data.priority ?? 'normal',
      doctor_id: data.doctor_id ?? null,
      notes: data.notes ?? null,
    })
    setEditTarget(null)
  }

  async function cancelAppointment(id: string) {
    if (!confirm('Annuler ce rendez-vous ?')) return
    await statusMutation.mutateAsync({ id, status: 'cancelled' })
  }

  const stats = {
    total: appointments?.length ?? 0,
    waiting: appointments?.filter(a => a.status === 'in_queue').length ?? 0,
    inProgress: appointments?.filter(a => a.status === 'in_progress').length ?? 0,
    done: appointments?.filter(a => a.status === 'completed').length ?? 0,
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Rendez-vous & File d'attente" />

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* Date nav + view toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevDay}><ChevronLeft className="h-4 w-4" /></Button>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40" />
          <Button variant="outline" size="icon" onClick={nextDay}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setDate(today)}>Aujourd&apos;hui</Button>
          <span className="hidden text-sm text-gray-500 lg:block">{formatDate(date + 'T12:00:00', { dateStyle: 'full' })}</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg border overflow-hidden">
              <Button
                variant="ghost" size="sm"
                className={cn('rounded-none h-8 px-3', viewMode === 'list' && 'bg-blue-50 text-blue-700')}
                onClick={() => setViewMode('list')}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost" size="sm"
                className={cn('rounded-none h-8 px-3', viewMode === 'calendar' && 'bg-blue-50 text-blue-700')}
                onClick={() => setViewMode('calendar')}
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </div>
            <Button className="shrink-0" onClick={() => { createForm.reset({ duration_min: 30, priority: 'normal' }); setCreateOpen(true) }}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nouveau rendez-vous</span>
            </Button>
          </div>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Total', value: stats.total, cls: 'bg-blue-50 text-blue-700' },
            { label: 'En attente', value: stats.waiting, cls: 'bg-amber-50 text-amber-700' },
            { label: 'En cours', value: stats.inProgress, cls: 'bg-violet-50 text-violet-700' },
            { label: 'Terminés', value: stats.done, cls: 'bg-emerald-50 text-emerald-700' },
          ].map(s => (
            <div key={s.label} className={cn('rounded-xl p-4 text-center', s.cls)}>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Calendar view */}
        {viewMode === 'calendar' && (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-7 gap-2 min-w-[700px]">
              {getWeekDays(weekStart).map(day => {
                const dayAppts = (weekAppts ?? []).filter(a => a.scheduled_at.startsWith(day))
                const isToday = day === today
                const isSelected = day === date
                return (
                  <div key={day} className="min-h-40">
                    <button
                      className={cn(
                        'w-full text-center py-1.5 rounded-lg text-xs font-semibold mb-2 transition-colors',
                        isToday ? 'bg-blue-600 text-white' : isSelected ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100',
                      )}
                      onClick={() => { setDate(day); setViewMode('list') }}
                    >
                      {new Date(day + 'T12:00:00').toLocaleDateString('fr-SN', { weekday: 'short', day: 'numeric' })}
                    </button>
                    <div className="space-y-1">
                      {weekLoading && <div className="h-8 rounded bg-gray-100 animate-pulse" />}
                      {dayAppts.map(appt => {
                        const patient = (appt as { patient?: { full_name?: string } }).patient
                        return (
                          <div
                            key={appt.id}
                            className={cn(
                              'rounded-md px-2 py-1 text-xs cursor-pointer hover:opacity-80 truncate',
                              statusColors[appt.status],
                            )}
                            title={`${patient?.full_name} — ${formatTime(appt.scheduled_at)}`}
                            onClick={() => { setDate(day); setViewMode('list') }}
                          >
                            <span className="font-medium">{formatTime(appt.scheduled_at)}</span>
                            <span className="ml-1 truncate">{patient?.full_name}</span>
                          </div>
                        )
                      })}
                      {!weekLoading && dayAppts.length === 0 && (
                        <p className="text-xs text-center text-gray-300 py-2">—</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Appointment list */}
        {viewMode === 'list' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              {isLoading ? 'Chargement...' : `${appointments?.length ?? 0} rendez-vous`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!isLoading && (!appointments || appointments.length === 0) && (
              <div className="text-center py-12 text-gray-400">
                <CalendarDays className="mx-auto h-10 w-10 mb-3 opacity-30" />
                <p>Aucun rendez-vous ce jour</p>
              </div>
            )}
            {appointments?.map((appt) => {
              const patient = (appt as { patient?: { full_name?: string } }).patient
              const doctor = (appt as { doctor?: { full_name?: string } }).doctor
              const canEdit = !['completed', 'cancelled', 'no_show'].includes(appt.status)
              return (
                <div key={appt.id} className="flex flex-col gap-3 rounded-xl border p-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700 text-sm">
                      {appt.queue_number ?? '—'}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{patient?.full_name ?? '—'}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                        <Clock className="h-3 w-3 text-gray-400 shrink-0" />
                        <span className="text-xs text-gray-500">{formatTime(appt.scheduled_at)} · {appt.duration_min} min</span>
                        {doctor && <span className="text-xs text-gray-400">Dr. {doctor.full_name}</span>}
                        {appt.priority !== 'normal' && (
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', priorityColors[appt.priority])}>
                            {appt.priority === 'urgent' ? '⚠ Urgent' : '🚨 Urgence'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', statusColors[appt.status])}>
                      {statusLabels[appt.status]}
                    </span>
                    {appt.status === 'scheduled' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => statusMutation.mutate({ id: appt.id, status: 'in_queue' })}>
                        Mettre en file
                      </Button>
                    )}
                    {appt.status === 'in_queue' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => statusMutation.mutate({ id: appt.id, status: 'in_progress' })}>
                        Démarrer
                      </Button>
                    )}
                    {appt.status === 'in_progress' && (
                      <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => statusMutation.mutate({ id: appt.id, status: 'completed' })}>
                        Terminer
                      </Button>
                    )}
                    {canEdit && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(appt)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => cancelAppointment(appt.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nouveau rendez-vous</DialogTitle></DialogHeader>
          <form onSubmit={createForm.handleSubmit(onCreate)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Patient *</Label>
              <Select onValueChange={v => createForm.setValue('patient_id', v)}>
                <SelectTrigger><SelectValue placeholder="Sélectionner un patient" /></SelectTrigger>
                <SelectContent>
                  {patients?.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name} — {p.patient_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {createForm.formState.errors.patient_id && (
                <p className="text-xs text-red-500">{createForm.formState.errors.patient_id.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Médecin</Label>
              <Select onValueChange={v => createForm.setValue('doctor_id', v)}>
                <SelectTrigger><SelectValue placeholder="Sélectionner (optionnel)" /></SelectTrigger>
                <SelectContent>
                  {doctors?.map(d => <SelectItem key={d.id} value={d.id}>Dr. {d.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date et heure *</Label>
              <Input type="datetime-local" {...createForm.register('scheduled_at')} />
              {createForm.formState.errors.scheduled_at && (
                <p className="text-xs text-red-500">{createForm.formState.errors.scheduled_at.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Durée (min)</Label>
                <Input type="number" {...createForm.register('duration_min', { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label>Priorité</Label>
                <Select defaultValue="normal" onValueChange={v => createForm.setValue('priority', v as AppointmentPriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="emergency">Urgence</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input {...createForm.register('notes')} placeholder="Motif de consultation..." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={createForm.formState.isSubmitting}>
                {createForm.formState.isSubmitting && <Loader2 className="animate-spin" />}
                Créer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Modifier le rendez-vous</DialogTitle></DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Médecin</Label>
              <Select
                defaultValue={editTarget?.doctor_id ?? ''}
                onValueChange={v => editForm.setValue('doctor_id', v)}
              >
                <SelectTrigger><SelectValue placeholder="Sélectionner (optionnel)" /></SelectTrigger>
                <SelectContent>
                  {doctors?.map(d => <SelectItem key={d.id} value={d.id}>Dr. {d.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date et heure *</Label>
              <Input type="datetime-local" {...editForm.register('scheduled_at')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Durée (min)</Label>
                <Input type="number" {...editForm.register('duration_min', { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label>Priorité</Label>
                <Select
                  defaultValue={editTarget?.priority ?? 'normal'}
                  onValueChange={v => editForm.setValue('priority', v as AppointmentPriority)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="emergency">Urgence</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input {...editForm.register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Annuler</Button>
              <Button type="submit" disabled={editForm.formState.isSubmitting}>
                {editForm.formState.isSubmitting && <Loader2 className="animate-spin" />}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
