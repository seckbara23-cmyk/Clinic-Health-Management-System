'use client'

import { useTranslations } from 'next-intl'
import {
  Sparkles, AlertOctagon, AlertTriangle, Info, HeartPulse, Pill,
  ShieldCheck, UserRound, Stethoscope, FolderOpen, FileText,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { confidenceVariant } from '@/lib/ai/ui'
import { useFormatters } from '@/hooks/useFormatters'
import { cn } from '@/lib/utils'
import type { PatientBriefData, PatientAlert, AlertSeverity } from '@/lib/patient-intel'
import type { AIConfidenceLevel } from '@/lib/ai/types'

// ── AI Patient Brief (informational, no diagnosis) ─────────────────
export function PatientBrief({ brief }: { brief: PatientBriefData }) {
  const t = useTranslations('patientProfile')
  const rx = t('brief_rx', { count: brief.activePrescriptions })
  const labs = t('brief_labs', { count: brief.pendingLabReviews })
  const sentence = brief.hasIssues ? t('brief_sentence', { rx, labs }) : t('brief_none')

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">{t('briefTitle')}</h2>
            <Badge variant={confidenceVariant(brief.confidence as AIConfidenceLevel)}>
              {t('confidence')}: {t(`confidence_${brief.confidence}`)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-gray-700">{sentence}</p>
          {brief.sources.length > 0 && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {t('brief_sources')}: {brief.sources.map(s => t(`source_${s}`)).join(' · ')}
            </p>
          )}
          <p className="mt-1 text-[11px] leading-tight text-muted-foreground/70">{t('briefDisclaimer')}</p>
        </div>
      </div>
    </section>
  )
}

// ── Alert strip (hidden entirely when empty) ───────────────────────
const ALERT_STYLE: Record<AlertSeverity, { box: string; icon: string; Icon: React.ElementType }> = {
  critical: { box: 'border-red-200 bg-red-50 text-red-800', icon: 'text-red-600', Icon: AlertOctagon },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-800', icon: 'text-amber-600', Icon: AlertTriangle },
  info: { box: 'border-blue-200 bg-blue-50 text-blue-800', icon: 'text-blue-600', Icon: Info },
}

export function PatientAlerts({ alerts }: { alerts: PatientAlert[] }) {
  const t = useTranslations('patientProfile')
  const { formatCurrency } = useFormatters()
  if (alerts.length === 0) return null

  return (
    <div className="space-y-2" role="status" aria-live="polite">
      {alerts.map((a, i) => {
        const st = ALERT_STYLE[a.severity]
        const params = { ...(a.params ?? {}) }
        if (a.code === 'outstanding_balance' && a.params) params.amount = formatCurrency(Number(a.params.amount))
        return (
          <div key={`${a.code}-${i}`} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5', st.box)}>
            <st.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', st.icon)} />
            <p className="text-sm leading-snug">{t(`alert_${a.code}`, params)}</p>
          </div>
        )
      })}
    </div>
  )
}

// ── Clinical snapshot ──────────────────────────────────────────────
export interface SnapshotData {
  allergies: string[]
  activeMedications: string[]
  insurance: { payerLabel: string | null; provider: string | null; coverage: number | null }
  emergency: { contact: string | null; phone: string | null }
  primaryPhysician: string | null
  chronicConditions: string[]
}

export function ClinicalSnapshot({ data, showInsurance = true }: { data: SnapshotData; showInsurance?: boolean }) {
  const t = useTranslations('patientProfile')
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HeartPulse className="h-4 w-4 text-rose-500" /> {t('snapshotTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <SnapshotRow icon={AlertTriangle} iconClass="text-red-500" label={t('snapshotAllergies')}>
          {data.allergies.length === 0
            ? <span className="text-gray-400">{t('snapshotNoAllergies')}</span>
            : <ChipList items={data.allergies} cls="border-red-200 bg-red-50 text-red-700" />}
        </SnapshotRow>

        <SnapshotRow icon={Pill} iconClass="text-teal-600" label={t('snapshotMeds')}>
          {data.activeMedications.length === 0
            ? <span className="text-gray-400">{t('snapshotNoMeds')}</span>
            : <ChipList items={data.activeMedications} cls="border-teal-200 bg-teal-50 text-teal-700" />}
        </SnapshotRow>

        {showInsurance && (
          <SnapshotRow icon={ShieldCheck} iconClass="text-blue-600" label={t('snapshotInsurance')}>
            {data.insurance.payerLabel
              ? <span className="text-gray-700">
                  {data.insurance.payerLabel}
                  {data.insurance.provider ? ` · ${data.insurance.provider}` : ''}
                  {data.insurance.coverage != null ? ` · ${data.insurance.coverage}%` : ''}
                </span>
              : <span className="text-gray-400">{t('snapshotNoInsurance')}</span>}
          </SnapshotRow>
        )}

        <SnapshotRow icon={UserRound} iconClass="text-amber-600" label={t('snapshotEmergency')}>
          {data.emergency.contact || data.emergency.phone
            ? <span className="text-gray-700">{[data.emergency.contact, data.emergency.phone].filter(Boolean).join(' · ')}</span>
            : <span className="text-gray-400">{t('snapshotNoEmergency')}</span>}
        </SnapshotRow>

        <SnapshotRow icon={Stethoscope} iconClass="text-violet-600" label={t('snapshotPhysician')}>
          {data.primaryPhysician
            ? <span className="text-gray-700">{data.primaryPhysician}</span>
            : <span className="text-gray-400">{t('snapshotNoPhysician')}</span>}
        </SnapshotRow>

        <SnapshotRow icon={HeartPulse} iconClass="text-rose-500" label={t('snapshotChronic')}>
          {data.chronicConditions.length === 0
            ? <span className="text-gray-400">{t('snapshotNoChronic')}</span>
            : <ChipList items={data.chronicConditions} cls="border-violet-200 bg-violet-50 text-violet-700" />}
        </SnapshotRow>
      </CardContent>
    </Card>
  )
}

function SnapshotRow({ icon: Icon, iconClass, label, children }: {
  icon: React.ElementType; iconClass: string; label: string; children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        <Icon className={cn('h-3 w-3', iconClass)} /> {label}
      </p>
      <div className="pl-5">{children}</div>
    </div>
  )
}

function ChipList({ items, cls }: { items: string[]; cls: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <span key={`${it}-${i}`} className={cn('rounded-full border px-2 py-0.5 text-xs', cls)}>{it}</span>
      ))}
    </div>
  )
}

// ── Documents (future-ready) ───────────────────────────────────────
export function PatientDocuments() {
  const t = useTranslations('patientProfile')
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FolderOpen className="h-4 w-4 text-teal-700" /> {t('documentsTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-8 text-center">
          <FileText className="h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-400">{t('documentsEmpty')}</p>
          <p className="max-w-xs text-xs text-gray-400">{t('documentsHint')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
