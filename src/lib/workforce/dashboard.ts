// ── Workforce dashboard aggregations (Phase 21) ────────────────────
//
// Pure, deterministic aggregations over the workforce set. No I/O, no React.
// Operational metrics only — headcounts, expiries, distributions. Never
// evaluates a person; never touches permissions or patient data.

import type { Credential, TrainingRecord, WorkforceMember } from './types'
import { credentialReminders, reminderTier, daysUntil, missingCredentialTypes } from './credentials'
import type { ReminderTier } from './types'

export interface ContractReminder {
  member: WorkforceMember
  days: number
  tier: Exclude<ReminderTier, null>
}

export interface RenewalItem {
  kind: 'credential' | 'contract' | 'training'
  employeeId: string
  ref: string            // credential type / member name / training title
  date: string
  days: number
  tier: Exclude<ReminderTier, null>
}

export interface DistributionBucket {
  key: string
  count: number
}

export interface WorkforceDashboard {
  totalMembers: number
  activeCount: number
  onLeaveCount: number
  suspendedCount: number
  retiredCount: number
  terminatedCount: number
  withoutEmploymentRecord: number
  expiringLicenses: { member: WorkforceMember; credential: Credential; days: number; tier: Exclude<ReminderTier, null> }[]
  expiringContracts: ContractReminder[]
  missingCredentials: { member: WorkforceMember; missing: string[] }[]
  recentlyHired: WorkforceMember[]
  departmentDistribution: DistributionBucket[]
  specialtyDistribution: DistributionBucket[]
  upcomingRenewals: RenewalItem[]
}

export interface DashboardInput {
  members: WorkforceMember[]
  credentials: Credential[]
  trainings?: TrainingRecord[]
  now: Date
  recentlyHiredWindowDays?: number
}

const LICENSE_TYPES = new Set(['license', 'council_registration', 'board_certification'])

export function buildWorkforceDashboard(input: DashboardInput): WorkforceDashboard {
  const { members, credentials, trainings = [], now } = input
  const hiredWindow = input.recentlyHiredWindowDays ?? 30

  const byEmployeeId = new Map<string, WorkforceMember>()
  for (const m of members) if (m.employee) byEmployeeId.set(m.employee.id, m)

  const credByEmployee = new Map<string, Credential[]>()
  for (const c of credentials) {
    const list = credByEmployee.get(c.employeeId) ?? []
    list.push(c)
    credByEmployee.set(c.employeeId, list)
  }

  // Headcounts by employment status.
  let activeCount = 0, onLeaveCount = 0, suspendedCount = 0, retiredCount = 0, terminatedCount = 0, withoutEmploymentRecord = 0
  for (const m of members) {
    if (!m.employee) { withoutEmploymentRecord++; continue }
    switch (m.employee.employmentStatus) {
      case 'active':     activeCount++; break
      case 'on_leave':   onLeaveCount++; break
      case 'suspended':  suspendedCount++; break
      case 'retired':    retiredCount++; break
      case 'terminated': terminatedCount++; break
    }
  }

  // Expiring licenses (license-family credential reminders).
  const expiringLicenses: WorkforceDashboard['expiringLicenses'] = []
  for (const [employeeId, list] of credByEmployee) {
    const member = byEmployeeId.get(employeeId)
    if (!member) continue
    for (const r of credentialReminders(list.filter(c => LICENSE_TYPES.has(c.credentialType)), now)) {
      expiringLicenses.push({ member, credential: r.credential, days: r.days, tier: r.tier })
    }
  }
  expiringLicenses.sort((a, b) => a.days - b.days)

  // Expiring contracts (employee contract_end_date within 90 days / expired).
  const expiringContracts: ContractReminder[] = []
  for (const m of members) {
    if (!m.employee?.contractEndDate) continue
    if (m.employee.employmentStatus === 'terminated' || m.employee.employmentStatus === 'retired') continue
    const tier = reminderTier(m.employee.contractEndDate, now)
    if (tier === null) continue
    expiringContracts.push({ member: m, days: daysUntil(m.employee.contractEndDate, now)!, tier })
  }
  expiringContracts.sort((a, b) => a.days - b.days)

  // Missing credentials (structural completeness — active workforce only).
  const missingCredentials: WorkforceDashboard['missingCredentials'] = []
  for (const m of members) {
    if (!m.employee) continue
    if (m.employee.employmentStatus === 'terminated' || m.employee.employmentStatus === 'retired') continue
    // Only clinical roles are expected to hold a license.
    if (!['doctor', 'nurse'].includes(m.role)) continue
    const missing = missingCredentialTypes(credByEmployee.get(m.employee.id) ?? [])
    if (missing.length) missingCredentials.push({ member: m, missing })
  }

  // Recently hired (hire_date within the window, in the past).
  const recentlyHired = members
    .filter(m => {
      if (!m.employee?.hireDate) return false
      const d = daysUntil(m.employee.hireDate, now)
      return d !== null && d <= 0 && d >= -hiredWindow
    })
    .sort((a, b) => (daysUntil(b.employee!.hireDate, now)! - daysUntil(a.employee!.hireDate, now)!))

  // Distributions.
  const departmentDistribution = tally(members.map(m => m.employee?.department ?? 'unassigned'))
  const specialtyDistribution = tally(members.map(m => m.primarySpecialty ?? 'unassigned'))

  // Upcoming renewals — merge credentials + contracts + trainings, soonest first.
  const upcomingRenewals: RenewalItem[] = []
  for (const c of credentials) {
    const tier = reminderTier(c.expiryDate, now)
    if (tier === null) continue
    upcomingRenewals.push({ kind: 'credential', employeeId: c.employeeId, ref: c.credentialType, date: c.expiryDate!, days: daysUntil(c.expiryDate, now)!, tier })
  }
  for (const cr of expiringContracts) {
    upcomingRenewals.push({ kind: 'contract', employeeId: cr.member.employee!.id, ref: cr.member.fullName, date: cr.member.employee!.contractEndDate!, days: cr.days, tier: cr.tier })
  }
  for (const t of trainings) {
    const tier = reminderTier(t.expiryDate, now)
    if (tier === null) continue
    upcomingRenewals.push({ kind: 'training', employeeId: t.employeeId, ref: t.title, date: t.expiryDate!, days: daysUntil(t.expiryDate, now)!, tier })
  }
  upcomingRenewals.sort((a, b) => a.days - b.days)

  return {
    totalMembers: members.length,
    activeCount, onLeaveCount, suspendedCount, retiredCount, terminatedCount, withoutEmploymentRecord,
    expiringLicenses, expiringContracts, missingCredentials, recentlyHired,
    departmentDistribution, specialtyDistribution, upcomingRenewals,
  }
}

function tally(keys: string[]): DistributionBucket[] {
  const counts = new Map<string, number>()
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1)
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}
