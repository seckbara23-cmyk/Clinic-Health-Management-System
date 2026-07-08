// ── Enterprise Authorization — Department registry (Phase 40) ─────
//
// Departments are an ORGANIZATIONAL grouping (Department → Role → Permission). They
// group roles for the access matrix and future custom roles. IMPORTANT: a
// department is NEVER the security key — enforcement resolves from the user's ROLE
// (RLS-aligned), not from an employment department. This preserves the existing
// rule that employment status/department never grant or revoke access.

import type { Role } from '@/types/database'

export interface DepartmentDef {
  id: string
  labelKey: string
  /** Roles that typically belong to this department (organizational view only). */
  roles: Role[]
  /** Specialty this department maps to, when it refines a clinical role. */
  specialty?: string
}

export const DEPARTMENTS: DepartmentDef[] = [
  { id: 'reception',        labelKey: 'dep_reception',        roles: ['receptionist'] },
  { id: 'nursing',          labelKey: 'dep_nursing',          roles: ['nurse'] },
  { id: 'general_practice', labelKey: 'dep_general_practice', roles: ['doctor'] },
  { id: 'specialists',      labelKey: 'dep_specialists',      roles: ['doctor'] },
  { id: 'radiology',        labelKey: 'dep_radiology',        roles: ['doctor'], specialty: 'radiology' },
  { id: 'laboratory',       labelKey: 'dep_laboratory',       roles: ['lab_technician'] },
  { id: 'pharmacy',         labelKey: 'dep_pharmacy',         roles: ['pharmacist'] },
  { id: 'finance',          labelKey: 'dep_finance',          roles: ['cashier'] },
  { id: 'accounting',       labelKey: 'dep_accounting',       roles: ['admin'] },
  { id: 'human_resources',  labelKey: 'dep_human_resources',  roles: ['admin'] },
  { id: 'administration',   labelKey: 'dep_administration',   roles: ['admin'] },
  { id: 'management',       labelKey: 'dep_management',        roles: ['admin'] },
  { id: 'it',               labelKey: 'dep_it',               roles: ['super_admin'] },
]

export const DEPARTMENT_IDS = DEPARTMENTS.map(d => d.id)

export function getDepartment(id?: string | null): DepartmentDef | null {
  return DEPARTMENTS.find(d => d.id === id) ?? null
}

export function departmentsForRole(role?: string | null): DepartmentDef[] {
  return DEPARTMENTS.filter(d => (d.roles as string[]).includes(role ?? ''))
}
