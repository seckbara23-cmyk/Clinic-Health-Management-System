'use client'

// ── ORL / ENT Clinical Copilot — panel (Phase 19) ──────────────────
//
// Fourth production Copilot. READ-ONLY intelligence (brief, ORL follow-up,
// completeness, medication review) plus clinician-initiated event data entry
// (recording an audiometry / endoscopy / imaging / biopsy / post-op event and
// advancing its status). It NEVER diagnoses, recommends treatment or surgery,
// prescribes, or interprets audiometry / endoscopy / CT / MRI / pathology — it
// only surfaces that an event exists and its workflow status. Extends and reuses
// the GP engine — no duplication.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Ear, ClipboardCheck, Activity, FileText, Pill, ShieldQuestion, Plus, Check, Loader2,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useProfessionalIdentity } from '@/hooks/useProfessionalIdentity'
import { useClinicConfig } from '@/hooks/useClinicConfig'
import { useMedicationSafety } from '@/hooks/useMedicationSafety'
import { useLabOrders } from '@/hooks/useLab'
import { useAppointments } from '@/hooks/useAppointments'
import { useFormatters } from '@/hooks/useFormatters'
import { useOrlEvents, useRecordOrlEvent, useUpdateOrlEventStatus, type OrlEventRow } from '@/hooks/useOrl'
import {
  isOrlContext, buildOrlFollowUp, countOrlLabSignals, computeOrlCompleteness, buildOrlBrief,
  buildFollowUps, buildMedicationReview, ORL_EVENT_TYPES, ORL_COPILOT_PACK_ID, categoryOf,
} from '@/lib/orl/engine'
import { ORL_SMART_TEMPLATE_IDS } from '@/lib/templates/registry'
import type { Consultation, Invoice, Medication, Prescription } from '@/types/database'
import type { ConsultationDoc } from '@/lib/gp-copilot'

interface Props {
  patientId: string
  consultation: { id: string; created_at: string }
  patient: { allergies?: string[] | null }
  doc: ConsultationDoc
  activeMeds: Medication[]
  prescriptions?: Prescription[]
  consultations?: Consultation[]
  invoices?: Invoice[]
}

const OPEN_INVOICE = new Set(['draft', 'sent', 'partial', 'overdue'])
const UPCOMING_APPT = new Set(['scheduled', 'waiting', 'called', 'in_consultation', 'in_queue', 'in_progress'])
const ADVANCEABLE = new Set(['ordered', 'completed', 'awaiting_review', 'due'])

