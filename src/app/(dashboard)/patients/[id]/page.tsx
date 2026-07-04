'use client'

import { use, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { logRecordView } from '@/lib/audit-client'
import { ArrowLeft, UserRound, ShieldCheck, AlertCircle, Activity, Clock, Lock } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePatient } from '@/hooks/usePatients'
import { useAppointments } from '@/hooks/useAppointments'
import { useConsultations } from '@/hooks/useConsultations'
import { useInvoices } from '@/hooks/useInvoices'
import { usePrescriptions } from '@/hooks/usePrescriptions'
import { useLabOrders } from '@/hooks/useLab'
import { useDispensings } from '@/hooks/usePharmacy'
import { useLatestPatientVitals } from '@/hooks/useVitals'
import { useMedicationSafety } from '@/hooks/useMedicationSafety'
import { useClinic } from '@/context/ClinicContext'
import { useFormatters } from '@/hooks/useFormatters'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  computeHealthScore, buildPatientBrief, buildPatientAlerts, patientCapabilities,
} from '@/lib/patient-intel'
import { PatientHeader } from '@/components/patients/PatientHeader'
import { PatientTimeline } from '@/components/patients/PatientTimeline'
import { PatientQuickActions } from '@/components/patients/PatientQuickActions'
import { PatientBrief, PatientAlerts, ClinicalSnapshot, PatientDocuments } from '@/components/patients/PatientPanels'
import type { PatientTimelineType } from '@/lib/patient-intel'
import type { Medication, Role } from '@/types/database'

const ACTIVE_RX = new Set(['active', 'partially_dispensed'])
const PENDING_LAB = new Set(['ordered', 'sample_collected', 'in_progress'])
const OPEN_INVOICE = new Set(['draft', 'sent', 'partial', 'overdue'])
const ABNORMAL_FLAGS = new Set(['abnormal', 'high', 'low', 'critical'])

