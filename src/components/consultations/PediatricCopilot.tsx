'use client'

// ── Pediatrics Clinical Copilot — panel (Phase 17) ─────────────────
//
// The second production Copilot. READ-ONLY intelligence (brief, growth,
// reminders, completeness, medication review) plus ONE clinician-initiated
// write: recording a vaccine dose given (factual data entry, RLS-gated — not
// the Copilot acting autonomously). It NEVER diagnoses, prescribes, recommends
// treatment/dosing, interprets labs, invents growth percentiles, or presents
// the vaccination schedule as definitive (labelled a placeholder). Extends and
// reuses the GP engine — no duplication.

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import {
  Baby, Syringe, TrendingUp, BellRing, FileText, ClipboardCheck, Pill, ShieldQuestion,
  AlertTriangle, Check, ArrowUp, ArrowDown, Minus, MessageSquare,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useProfessionalIdentity } from '@/hooks/useProfessionalIdentity'
import { useClinicConfig } from '@/hooks/useClinicConfig'
import { useMedicationSafety } from '@/hooks/useMedicationSafety'
import { useLabOrders } from '@/hooks/useLab'
import { useAppointments } from '@/hooks/useAppointments'
import { useFormatters } from '@/hooks/useFormatters'
import { usePatientVaccinations, usePatientVitalsHistory, useRecordVaccination } from '@/hooks/usePediatrics'
import {
  isPediatricContext, formatPediatricAge, buildGrowthMonitoring, buildVaccinationStatus,
  buildPediatricReminders, computePediatricCompleteness, buildPediatricMedicationReview,
  buildPediatricBrief, buildFollowUps, PEDS_COPILOT_PACK_ID, type GrowthTrend, type VaxEntry,
} from '@/lib/pediatrics/engine'
import { PEDS_SMART_TEMPLATE_IDS } from '@/lib/templates/registry'
import { PARENT_COMM_TEMPLATE_IDS } from '@/lib/pediatrics/schedule'
import type { Consultation, Invoice, Medication, Prescription } from '@/types/database'
import type { ConsultationDoc } from '@/lib/gp-copilot'

interface Props {
  patientId: string
  consultation: { id: string; created_at: string }
  patient: { date_of_birth?: string | null; gender?: string | null; allergies?: string[] | null; emergency_contact?: string | null }
  doc: ConsultationDoc
  activeMeds: Medication[]
  prescriptions?: Prescription[]
  consultations?: Consultation[]
  invoices?: Invoice[]
}

const OPEN_INVOICE = new Set(['draft', 'sent', 'partial', 'overdue'])
const UPCOMING_APPT = new Set(['scheduled', 'waiting', 'called', 'in_consultation', 'in_queue', 'in_progress'])

