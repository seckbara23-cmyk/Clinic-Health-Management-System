'use client'

import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Loader2, Pill, Trash2, Pencil, Printer, CheckCircle, Download } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePrescriptions, useCreatePrescription, useUpdatePrescription } from '@/hooks/usePrescriptions'
import { useConsultations } from '@/hooks/useConsultations'
import { useClinic } from '@/context/ClinicContext'
import { formatDate, cn } from '@/lib/utils'
import { openPrescriptionPDF } from '@/lib/pdf'
import type { Prescription, Medication, PrescriptionStatus } from '@/types/database'

const medicationSchema = z.object({
  name:         z.string().min(1, 'Requis'),
  dosage:       z.string().min(1, 'Requis'),
  frequency:    z.string().min(1, 'Requis'),
  duration:     z.string().min(1, 'Requis'),
  instructions: z.string().optional(),
})

const createSchema = z.object({
  consultation_id: z.string().min(1, 'Consultation requise'),
  medications: z.array(medicationSchema).min(1, 'Au moins un médicament'),
  instructions: z.string().optional().nullable(),
  valid_until:  z.string().optional().nullable(),
})
type CreateForm = z.infer<typeof createSchema>

const statusColors: Record<PrescriptionStatus, string> = {
  active:    'bg-emerald-100 text-emerald-700',
  dispensed: 'bg-blue-100 text-blue-700',
  expired:   'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-500',
}
const statusLabels: Record<PrescriptionStatus, string> = {
  active:    'Active',
  dispensed: 'Délivrée',
  expired:   'Expirée',
  cancelled: 'Annulée',
}

type PrescriptionRow = Prescription & {
  patient: { id: string; full_name: string; patient_number: string }
  doctor: { id: string; full_name: string }
}

