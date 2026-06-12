'use client'

import { useState } from 'react'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
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
import { useMedications } from '@/hooks/useMedications'
import { useConsultations } from '@/hooks/useConsultations'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import { openPrescriptionPDF } from '@/lib/pdf'
import { logRecordView } from '@/lib/audit-client'
import { useTranslations } from 'next-intl'
import type { Prescription, Medication, PrescriptionStatus, CatalogMedication } from '@/types/database'

const statusColors: Record<PrescriptionStatus, string> = {
  active:    'bg-emerald-100 text-emerald-700',
  dispensed: 'bg-blue-100 text-blue-700',
  expired:   'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-500',
}

type PrescriptionRow = Prescription & {
  patient: { id: string; full_name: string; patient_number: string }
  doctor: { id: string; full_name: string }
}

const EMPTY_MED = {
  name: '', dosage: '', frequency: '', duration: '', instructions: '',
  medication_id: null as string | null, strength: null as string | null, dosage_form: null as string | null,
}

export default function PrescriptionsPage() {
  const t = useTranslations('prescriptions')
  const { formatDate } = useFormatters()
  const { profile, clinic } = useClinic()
  const [createOpen, setCreateOpen] = useState(false)
  const [printTarget, setPrintTarget] = useState<PrescriptionRow | null>(null)
  const [editTarget, setEditTarget] = useState<PrescriptionRow | null>(null)

  const statusLabels: Record<PrescriptionStatus, string> = {
    active:    t('statusActive'),
    dispensed: t('statusDispensed'),
    expired:   t('statusExpired'),
    cancelled: t('statusCancelled'),
  }

  const medicationSchema = z.object({
    name:         z.string().min(1, t('labelMedName')),
    dosage:       z.string().min(1, t('labelMedDosage')),
    frequency:    z.string().min(1, t('labelMedFrequency')),
    duration:     z.string().min(1, t('labelMedDuration')),
    instructions: z.string().optional(),
    // Catalog link — set when picked from the formulary, null for free text.
    medication_id: z.string().nullable().optional(),
    strength:      z.string().nullable().optional(),
    dosage_form:   z.string().nullable().optional(),
  })

  const createSchema = z.object({
    consultation_id: z.string().min(1, t('zodConsultRequired')),
    medications: z.array(medicationSchema).min(1, t('zodMinOneMed')),
    instructions: z.string().optional().nullable(),
    valid_until:  z.string().optional().nullable(),
  })
  type CreateForm = z.infer<typeof createSchema>

  const { data: prescriptions, isLoading } = usePrescriptions()
  const { data: consultations } = useConsultations()
  const createMutation = useCreatePrescription()
  const updateMutation = useUpdatePrescription()

  const canCreate = profile?.role === 'doctor' || profile?.role === 'admin' || profile?.role === 'super_admin'

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { medications: [{ ...EMPTY_MED }] },
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'medications' })
  // useWatch (not form.watch) keeps live medication values without the
  // React-Compiler "incompatible library" warning.
  const watchedMeds = useWatch({ control: form.control, name: 'medications' })

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
    form.reset({ medications: [{ ...EMPTY_MED }] })
  }

  async function markDispensed(rx: PrescriptionRow) {
    await updateMutation.mutateAsync({ id: rx.id, status: 'dispensed' })
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} description={t('subtitle')} />

      <div className="flex-1 p-6 space-y-4">
        <div className="flex justify-end">
          {canCreate && (
            <Button onClick={() => { form.reset({ medications: [{ ...EMPTY_MED }] }); setCreateOpen(true) }}>
              <Plus className="h-4 w-4" /> {t('newPrescription')}
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colPatient')}</TableHead>
                  <TableHead>{t('colDoctor')}</TableHead>
                  <TableHead>{t('colMedications')}</TableHead>
                  <TableHead>{t('colValidUntil')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead>{t('colDate')}</TableHead>
                  <TableHead className="text-right">{t('colActions')}</TableHead>
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
                      <p>{t('emptyTitle')}</p>
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
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPrintTarget(rx)}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        {clinic && (
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8"
                            onClick={() => { logRecordView('prescription', rx.id); openPrescriptionPDF(rx, clinic, rx.patient?.full_name ?? '—', rx.doctor?.full_name ?? '—') }}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {rx.status === 'active' && (
                          <>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8"
                              onClick={() => setEditTarget(rx)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              onClick={() => markDispensed(rx)}
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
          <DialogHeader><DialogTitle>{t('createTitle')}</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('labelConsultation')}</Label>
              <Select onValueChange={v => form.setValue('consultation_id', v)}>
                <SelectTrigger><SelectValue placeholder={t('selectConsultation')} /></SelectTrigger>
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
                <Label>{t('labelMedications')}</Label>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => append({ ...EMPTY_MED })}
                >
                  <Plus className="h-3.5 w-3.5" /> {t('addMedication')}
                </Button>
              </div>
              {form.formState.errors.medications && (
                <p className="text-xs text-red-500">{form.formState.errors.medications.message}</p>
              )}
              {fields.map((field, idx) => (
                <div key={field.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">{t('medicationNumber', { number: idx + 1 })}</p>
                    {fields.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => remove(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">{t('labelMedName')}</Label>
                      <MedicationCombobox
                        value={watchedMeds?.[idx]?.name ?? ''}
                        strength={watchedMeds?.[idx]?.strength ?? null}
                        dosageForm={watchedMeds?.[idx]?.dosage_form ?? null}
                        fromCatalog={!!watchedMeds?.[idx]?.medication_id}
                        placeholder={t('medNamePlaceholder')}
                        catalogLabel={t('medFromCatalog')}
                        customLabel={t('medCustom')}
                        onChange={(name) => {
                          form.setValue(`medications.${idx}.name`, name, { shouldValidate: true })
                          form.setValue(`medications.${idx}.medication_id`, null)
                          form.setValue(`medications.${idx}.strength`, null)
                          form.setValue(`medications.${idx}.dosage_form`, null)
                        }}
                        onPick={(med) => {
                          form.setValue(`medications.${idx}.name`, med.name, { shouldValidate: true })
                          form.setValue(`medications.${idx}.medication_id`, med.id)
                          form.setValue(`medications.${idx}.strength`, med.strength)
                          form.setValue(`medications.${idx}.dosage_form`, med.dosage_form)
                        }}
                      />
                      {form.formState.errors.medications?.[idx]?.name && (
                        <p className="text-xs text-red-500">{form.formState.errors.medications[idx]?.name?.message}</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('labelMedDosage')}</Label>
                      <Input {...form.register(`medications.${idx}.dosage`)} placeholder={t('medDosagePlaceholder')} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('labelMedFrequency')}</Label>
                      <Input {...form.register(`medications.${idx}.frequency`)} placeholder={t('medFrequencyPlaceholder')} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('labelMedDuration')}</Label>
                      <Input {...form.register(`medications.${idx}.duration`)} placeholder={t('medDurationPlaceholder')} className="h-8 text-sm" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">{t('labelMedInstructions')}</Label>
                      <Input {...form.register(`medications.${idx}.instructions`)} placeholder={t('medInstructionsPlaceholder')} className="h-8 text-sm" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t('labelGeneralInstructions')}</Label>
                <Input {...form.register('instructions')} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('labelValidUntil')}</Label>
                <Input type="date" {...form.register('valid_until')} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={form.formState.isSubmitting || createMutation.isPending}>
                {(form.formState.isSubmitting || createMutation.isPending) && <Loader2 className="animate-spin" />}
                {t('createBtn')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Status edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t('editStatusTitle')}</DialogTitle></DialogHeader>
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
  const t = useTranslations('prescriptions')
  const { formatDate } = useFormatters()
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rx.patient?.full_name}</DialogTitle>
        </DialogHeader>
        <div id="rx-print" className="space-y-4 text-sm">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{t('printDoctorLabel')}: <strong>{rx.doctor?.full_name}</strong></span>
            <span>{t('printDateLabel')}: <strong>{formatDate(rx.created_at)}</strong></span>
          </div>
          {rx.valid_until && (
            <p className="text-xs text-amber-600">{t('printValidUntil', { date: formatDate(rx.valid_until) })}</p>
          )}
          <div className="space-y-3 border-t pt-3">
            {rx.medications.map((m, i) => (
              <div key={i} className="rounded-md bg-gray-50 p-3">
                <p className="font-semibold">
                  {i + 1}. {m.name} — {m.dosage}
                  {m.dosage_form && <span className="ml-2 text-xs font-normal text-gray-400">({m.dosage_form})</span>}
                </p>
                <p className="text-gray-600">{m.frequency} {m.duration}</p>
                {m.instructions && <p className="text-xs text-gray-400 italic">{m.instructions}</p>}
              </div>
            ))}
          </div>
          {rx.instructions && (
            <div className="border-t pt-3">
              <p className="text-xs text-gray-500">{t('printGeneralInstructions')}</p>
              <p>{rx.instructions}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('close')}</Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t('print')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Searchable medication picker over the formulary (migration 029), with a
// free-text fallback for custom medicines. Picking a catalog item snapshots
// its strength/dosage_form onto the prescription; typing freely clears them.
function MedicationCombobox({
  value, strength, dosageForm, fromCatalog, placeholder, catalogLabel, customLabel, onChange, onPick,
}: {
  value: string
  strength: string | null
  dosageForm: string | null
  fromCatalog: boolean
  placeholder: string
  catalogLabel: string
  customLabel: string
  onChange: (name: string) => void
  onPick: (med: CatalogMedication) => void
}) {
  // Controlled directly by the form field value (no internal mirror state) so
  // typing = free text and picking = catalog selection, both via callbacks.
  const [open, setOpen] = useState(false)
  const { data: results } = useMedications(value)

  return (
    <div className="relative">
      <Input
        value={value}
        placeholder={placeholder}
        className="h-8 text-sm"
        autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && value.trim().length >= 2 && (results?.length ?? 0) > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-white shadow-lg">
          {results!.map(med => (
            <button
              key={med.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onPick(med); setOpen(false) }}
            >
              <span className="truncate">{med.name}</span>
              {med.dosage_form && <span className="shrink-0 text-xs text-gray-400">{med.dosage_form}</span>}
            </button>
          ))}
        </div>
      )}
      {(fromCatalog || strength || dosageForm) && (
        <p className="mt-1 flex items-center gap-2 text-xs text-gray-400">
          {[strength, dosageForm].filter(Boolean).join(' · ')}
          <span className={cn('rounded px-1.5 py-0.5 text-[10px]', fromCatalog ? 'bg-teal-50 text-teal-600' : 'bg-gray-100 text-gray-400')}>
            {fromCatalog ? catalogLabel : customLabel}
          </span>
        </p>
      )}
    </div>
  )
}
