// ── Department registry (Phase 21) ─────────────────────────────────
//
// Registry-driven, code-based departments — the same plug-in model as
// SPECIALTIES / SETTINGS_SECTIONS: add one entry, no schema change. A
// department is ORGANISATIONAL ONLY. It never grants, changes, or gates
// permissions — permissions come solely from user_profiles.role. Some
// departments carry an optional specialtyId hint used only for reporting
// (specialty distribution), never for access control.

export interface DepartmentDefinition {
  code: string
  labelKey: string          // i18n key under the `workforce` namespace
  /** Optional clinical specialty association — reporting hint only. */
  specialtyId?: string
}

export const DEPARTMENT_REGISTRY: DepartmentDefinition[] = [
  { code: 'administration',    labelKey: 'dept_administration' },
  { code: 'reception',         labelKey: 'dept_reception' },
  { code: 'consultation',      labelKey: 'dept_consultation' },
  { code: 'emergency',         labelKey: 'dept_emergency' },
  { code: 'general_practice',  labelKey: 'dept_general_practice', specialtyId: 'general_practice' },
  { code: 'pediatrics',        labelKey: 'dept_pediatrics',       specialtyId: 'pediatrics' },
  { code: 'obgyn',             labelKey: 'dept_obgyn',            specialtyId: 'obstetrics_gynecology' },
  { code: 'maternity',         labelKey: 'dept_maternity' },
  { code: 'surgery',           labelKey: 'dept_surgery' },
  { code: 'orl',               labelKey: 'dept_orl',              specialtyId: 'ent' },
  { code: 'nursing',           labelKey: 'dept_nursing' },
  { code: 'laboratory',        labelKey: 'dept_laboratory' },
  { code: 'radiology',         labelKey: 'dept_radiology' },
  { code: 'imaging',           labelKey: 'dept_imaging' },
  { code: 'pharmacy',          labelKey: 'dept_pharmacy' },
  { code: 'billing',           labelKey: 'dept_billing' },
  { code: 'finance',           labelKey: 'dept_finance' },
  { code: 'it',                labelKey: 'dept_it' },
  { code: 'management',        labelKey: 'dept_management' },
]

const BY_CODE = new Map(DEPARTMENT_REGISTRY.map(d => [d.code, d]))

export function listDepartments(): DepartmentDefinition[] {
  return DEPARTMENT_REGISTRY
}

export function getDepartment(code?: string | null): DepartmentDefinition | null {
  if (!code) return null
  return BY_CODE.get(code) ?? null
}

export function isDepartment(code?: string | null): boolean {
  return !!code && BY_CODE.has(code)
}

/** i18n label key for a department code, or a neutral fallback key. */
export function departmentLabelKey(code?: string | null): string {
  return getDepartment(code)?.labelKey ?? 'dept_unassigned'
}
