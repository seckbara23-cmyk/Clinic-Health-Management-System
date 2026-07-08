// ── Enterprise Authorization — Module registry (Phase 40) ─────────
//
// The central registry of platform modules. Every module exposes the actions it
// supports; a permission id is `<module>.<action>`. Sidebar nav, buttons, fields
// and AI copilots all resolve their access from these permissions. Additive and
// registry-driven — a future module is one entry here.

import type { Action } from './actions'

export interface ModuleDef {
  id: string
  labelKey: string
  /** Actions this module exposes (each becomes a `<id>.<action>` permission). */
  actions: Action[]
  /** Sensitive fields this module guards (each becomes a `field.<name>` permission). */
  fields?: string[]
}

export const MODULES: ModuleDef[] = [
  { id: 'dashboard',      labelKey: 'mod_dashboard',      actions: ['view'] },
  { id: 'patients',       labelKey: 'mod_patients',       actions: ['view', 'create', 'edit', 'delete', 'export'], fields: ['national_id', 'insurance_number', 'medical_history'] },
  { id: 'queue',          labelKey: 'mod_queue',          actions: ['view', 'manage'] },
  { id: 'appointments',   labelKey: 'mod_appointments',   actions: ['view', 'create', 'edit', 'cancel', 'schedule'] },
  { id: 'consultations',  labelKey: 'mod_consultations',  actions: ['view', 'create', 'edit', 'sign'], fields: ['psychiatry_notes'] },
  { id: 'prescriptions',  labelKey: 'mod_prescriptions',  actions: ['view', 'create', 'edit'] },
  { id: 'laboratory',     labelKey: 'mod_laboratory',     actions: ['view', 'create', 'verify', 'result_entry', 'catalog'] },
  { id: 'radiology',      labelKey: 'mod_radiology',      actions: ['view', 'report', 'sign', 'upload'] },
  { id: 'pharmacy',       labelKey: 'mod_pharmacy',       actions: ['view', 'dispense', 'inventory', 'catalog', 'reports', 'scan'] },
  { id: 'billing',        labelKey: 'mod_billing',        actions: ['view', 'create', 'payment', 'refund'], fields: ['financial'] },
  { id: 'finance',        labelKey: 'mod_finance',        actions: ['view', 'approve', 'export'], fields: ['financial'] },
  { id: 'inventory',      labelKey: 'mod_inventory',      actions: ['view', 'manage'] },
  { id: 'workforce',      labelKey: 'mod_workforce',      actions: ['view', 'manage'], fields: ['salary'] },
  { id: 'hr',             labelKey: 'mod_hr',             actions: ['view', 'manage'], fields: ['salary'] },
  { id: 'reports',        labelKey: 'mod_reports',        actions: ['view', 'export'] },
  { id: 'documents',      labelKey: 'mod_documents',      actions: ['view', 'create', 'print', 'export'] },
  { id: 'ai',             labelKey: 'mod_ai',             actions: ['view'] },   // ai.view = AI copilots
  { id: 'settings',       labelKey: 'mod_settings',       actions: ['view', 'manage'] },
  { id: 'administration', labelKey: 'mod_administration', actions: ['view', 'manage'] },
]

// Sensitive fields guarded by field-level security (`field.<name>` permissions).
export const SENSITIVE_FIELDS = [
  'salary', 'national_id', 'insurance_number', 'psychiatry_notes', 'financial', 'medical_history',
] as const
export type SensitiveField = (typeof SENSITIVE_FIELDS)[number]

export const MODULE_IDS = MODULES.map(m => m.id)

export function getModule(id?: string | null): ModuleDef | null {
  return MODULES.find(m => m.id === id) ?? null
}

/** Every valid permission id the registry defines (`<module>.<action>` + `field.<name>`). */
export function allPermissionIds(): string[] {
  const perms: string[] = []
  for (const m of MODULES) for (const a of m.actions) perms.push(`${m.id}.${a}`)
  for (const f of SENSITIVE_FIELDS) perms.push(`field.${f}`)
  return perms
}

export function isValidPermission(perm?: string | null): boolean {
  if (!perm) return false
  if (perm === '*') return true
  if (perm.startsWith('field.')) return (SENSITIVE_FIELDS as readonly string[]).includes(perm.slice(6))
  const [mod, action] = perm.split('.')
  if (action === '*') return MODULE_IDS.includes(mod)
  const m = getModule(mod)
  return !!m && m.actions.includes(action as Action)
}
