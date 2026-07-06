'use client'

// ── Clinical Document renderer (Phase 20) ──────────────────────────
//
// Generic, print-friendly presentation of a resolved document: clinic header,
// patient identity, content sections, date, doctor identity + signature, footer.
// Presentational only — it renders the clinician-edited field values verbatim.
// It generates NO content and makes NO decision. Wrapped by the builder in a
// `.doc-print` region so window.print() outputs only the document.

import { useTranslations } from 'next-intl'
import { useFormatters } from '@/hooks/useFormatters'
import type { DocumentContext, DocumentDefinition, DocumentValues } from '@/lib/documents/types'

export interface DocumentRenderProps {
  definition: DocumentDefinition
  values: DocumentValues
  context: DocumentContext
  doctorName: string
  doctorTitle?: string | null
  signatureUrl?: string | null
}

export function DocumentRenderer({ definition, values, context, doctorName, doctorTitle, signatureUrl }: DocumentRenderProps) {
  const t = useTranslations('documents')
  const { formatDate } = useFormatters()
  const p = definition.print
  const patient = context.patient
  const clinic = context.clinic

  function fieldValue(key: string, type: string): string {
    const raw = (values[key] ?? '').trim()
    if (!raw) return ''
    if (type === 'date') { const d = new Date(raw); return Number.isNaN(d.getTime()) ? raw : formatDate(raw) }
    return raw
  }

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-sm text-gray-900">
      {/* Clinic header */}
      {p.showClinicHeader && (
        <div className="border-b pb-3 text-center">
          <p className="text-lg font-bold text-gray-900">{clinic?.name ?? ''}</p>
          <p className="text-xs text-gray-500">
            {[clinic?.location, clinic?.phone].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}

      {/* Title */}
      <h1 className="mt-5 text-center text-base font-bold uppercase tracking-wide text-gray-900">{t(definition.titleKey)}</h1>

      {/* Date */}
      {p.showDate && (
        <p className="mt-2 text-right text-xs text-gray-500">{t('rdr_date')}: {formatDate(context.now.toISOString())}</p>
      )}

      {/* Patient identity */}
      {p.showPatientIdentity && (
        <div className="mt-3 rounded border border-gray-200 p-3 text-xs">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <IdRow label={t('rdr_patient')} value={patient?.full_name ?? ''} />
            <IdRow label={t('rdr_number')} value={patient?.patient_number ?? ''} />
            {patient?.date_of_birth && <IdRow label={t('rdr_dob')} value={formatDate(patient.date_of_birth)} />}
            {patient?.gender && <IdRow label={t('rdr_gender')} value={patient.gender} />}
          </div>
        </div>
      )}

      {/* Content sections */}
      <div className="mt-5 space-y-4">
        {definition.sections.map(section => (
          <div key={section.id} className="space-y-3">
            {section.labelKey && <p className="text-xs font-semibold uppercase text-gray-400">{t(section.labelKey)}</p>}
            {section.fieldKeys.map(key => {
              const field = definition.fields.find(f => f.key === key)
              if (!field) return null
              const v = fieldValue(key, field.type)
              if (!v) return null
              return (
                <div key={key} className="text-sm">
                  <span className="font-semibold text-gray-700">{t(field.labelKey)}: </span>
                  <span className="whitespace-pre-wrap text-gray-800">
                    {field.type === 'select' ? t(field.options?.find(o => o.value === v)?.labelKey ?? v) : v}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Signature */}
      {p.showDoctorSignature && (
        <div className="mt-10 flex justify-end">
          <div className="text-center">
            {signatureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signatureUrl} alt="signature" className="mx-auto mb-1 h-14 object-contain" />
            ) : (
              <div className="mb-1 h-14" />
            )}
            <div className="w-48 border-t border-gray-400 pt-1 text-xs">
              <p className="font-semibold text-gray-800">{doctorTitle ? `${doctorTitle} ` : ''}{doctorName}</p>
              <p className="text-gray-400">{t('rdr_signature')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <p className="mt-8 border-t pt-2 text-center text-[10px] text-gray-400">{t('rdr_footer')}</p>
    </div>
  )
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <p><span className="text-gray-400">{label}: </span><span className="font-medium text-gray-800">{value || '—'}</span></p>
  )
}
