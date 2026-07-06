// ── Workforce search & filtering (Phase 21) ────────────────────────
//
// Pure predicates over the workforce set. Filter by department, specialty,
// role, employment status, language, clinic, and credential expiry. No I/O.
// Filtering NEVER changes permissions — it only narrows a display list.

import type { Role } from '@/types/database'
import type { Credential, EmploymentStatus, WorkforceMember } from './types'
import { reminderTier } from './credentials'

export interface WorkforceFilters {
  query?: string
  department?: string
  specialty?: string
  role?: Role
  employmentStatus?: EmploymentStatus
  language?: string
  clinicId?: string
  credentialExpiry?: 'expiring' | 'expired'
}

export interface FilterContext {
  credentials?: Credential[]
  now?: Date
}

function matchesQuery(m: WorkforceMember, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [
    m.fullName, m.email, m.employee?.matricule, m.employee?.position,
    m.employee?.medicalLicenseNumber, m.employee?.nationalId,
  ].filter(Boolean).join(' ').toLowerCase()
  return hay.includes(needle)
}

/** Filter the workforce list. Empty/undefined filters are no-ops. */
export function filterWorkforce(
  members: WorkforceMember[],
  filters: WorkforceFilters,
  ctx: FilterContext = {},
): WorkforceMember[] {
  const now = ctx.now ?? new Date(0)
  const credByEmployee = new Map<string, Credential[]>()
  for (const c of ctx.credentials ?? []) {
    const list = credByEmployee.get(c.employeeId) ?? []
    list.push(c)
    credByEmployee.set(c.employeeId, list)
  }

  return members.filter(m => {
    if (filters.query && !matchesQuery(m, filters.query)) return false
    if (filters.department && (m.employee?.department ?? '') !== filters.department) return false
    if (filters.specialty && (m.primarySpecialty ?? '') !== filters.specialty) return false
    if (filters.role && m.role !== filters.role) return false
    if (filters.employmentStatus && m.employee?.employmentStatus !== filters.employmentStatus) return false
    if (filters.clinicId && m.clinicId !== filters.clinicId) return false
    if (filters.language && !m.languages.map(l => l.toLowerCase()).includes(filters.language.toLowerCase())) return false

    if (filters.credentialExpiry) {
      const list = m.employee ? (credByEmployee.get(m.employee.id) ?? []) : []
      const tiers = list.map(c => reminderTier(c.expiryDate, now))
      if (filters.credentialExpiry === 'expired' && !tiers.includes('expired')) return false
      if (filters.credentialExpiry === 'expiring'
        && !tiers.some(t => t === 'due_30' || t === 'due_60' || t === 'due_90')) return false
    }
    return true
  })
}

/** Distinct languages present across the workforce (for a filter dropdown). */
export function distinctLanguages(members: WorkforceMember[]): string[] {
  const set = new Set<string>()
  for (const m of members) for (const l of m.languages) if (l.trim()) set.add(l)
  return [...set].sort((a, b) => a.localeCompare(b))
}
