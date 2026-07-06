'use client'

// ── Obstetrics & Gynecology Clinical Copilot — panel (Phase 18) ────
//
// Third production Copilot. READ-ONLY intelligence (brief, ANC tracking,
// women's-health reminders, completeness, medication review, lab/ultrasound
// follow-up) plus ONE clinician-initiated write: recording a pregnancy episode
// (LMP / status — factual data entry, RLS-gated; not the Copilot acting). It
// NEVER diagnoses, recommends treatment/delivery method, prescribes, interprets
// fetal monitoring / ultrasound, or classifies risk (pregnancy medication safety
// is a labelled placeholder). Gestational age / EDD are calendar arithmetic.
// Extends and reuses the GP engine — no duplication.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Stethoscope, Baby, HeartPulse, FileText, ClipboardCheck, Pill, FlaskConical,
  ShieldQuestion, Save, Loader2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useProfessionalIdentity } from '@/hooks/useProfessionalIdentity'
import { useClinicConfig } from '@/hooks/useClinicConfig'
import { useMedicationSafety } from '@/hooks/useMedicationSafety'
import { useLabOrders } from '@/hooks/useLab'
import { useAppointments } from '@/hooks/useAppointments'
import { useLatestPatientVitals } from '@/hooks/useVitals'
import { useFormatters } from '@/hooks/useFormatters'
import { usePregnancy, useSavePregnancy } from '@/hooks/useObgyn'
import {
  isObgynContext, buildPregnancyTracking, buildWomensHealthReminders,
  computeObgynCompleteness, buildObgynMedicationReview, buildLabUltrasoundFollowUp,
  buildObgynBrief, estimateDueDate, computeGestationalAge, OBGYN_COPILOT_PACK_ID,
  type PregnancyStatus,
} from '@/lib/obgyn/engine'
import { ageFrom, type ConsultationDoc } from '@/lib/gp-copilot'
import { OBGYN_SMART_TEMPLATE_IDS } from '@/lib/templates/registry'
import type { Consultation, Invoice, Medication, Prescription } from '@/types/database'

interface Props {
  patientId: string
  consultation: { id: string; created_at: string }
  patient: { date_of_birth?: string | null; gender?: string | null; allergies?: string[] | null }
  doc: ConsultationDoc
  activeMeds: Medication[]
  prescriptions?: Prescription[]
  consultations?: Consultation[]
  invoices?: Invoice[]
}

const OPEN_INVOICE = new Set(['draft', 'sent', 'partial', 'overdue'])
const UPCOMING_APPT = new Set(['scheduled', 'waiting', 'called', 'in_consultation', 'in_queue', 'in_progress'])
const STATUSES: PregnancyStatus[] = ['ongoing', 'postpartum', 'completed', 'ended']