export default function PrescriptionsPage() {
  const { profile, clinic } = useClinic()
  const [createOpen, setCreateOpen] = useState(false)
  const [printTarget, setPrintTarget] = useState<PrescriptionRow | null>(null)
  const [editTarget, setEditTarget] = useState<PrescriptionRow | null>(null)

  const { data: prescriptions, isLoading } = usePrescriptions()
  const { data: consultations } = useConsultations()
  const createMutation = useCreatePrescription()
  const updateMutation = useUpdatePrescription()

  const canCreate = profile?.role === 'doctor' || profile?.role === 'admin' || profile?.role === 'super_admin'

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { medications: [{ name: '', dosage: '', frequency: '', duration: '', instructions: '' }] },
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'medications' })

  async function onSubmit(data: CreateForm) {
    const consult = consultations?.find(c => c.id === data.consultation_id)
    if (!consult) return
    await createMutation.mutateAsync({
      consultation_id: data.consultation_id,
      patient_id: consult.patient_id,
      medications: data.medications as Medication[],
      instructions: data.instructions ?? null,
      valid_until: data.valid_until ?? null,
    })
    setCreateOpen(false)
    form.reset({ medications: [{ name: '', dosage: '', frequency: '', duration: '', instructions: '' }] })
  }

  async function markDispensed(rx: PrescriptionRow) {
    await updateMutation.mutateAsync({ id: rx.id, status: 'dispensed' })
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Ordonnances" description="Gestion des prescriptions médicales" />

      <div className="flex-1 p-6 space-y-4">
        <div className="flex justify-end">
          {canCreate && (
            <Button onClick={() => { form.reset({ medications: [{ name: '', dosage: '', frequency: '', duration: '' }] }); setCreateOpen(true) }}>
              <Plus className="h-4 w-4" /> Nouvelle ordonnance
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Médecin</TableHead>
                  <TableHead>Médicaments</TableHead>
                  <TableHead>Valide jusqu&apos;au</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && (!prescriptions || prescriptions.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-gray-400">
                      <Pill className="mx-auto h-10 w-10 mb-3 opacity-30" />
                      <p>Aucune ordonnance</p>
                    </TableCell>
                  </TableRow>
                )}
                {(prescriptions as PrescriptionRow[] | undefined)?.map(rx => (
                  <TableRow key={rx.id}>
                    <TableCell className="font-medium">{rx.patient?.full_name ?? '—'}</TableCell>
                    <TableCell className="text-sm text-gray-500">{rx.doctor?.full_name ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {rx.medications.slice(0, 3).map((m, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">{m.name}</Badge>
                        ))}
                        {rx.medications.length > 3 && (
                          <Badge variant="outline" className="text-xs">+{rx.medications.length - 3}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {rx.valid_until ? formatDate(rx.valid_until) : '—'}
                    </TableCell>
                    <TableCell>
                      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', statusColors[rx.status])}>
                        {statusLabels[rx.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">{formatDate(rx.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPrintTarget(rx)} title="Aperçu impression">
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        {clinic && (
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8"
                            onClick={() => openPrescriptionPDF(rx, clinic, rx.patient?.full_name ?? '—', rx.doctor?.full_name ?? '—')}
                            title="Télécharger PDF"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {rx.status === 'active' && (
                          <>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8"
                              onClick={() => setEditTarget(rx)} title="Modifier"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              onClick={() => markDispensed(rx)} title="Marquer délivrée"
                              disabled={updateMutation.isPending}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                            </Button>
                          </>
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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nouvelle ordonnance</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Consultation *</Label>
              <Select onValueChange={v => form.setValue('consultation_id', v)}>
                <SelectTrigger><SelectValue placeholder="Sélectionner une consultation" /></SelectTrigger>
                <SelectContent>
                  {consultations?.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {(c as { patient?: { full_name?: string } }).patient?.full_name} — {formatDate(c.created_at)}
                      {c.chief_complaint ? ` (${c.chief_complaint.slice(0, 30)})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.consultation_id && (
                <p className="text-xs text-red-500">{form.formState.errors.consultation_id.message}</p>
              )}
            </div>

            {/* Medications */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Médicaments *</Label>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => append({ name: '', dosage: '', frequency: '', duration: '', instructions: '' })}
                >
                  <Plus className="h-3.5 w-3.5" /> Ajouter
                </Button>
              </div>
              {form.formState.errors.medications && (
                <p className="text-xs text-red-500">{form.formState.errors.medications.message}</p>
              )}
              {fields.map((field, idx) => (
                <div key={field.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">Médicament {idx + 1}</p>
                    {fields.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => remove(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Nom *</Label>
                      <Input {...form.register(`medications.${idx}.name`)} placeholder="Paracétamol" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Dosage *</Label>
                      <Input {...form.register(`medications.${idx}.dosage`)} placeholder="500mg" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Fréquence *</Label>
                      <Input {...form.register(`medications.${idx}.frequency`)} placeholder="3x/jour" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Durée *</Label>
                      <Input {...form.register(`medications.${idx}.duration`)} placeholder="7 jours" className="h-8 text-sm" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Instructions</Label>
                      <Input {...form.register(`medications.${idx}.instructions`)} placeholder="Prendre après les repas" className="h-8 text-sm" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Instructions générales</Label>
                <Input {...form.register('instructions')} />
              </div>
              <div className="space-y-1.5">
                <Label>Valide jusqu&apos;au</Label>
                <Input type="date" {...form.register('valid_until')} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={form.formState.isSubmitting || createMutation.isPending}>
                {(form.formState.isSubmitting || createMutation.isPending) && <Loader2 className="animate-spin" />}
                Créer l&apos;ordonnance
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Status edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Modifier le statut</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {(['active', 'dispensed', 'cancelled'] as PrescriptionStatus[]).map(s => (
              <Button
                key={s}
                variant={editTarget?.status === s ? 'default' : 'outline'}
                className="w-full justify-start"
                onClick={async () => {
                  if (!editTarget) return
                  await updateMutation.mutateAsync({ id: editTarget.id, status: s })
                  setEditTarget(null)
                }}
                disabled={updateMutation.isPending}
              >
                <span className={cn('h-2 w-2 rounded-full mr-2', statusColors[s])} />
                {statusLabels[s]}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Print dialog */}
      {printTarget && (
        <PrescriptionPrintDialog rx={printTarget} onClose={() => setPrintTarget(null)} />
      )}
    </div>
  )
}

function PrescriptionPrintDialog({ rx, onClose }: { rx: PrescriptionRow; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ordonnance — {rx.patient?.full_name}</DialogTitle>
        </DialogHeader>
        <div id="rx-print" className="space-y-4 text-sm">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Médecin: <strong>{rx.doctor?.full_name}</strong></span>
            <span>Date: <strong>{formatDate(rx.created_at)}</strong></span>
          </div>
          {rx.valid_until && (
            <p className="text-xs text-amber-600">Valable jusqu&apos;au {formatDate(rx.valid_until)}</p>
          )}
          <div className="space-y-3 border-t pt-3">
            {rx.medications.map((m, i) => (
              <div key={i} className="rounded-md bg-gray-50 p-3">
                <p className="font-semibold">{i + 1}. {m.name} — {m.dosage}</p>
                <p className="text-gray-600">{m.frequency} pendant {m.duration}</p>
                {m.instructions && <p className="text-xs text-gray-400 italic">{m.instructions}</p>}
              </div>
            ))}
          </div>
          {rx.instructions && (
            <div className="border-t pt-3">
              <p className="text-xs text-gray-500">Instructions générales:</p>
              <p>{rx.instructions}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
