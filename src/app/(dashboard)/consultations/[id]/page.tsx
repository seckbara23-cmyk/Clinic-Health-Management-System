'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowLeft, Loader2, Activity, Receipt, CheckCircle2,
  User, Calendar, Stethoscope,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useConsultation, useUpdateConsultation, useEndConsultation, type VitalSignsInput } from '@/hooks/useConsultations'
import { useCreateInvoice } from '@/hooks/useInvoices'
import { useClinic } from '@/context/ClinicContext'
import { formatDate, formatTime, cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { VitalSigns } from '@/types/database'

const schema = z.object({
  chief_complaint: z.string().optional().nullable(),
  symptoms:        z.string().optional().nullable(),
  diagnosis:       z.string().optional().nullable(),
  treatment_plan:  z.string().optional().nullable(),
  notes:           z.string().optional().nullable(),
  follow_up_date:  z.string().optional().nullable(),
  blood_pressure:  z.string().optional().nullable(),
  heart_rate:      z.coerce.number().optional().nullable(),
  temperature:     z.coerce.number().optional().nullable(),
  weight:          z.coerce.number().optional().nullable(),
  height:          z.coerce.number().optional().nullable(),
  oxygen_saturation: z.coerce.number().optional().nullable(),
})
type FormData = z.infer<typeof schema>

const invoiceSchema = z.object({
  amount:         z.coerce.number().min(0, 'Montant requis'),
  payment_method: z.string().min(1, 'Mode de paiement requis'),
})
type InvoiceForm = z.infer<typeof invoiceSchema>

const PAYMENT_METHODS = [
  { value: 'cash',         label: 'Espèces' },
  { value: 'mobile_money', label: 'Mobile Money (Wave / Orange)' },
  { value: 'card',         label: 'Carte bancaire' },
  { value: 'insurance',    label: 'Assurance' },
  { value: 'other',        label: 'Autre' },
]

export default function ConsultationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { profile } = useClinic()
  const { data: consultation, isLoading } = useConsultation(id)
  const updateMutation = useUpdateConsultation()
  const endMutation = useEndConsultation()
  const createInvoice = useCreateInvoice()
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting, isDirty } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    values: consultation ? {
      chief_complaint: consultation.chief_complaint,
      symptoms:        consultation.symptoms,
      diagnosis:       consultation.diagnosis,
      treatment_plan:  consultation.treatment_plan,
      notes:           consultation.notes,
      follow_up_date:  consultation.follow_up_date,
      blood_pressure:  (consultation.vital_signs as VitalSigns)?.blood_pressure ?? '',
      heart_rate:      (consultation.vital_signs as VitalSigns)?.heart_rate ?? undefined,
      temperature:     (consultation.vital_signs as VitalSigns)?.temperature ?? undefined,
      weight:          (consultation.vital_signs as VitalSigns)?.weight ?? undefined,
      height:          (consultation.vital_signs as VitalSigns)?.height ?? undefined,
      oxygen_saturation: (consultation.vital_signs as VitalSigns)?.oxygen_saturation ?? undefined,
    } : {},
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceForm = useForm<InvoiceForm>({
    resolver: zodResolver(invoiceSchema) as any,
    defaultValues: { amount: 0, payment_method: 'cash' },
  })

  async function onSave(data: FormData) {
    const vital_signs: VitalSignsInput = {
      blood_pressure:    data.blood_pressure || null,
      heart_rate:        data.heart_rate || null,
      temperature:       data.temperature || null,
      weight:            data.weight || null,
      height:            data.height || null,
      oxygen_saturation: data.oxygen_saturation || null,
    }
    await updateMutation.mutateAsync({
      id,
      chief_complaint: data.chief_complaint,
      symptoms:        data.symptoms,
      diagnosis:       data.diagnosis,
      treatment_plan:  data.treatment_plan,
      notes:           data.notes,
      follow_up_date:  data.follow_up_date,
      vital_signs,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function onEnd() {
    if (isDirty) {
      await handleSubmit(onSave)()
    }
    await endMutation.mutateAsync(id)
    router.push('/queue')
  }

  async function onCreateInvoice(data: InvoiceForm) {
    if (!consultation) return
    const subtotal = data.amount
    await createInvoice.mutateAsync({
      patient_id:     consultation.patient_id,
      consultation_id: id,
      line_items:     [{ description: 'Consultation médicale', quantity: 1, unit_price: subtotal, total: subtotal }],
      subtotal,
      tax_amount:     0,
      discount_amount: 0,
      total_amount:   subtotal,
      amount_paid:    0,
      currency:       'XOF',
      status:         'draft',
      payment_method: data.payment_method,
      due_date:       null,
      paid_at:        null,
      notes:          null,
    })
    setInvoiceOpen(false)
    invoiceForm.reset()
    toast.success('Facture créée — disponible dans Facturation')
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!consultation) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-400">Consultation introuvable.</p>
      </div>
    )
  }

  const patient  = (consultation as { patient?: { full_name?: string; patient_number?: string; date_of_birth?: string | null; gender?: string | null; blood_type?: string | null; allergies?: string[] | null } }).patient
  const doctor   = (consultation as { doctor?: { full_name?: string } }).doctor
  const appointment = (consultation as { appointment?: { id: string; title: string; scheduled_at: string; notes: string | null; status: string } | null }).appointment
  const isEnded  = !!consultation.ended_at

  const genderLabel = (g: string | null | undefined) =>
    g === 'male' ? 'M' : g === 'female' ? 'F' : g === 'other' ? 'Autre' : null

  return (
    <div className="flex flex-col h-full">
      {/* Topbar */}
      <div className="flex items-center gap-3 border-b bg-white px-6 py-3">
        <Button variant="ghost" size="sm" className="gap-1 text-gray-500" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
        <div className="h-5 w-px bg-gray-200" />
        <Stethoscope className="h-4 w-4 text-teal-700" />
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 leading-tight">{patient?.full_name ?? '—'}</p>
          {appointment && (
            <p className="text-xs text-gray-400">
              {appointment.title} — {formatTime(appointment.scheduled_at)}
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isEnded && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Terminée le {formatDate(consultation.ended_at!)}
            </span>
          )}
          {!isEnded && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={() => setInvoiceOpen(true)}
                disabled={isSubmitting}
              >
                <Receipt className="h-3.5 w-3.5" /> Générer facture
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSubmit(onSave)}
                disabled={isSubmitting || updateMutation.isPending || !isDirty}
              >
                {(isSubmitting || updateMutation.isPending) ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : saved ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : null}
                Enregistrer
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                onClick={onEnd}
                disabled={endMutation.isPending}
              >
                {endMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Terminer
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left: patient card + appointment card */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4 text-teal-700" /> Patient
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <p className="font-semibold text-gray-900">{patient?.full_name}</p>
                <p className="font-mono text-xs text-gray-400">{patient?.patient_number}</p>
                {patient?.date_of_birth && (
                  <p className="text-gray-500">
                    {new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear()} ans
                    {genderLabel(patient.gender) && ` · ${genderLabel(patient.gender)}`}
                  </p>
                )}
                {patient?.blood_type && (
                  <p className="text-gray-500">Groupe: <span className="font-medium text-red-700">{patient.blood_type}</span></p>
                )}
                {patient?.allergies && patient.allergies.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Allergies</p>
                    <div className="flex flex-wrap gap-1">
                      {patient.allergies.map(a => (
                        <span key={a} className="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-xs text-red-700">{a}</span>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {appointment && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-teal-700" /> Rendez-vous
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <p className="font-medium text-gray-700">{appointment.title}</p>
                  <p className="text-gray-500">{formatTime(appointment.scheduled_at)}</p>
                  {appointment.notes && <p className="text-xs text-gray-400 italic">{appointment.notes}</p>}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-teal-700" /> Médecin
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="font-medium text-gray-700">{doctor?.full_name ?? profile?.full_name ?? '—'}</p>
                {consultation.started_at && (
                  <p className="text-xs text-gray-400 mt-1">Début: {formatTime(consultation.started_at)}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: clinical form */}
          <div className="lg:col-span-2 space-y-4">
            <form onSubmit={handleSubmit(onSave)} className="space-y-4">

              {/* Clinical fields */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Données cliniques</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[
                    { field: 'chief_complaint' as const, label: 'Motif de consultation' },
                    { field: 'symptoms'        as const, label: 'Symptômes' },
                    { field: 'diagnosis'       as const, label: 'Diagnostic' },
                    { field: 'treatment_plan'  as const, label: 'Plan de traitement' },
                    { field: 'notes'           as const, label: 'Notes cliniques' },
                  ].map(({ field, label }) => (
                    <div key={field} className="space-y-1.5">
                      <Label className="text-sm">{label}</Label>
                      <Textarea
                        {...register(field)}
                        rows={2}
                        disabled={isEnded}
                        className={cn('resize-none text-sm', isEnded && 'bg-gray-50 text-gray-600')}
                      />
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label className="text-sm">Date de suivi</Label>
                    <Input type="date" {...register('follow_up_date')} disabled={isEnded} className="max-w-48" />
                  </div>
                </CardContent>
              </Card>

              {/* Vital signs */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4 text-rose-500" /> Signes vitaux
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[
                      { field: 'blood_pressure'    as const, label: 'Tension (mmHg)',   placeholder: '120/80', type: 'text' },
                      { field: 'heart_rate'        as const, label: 'Fréq. cardiaque (bpm)', placeholder: '75',     type: 'number' },
                      { field: 'temperature'       as const, label: 'Température (°C)', placeholder: '37.0',   type: 'number', step: '0.1' },
                      { field: 'weight'            as const, label: 'Poids (kg)',       placeholder: '70',     type: 'number', step: '0.1' },
                      { field: 'height'            as const, label: 'Taille (cm)',      placeholder: '175',    type: 'number' },
                      { field: 'oxygen_saturation' as const, label: 'SpO₂ (%)',        placeholder: '98',     type: 'number' },
                    ].map(({ field, label, placeholder, type, step }) => (
                      <div key={field} className="space-y-1.5">
                        <Label className="text-xs text-gray-500">{label}</Label>
                        <Input
                          type={type}
                          step={step}
                          placeholder={placeholder}
                          {...register(field)}
                          disabled={isEnded}
                          className="h-9 text-sm"
                        />
                        {errors[field] && <p className="text-xs text-red-500">{String(errors[field]?.message)}</p>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {!isEnded && (
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={isSubmitting || updateMutation.isPending || !isDirty}
                    className="gap-1.5"
                  >
                    {(isSubmitting || updateMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                    {saved ? <><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Enregistré</> : 'Enregistrer'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* Invoice creation dialog */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Générer une facture</DialogTitle>
          </DialogHeader>
          <form onSubmit={invoiceForm.handleSubmit(onCreateInvoice)} className="space-y-4">
            <div className="rounded-lg bg-gray-50 border px-4 py-3 text-sm text-gray-700 space-y-1">
              <p className="font-medium">{patient?.full_name}</p>
              <p className="text-xs text-gray-400">Consultation médicale · {formatDate(consultation.created_at)}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Montant (XOF)</Label>
              <Input
                type="number"
                min={0}
                step={100}
                placeholder="5000"
                {...invoiceForm.register('amount')}
                className="text-lg font-semibold"
              />
              {invoiceForm.formState.errors.amount && (
                <p className="text-xs text-red-500">{invoiceForm.formState.errors.amount.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Mode de paiement</Label>
              <Select
                defaultValue="cash"
                onValueChange={v => invoiceForm.setValue('payment_method', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInvoiceOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={invoiceForm.formState.isSubmitting || createInvoice.isPending}>
                {(invoiceForm.formState.isSubmitting || createInvoice.isPending) && <Loader2 className="animate-spin h-4 w-4" />}
                Créer la facture
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
