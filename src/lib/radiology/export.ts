// ── Radiology report export — pure builder (Phase 39) ─────────────
//
// Arranges an already-authored, SIGNED report into a printable structure (clinic
// header, patient identity, exam metadata, radiologist identity + signature, date,
// report body). It generates NO clinical content — it only lays out data the
// radiologist authored and signed. Unsigned reports are never exportable as final.

import { isDeliverable } from './report'
import type { RadiologyReport } from './types'

export interface ReportExportInput {
  clinic: { name?: string | null; location?: string | null; phone?: string | null }
  patient: { fullName?: string | null; patientNumber?: string | null; dateOfBirth?: string | null; gender?: string | null }
  radiologist: { fullName?: string | null; professionalTitle?: string | null }
  order: { modality?: string | null; examType?: string | null; requestedAt?: string | null }
  report: RadiologyReport
  now: Date
}

export interface ReportExport {
  final: boolean            // true only when the report is signed
  watermarkKey: string | null   // 'draft_watermark' when NOT final
  clinic: { name: string; location: string; phone: string }
  patient: { name: string; number: string; dob: string; gender: string }
  exam: { modality: string; examType: string; requested: string; reportDate: string }
  radiologist: { name: string; title: string; signed: boolean; signedAt: string }
  body: { technique: string; findings: string; conclusion: string; recommendations: string }
  version: number
}

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Build the printable export structure. NEVER fabricates content: empty source
 *  fields stay empty. `final` is true only for a signed report. */
export function buildReportExport(input: ReportExportInput): ReportExport {
  const final = isDeliverable(input.report)
  return {
    final,
    watermarkKey: final ? null : 'draft_watermark',
    clinic: { name: s(input.clinic.name), location: s(input.clinic.location), phone: s(input.clinic.phone) },
    patient: {
      name: s(input.patient.fullName),
      number: s(input.patient.patientNumber),
      dob: s(input.patient.dateOfBirth),
      gender: s(input.patient.gender),
    },
    exam: {
      modality: s(input.report.modality ?? input.order.modality),
      examType: s(input.report.examType ?? input.order.examType),
      requested: s(input.order.requestedAt),
      reportDate: input.now.toISOString().slice(0, 10),
    },
    radiologist: {
      name: s(input.radiologist.fullName),
      title: s(input.radiologist.professionalTitle),
      signed: final,
      signedAt: s(input.report.signedAt),
    },
    body: {
      technique: s(input.report.technique),
      findings: s(input.report.findings),
      conclusion: s(input.report.conclusion),
      recommendations: s(input.report.recommendations),
    },
    version: input.report.version ?? 1,
  }
}
