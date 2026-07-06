'use client'

import { use, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { logRecordView } from '@/lib/audit-client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Loader2, CheckCircle2, Stethoscope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AutoTextarea } from '@/components/ui/auto-textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { VitalsForm } from '@/components/consultations/VitalsForm'
import { PatientSummaryHeader } from '@/components/consultations/PatientSummaryHeader'
import { ClinicalTimeline } from '@/components/consultations/ClinicalTimeline'
import { QuickActions } from '@/components/consultations/QuickActions'
import { MedicationSafetyPanel } from '@/components/consultations/MedicationSafetyPanel'
import { GeneralPracticeCopilot } from '@/components/consultations/GeneralPracticeCopilot'
import { PediatricCopilot } from '@/components/consultations/PediatricCopilot'
import { ObgynCopilot } from '@/components/consultations/ObgynCopilot'
import { OrlCopilot } from '@/components/consultations/OrlCopilot'
import { CardiologyCopilot } from '@/components/consultations/CardiologyCopilot'
import { EmergencyCopilot } from '@/components/consultations/EmergencyCopilot'
import { DocumentsPanel } from '@/components/documents/DocumentsPanel'
import { InsightsPanel } from '@/components/ai/InsightsPanel'
import { DraftLauncher } from '@/components/ai/DraftLauncher'
import { useConsultation, useUpdateConsultation, useEndConsultation, useConsultations } from '@/hooks/useConsultations'
import { usePrescriptions } from '@/hooks/usePrescriptions'
import { useInvoices } from '@/hooks/useInvoices'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import type { Medication, Patient } from '@/types/database'

const schema = z.object({
  chief_complaint: z.string().optional().nullable(),
  symptoms:        z.string().optional().nullable(),
  diagnosis:       z.string().optional().nullable(),
  treatment_plan:  z.string().optional().nullable(),
  notes:           z.string().optional().nullable(),
  follow_up_date:  z.string().optional().nullable(),
})
type FormData = z.infer<typeof schema>

// Active prescription medications collapsed to a unique list (by name) for the
// summary header + safety panel. Keeps the first catalog link seen.
const ACTIVE_RX_STATES = new Set(['active', 'partially_dispensed'])

export default function ConsultationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('consultationDetail')
  const router = useRouter()

  const { data: consultation, isLoading } = useConsultation(id)
  useEffect(() => { logRecordView('consultation', id) }, [id])
  const updateMutation = useUpdateConsultation()
  const endMutation = useEndConsultation()
  const [saved, setSaved] = useState(false)

  const patientId = consultation?.patient_id ?? null

  // Patient-scoped context (RLS-scoped; query keys shared app-wide → no dupes).
  const { data: patientRx } = usePrescriptions(undefined, patientId ?? undefined)
  const { data: patientInvoices } = useInvoices(undefined, patientId ?? undefined)
  const { data: patientConsults } = useConsultations(patientId ?? undefined)

  const activeMeds = useMemo<Medication[]>(() => {
    const seen = new Set<string>()
    const out: Medication[] = []
    for (const rx of patientRx ?? []) {
      if (!ACTIVE_RX_STATES.has(rx.status)) continue
      for (const m of (rx.medications ?? [])) {
        const key = m.name.trim().toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push(m)
      }
    }
    return out
  }, [patientRx])

  const outstandingBalance = useMemo(() => {
    const OPEN = new Set(['draft', 'sent', 'partial', 'overdue'])
    return (patientInvoices ?? [])
      .filter(i => OPEN.has(i.status))
      .reduce((s, i) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0)
  }, [patientInvoices])

  const lastConsultDate = useMemo(() => {
    const prev = (patientConsults ?? [])
      .filter(c => c.id !== id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return prev[0]?.created_at ?? null
  }, [patientConsults, id])

  const clinicalFields = [
    { field: 'chief_complaint' as const, label: t('sectionChiefComplaint'), hint: t('hintChiefComplaint') },
    { field: 'symptoms'        as const, label: t('sectionHPI'),            hint: t('hintHPI') },
    { field: 'notes'           as const, label: t('sectionExam'),           hint: t('hintExam') },
    { field: 'diagnosis'       as const, label: t('sectionAssessment'),     hint: t('hintAssessment') },
    { field: 'treatment_plan'  as const, label: t('sectionPlan'),           hint: t('hintPlan') },
  ]

  const { register, handleSubmit, watch, formState: { errors, isSubmitting, isDirty } } = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    values: consultation ? {
      chief_complaint: consultation.chief_complaint,
      symptoms:        consultation.symptoms,
      diagnosis:       consultation.diagnosis,
      treatment_plan:  consultation.treatment_plan,
      notes:           consultation.notes,
      follow_up_date:  consultation.follow_up_date,
    } : {},
  })

  async function onSave(data: FormData) {
    await updateMutation.mutateAsync({
      id,
      chief_complaint: data.chief_complaint,
      symptoms:        data.symptoms,
      diagnosis:       data.diagnosis,
      treatment_plan:  data.treatment_plan,
      notes:           data.notes,
      follow_up_date:  data.follow_up_date,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function onEnd() {
    if (isDirty) await handleSubmit(onSave)()
    await endMutation.mutateAsync(id)
    router.push('/queue')
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
        <p className="text-gray-400">{t('notFound')}</p>
      </div>
    )
  }

  const patient = (consultation as { patient?: {
    id?: string; full_name?: string; patient_number?: string; date_of_birth?: string | null
    gender?: string | null; blood_type?: string | null; phone?: string | null; allergies?: string[] | null
    emergency_contact?: string | null
  } }).patient
  const allergies = patient?.allergies ?? null
  const isEnded = !!consultation.ended_at

  return (
    <div className="flex h-full flex-col">
      {/* Topbar */}
      <div className="flex shrink-0 items-center gap-3 border-b bg-white px-4 py-3 md:px-6">
        <Button variant="ghost" size="sm" className="gap-1 text-gray-500" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" /> {t('back')}
        </Button>
        <div className="h-5 w-px bg-gray-200" />
        <Stethoscope className="h-4 w-4 shrink-0 text-teal-700" />
        <p className="min-w-0 truncate font-semibold leading-tight text-gray-900">{patient?.full_name ?? '—'}</p>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isEnded ? (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="hidden sm:inline">{t('endedShort')}</span>
            </span>
          ) : (
            <>
              <Button
                size="sm" className="gap-1.5"
                onClick={handleSubmit(onSave)}
                disabled={isSubmitting || updateMutation.isPending || !isDirty}
              >
                {(isSubmitting || updateMutation.isPending)
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : saved ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : null}
                <span className="hidden sm:inline">{t('btnSave')}</span>
              </Button>
              <Button
                size="sm" variant="outline"
                className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                onClick={onEnd}
                disabled={endMutation.isPending}
              >
                {endMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <CheckCircle2 className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{t('btnEnd')}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-4 md:space-y-6">

          {/* 1. Patient summary */}
          {patient && (
            <PatientSummaryHeader
              patient={{
                id: patient.id ?? patientId ?? '',
                full_name: patient.full_name ?? '—',
                patient_number: patient.patient_number ?? '',
                date_of_birth: patient.date_of_birth ?? null,
                gender: patient.gender ?? null,
                blood_type: patient.blood_type ?? null,
                phone: patient.phone ?? null,
                allergies: patient.allergies ?? null,
              }}
              activeMeds={activeMeds}
              lastConsultDate={lastConsultDate}
              outstandingBalance={outstandingBalance}
            />
          )}

          {/* AI draft launcher (existing AI layer) */}
          <DraftLauncher patientId={consultation.patient_id} consultationId={id} />

          <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
            {/* Left: consultation editor (2/3) + vitals */}
            <div className="space-y-4 md:space-y-6 lg:col-span-2">
              <form onSubmit={handleSubmit(onSave)}>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{t('clinicalTitle')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {clinicalFields.map(({ field, label, hint }) => (
                      <div key={field} className="space-y-1.5">
                        <Label className="text-sm font-medium">{label}</Label>
                        <AutoTextarea
                          {...register(field)}
                          resizeDep={consultation.updated_at}
                          disabled={isEnded}
                          placeholder={hint}
                          className={cn('text-sm', isEnded && 'bg-gray-50 text-gray-600')}
                        />
                        {errors[field] && <p className="text-xs text-red-500">{String(errors[field]?.message)}</p>}
                      </div>
                    ))}
                    <div className="space-y-1.5">
                      <Label className="text-sm">{t('labelFollowUp')}</Label>
                      <Input type="date" {...register('follow_up_date')} disabled={isEnded} className="max-w-48" />
                    </div>
                    {!isEnded && (
                      <div className="flex justify-end pt-1">
                        <Button type="submit" size="sm" disabled={isSubmitting || updateMutation.isPending || !isDirty} className="gap-1.5">
                          {(isSubmitting || updateMutation.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {saved
                            ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> {t('btnSaved')}</>
                            : t('btnSave')}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </form>

              {/* 2. Vitals */}
              <VitalsForm consultationId={id} patientId={consultation.patient_id} isEnded={isEnded} />
            </div>

            {/* Right rail (1/3): actions, safety, timeline, AI */}
            <div className="space-y-4 md:space-y-6">
              <QuickActions
                consultationId={id}
                patientId={consultation.patient_id}
                doctorId={consultation.doctor_id}
                patientName={patient?.full_name ?? '—'}
                allergies={allergies}
              />
              <MedicationSafetyPanel activeMeds={activeMeds} allergies={allergies} />
              {/* GP Clinical Copilot — read-only, deterministic (Phase 16).
                  Renders only for a GP/un-specialised doctor with AI enabled. */}
              <GeneralPracticeCopilot
                patientId={consultation.patient_id}
                consultation={{ id, ended_at: consultation.ended_at, created_at: consultation.created_at }}
                patient={{ date_of_birth: patient?.date_of_birth ?? null, gender: patient?.gender ?? null, allergies }}
                doc={{
                  chief_complaint: watch('chief_complaint'),
                  symptoms: watch('symptoms'),
                  notes: watch('notes'),
                  diagnosis: watch('diagnosis'),
                  treatment_plan: watch('treatment_plan'),
                }}
                activeMeds={activeMeds}
                prescriptions={patientRx}
                consultations={patientConsults}
                invoices={patientInvoices}
              />
              {/* Pediatrics Clinical Copilot — read-only + vaccination recording.
                  Renders only for a pediatrics doctor with AI enabled. */}
              <PediatricCopilot
                patientId={consultation.patient_id}
                consultation={{ id, created_at: consultation.created_at }}
                patient={{ date_of_birth: patient?.date_of_birth ?? null, gender: patient?.gender ?? null, allergies, emergency_contact: patient?.emergency_contact ?? null }}
                doc={{
                  chief_complaint: watch('chief_complaint'),
                  symptoms: watch('symptoms'),
                  notes: watch('notes'),
                  diagnosis: watch('diagnosis'),
                  treatment_plan: watch('treatment_plan'),
                }}
                activeMeds={activeMeds}
                prescriptions={patientRx}
                consultations={patientConsults}
                invoices={patientInvoices}
              />
              {/* OB/GYN Clinical Copilot — read-only + pregnancy record.
                  Renders only for an OB/GYN or midwife with AI enabled. */}
              <ObgynCopilot
                patientId={consultation.patient_id}
                consultation={{ id, created_at: consultation.created_at }}
                patient={{ date_of_birth: patient?.date_of_birth ?? null, gender: patient?.gender ?? null, allergies }}
                doc={{
                  chief_complaint: watch('chief_complaint'),
                  symptoms: watch('symptoms'),
                  notes: watch('notes'),
                  diagnosis: watch('diagnosis'),
                  treatment_plan: watch('treatment_plan'),
                }}
                activeMeds={activeMeds}
                prescriptions={patientRx}
                consultations={patientConsults}
                invoices={patientInvoices}
              />
              {/* ORL / ENT Clinical Copilot — read-only + ORL event tracking.
                  Renders only for an ORL/ENT doctor with AI enabled. */}
              <OrlCopilot
                patientId={consultation.patient_id}
                consultation={{ id, created_at: consultation.created_at }}
                patient={{ allergies }}
                doc={{
                  chief_complaint: watch('chief_complaint'),
                  symptoms: watch('symptoms'),
                  notes: watch('notes'),
                  diagnosis: watch('diagnosis'),
                  treatment_plan: watch('treatment_plan'),
                }}
                activeMeds={activeMeds}
                prescriptions={patientRx}
                consultations={patientConsults}
                invoices={patientInvoices}
              />
              {/* Cardiology Clinical Copilot — read-only + cardiac event tracking.
                  Renders only for a cardiology doctor with AI enabled. */}
              <CardiologyCopilot
                patientId={consultation.patient_id}
                consultation={{ id, created_at: consultation.created_at }}
                patient={{ allergies }}
                doc={{
                  chief_complaint: watch('chief_complaint'),
                  symptoms: watch('symptoms'),
                  notes: watch('notes'),
                  diagnosis: watch('diagnosis'),
                  treatment_plan: watch('treatment_plan'),
                }}
                activeMeds={activeMeds}
                prescriptions={patientRx}
                consultations={patientConsults}
                invoices={patientInvoices}
              />
              {/* Emergency Medicine Clinical Copilot — read-only + ED event tracking.
                  Renders only for an emergency-medicine doctor with AI enabled. */}
              <EmergencyCopilot
                patientId={consultation.patient_id}
                consultation={{ id, created_at: consultation.created_at }}
                patient={{ allergies }}
                doc={{
                  chief_complaint: watch('chief_complaint'),
                  symptoms: watch('symptoms'),
                  notes: watch('notes'),
                  diagnosis: watch('diagnosis'),
                  treatment_plan: watch('treatment_plan'),
                }}
                activeMeds={activeMeds}
                prescriptions={patientRx}
                consultations={patientConsults}
                invoices={patientInvoices}
              />
              {/* Clinical Documents & Forms — shared, registry-driven (Phase 20).
                  Lists role/specialty-permitted documents; clinician edits + prints. */}
              <DocumentsPanel
                patientId={consultation.patient_id}
                consultation={consultation}
                patient={patient ? {
                  full_name: patient.full_name ?? '', patient_number: patient.patient_number ?? '',
                  date_of_birth: patient.date_of_birth ?? null, gender: (patient.gender ?? null) as Patient['gender'],
                  address: null, phone: patient.phone ?? null, cni: null,
                } : null}
              />
              <ClinicalTimeline patientId={consultation.patient_id} currentConsultationId={id} />
              <InsightsPanel variant="patient" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
