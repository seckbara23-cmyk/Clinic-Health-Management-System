'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, FlaskConical, Pencil } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLabRequests, useCreateLabRequest, useUpdateLabRequest } from '@/hooks/useLabRequests'
import { usePatients } from '@/hooks/usePatients'
import { useClinic } from '@/context/ClinicContext'
import { formatDate, cn } from '@/lib/utils'
import type { LabRequest, LabRequestStatus, LabRequestType, AppointmentPriority } from '@/types/database'

const createSchema = z.object({
  patient_id:    z.string().min(1, 'Patient requis'),
  test_name:     z.string().min(1, 'Examen requis'),
  test_type:     z.enum(['blood','urine','imaging','biopsy','microbiology','other']),
  priority:      z.enum(['normal','urgent','emergency']),
  clinical_notes:z.string().optional().nullable(),
})
type CreateForm = z.infer<typeof createSchema>

const resultSchema = z.object({
  result_notes: z.string().min(1, 'Résultat requis'),
  status: z.enum(['resulted','cancelled']),
})
type ResultForm = z.infer<typeof resultSchema>

const statusColors: Record<LabRequestStatus, string> = {
  ordered:    'bg-blue-100 text-blue-700',
  collected:  'bg-purple-100 text-purple-700',
  processing: 'bg-amber-100 text-amber-700',
  resulted:   'bg-emerald-100 text-emerald-700',
  cancelled:  'bg-red-100 text-red-500',
}
const statusLabels: Record<LabRequestStatus, string> = {
  ordered:    'Demandé',
  collected:  'Prélevé',
  processing: 'En cours',
  resulted:   'Résultat disponible',
  cancelled:  'Annulé',
}

const typeLabels: Record<LabRequestType, string> = {
  blood:         'Sang',
  urine:         'Urine',
  imaging:       'Imagerie',
  biopsy:        'Biopsie',
  microbiology:  'Microbiologie',
  other:         'Autre',
}

const priorityBadge: Record<string, string> = {
  normal:    'bg-gray-100 text-gray-600',
  urgent:    'bg-amber-100 text-amber-700',
  emergency: 'bg-red-100 text-red-700',
}

type LabRow = LabRequest & {
  patient: { id: string; full_name: string; patient_number: string }
  doctor: { id: string; full_name: string }
}