export function OrlCopilot(props: Props) {
  const t = useTranslations('orlCopilot')
  const { formatCurrency } = useFormatters()
  const identity = useProfessionalIdentity()
  const { ai } = useClinicConfig()

  const active = isOrlContext(identity.profession.id, identity.specialties.primary?.id ?? null)
  const aiOn = ai('patient_intelligence')

  const safety = useMedicationSafety()
  const { data: events } = useOrlEvents(props.patientId)
  const { data: labs } = useLabOrders(props.patientId)
  const { data: appts } = useAppointments(undefined, props.patientId)
  const recordEvent = useRecordOrlEvent()
  const advanceEvent = useUpdateOrlEventStatus()

  const now = useMemo(() => new Date(), [])

  const followUp = useMemo(() => buildOrlFollowUp(events), [events])
  const labSignals = useMemo(() => countOrlLabSignals(labs), [labs])
  const followUps = useMemo(() => buildFollowUps({ appointments: appts, labOrders: labs, consultations: props.consultations, now }), [appts, labs, props.consultations, now])

  const warnings = useMemo(
    () => safety.analyzeLines(props.activeMeds.map(m => ({ medication_id: m.medication_id, name: m.name })), props.patient.allergies),
    [safety, props.activeMeds, props.patient.allergies],
  )
  const medReview = useMemo(() => buildMedicationReview({ activeMedNames: props.activeMeds.map(m => m.name), warnings, now }), [props.activeMeds, warnings, now])
  const completeness = useMemo(() => computeOrlCompleteness(props.doc), [props.doc])

  const lastConsultationAt = useMemo(() => {
    const prev = (props.consultations ?? []).filter(c => c.id !== props.consultation.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return prev[0]?.created_at ?? null
  }, [props.consultations, props.consultation.id])

  const brief = useMemo(() => buildOrlBrief({
    now,
    activePrescriptions: props.activeMeds.length,
    pendingLabReviews: (labs ?? []).filter(l => l.status === 'completed').length,
    outstandingBalance: (props.invoices ?? []).filter(i => OPEN_INVOICE.has(i.status)).reduce((s, i) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0),
    allergyCount: props.patient.allergies?.length ?? 0,
    upcomingAppointments: (appts ?? []).filter(a => UPCOMING_APPT.has(a.status) && new Date(a.scheduled_at).getTime() >= now.getTime()).length,
    lastConsultationAt, followUp, labSignals, followUps,
    loaded: { prescriptions: !!props.prescriptions, labs: !!labs, invoices: !!props.invoices },
  }), [props, now, labs, appts, lastConsultationAt, followUp, labSignals, followUps])

  const openEvents = useMemo(() => (events ?? []).filter(e => ADVANCEABLE.has(e.status)), [events])

  const [newType, setNewType] = useState<string>('audiometry')
  const [newStatus, setNewStatus] = useState<string>('ordered')

  if (!active || !aiOn) return null

  function onRecord() {
    recordEvent.mutate(
      { patientId: props.patientId, consultationId: props.consultation.id, eventType: newType, status: newStatus },
      { onSuccess: () => toast.success(t('eventRecorded')) },
    )
  }
  function onAdvance(e: OrlEventRow) {
    const next = e.status === 'awaiting_review' ? 'reviewed' : e.status === 'ordered' ? 'awaiting_review' : 'reviewed'
    advanceEvent.mutate({ id: e.id, status: next, patientId: props.patientId }, { onSuccess: () => toast.success(t('eventUpdated')) })
  }

  return (
    <Card className="border-sky-100">
      <CardContent className="space-y-4 p-4">
        {/* Header */}
        <div className="flex items-center gap-2 border-b pb-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-600 text-white"><Ear className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{t('title')}</p>
            <p className="text-[11px] text-gray-400">{t('subtitle')}</p>
          </div>
          <Badge variant="outline" className="ml-auto text-[10px] text-sky-600">{ORL_COPILOT_PACK_ID}</Badge>
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

        {/* ORL follow-up (audiology / endoscopy / imaging / pathology / post-op) */}
        <Section icon={Activity} title={t('followUpTitle')}>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {followUp.categories.filter(c => c.total > 0).map(c => (
              <Badge key={c.category} variant="outline" className={c.awaitingReview > 0 ? 'border-amber-300 text-amber-700' : ''}>
                {t(`cat_${c.category}`)}: {c.total}{c.awaitingReview > 0 ? ` · ${c.awaitingReview}${t('awaitingShort')}` : ''}
              </Badge>
            ))}
            {followUp.categories.every(c => c.total === 0) && <span className="text-gray-400">{t('followUpEmpty')}</span>}
          </div>
          {followUp.reminders.length > 0 && (
            <ul className="mt-2 space-y-1">
              {followUp.reminders.map(r => (
                <li key={r.code} className="flex items-center gap-2 text-xs">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', r.severity === 'warning' ? 'bg-amber-400' : 'bg-sky-300')} />
                  <span className="text-gray-700">{t(r.labelKey, (r.params ?? {}) as Record<string, string | number>)}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Open events with status-advance */}
          {openEvents.length > 0 && (
            <div className="mt-2 space-y-1">
              {openEvents.slice(0, 6).map(e => (
                <div key={e.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('h-1.5 w-1.5 rounded-full', categoryOf(e.eventType) ? 'bg-sky-400' : 'bg-gray-300')} />
                    {t(`evt_${e.eventType}`)} <span className="text-[10px] text-gray-400">{t(`st_${e.status}`)}</span>
                  </span>
                  <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" disabled={advanceEvent.isPending} onClick={() => onAdvance(e)}>
                    <Check className="h-3 w-3" /> {t('advance')}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Record a new ORL event */}
          <div className="mt-2 flex items-end gap-1.5 rounded-lg border bg-white p-2">
            <div className="min-w-0 flex-1">
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{ORL_EVENT_TYPES.map(ty => <SelectItem key={ty} value={ty}>{t(`evt_${ty}`)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{['ordered', 'awaiting_review', 'due'].map(s => <SelectItem key={s} value={s}>{t(`st_${s}`)}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" disabled={recordEvent.isPending} onClick={onRecord}>
              {recordEvent.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} {t('record')}
            </Button>
          </div>
        </Section>

        {/* Lab-derived signals (supplementary, from existing lab orders) */}
        {(labSignals.imaging > 0 || labSignals.pathology > 0 || labSignals.audiology > 0) && (
          <Section icon={FileText} title={t('labSignalsTitle')}>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {labSignals.imaging > 0 && <Badge variant="outline">{t('sigImaging', { count: labSignals.imaging })}</Badge>}
              {labSignals.pathology > 0 && <Badge variant="outline">{t('sigPathology', { count: labSignals.pathology })}</Badge>}
              {labSignals.audiology > 0 && <Badge variant="outline">{t('sigAudiology', { count: labSignals.audiology })}</Badge>}
            </div>
            <p className="mt-1 text-[10px] text-gray-400">{t('labNoInterpret')}</p>
          </Section>
        )}

        {/* Documentation completeness */}
        <Section icon={FileText} title={t('completenessTitle')} right={<span className="text-xs font-bold text-sky-700">{completeness.overall}%</span>}>
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
        </Section>

        {/* Templates */}
        <Section icon={FileText} title={t('templatesTitle')}>
          <div className="flex flex-wrap gap-1.5">
            {ORL_SMART_TEMPLATE_IDS.map(id => <Badge key={id} variant="outline" className="text-[10px] text-gray-500">{t(`tpl_${id}`)}</Badge>)}
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

function Section({ icon: Icon, title, right, children }: { icon: React.ElementType; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
        <Icon className="h-3.5 w-3.5 text-sky-600" /> {title}
        {right && <span className="ml-auto">{right}</span>}
      </p>
      {children}
    </div>
  )
}