export function PediatricCopilot(props: Props) {
  const t = useTranslations('pedsCopilot')
  const tv = useTranslations('pedsVaccines')
  const { formatCurrency, formatDate } = useFormatters()
  const identity = useProfessionalIdentity()
  const { ai } = useClinicConfig()

  const active = isPediatricContext(identity.profession.id, identity.specialties.primary?.id ?? null)
  const aiOn = ai('patient_intelligence')

  const safety = useMedicationSafety()
  const { data: vax } = usePatientVaccinations(props.patientId)
  const { data: vitalsHistory } = usePatientVitalsHistory(props.patientId)
  const { data: labs } = useLabOrders(props.patientId)
  const { data: appts } = useAppointments(undefined, props.patientId)
  const recordVax = useRecordVaccination()

  const now = useMemo(() => new Date(), [])
  const age = useMemo(() => formatPediatricAge(props.patient.date_of_birth, now), [props.patient.date_of_birth, now])

  const growth = useMemo(() => buildGrowthMonitoring(vitalsHistory), [vitalsHistory])
  const vaccination = useMemo(() => buildVaccinationStatus(props.patient.date_of_birth, vax, now), [props.patient.date_of_birth, vax, now])
  const reminders = useMemo(() => buildPediatricReminders({ dateOfBirth: props.patient.date_of_birth, vaccination, growth, now }), [props.patient.date_of_birth, vaccination, growth, now])

  const warnings = useMemo(
    () => safety.analyzeLines(props.activeMeds.map(m => ({ medication_id: m.medication_id, name: m.name })), props.patient.allergies),
    [safety, props.activeMeds, props.patient.allergies],
  )
  const weightThisVisit = useMemo(
    () => (vitalsHistory ?? []).some(v => v.consultation_id === props.consultation.id && v.weight_kg != null),
    [vitalsHistory, props.consultation.id],
  )
  const completeness = useMemo(() => computePediatricCompleteness(props.doc, { weightRecordedThisVisit: weightThisVisit }), [props.doc, weightThisVisit])
  const medReview = useMemo(() => buildPediatricMedicationReview({
    activeMedNames: props.activeMeds.map(m => m.name), warnings, now,
    hasWeight: growth.latest?.weightKg != null, hasAge: !!age,
  }), [props.activeMeds, warnings, now, growth.latest, age])

  const followUps = useMemo(() => buildFollowUps({ appointments: appts, labOrders: labs, consultations: props.consultations, now }), [appts, labs, props.consultations, now])

  const lastConsultationAt = useMemo(() => {
    const prev = (props.consultations ?? []).filter(c => c.id !== props.consultation.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return prev[0]?.created_at ?? null
  }, [props.consultations, props.consultation.id])

  const brief = useMemo(() => buildPediatricBrief({
    dateOfBirth: props.patient.date_of_birth, guardian: props.patient.emergency_contact, now,
    activePrescriptions: props.activeMeds.length,
    pendingLabReviews: (labs ?? []).filter(l => l.status === 'completed').length,
    outstandingBalance: (props.invoices ?? []).filter(i => OPEN_INVOICE.has(i.status)).reduce((s, i) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0),
    allergyCount: props.patient.allergies?.length ?? 0,
    upcomingAppointments: (appts ?? []).filter(a => UPCOMING_APPT.has(a.status) && new Date(a.scheduled_at).getTime() >= now.getTime()).length,
    lastConsultationAt, vaccination, growth, followUps, reminders,
    loaded: { prescriptions: !!props.prescriptions, labs: !!labs, invoices: !!props.invoices },
  }), [props, now, labs, appts, lastConsultationAt, vaccination, growth, followUps, reminders])

  if (!active || !aiOn) return null

  function onRecord(entry: VaxEntry) {
    recordVax.mutate(
      { patientId: props.patientId, vaccineCode: entry.dose.code, doseLabel: tv(entry.dose.labelKey) },
      { onSuccess: () => toast.success(t('vaxRecorded')) },
    )
  }

  const actionable = [...vaccination.overdue, ...vaccination.due]

  return (
    <Card className="border-indigo-100">
      <CardContent className="space-y-4 p-4">
        {/* Header */}
        <div className="flex items-center gap-2 border-b pb-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white"><Baby className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{t('title')}</p>
            <p className="text-[11px] text-gray-400">{age ? ageLabel(age, t) : t('subtitle')}{brief.guardian ? ` · ${t('guardian')}: ${brief.guardian}` : ''}</p>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px] text-indigo-600">{PEDS_COPILOT_PACK_ID}</Badge>
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
            <div className="flex items-center justify-between rounded-lg bg-indigo-50 px-2 py-1 text-xs text-indigo-800">
              <span className="truncate">{t('brief_vaccination')}</span>
              <span className="ml-1 shrink-0 font-semibold">{brief.vaccinationSummary.received}✓ / {brief.vaccinationSummary.due + brief.vaccinationSummary.overdue}</span>
            </div>
          </div>
        </Section>

        {/* Growth monitoring */}
        <Section icon={TrendingUp} title={t('growthTitle')}>
          <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
            <GrowthCell label={t('growthWeight')} value={growth.latest?.weightKg} unit="kg" trend={growth.trend.weight} />
            <GrowthCell label={t('growthHeight')} value={growth.latest?.heightCm} unit="cm" trend={growth.trend.height} />
            <GrowthCell label={t('growthBmi')} value={growth.latest?.bmi} unit="" trend={growth.trend.bmi} />
          </div>
          {growth.missing.length > 0 && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="h-3 w-3" /> {t('growthMissing')}: {growth.missing.map(m => t(`growth${m === 'weight' ? 'Weight' : 'Height'}`)).join(', ')}</p>
          )}
          <p className="mt-1 text-[10px] text-gray-400">{t('growthPlaceholders')}</p>
        </Section>

        {/* Vaccination tracker */}
        <Section icon={Syringe} title={t('vaxTitle')} right={
          <span className="flex gap-1 text-[10px]">
            {vaccination.overdueCount > 0 && <Badge variant="outline" className="border-red-300 text-red-600">{t('vaxOverdue')}: {vaccination.overdueCount}</Badge>}
            {vaccination.dueCount > 0 && <Badge variant="outline" className="border-amber-300 text-amber-600">{t('vaxDue')}: {vaccination.dueCount}</Badge>}
            <Badge variant="outline" className="text-emerald-600">{vaccination.receivedCount}✓</Badge>
          </span>
        }>
          {actionable.length === 0 ? (
            <p className="text-[11px] text-gray-400">{t('vaxNoneDue')}</p>
          ) : (
            <ul className="space-y-1">
              {actionable.map(e => (
                <li key={e.dose.code} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('h-1.5 w-1.5 rounded-full', e.state === 'overdue' ? 'bg-red-500' : 'bg-amber-400')} />
                    {tv(e.dose.labelKey)}
                    <span className="text-[10px] text-gray-400">{t(`vaxState_${e.state}`)}</span>
                  </span>
                  <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" disabled={recordVax.isPending} onClick={() => onRecord(e)}>
                    <Check className="h-3 w-3" /> {t('vaxMarkGiven')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[10px] text-gray-400">{t('vaxPlaceholder', { version: vaccination.scheduleVersion })}</p>
        </Section>

        {/* Reminders */}
        {reminders.length > 0 && (
          <Section icon={BellRing} title={t('remindersTitle')}>
            <ul className="space-y-1">
              {reminders.map(r => (
                <li key={r.code} className="flex items-center gap-2 text-xs">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', r.severity === 'warning' ? 'bg-amber-400' : 'bg-indigo-400')} />
                  <span className="text-gray-700">{t(r.labelKey, (r.params ?? {}) as Record<string, string | number>)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Documentation completeness */}
        <Section icon={FileText} title={t('completenessTitle')} right={<span className="text-xs font-bold text-indigo-700">{completeness.overall}%</span>}>
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
            {medReview.weightMissing && <Badge variant="outline" className="border-amber-300 text-amber-600">{t('medWeightMissing')}</Badge>}
            {medReview.ageMissing && <Badge variant="outline" className="border-amber-300 text-amber-600">{t('medAgeMissing')}</Badge>}
            {medReview.hasAllergyConflict && <Badge variant="outline" className="border-red-300 text-red-600">{t('medAllergy')}</Badge>}
            {medReview.hasDuplicate && <Badge variant="outline" className="border-orange-300 text-orange-600">{t('medDuplicate')}</Badge>}
            {medReview.hasStockIssue && <Badge variant="outline" className="border-amber-300 text-amber-600">{t('medStock')}</Badge>}
          </div>
          <p className="mt-1 text-[10px] text-gray-400">{t('medNoDosing')}</p>
        </Section>

        {/* Templates + parent communication */}
        <Section icon={FileText} title={t('templatesTitle')}>
          <div className="flex flex-wrap gap-1.5">
            {PEDS_SMART_TEMPLATE_IDS.map(id => <Badge key={id} variant="outline" className="text-[10px] text-gray-500">{t(`tpl_${id}`)}</Badge>)}
          </div>
        </Section>
        <Section icon={MessageSquare} title={t('commTitle')}>
          <div className="flex flex-wrap gap-1.5">
            {PARENT_COMM_TEMPLATE_IDS.map(id => <Badge key={id} variant="outline" className="text-[10px] text-gray-500">{t(`comm_${id}`)}</Badge>)}
          </div>
          <p className="mt-1 text-[10px] text-gray-400">{t('commNote')}</p>
        </Section>

        {/* Confidence + disclaimer */}
        <div className="border-t pt-2">
          <div className="flex items-center gap-2 text-[11px]">
            <ShieldQuestion className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-gray-500">{t('confidenceLabel')}:</span>
            <Badge variant="outline" className={cn('text-[10px]', brief.gp.confidence === 'high' ? 'text-emerald-600' : brief.gp.confidence === 'medium' ? 'text-amber-600' : 'text-gray-500')}>{t(`confidence_${brief.gp.confidence}`)}</Badge>
            {lastConsultationAt && <span className="ml-auto text-[10px] text-gray-400">{t('lastVisit')}: {formatDate(lastConsultationAt)}</span>}
          </div>
          <p className="mt-1.5 text-[10px] leading-tight text-gray-400">{t('disclaimer')}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function ageLabel(a: ReturnType<typeof formatPediatricAge>, t: ReturnType<typeof useTranslations>): string {
  if (!a) return ''
  if (a.displayUnit === 'days') return t('ageDays', { d: a.totalDays })
  if (a.displayUnit === 'weeks') return t('ageWeeks', { w: a.totalWeeks })
  if (a.displayUnit === 'months') return t('ageMonths', { m: a.totalMonths })
  return t('ageYears', { y: a.years, m: a.months })
}

function GrowthCell({ label, value, unit, trend }: { label: string; value: number | null | undefined; unit: string; trend: GrowthTrend }) {
  const Icon = trend === 'up' ? ArrowUp : trend === 'down' ? ArrowDown : trend === 'stable' ? Minus : null
  return (
    <div className="rounded-lg bg-gray-50 px-1 py-1.5">
      <p className="text-[10px] text-gray-400">{label}</p>
      <p className="flex items-center justify-center gap-0.5 font-semibold text-gray-800">
        {value != null ? `${value}${unit}` : '—'}
        {Icon && value != null && <Icon className={cn('h-3 w-3', trend === 'down' ? 'text-red-400' : 'text-emerald-500')} />}
      </p>
    </div>
  )
}

function Section({ icon: Icon, title, right, children }: { icon: React.ElementType; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
        <Icon className="h-3.5 w-3.5 text-indigo-600" /> {title}
        {right && <span className="ml-auto">{right}</span>}
      </p>
      {children}
    </div>
  )
}