export default function LabRequestsPage() {
  const { profile } = useClinic()
  const [createOpen, setCreateOpen] = useState(false)
  const [resultTarget, setResultTarget] = useState<LabRow | null>(null)
  const [statusTarget, setStatusTarget] = useState<LabRow | null>(null)

  const { data: labRequests, isLoading } = useLabRequests()
  const { data: patients } = usePatients()
  const createMutation = useCreateLabRequest()
  const updateMutation = useUpdateLabRequest()

  const canCreate = ['doctor','nurse','admin','super_admin'].includes(profile?.role ?? '')

  const createForm = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { test_type: 'blood', priority: 'normal' },
  })

  const resultForm = useForm<ResultForm>({
    resolver: zodResolver(resultSchema),
    defaultValues: { status: 'resulted' },
  })

  async function onCreateSubmit(data: CreateForm) {
    await createMutation.mutateAsync({
      patient_id:     data.patient_id,
      test_name:      data.test_name,
      test_type:      data.test_type as LabRequestType,
      priority:       data.priority as AppointmentPriority,
      clinical_notes: data.clinical_notes ?? null,
    })
    setCreateOpen(false)
    createForm.reset({ test_type: 'blood', priority: 'normal' })
  }

  async function onResultSubmit(data: ResultForm) {
    if (!resultTarget) return
    await updateMutation.mutateAsync({
      id: resultTarget.id,
      status: data.status as LabRequestStatus,
      result_notes: data.result_notes,
      resulted_at: data.status === 'resulted' ? new Date().toISOString() : null,
    })
    setResultTarget(null)
    resultForm.reset({ status: 'resulted' })
  }

  async function advanceStatus(lab: LabRow) {
    const next: Partial<Record<LabRequestStatus, LabRequestStatus>> = {
      ordered: 'collected',
      collected: 'processing',
    }
    const n = next[lab.status as LabRequestStatus]
    if (n) await updateMutation.mutateAsync({ id: lab.id, status: n })
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Analyses & Examens" description="Demandes d'examens et résultats" />

      <div className="flex-1 p-6 space-y-4">
        <div className="flex justify-end">
          {canCreate && (
            <Button onClick={() => { createForm.reset({ test_type: 'blood', priority: 'normal' }); setCreateOpen(true) }}>
              <Plus className="h-4 w-4" /> Nouvelle demande
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Examen</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priorité</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Résultat</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && (!labRequests || labRequests.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-gray-400">
                      <FlaskConical className="mx-auto h-10 w-10 mb-3 opacity-30" />
                      <p>Aucune demande d&apos;examen</p>
                    </TableCell>
                  </TableRow>
                )}
                {(labRequests as LabRow[] | undefined)?.map(lab => (
                  <TableRow key={lab.id}>
                    <TableCell className="font-medium">{lab.patient?.full_name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{lab.test_name}</TableCell>
                    <TableCell className="text-sm text-gray-500">{typeLabels[lab.test_type as LabRequestType] ?? lab.test_type}</TableCell>
                    <TableCell>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', priorityBadge[lab.priority])}>
                        {lab.priority}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', statusColors[lab.status as LabRequestStatus])}>
                        {statusLabels[lab.status as LabRequestStatus] ?? lab.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm max-w-40 truncate text-gray-500">
                      {lab.result_notes ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">{formatDate(lab.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {['ordered','collected'].includes(lab.status) && (
                          <Button
                            variant="ghost" size="sm" className="h-7 text-xs"
                            onClick={() => advanceStatus(lab)}
                            disabled={updateMutation.isPending}
                          >
                            {lab.status === 'ordered' ? 'Prélever' : 'En cours'}
                          </Button>
                        )}
                        {lab.status === 'processing' && (
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8"
                            onClick={() => { resultForm.reset({ status: 'resulted' }); setResultTarget(lab) }}
                            title="Entrer résultat"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!['resulted','cancelled'].includes(lab.status) && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 text-gray-400 hover:text-gray-700"
                            onClick={() => setStatusTarget(lab)}
                            title="Changer statut"
                          >
                            <FlaskConical className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nouvelle demande d&apos;examen</DialogTitle></DialogHeader>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Patient *</Label>
              <Select onValueChange={v => createForm.setValue('patient_id', v)}>
                <SelectTrigger><SelectValue placeholder="Sélectionner un patient" /></SelectTrigger>
                <SelectContent>
                  {patients?.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              {createForm.formState.errors.patient_id && (
                <p className="text-xs text-red-500">{createForm.formState.errors.patient_id.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Nom de l&apos;examen *</Label>
              <Input {...createForm.register('test_name')} placeholder="NFS, Glycémie, Radiographie..." />
              {createForm.formState.errors.test_name && (
                <p className="text-xs text-red-500">{createForm.formState.errors.test_name.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select defaultValue="blood" onValueChange={v => createForm.setValue('test_type', v as LabRequestType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
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
              <Label>Notes cliniques</Label>
              <Input {...createForm.register('clinical_notes')} placeholder="Contexte clinique..." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={createForm.formState.isSubmitting || createMutation.isPending}>
                {(createForm.formState.isSubmitting || createMutation.isPending) && <Loader2 className="animate-spin" />}
                Demander
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Enter result dialog */}
      <Dialog open={!!resultTarget} onOpenChange={open => { if (!open) setResultTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Résultat — {resultTarget?.test_name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={resultForm.handleSubmit(onResultSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Résultat *</Label>
              <Input {...resultForm.register('result_notes')} placeholder="Résultats de l'examen..." />
              {resultForm.formState.errors.result_notes && (
                <p className="text-xs text-red-500">{resultForm.formState.errors.result_notes.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Statut final</Label>
              <Select defaultValue="resulted" onValueChange={v => resultForm.setValue('status', v as 'resulted' | 'cancelled')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="resulted">Résultat disponible</SelectItem>
                  <SelectItem value="cancelled">Annulé</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResultTarget(null)}>Annuler</Button>
              <Button type="submit" disabled={resultForm.formState.isSubmitting || updateMutation.isPending}>
                {(resultForm.formState.isSubmitting || updateMutation.isPending) && <Loader2 className="animate-spin" />}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Change status dialog */}
      <Dialog open={!!statusTarget} onOpenChange={open => { if (!open) setStatusTarget(null) }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Changer le statut</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            {(['ordered','collected','processing','cancelled'] as LabRequestStatus[]).map(s => (
              <Button
                key={s}
                variant={statusTarget?.status === s ? 'default' : 'outline'}
                className="w-full justify-start"
                onClick={async () => {
                  if (!statusTarget) return
                  await updateMutation.mutateAsync({ id: statusTarget.id, status: s })
                  setStatusTarget(null)
                }}
                disabled={updateMutation.isPending}
              >
                <span className={cn('h-2 w-2 rounded-full mr-2 inline-block', statusColors[s])} />
                {statusLabels[s]}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