export function ObgynCopilot(props: Props) {
  const t = useTranslations('obgynCopilot')
  const { formatCurrency, formatDate } = useFormatters()
  const identity = useProfessionalIdentity()
  const { ai } = useClinicConfig()

  const active = isObgynContext(identity.profession.id, identity.specialties.primary?.id ?? null)
  const aiOn = ai('patient_intelligence')

  const safety = useMedicationSafety()
  const { data: pregnancy } = usePregnancy(props.patientId)
  const { data: labs } = useLabOrders(props.patientId)
  const { data: appts } = useAppointments(undefined, props.patientId)
  const { data: vitals } = useLatestPatientVitals(props.patientId)
  const savePregnancy = useSavePregnancy()

  const now = useMemo(() => new Date(), [])

  const hasRecentVitals = !!vitals && vitals.systolic_bp != null
  const hasPregnancyLabs = useMemo(() => {
    const lmp = pregnancy?.lmp_date ? new Date(pregnancy.lmp_date).getTime() : null
    if (!lmp) return undefined
    return (labs ?? []).some(l => new Date(l.created_at).getTime() >= lmp)
  }, [labs, pregnancy])

  const tracking = useMemo(() => buildPregnancyTracking({
    pregnancy, consultations: props.consultations, hasRecentVitals, hasPregnancyLabs, now,
  }), [pregnancy, props.consultations, hasRecentVitals, hasPregnancyLabs, now])

  const womensHealth = useMemo(() => buildWomensHealthReminders({
    dateOfBirth: props.patient.date_of_birth, gender: props.patient.gender, pregnancyStatus: tracking.status, now,
  }), [props.patient.date_of_birth, props.patient.gender, tracking.status, now])

  const warnings = useMemo(
    () => safety.analyzeLines(props.activeMeds.map(m => ({ medication_id: m.medication_id, name: m.name })), props.patient.allergies),
    [safety, props.activeMeds, props.patient.allergies],
  )
  const completeness = useMemo(() => computeObgynCompleteness(props.doc, { pregnancy: tracking.status === 'ongoing' }), [props.doc, tracking.status])
  const medReview = useMemo(() => buildObgynMedicationReview({
    activeMedNames: props.activeMeds.map(m => m.name), warnings, now, isPregnant: tracking.status === 'ongoing',
  }), [props.activeMeds, warnings, now, tracking.status])

  const labUs = useMemo(() => buildLabUltrasoundFollowUp({ labOrders: labs, consultations: props.consultations, appointments: appts, now }), [labs, props.consultations, appts, now])

  const lastConsultationAt = useMemo(() => {
    const prev = (props.consultations ?? []).filter(c => c.id !== props.consultation.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return prev[0]?.created_at ?? null
  }, [props.consultations, props.consultation.id])

  const brief = useMemo(() => buildObgynBrief({
    now,
    activePrescriptions: props.activeMeds.length,
    pendingLabReviews: labUs.awaitingReview,
    outstandingBalance: (props.invoices ?? []).filter(i => OPEN_INVOICE.has(i.status)).reduce((s, i) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0),
    allergyCount: props.patient.allergies?.length ?? 0,
    upcomingAppointments: (appts ?? []).filter(a => UPCOMING_APPT.has(a.status) && new Date(a.scheduled_at).getTime() >= now.getTime()).length,
    lastConsultationAt, pregnancy: tracking, ultrasoundOrders: labUs.ultrasoundOrders, followUps: labUs.followUps,
    loaded: { prescriptions: !!props.prescriptions, labs: !!labs, invoices: !!props.invoices },
  }), [props, now, labUs, appts, lastConsultationAt, tracking, labs])

  // Pregnancy record inline form.
  const [lmp, setLmp] = useState('')
  const [status, setStatus] = useState<PregnancyStatus>('ongoing')
  const previewEdd = lmp ? estimateDueDate(lmp) : null
  const previewGa = lmp ? computeGestationalAge(lmp, now) : null

  if (!active || !aiOn) return null

  const age = ageFrom(props.patient.date_of_birth, now)

  function onSavePregnancy() {
    savePregnancy.mutate(
      { id: pregnancy?.id ?? null, patientId: props.patientId, consultationId: props.consultation.id, lmpDate: lmp || pregnancy?.lmp_date || null, pregnancyStatus: status },
      { onSuccess: () => { toast.success(t('pregnancySaved')); setLmp('') } },
    )
  }

  return (
    <Card className="border-rose-100">
      <CardContent className="space-y-4 p-4">
        {/* Header */}
        <div className="flex items-center gap-2 border-b pb-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-600 text-white"><Stethoscope className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{t('title')}</p>
            <p className="text-[11px] text-gray-400">{age != null ? t('ageYears', { y: age }) : t('subtitle')}</p>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px] text-rose-600">{OBGYN_COPILOT_PACK_ID}</Badge>
        </div>

        {/* Brief */}
        <Section icon={ClipboardCheck} title={t('briefTitle')}>
          <div className="grid grid-cols-2 gap-1.5">
            {brief.gp.lines.filter(l => l.code !== 'preventive_reminders').map(l => (
              <div key={l.code} className={cn('flex items-center justify-between rounded-lg px-2 py-1 text-xs', l.severity === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-600')}>
                <span className="truncate">{t(`brief_${l.code}`)}</span>
                <span className="ml-1 shrink-0 font-semibold">{l.code === 'outstanding_balance' ? formatCurrency(Number(l.value)) : l.value}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Pregnancy / ANC tracking */}
        <Section icon={Baby} title={t('ancTitle')}>
          {tracking.hasPregnancy ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
                <Stat label={t('ancGa')} value={tracking.gestationalAge ? t('gaValue', { w: tracking.gestationalAge.weeks, d: tracking.gestationalAge.days }) : '—'} />
                <Stat label={t('ancEdd')} value={tracking.estimatedDueDate ? formatDate(tracking.estimatedDueDate) : '—'} />
                <Stat label={t('ancTrimester')} value={tracking.trimester ? t('trimesterN', { n: tracking.trimester }) : '—'} />
                <Stat label={t('ancVisits')} value={String(tracking.ancVisitCount)} />
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] capitalize text-rose-600">{t(`status_${tracking.status}`)}</Badge>
                {tracking.gravida != null && <span className="text-[11px] text-gray-500">G{tracking.gravida}{tracking.para != null ? `P${tracking.para}` : ''}</span>}
              </div>
              {tracking.reminders.length > 0 && (
                <ul className="space-y-1">
                  {tracking.reminders.map(r => (
                    <li key={r.code} className="flex items-center gap-2 text-xs">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', r.severity === 'warning' ? 'bg-amber-400' : 'bg-rose-300')} />
                      <span className="text-gray-700">{t(r.labelKey)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed bg-gray-50 px-3 py-3 text-center text-[11px] text-gray-400">{t('ancEmpty')}</p>
          )}

          {/* Record / update (clinician data entry) */}
          <div className="mt-2 rounded-lg border bg-white p-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-gray-400">{t('lmpLabel')}</Label>
                <Input type="date" value={lmp} onChange={e => setLmp(e.target.value)} className="h-7 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-gray-400">{t('statusLabel')}</Label>
                <Select value={status} onValueChange={v => setStatus(v as PregnancyStatus)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{t(`status_${s}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {lmp && (
              <p className="mt-1 text-[10px] text-gray-400">
                {t('previewEdd')}: {previewEdd ? formatDate(previewEdd) : '—'} · {t('ancGa')}: {previewGa ? t('gaValue', { w: previewGa.weeks, d: previewGa.days }) : '—'}
              </p>
            )}
            <Button size="sm" variant="outline" className="mt-1.5 h-7 gap-1 text-[11px]" disabled={savePregnancy.isPending || (!lmp && !pregnancy)} onClick={onSavePregnancy}>
              {savePregnancy.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} {t('savePregnancy')}
            </Button>
          </div>
        </Section>

        {/* Women's health reminders */}
        {womensHealth.length > 0 && (
          <Section icon={HeartPulse} title={t('whTitle')}>
            <ul className="space-y-1">
              {womensHealth.map(r => (
                <li key={r.code} className="flex items-center gap-2 text-xs">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-300" />
                  <span className="text-gray-700">{t(r.labelKey)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Lab & ultrasound follow-up */}
        <Section icon={FlaskConical} title={t('labUsTitle')}>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Badge variant="outline">{t('labAwaiting', { count: labUs.awaitingReview })}</Badge>
            <Badge variant="outline">{t('usOrders', { count: labUs.ultrasoundOrders })}</Badge>
            {labUs.followUps.filter(f => f.code === 'outstanding_lab').map(f => <Badge key={f.code} variant="outline">{t('labPending', { count: f.count })}</Badge>)}
          </div>
          <p className="mt-1 text-[10px] text-gray-400">{t('labNoInterpret')}</p>
        </Section>

        {/* Documentation completeness */}
        <Section icon={FileText} title={t('completenessTitle')} right={<span className="text-xs font-bold text-rose-700">{completeness.overall}%</span>}>
          <div className="space-y-1.5">
            {completeness.sections.map(s => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-[11px] text-gray-600">{t(`soap_${s.key}`)}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div className={cn('h-full rounded-full', s.score >= 80 ? 'bg-emerald-500' : s.score >= 40 ? 'bg-amber-400' : 'bg-red-400')} style={{ width: `${s.score}%` }} />
                </div>
                <span className="w-8 shrink-0 text-right text-[11px] font-medium text-gray-500">{s.score}%</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {completeness.prompts.map(p => <Badge key={p} variant="outline" className="text-[10px] text-gray-500">{t(p)}</Badge>)}
          </div>
        </Section>

        {/* Medication review */}
        <Section icon={Pill} title={t('medReviewTitle')}>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Badge variant="outline">{t('medActive', { count: medReview.activeCount })}</Badge>
            {medReview.hasAllergyConflict && <Badge variant="outline" className="border-red-300 text-red-600">{t('medAllergy')}</Badge>}
            {medReview.hasDuplicate && <Badge variant="outline" className="border-orange-300 text-orange-600">{t('medDuplicate')}</Badge>}
            {medReview.hasStockIssue && <Badge variant="outline" className="border-amber-300 text-amber-600">{t('medStock')}</Badge>}
          </div>
          {medReview.isPregnant && <p className="mt-1 text-[10px] text-gray-400">{t('medPregnancyPlaceholder')}</p>}
        </Section>

        {/* Templates */}
        <Section icon={FileText} title={t('templatesTitle')}>
          <div className="flex flex-wrap gap-1.5">
            {OBGYN_SMART_TEMPLATE_IDS.map(id => <Badge key={id} variant="outline" className="text-[10px] text-gray-500">{t(`tpl_${id}`)}</Badge>)}
          </div>
        </Section>

        {/* Confidence + disclaimer */}
        <div className="border-t pt-2">
          <div className="flex items-center gap-2 text-[11px]">
            <ShieldQuestion className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-gray-500">{t('confidenceLabel')}:</span>
            <Badge variant="outline" className={cn('text-[10px]', brief.gp.confidence === 'high' ? 'text-emerald-600' : brief.gp.confidence === 'medium' ? 'text-amber-600' : 'text-gray-500')}>{t(`confidence_${brief.gp.confidence}`)}</Badge>
          </div>
          <p className="mt-1.5 text-[10px] leading-tight text-gray-400">{t('disclaimer')}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-1.5 text-center">
      <p className="font-semibold text-gray-800">{value}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  )
}

function Section({ icon: Icon, title, right, children }: { icon: React.ElementType; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
        <Icon className="h-3.5 w-3.5 text-rose-600" /> {title}
        {right && <span className="ml-auto">{right}</span>}
      </p>
      {children}
    </div>
  )
}
