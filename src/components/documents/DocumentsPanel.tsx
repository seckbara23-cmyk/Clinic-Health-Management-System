'use client'

// ── Clinical Documents panel (Phase 20) ────────────────────────────
//
// Consultation right-rail launcher: lists the documents the current
// professional may generate (role + specialty gated by the registry) and opens
// the builder, prefilled from the patient / consultation / profile / clinic.
// Read-only listing; generation is clinician-driven and content is
// clinician-confirmed. No AI, no diagnosis, no treatment.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FileText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useClinic } from '@/context/ClinicContext'
import { useProfessionalIdentity } from '@/hooks/useProfessionalIdentity'
import { useProfessionalMedia } from '@/hooks/useProfessionalIdentity'
import { availableDocuments } from '@/lib/documents/registry'
import { DocumentBuilder } from './DocumentBuilder'
import type { DocumentContext, DocumentDefinition } from '@/lib/documents/types'
import type { Consultation, Patient } from '@/types/database'

interface Props {
  patientId: string
  consultation: Pick<Consultation, 'id' | 'chief_complaint' | 'symptoms' | 'diagnosis' | 'treatment_plan' | 'notes' | 'follow_up_date'>
  patient: Pick<Patient, 'full_name' | 'patient_number' | 'date_of_birth' | 'gender' | 'address' | 'phone' | 'cni'> | null
}

const CATEGORY_COLOR: Record<string, string> = {
  certificate: 'text-emerald-600', referral: 'text-blue-600', summary: 'text-violet-600', report: 'text-amber-600', note: 'text-gray-500',
}

export function DocumentsPanel(props: Props) {
  const t = useTranslations('documents')
  const { clinic, profile } = useClinic()
  const identity = useProfessionalIdentity()
  const media = useProfessionalMedia()
  const [selected, setSelected] = useState<DocumentDefinition | null>(null)

  const role = profile?.role ?? null
  const docs = useMemo(
    () => availableDocuments(role, identity.specialties.primary?.id ?? null),
    [role, identity.specialties],
  )

  const context = useMemo<DocumentContext>(() => ({
    patient: props.patient
      ? { full_name: props.patient.full_name, patient_number: props.patient.patient_number, date_of_birth: props.patient.date_of_birth, gender: props.patient.gender, address: props.patient.address, phone: props.patient.phone, cni: props.patient.cni }
      : null,
    consultation: {
      chief_complaint: props.consultation.chief_complaint, symptoms: props.consultation.symptoms,
      diagnosis: props.consultation.diagnosis, treatment_plan: props.consultation.treatment_plan,
      notes: props.consultation.notes, follow_up_date: props.consultation.follow_up_date,
    },
    profile: { full_name: profile?.full_name ?? null, professionalTitle: identity.profile?.professionalTitle ?? null },
    clinic: { name: clinic?.name ?? null, location: clinic?.location ?? null, phone: clinic?.phone ?? null },
    now: new Date(),
  }), [props.patient, props.consultation, profile, identity.profile, clinic])

  if (docs.length === 0) return null

  return (
    <Card className="border-gray-200">
      <CardContent className="p-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          <FileText className="h-3.5 w-3.5 text-gray-500" /> {t('panel_title')}
        </p>
        <div className="space-y-1">
          {docs.map(d => (
            <button
              key={d.id}
              onClick={() => setSelected(d)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50"
            >
              <span className="truncate text-gray-800">{t(d.titleKey)}</span>
              <Badge variant="outline" className={`shrink-0 text-[10px] ${CATEGORY_COLOR[d.category] ?? ''}`}>{t(`cat_${d.category}`)}</Badge>
            </button>
          ))}
        </div>
      </CardContent>

      {selected && (
        <DocumentBuilder
          definition={selected}
          context={context}
          doctorName={profile?.full_name ?? '—'}
          doctorTitle={identity.profile?.professionalTitle ?? null}
          signatureUrl={media.signatureUrl}
          patientId={props.patientId}
          consultationId={props.consultation.id}
          onClose={() => setSelected(null)}
        />
      )}
    </Card>
  )
}
