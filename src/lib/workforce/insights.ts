// ── Workforce operational insights (Phase 21) ──────────────────────
//
// Deterministic, read-only, OPERATIONAL-only signals derived from the workforce
// dashboard. Emits CODES + params only (the UI renders them via i18n) — there is
// no free-text generation here. STRICTLY forbidden and structurally impossible
// in this module: recommending hiring, evaluating performance, or suggesting
// disciplinary action. It only reports facts already in the data: an expiry
// date, a missing credential row, an incomplete profile.

import type { WorkforceDashboard } from './dashboard'
import type { WorkforceMember } from './types'

export type InsightSeverity = 'info' | 'warning' | 'critical'

export interface WorkforceInsight {
  code:
    | 'license_expired' | 'license_expiring'
    | 'contract_expiring' | 'credential_missing' | 'profile_incomplete'
  severity: InsightSeverity
  labelKey: string
  params: Record<string, string | number>
  memberId?: string
}

// The fields that make up a "complete" workforce profile. Structural only —
// presence, never quality. medical license is expected for clinical roles only.
export function profileCompleteness(member: WorkforceMember): { score: number; missing: string[] } {
  const e = member.employee
  const checks: { key: string; ok: boolean }[] = [
    { key: 'employment_record', ok: !!e },
    { key: 'matricule',         ok: !!e?.matricule },
    { key: 'department',        ok: !!e?.department },
    { key: 'position',          ok: !!e?.position },
    { key: 'employment_type',   ok: !!e?.employmentType },
    { key: 'hire_date',         ok: !!e?.hireDate },
    { key: 'languages',         ok: member.languages.length > 0 },
  ]
  if (member.role === 'doctor' || member.role === 'nurse') {
    checks.push({ key: 'medical_license', ok: !!e?.medicalLicenseNumber })
    checks.push({ key: 'specialty',       ok: !!member.primarySpecialty })
  }
  const missing = checks.filter(c => !c.ok).map(c => c.key)
  const score = Math.round(((checks.length - missing.length) / checks.length) * 100)
  return { score, missing }
}

export interface InsightInput {
  dashboard: WorkforceDashboard
  members: WorkforceMember[]
  maxItems?: number
}

/**
 * Build the operational insight feed, most-urgent first. Deterministic. Caps the
 * feed so it stays a nudge list, not an audit dump.
 */
export function workforceInsights(input: InsightInput): WorkforceInsight[] {
  const { dashboard, members } = input
  const out: WorkforceInsight[] = []

  for (const l of dashboard.expiringLicenses) {
    if (l.tier === 'expired') {
      out.push({ code: 'license_expired', severity: 'critical', memberId: l.member.userId, labelKey: 'insight_license_expired', params: { name: l.member.fullName } })
    } else {
      out.push({ code: 'license_expiring', severity: 'warning', memberId: l.member.userId, labelKey: 'insight_license_expiring', params: { name: l.member.fullName, days: l.days } })
    }
  }

  for (const c of dashboard.expiringContracts) {
    out.push({ code: 'contract_expiring', severity: c.tier === 'expired' ? 'critical' : 'warning', memberId: c.member.userId, labelKey: 'insight_contract_expiring', params: { name: c.member.fullName, days: c.days } })
  }

  for (const mc of dashboard.missingCredentials) {
    out.push({ code: 'credential_missing', severity: 'info', memberId: mc.member.userId, labelKey: 'insight_credential_missing', params: { name: mc.member.fullName } })
  }

  for (const m of members) {
    const { score } = profileCompleteness(m)
    if (score < 50) {
      out.push({ code: 'profile_incomplete', severity: 'info', memberId: m.userId, labelKey: 'insight_profile_incomplete', params: { name: m.fullName, score } })
    }
  }

  const rank: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2 }
  out.sort((a, b) => rank[a.severity] - rank[b.severity])
  return out.slice(0, input.maxItems ?? 20)
}
