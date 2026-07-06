'use client'

// ── General Practice Clinical Copilot — panel (Phase 16) ───────────
//
// The first production Clinical Copilot UI. READ-ONLY, deterministic,
// operational. It summarises, highlights, reminds, and checks documentation
// completeness — it NEVER diagnoses, prescribes, recommends treatment,
// interprets lab values, invents findings, or writes to any record. Every
// value shown is a count/flag/reminder derived by the pure gp-copilot engine;
// all human text is i18n (asserted free of diagnosis/treatment wording).
//
// Activates only for a GP (or un-specialised) doctor AND when the clinic AI
// toggle is on. Reuses existing engines + hooks (no duplication).

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import {
  Sparkles, ClipboardCheck, CalendarClock, Pill, BellRing, FileText, ShieldQuestion, AlertTriangle,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useProfessionalIdentity } from '@/hooks/useProfessionalIdentity'
import { useClinicConfig } from '@/hooks/useClinicConfig'
import { useMedicationSafety } from '@/hooks/useMedicationSafety'
import { useLabOrders } from '@/hooks/useLab'
import { useAppointments } from '@/hooks/useAppointments'
import { useLatestPatientVitals } from '@/hooks/useVitals'
import {
  isGeneralPracticeDefault, computeConsultationCompleteness, buildPreventiveReminders,
  buildFollowUps, buildMedicationReview, buildGpBrief,
  GP_COPILOT_PACK_ID, type ConsultationDoc,
} from '@/lib/gp-copilot'
import { GP_SMART_TEMPLATE_IDS } from '@/lib/templates/registry'
import type { Consultation, Invoice, Medication, Prescription } from '@/types/database'
import { useFormatters } from '@/hooks/useFormatters'

interface Props {
  patientId: string
  consultation: { id: string; ended_at?: string | null; created_at: string }
  patient: { date_of_birth?: string | null; gender?: string | null; allergies?: string[] | null }
  /** Live SOAP fields from the consultation form (react-hook-form watch). */
  doc: ConsultationDoc
  activeMeds: Medication[]
  prescriptions?: Prescription[]
  consultations?: Consultation[]
  invoices?: Invoice[]
}

const OPEN_INVOICE = new Set(['draft', 'sent', 'partial', 'overdue'])
const UPCOMING_APPT = new Set(['scheduled', 'waiting', 'called', 'in_consultation', 'in_queue', 'in_progress'])