export default function PatientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('patientProfile')
  const { formatDate, formatTime } = useFormatters()
  const { profile } = useClinic()
  const role = (profile?.role ?? 'admin') as Role
  const caps = patientCapabilities(role)

  const { data: patient, isLoading } = usePatient(id)
  useEffect(() => { logRecordView('patient', id) }, [id])
  const { data: latestVitals } = useLatestPatientVitals(id)
  const { data: dispensings } = useDispensings({ patientId: id })
  const { data: appointments } = useAppointments(undefined, id)
  const { data: consultations } = useConsultations(id)
  const { data: invoices } = useInvoices(undefined, id)
  const { data: prescriptions } = usePrescriptions(undefined, id)
  const { data: labOrders } = useLabOrders(id)
  const safety = useMedicationSafety()

  const activeMeds = useMemo<Medication[]>(() => {
    const seen = new Set<string>()
    const out: Medication[] = []
    for (const rx of prescriptions ?? []) {
      if (!ACTIVE_RX.has(rx.status)) continue
      for (const m of rx.medications ?? []) {
        const key = m.name.trim().toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key); out.push(m)
      }
    }
    return out
  }, [prescriptions])

  const derived = useMemo(() => {
    const nowIso = new Date().toISOString()
    const today = nowIso.slice(0, 10)

    const outstandingBalance = (invoices ?? [])
      .filter(i => OPEN_INVOICE.has(i.status))
      .reduce((s, i) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0)

    const activePrescriptions = (prescriptions ?? []).filter(rx => ACTIVE_RX.has(rx.status)).length
    const pendingLabOrders = (labOrders ?? []).filter(l => PENDING_LAB.has(l.status)).length
    const pendingLabReviews = (labOrders ?? []).filter(l => l.status === 'completed').length

    const upcoming = (appointments ?? [])
      .filter(a => a.scheduled_at >= nowIso && !['cancelled', 'no_show', 'completed'].includes(a.status))
      .sort((x, y) => new Date(x.scheduled_at).getTime() - new Date(y.scheduled_at).getTime())
    const lastConsult = consultations?.[0]?.created_at ?? null

    // Abnormal, still-unreviewed lab results.
    const abnormalOrders = (labOrders ?? []).filter(l =>
      l.status === 'completed' && (l.items ?? []).some(i => i.flag && ABNORMAL_FLAGS.has(i.flag)))
    const criticalPendingLab = abnormalOrders.some(l => (l.items ?? []).some(i => i.flag === 'critical'))

    // Missed follow-up: a past follow-up date with no visit or appointment since.
    const pastFollowUps = (consultations ?? [])
      .map(c => c.follow_up_date).filter((d): d is string => !!d && d < today).sort()
    const latestPastFollowUp = pastFollowUps[pastFollowUps.length - 1]
    const missedFollowUp = !!latestPastFollowUp
      && !(consultations ?? []).some(c => c.created_at.slice(0, 10) > latestPastFollowUp)
      && !(appointments ?? []).some(a => a.scheduled_at.slice(0, 10) >= latestPastFollowUp)

    // Stock issue affecting an active medication (Phase 8 safety engine).
    const stockIssueCount = safety.analyzeLines(
      activeMeds.map(m => ({ medication_id: m.medication_id ?? null, name: m.name })),
    ).filter(w => w.code === 'out_of_stock' || w.code === 'low_stock').length

    return {
      outstandingBalance, activePrescriptions, pendingLabOrders, pendingLabReviews,
      upcomingAppointment: upcoming[0]?.scheduled_at ?? null, lastConsult,
      abnormalPendingLabCount: abnormalOrders.length, criticalPendingLab, missedFollowUp,
      stockIssueCount,
      primaryPhysician: (consultations?.[0] as { doctor?: { full_name?: string } } | undefined)?.doctor?.full_name ?? null,
    }
  }, [invoices, prescriptions, labOrders, appointments, consultations, activeMeds, safety])

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title={t('title')} />
        <div className="flex flex-1 items-center justify-center text-gray-400">{t('loading')}</div>
      </div>
    )
  }
  if (!patient) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title={t('title')} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-gray-400">
          <UserRound className="h-12 w-12 opacity-30" />
          <p>{t('notFound')}</p>
          <Link href="/patients"><Button variant="outline" size="sm">{t('backLink')}</Button></Link>
        </div>
      </div>
    )
  }

  // super_admin: platform role, no patient medical detail.
  if (caps.restricted) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title={patient.full_name} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-gray-400">
          <Lock className="h-12 w-12 opacity-30" />
          <p className="max-w-sm text-sm">{t('restrictedNotice')}</p>
          <Link href="/patients"><Button variant="outline" size="sm">{t('backLink')}</Button></Link>
        </div>
      </div>
    )
  }

  const healthScore = computeHealthScore(patient)
  const brief = buildPatientBrief({
    activePrescriptions: derived.activePrescriptions,
    pendingLabReviews: derived.pendingLabReviews,
    outstandingBalance: derived.outstandingBalance,
    loaded: { prescriptions: !!prescriptions, labs: !!labOrders, invoices: !!invoices },
  })

  const alerts = buildPatientAlerts({
    allergies: patient.allergies,
    outstandingBalance: derived.outstandingBalance,
    missedFollowUp: derived.missedFollowUp,
    abnormalPendingLabCount: derived.abnormalPendingLabCount,
    criticalPendingLab: derived.criticalPendingLab,
    stockIssueCount: derived.stockIssueCount,
  }).filter(a => {
    if (a.code === 'outstanding_balance') return caps.financial
    if (a.code === 'stock_issue') return caps.medications || caps.medical
    return caps.medical // allergy, abnormal lab, missed follow-up
  })

  // Which record types the timeline shows for this role.
  const include: PatientTimelineType[] = Array.from(new Set<PatientTimelineType>([
    ...(caps.medical ? ['consultation', 'appointment', 'prescription', 'lab'] as PatientTimelineType[] : []),
    ...(caps.medications ? ['prescription', 'dispensing'] as PatientTimelineType[] : []),
    ...(caps.labs ? ['lab'] as PatientTimelineType[] : []),
    ...(caps.financial ? ['invoice'] as PatientTimelineType[] : []),
    ...(caps.appointments ? ['appointment'] as PatientTimelineType[] : []),
  ]))

  const insuranceData = {
    payerLabel: patient.insurance_payer_type ? t(`payer_${patient.insurance_payer_type}`) : null,
    provider: patient.insurance_provider,
    coverage: patient.insurance_coverage_percent != null ? Number(patient.insurance_coverage_percent) : null,
  }

  return (
    <div className="flex h-full flex-col">
      <Topbar title={patient.full_name} description={t('dossierDesc', { number: patient.patient_number })} />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-4 md:space-y-6">
          <Link href="/patients" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="h-4 w-4" /> {t('backLink')}
          </Link>

          <PatientHeader patient={patient} healthScore={healthScore} caps={caps} metrics={{
            lastConsult: derived.lastConsult,
            upcomingAppointment: derived.upcomingAppointment,
            outstandingBalance: derived.outstandingBalance,
            activePrescriptions: derived.activePrescriptions,
            pendingLabOrders: derived.pendingLabOrders,
          }} />

          {/* Alert strip — hidden entirely when empty */}
          {alerts.length > 0 && <PatientAlerts alerts={alerts} />}

          <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
            {/* Main column */}
            <div className="space-y-4 md:space-y-6 lg:col-span-2">
              {caps.medical && <PatientBrief brief={brief} />}
              {include.length > 0 && (
                <PatientTimeline
                  include={include}
                  consultations={consultations}
                  appointments={appointments}
                  prescriptions={prescriptions}
                  labOrders={labOrders}
                  invoices={invoices}
                  dispensings={dispensings}
                />
              )}
              {caps.documents && <PatientDocuments />}
            </div>

            {/* Right rail */}
            <div className="space-y-4 md:space-y-6">
              {caps.quickActions.length > 0 && (
                <PatientQuickActions
                  actions={caps.quickActions}
                  ctx={{ patientId: id, patientName: patient.full_name, doctorId: profile?.id ?? '' }}
                />
              )}

              {caps.medical ? (
                <ClinicalSnapshot data={{
                  allergies: patient.allergies ?? [],
                  activeMedications: activeMeds.map(m => m.name),
                  insurance: insuranceData,
                  emergency: { contact: patient.emergency_contact, phone: patient.emergency_phone },
                  primaryPhysician: derived.primaryPhysician,
                  chronicConditions: [],
                }} showInsurance={caps.insurance} />
              ) : caps.insurance && (
                /* Non-medical roles: insurance + emergency only */
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" /> {t('cardInsurance')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {insuranceData.payerLabel ? (
                      <p className="text-gray-700">
                        {insuranceData.payerLabel}
                        {insuranceData.provider ? ` · ${insuranceData.provider}` : ''}
                        {insuranceData.coverage != null ? ` · ${insuranceData.coverage}%` : ''}
                      </p>
                    ) : <p className="text-gray-400">{t('snapshotNoInsurance')}</p>}
                    <div className="border-t pt-2">
                      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        <AlertCircle className="h-3 w-3 text-amber-600" /> {t('snapshotEmergency')}
                      </p>
                      {patient.emergency_contact || patient.emergency_phone
                        ? <p className="text-gray-700">{[patient.emergency_contact, patient.emergency_phone].filter(Boolean).join(' · ')}</p>
                        : <p className="text-gray-400">{t('snapshotNoEmergency')}</p>}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Latest vitals (clinical roles only) */}
              {caps.medical && latestVitals && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Activity className="h-4 w-4 text-rose-500" /> {t('cardVitals')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock className="h-3 w-3" /> {formatDate(latestVitals.created_at)} {formatTime(latestVitals.created_at)}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {latestVitals.systolic_bp != null && latestVitals.diastolic_bp != null && (
                        <Vital label={t('vitalBp')} value={`${latestVitals.systolic_bp}/${latestVitals.diastolic_bp}`} unit="mmHg" cls="bg-rose-50 border-rose-100 text-rose-800" />
                      )}
                      {latestVitals.heart_rate != null && <Vital label={t('vitalHr')} value={String(latestVitals.heart_rate)} unit="bpm" cls="bg-pink-50 border-pink-100 text-pink-800" />}
                      {latestVitals.temperature_c != null && <Vital label={t('vitalTemp')} value={String(latestVitals.temperature_c)} unit="°C" cls="bg-amber-50 border-amber-100 text-amber-800" />}
                      {latestVitals.spo2 != null && <Vital label="SpO₂" value={String(latestVitals.spo2)} unit="%" cls="bg-blue-50 border-blue-100 text-blue-800" />}
                      {latestVitals.weight_kg != null && <Vital label={t('vitalWeight')} value={String(latestVitals.weight_kg)} unit="kg" cls="bg-violet-50 border-violet-100 text-violet-800" />}
                      {latestVitals.bmi != null && <Vital label={t('vitalBmi')} value={String(latestVitals.bmi)} unit="" cls="bg-violet-50 border-violet-100 text-violet-800" />}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Vital({ label, value, unit, cls }: { label: string; value: string; unit: string; cls: string }) {
  return (
    <div className={cn('rounded-lg border px-2.5 py-2', cls)}>
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="font-bold tabular-nums">{value}{unit && <span className="ml-1 text-xs font-normal opacity-70">{unit}</span>}</p>
    </div>
  )
}
