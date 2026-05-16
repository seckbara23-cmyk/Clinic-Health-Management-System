'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { Plus, Loader2, Stethoscope, Clock, Pencil, Activity, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useClinic } from '@/context/ClinicContext'
import { usePatients } from '@/hooks/usePatients'
import { useConsultations, useUpdateConsultation, type VitalSignsInput } from '@/hooks/useConsultations'
import { formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import type { Consultation, VitalSigns } from '@/types/database'

const createSchema = z.object({
  patient_id: z.string().min(1, 'Patient requis'),
  chief_complaint: z.string().optional().nullable(),
  symptoms: z.string().optional().nullable(),
  diagnosis: z.string().optional().nullable(),
  treatment_plan: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  follow_up_date: z.string().optional().nullable(),
})
type CreateForm = z.infer<typeof createSchema>

const editSchema = z.object({
  chief_complaint: z.string().optional().nullable(),
  symptoms: z.string().optional().nullable(),
  diagnosis: z.string().optional().nullable(),
  treatment_plan: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  follow_up_date: z.string().optional().nullable(),
  blood_pressure: z.string().optional().nullable(),
  heart_rate: z.coerce.number().optional().nullable(),
  temperature: z.coerce.number().optional().nullable(),
  weight: z.coerce.number().optional().nullable(),
  height: z.coerce.number().optional().nullable(),
  oxygen_saturation: z.coerce.number().optional().nullable(),
})
type EditForm = z.infer<typeof editSchema>

const textFields = [
  { field: 'chief_complaint' as const, label: 'Motif de consultation' },
  { field: 'symptoms' as const, label: 'Symptômes' },
  { field: 'diagnosis' as const, label: 'Diagnostic' },
  { field: 'treatment_plan' as const, label: 'Plan de traitement' },
  { field: 'notes' as const, label: 'Notes' },
]

export default function ConsultationsPage() {
  const router = useRouter()
  const { clinic, profile } = useClinic()
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Consultation | null>(null)
  const qc = useQueryClient()
  const supabase = createClient()
  const { data: patientsResult } = usePatients()
  const patients = patientsResult?.data
  const { data: consultations, isLoading } = useConsultations()
  const updateMutation = useUpdateConsultation()

  const createMutation = useMutation({
    mutationFn: async (data: CreateForm) => {
      const { data: res, error } = await supabase
        .from('consultations')
        .insert({
          patient_id: data.patient_id,
          chief_complaint: data.chief_complaint ?? null,
          symptoms: data.symptoms ?? null,
          diagnosis: data.diagnosis ?? null,
          treatment_plan: data.treatment_plan ?? null,
          notes: data.notes ?? null,
          follow_up_date: data.follow_up_date ?? null,
          clinic_id: clinic!.id,
          doctor_id: profile!.id,
          started_at: new Date().toISOString(),
          vital_signs: {},
        })
        .select()
        .single()
      if (error) throw error
      return res
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['consultations', clinic?.id] })
      setCreateOpen(false)
      createForm.reset()
      router.push(`/consultations/${res.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createForm = useForm<CreateForm>({ resolver: zodResolver(createSchema) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editForm = useForm<EditForm>({ resolver: zodResolver(editSchema) as any })

  function openEdit(c: Consultation) {
    setEditTarget(c)
    const vs = c.vital_signs as VitalSignsInput | null
    editForm.reset({
      chief_complaint: c.chief_complaint,
      symptoms: c.symptoms,
      diagnosis: c.diagnosis,
      treatment_plan: c.treatment_plan,
      notes: c.notes,
      follow_up_date: c.follow_up_date,
      blood_pressure: vs?.blood_pressure ?? '',
      heart_rate: vs?.heart_rate ?? undefined,
      temperature: vs?.temperature ?? undefined,
      weight: vs?.weight ?? undefined,
      height: vs?.height ?? undefined,
      oxygen_saturation: vs?.oxygen_saturation ?? undefined,
    })
  }

  async function onEdit(data: EditForm) {
    if (!editTarget) return
    const vital_signs: VitalSignsInput = {
      blood_pressure: data.blood_pressure || null,
      heart_rate: data.heart_rate || null,
      temperature: data.temperature || null,
      weight: data.weight || null,
      height: data.height || null,
      oxygen_saturation: data.oxygen_saturation || null,
    }
    await updateMutation.mutateAsync({
      id: editTarget.id,
      chief_complaint: data.chief_complaint,
      symptoms: data.symptoms,
      diagnosis: data.diagnosis,
      treatment_plan: data.treatment_plan,
      notes: data.notes,
      follow_up_date: data.follow_up_date,
      vital_signs,
    })
    setEditTarget(null)
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Consultations" description="Historique des consultations médicales" />

      <div className="flex-1 p-6 space-y-4">
        <div className="flex justify-end">
          <Button onClick={() => { createForm.reset(); setCreateOpen(true) }}>
            <Plus className="h-4 w-4" /> Nouvelle consultation
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Médecin</TableHead>
                  <TableHead>Motif</TableHead>
                  <TableHead>Diagnostic</TableHead>
                  <TableHead>Signes vitaux</TableHead>
                  <TableHead>Suivi</TableHead>
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
                {!isLoading && (!consultations || consultations.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-gray-400">
                      <Stethoscope className="mx-auto h-10 w-10 mb-3 opacity-30" />
                      <p>Aucune consultation enregistrée</p>
                    </TableCell>
                  </TableRow>
                )}
                {consultations?.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {(c as { patient?: { full_name?: string } }).patient?.full_name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {(c as { doctor?: { full_name?: string } }).doctor?.full_name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm max-w-32 truncate">{c.chief_complaint ?? '—'}</TableCell>
                    <TableCell className="text-sm max-w-40 truncate">{c.diagnosis ?? '—'}</TableCell>
                    <TableCell className="text-xs text-gray-500">
                      {(() => {
                        const vs = c.vital_signs as VitalSigns | null
                        if (!vs || Object.values(vs).every(v => !v)) return '—'
                        return (
                          <div className="space-y-0.5">
                            {vs.blood_pressure && <div>TA: {vs.blood_pressure}</div>}
                            {vs.heart_rate && <div>FC: {vs.heart_rate} bpm</div>}
                            {vs.temperature && <div>T°: {vs.temperature}°C</div>}
                            {vs.oxygen_saturation && <div>SpO₂: {vs.oxygen_saturation}%</div>}
                          </div>
                        )
                      })()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.follow_up_date ? (
                        <span className="flex items-center gap-1 text-amber-600">
                          <Clock className="h-3 w-3" /> {formatDate(c.follow_up_date)}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">{formatDate(c.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => openEdit(c)}
                          title="Modifier"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8 text-teal-700 hover:text-teal-800 hover:bg-teal-50"
                          asChild
                          title="Ouvrir la consultation"
                        >
                          <Link href={`/consultations/${c.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Nouvelle consultation</DialogTitle></DialogHeader>
          <form onSubmit={createForm.handleSubmit(d => createMutation.mutate(d))} className="space-y-3">
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
            {textFields.map(({ field, label }) => (
              <div key={field} className="space-y-1.5">
                <Label>{label}</Label>
                <Input {...createForm.register(field)} />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>Date de suivi</Label>
              <Input type="date" {...createForm.register('follow_up_date')} />
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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifier la consultation</DialogTitle>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-4">
            {/* Clinical fields */}
            <div className="space-y-3">
              {textFields.map(({ field, label }) => (
                <div key={field} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Input {...editForm.register(field)} />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label>Date de suivi</Label>
                <Input type="date" {...editForm.register('follow_up_date')} />
              </div>
            </div>

            {/* Vital signs */}
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Activity className="h-4 w-4 text-rose-500" /> Signes vitaux
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Tension (mmHg)</Label>
                  <Input {...editForm.register('blood_pressure')} placeholder="120/80" className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Fréquence cardiaque (bpm)</Label>
                  <Input type="number" {...editForm.register('heart_rate')} placeholder="75" className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Température (°C)</Label>
                  <Input type="number" step="0.1" {...editForm.register('temperature')} placeholder="37.0" className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Poids (kg)</Label>
                  <Input type="number" step="0.1" {...editForm.register('weight')} placeholder="70" className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Taille (cm)</Label>
                  <Input type="number" {...editForm.register('height')} placeholder="175" className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">SpO₂ (%)</Label>
                  <Input type="number" {...editForm.register('oxygen_saturation')} placeholder="98" className="h-8 text-sm" />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Annuler</Button>
              <Button type="submit" disabled={editForm.formState.isSubmitting || updateMutation.isPending}>
                {(editForm.formState.isSubmitting || updateMutation.isPending) && <Loader2 className="animate-spin" />}
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