export function GeneralPracticeCopilot(props: Props) {
  const t = useTranslations('gpCopilot')
  const { formatCurrency, formatDate } = useFormatters()
  const identity = useProfessionalIdentity()
  const { ai } = useClinicConfig()

  const active = isGeneralPracticeDefault(identity.profession.id, identity.specialties.primary?.id ?? null)
  const aiOn = ai('patient_intelligence')

  const safety = useMedicationSafety()
  const { data: labs } = useLabOrders(props.patientId)
  const { data: appts } = useAppointments(undefined, props.patientId)
  const { data: vitals } = useLatestPatientVitals(props.patientId)

  // Stable per-mount clock — reminders/follow-ups don't need a live-ticking now,
  // and a fresh Date() each render would thrash every downstream useMemo.
  const now = useMemo(() => new Date(), [])

  const warnings = useMemo(
    () => safety.analyzeLines(props.activeMeds.map(m => ({ medication_id: m.medication_id, name: m.name })), props.patient.allergies),
    [safety, props.activeMeds, props.patient.allergies],
  )

  const completeness = useMemo(() => computeConsultationCompleteness(props.doc), [props.doc])

  const lastConsultationAt = useMemo(() => {
    const prev = (props.consultations ?? []).filter(c => c.id !== props.consultation.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return prev[0]?.created_at ?? null
  }, [props.consultations, props.consultation.id])

  const reminders = useMemo(() => buildPreventiveReminders({
    dateOfBirth: props.patient.date_of_birth, gender: props.patient.gender,
    lastConsultationAt,
    latestVitals: vitals ? { systolic_bp: vitals.systolic_bp, diastolic_bp: vitals.diastolic_bp, blood_glucose: vitals.blood_glucose } : null,
    now,
  }), [props.patient.date_of_birth, props.patient.gender, lastConsultationAt, vitals, now])

  const followUps = useMemo(() => buildFollowUps({
    appointments: appts, labOrders: labs, consultations: props.consultations, now,
  }), [appts, labs, props.consultations, now])

  const medReview = useMemo(() => buildMedicationReview({
    activeMedNames: props.activeMeds.map(m => m.name), warnings, prescriptions: props.prescriptions, now,
  }), [props.activeMeds, warnings, props.prescriptions, now])

  const outstandingBalance = useMemo(
    () => (props.invoices ?? []).filter(i => OPEN_INVOICE.has(i.status)).reduce((s, i) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0),
    [props.invoices],
  )
  const pendingLabReviews = (labs ?? []).filter(l => l.status === 'completed').length
  const upcomingAppointments = (appts ?? []).filter(a => UPCOMING_APPT.has(a.status) && new Date(a.scheduled_at).getTime() >= now.getTime()).length

  const brief = useMemo(() => buildGpBrief({
    activePrescriptions: props.activeMeds.length,
    pendingLabReviews,
    outstandingBalance,
    allergyCount: props.patient.allergies?.length ?? 0,
    upcomingAppointments,
    lastConsultationAt,
    reminders, followUps,
    loaded: { prescriptions: !!props.prescriptions, labs: !!labs, invoices: !!props.invoices },
  }), [props.activeMeds.length, pendingLabReviews, outstandingBalance, props.patient.allergies, upcomingAppointments, lastConsultationAt, reminders, followUps, props.prescriptions, labs, props.invoices])

  if (!active || !aiOn) return null

  return (
    <Card className="border-teal-100">
      <CardContent className="space-y-4 p-4">
        {/* Header */}
        <div className="flex items-center gap-2 border-b pb-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-700 text-white"><Sparkles className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{t('title')}</p>
            <p className="text-[11px] text-gray-400">{t('subtitle')}</p>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px] text-teal-600">{GP_COPILOT_PACK_ID}</Badge>
        </div>

        {/* Clinical brief */}
        <Section icon={ClipboardCheck} title={t('briefTitle')}>
          <div className="grid grid-cols-2 gap-1.5">
            {brief.lines.map(l => (
              <div key={l.code} className={cn('flex items-center justify-between rounded-lg px-2 py-1 text-xs',
                l.severity === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-600')}>
                <span className="truncate">{t(l.labelKey)}</span>
                <span className="ml-1 shrink-0 font-semibold">{l.code === 'outstanding_balance' ? formatCurrency(Number(l.value)) : l.value}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Documentation completeness */}
        <Section icon={FileText} title={t('completenessTitle')} right={<span className="text-xs font-bold text-teal-700">{completeness.overall}%</span>}>
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
          {completeness.missing.length > 0 && (
            <p className="mt-2 flex items-start gap-1 text-[11px] text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {t('missingLabel')}: {completeness.missing.map(m => t(`soap_${m}`)).join(', ')}
            </p>
          )}
        </Section>

        {/* Preventive reminders */}
        {reminders.length > 0 && (
          <Section icon={BellRing} title={t('remindersTitle')}>
            <ul className="space-y-1">
              {reminders.map(r => (
                <li key={r.code} className="flex items-center gap-2 text-xs">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', r.severity === 'warning' ? 'bg-amber-400' : 'bg-teal-400')} />
                  <span className="text-gray-700">{t(r.labelKey, (r.params ?? {}) as Record<string, string | number>)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Follow-ups */}
        {followUps.length > 0 && (
          <Section icon={CalendarClock} title={t('followUpTitle')}>
            <ul className="space-y-1">
              {followUps.map(f => (
                <li key={f.code} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-gray-700">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', f.severity === 'warning' ? 'bg-amber-400' : 'bg-gray-300')} />
                    {t(f.labelKey)}
                  </span>
                  <span className="font-semibold text-gray-500">{f.count}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Medication review (reuses medication-safety; detail in the Safety panel) */}
        <Section icon={Pill} title={t('medReviewTitle')}>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Badge variant="outline">{t('medActive', { count: medReview.activeCount })}</Badge>
            {medReview.recentChangeCount > 0 && <Badge variant="outline">{t('medRecent', { count: medReview.recentChangeCount })}</Badge>}
            {medReview.hasAllergyConflict && <Badge variant="outline" className="border-red-300 text-red-600">{t('medAllergy')}</Badge>}
            {medReview.hasDuplicate && <Badge variant="outline" className="border-orange-300 text-orange-600">{t('medDuplicate')}</Badge>}
            {medReview.hasStockIssue && <Badge variant="outline" className="border-amber-300 text-amber-600">{t('medStock')}</Badge>}
            {medReview.hasExpiryIssue && <Badge variant="outline" className="border-amber-300 text-amber-600">{t('medExpiry')}</Badge>}
          </div>
          {medReview.warnings.length > 0 && <p className="mt-1.5 text-[11px] text-gray-400">{t('medSeeSafety')}</p>}
        </Section>

        {/* Smart templates (documentation scaffolds — not generated content) */}
        <Section icon={FileText} title={t('templatesTitle')}>
          <div className="flex flex-wrap gap-1.5">
            {GP_SMART_TEMPLATE_IDS.map(id => (
              <Badge key={id} variant="outline" className="text-[10px] text-gray-500">{t(`tpl_${id}`)}</Badge>
            ))}
          </div>
        </Section>

        {/* Confidence + sources + disclaimer */}
        <div className="border-t pt-2">
          <div className="flex items-center gap-2 text-[11px]">
            <ShieldQuestion className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-gray-500">{t('confidenceLabel')}:</span>
            <Badge variant="outline" className={cn('text-[10px]',
              brief.confidence === 'high' ? 'text-emerald-600' : brief.confidence === 'medium' ? 'text-amber-600' : 'text-gray-500')}>
              {t(`confidence_${brief.confidence}`)}
            </Badge>
            {lastConsultationAt && <span className="ml-auto text-[10px] text-gray-400">{t('lastVisit')}: {formatDate(lastConsultationAt)}</span>}
          </div>
          <p className="mt-1.5 text-[10px] leading-tight text-gray-400">{t('disclaimer')}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function Section({ icon: Icon, title, right, children }: { icon: React.ElementType; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
        <Icon className="h-3.5 w-3.5 text-teal-700" /> {title}
        {right && <span className="ml-auto">{right}</span>}
      </p>
      {children}
    </div>
  )
}
