// ── Radiology report lifecycle — pure engine (Phase 39) ───────────
//
// Deterministic report state machine + signature authority + signed-report
// immutability + version bumping. The radiologist remains fully responsible: the
// system NEVER signs automatically and NEVER delivers an unsigned report as final.
// A signed report is immutable — the only way to change it is a versioned
// amendment (enforced here AND by a DB trigger, defence in depth).

import { REPORT_STATUSES, type ReportStatus, type RadiologyReport } from './types'

const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  draft:   ['review', 'signed'],
  review:  ['draft', 'signed'],
  signed:  ['amended'],
  amended: ['amended'],   // re-amendment always creates a new version
}

export function isReportStatus(v: unknown): v is ReportStatus {
  return typeof v === 'string' && (REPORT_STATUSES as readonly string[]).includes(v)
}

/** A signed report (signed or amended) is final and immutable. */
export function isSigned(status?: string | null): boolean {
  return status === 'signed' || status === 'amended'
}

/** Clinical content is editable ONLY while a draft/review. Never once signed. */
export function canEditReport(status?: string | null): boolean {
  return status === 'draft' || status === 'review'
}

/** Amendment is possible ONLY on a signed/amended report (creates a new version). */
export function canAmendReport(status?: string | null): boolean {
  return isSigned(status)
}

export function canTransitionReport(from?: string | null, to?: string | null): boolean {
  if (!isReportStatus(from) || !isReportStatus(to)) return false
  return REPORT_TRANSITIONS[from].includes(to)
}

export function allowedReportTransitions(from?: string | null): ReportStatus[] {
  return isReportStatus(from) ? [...REPORT_TRANSITIONS[from]] : []
}

/** Only a radiologist (a doctor whose primary specialty is radiology) or an
 *  admin/super_admin may sign. Signing is NEVER automatic — always a human action. */
export function canSignReport(role?: string | null, primarySpecialtyId?: string | null, status?: string | null): boolean {
  if (!canEditReport(status)) return false     // only a draft/review can be signed
  const isRadiologist = role === 'doctor' && primarySpecialtyId === 'radiology'
  return isRadiologist || role === 'admin' || role === 'super_admin'
}

/** A report is "final" (safe to deliver to the chart) only once signed. */
export function isDeliverable(report: Pick<RadiologyReport, 'reportStatus' | 'signedAt'> | null | undefined): boolean {
  if (!report) return false
  return isSigned(report.reportStatus) && !!report.signedAt
}

// ── Version snapshots (append-only) ─────────────────────────────────
export interface ReportSnapshot {
  version: number
  reportStatus: string
  technique: string | null
  findings: string | null
  conclusion: string | null
  recommendations: string | null
  radiologistId: string | null
  signedAt: string | null
}

/** Build an immutable snapshot of the CURRENT report state (for the version log).
 *  Copies content verbatim — never derives or interprets. */
export function snapshotReport(report: RadiologyReport): ReportSnapshot {
  return {
    version: report.version,
    reportStatus: report.reportStatus,
    technique: report.technique ?? null,
    findings: report.findings ?? null,
    conclusion: report.conclusion ?? null,
    recommendations: report.recommendations ?? null,
    radiologistId: report.radiologistId ?? null,
    signedAt: report.signedAt ?? null,
  }
}

/** Next version number for an amendment (monotonic, no silent overwrite). */
export function nextVersion(report: Pick<RadiologyReport, 'version'>): number {
  return (report.version ?? 1) + 1
}
