import { readFileSync } from 'fs'
import { join } from 'path'

// ── Enterprise Identity Model tests (Phase 42) ────────────────────
// Verifies the permanent separation of Role / Department / Primary Specialty:
// doctors require a specialty, non-doctors never carry one, department is pure
// organizational metadata, specialty activates exactly ONE workspace, the
// clinical taxonomy stays the single source of truth, the migration is additive,
// and nothing touches Enterprise Authorization or RLS.

import {
  requiresSpecialty, canHaveSpecialty, specialtyOptions, isDoctorSpecialty,
  normalizeIdentity, validateIdentity, activeSpecialtyWorkspace,
} from '@/lib/identity/model'
import {
  DEPARTMENT_REGISTRY, listDepartments, getDepartment, isDepartment, departmentLabelKey,
} from '@/lib/workforce/departments'
import {
  SPECIALTY_TAXONOMY, getClinicalSpecialty, isRegisteredClinicalSpecialty,
} from '@/lib/specialties/taxonomy'
import type { Role } from '@/types/database'

const ROLES: Role[] = ['super_admin', 'admin', 'doctor', 'receptionist', 'nurse', 'cashier', 'lab_technician', 'pharmacist']

// ── Identity rules ────────────────────────────────────────────────
describe('specialty applies to doctors only', () => {
  it('requiresSpecialty / canHaveSpecialty is true for doctor, false otherwise', () => {
    for (const r of ROLES) {
      const expected = r === 'doctor'
      expect(requiresSpecialty(r)).toBe(expected)
      expect(canHaveSpecialty(r)).toBe(expected)
    }
    expect(requiresSpecialty(null)).toBe(false)
  })
})

describe('normalizeIdentity enforces the rules on write', () => {
  it('a doctor keeps a valid specialty and department', () => {
    expect(normalizeIdentity({ role: 'doctor', department: 'radiology', primary_specialty: 'radiology' }))
      .toEqual({ department: 'radiology', primary_specialty: 'radiology' })
  })
  it('a non-doctor NEVER keeps a specialty (stripped to null)', () => {
    for (const r of ['nurse', 'cashier', 'lab_technician', 'pharmacist', 'receptionist', 'admin', 'super_admin'] as Role[]) {
      expect(normalizeIdentity({ role: r, department: 'finance', primary_specialty: 'cardiology' }))
        .toEqual({ department: 'finance', primary_specialty: null })
    }
  })
  it('blank values normalize to null (existing users migrate safely)', () => {
    expect(normalizeIdentity({ role: 'doctor', department: '  ', primary_specialty: '  ' }))
      .toEqual({ department: null, primary_specialty: null })
    expect(normalizeIdentity({ role: 'nurse' })).toEqual({ department: null, primary_specialty: null })
  })
})

describe('validateIdentity', () => {
  it('a doctor must have a registered specialty', () => {
    expect(validateIdentity({ role: 'doctor', primary_specialty: null }).primary_specialty).toBe('specialty_required')
    expect(validateIdentity({ role: 'doctor', primary_specialty: 'not_a_specialty' }).primary_specialty).toBe('specialty_not_registered')
    expect(validateIdentity({ role: 'doctor', primary_specialty: 'cardiology' }).primary_specialty).toBeUndefined()
  })
  it('a non-doctor must NOT have a specialty', () => {
    expect(validateIdentity({ role: 'nurse', primary_specialty: 'cardiology' }).primary_specialty).toBe('specialty_forbidden_for_role')
    expect(validateIdentity({ role: 'cashier', primary_specialty: null }).primary_specialty).toBeUndefined()
  })
})

// ── Copilot / workspace activation ────────────────────────────────
describe('activeSpecialtyWorkspace activates exactly one workspace', () => {
  it('a doctor with a registered specialty activates exactly that one', () => {
    for (const id of ['cardiology', 'neurology', 'radiology', 'psychiatry', 'general_practice']) {
      const active = activeSpecialtyWorkspace('doctor', id)
      expect(active).toBe(id)                     // exactly one id — never an array/multiple
      expect(typeof active).toBe('string')
    }
  })
  it('non-doctors never activate a specialty workspace', () => {
    for (const r of ['nurse', 'cashier', 'lab_technician', 'pharmacist', 'receptionist', 'admin', 'super_admin'] as Role[]) {
      expect(activeSpecialtyWorkspace(r, 'cardiology')).toBeNull()
    }
  })
  it('a doctor without / with an unknown specialty activates none', () => {
    expect(activeSpecialtyWorkspace('doctor', null)).toBeNull()
    expect(activeSpecialtyWorkspace('doctor', 'bogus')).toBeNull()
  })
})

// ── Registry reuse (taxonomy is the single source of truth) ───────
describe('specialty options reuse the clinical taxonomy — no duplicated definitions', () => {
  it('every doctor specialty option comes from SPECIALTY_TAXONOMY', () => {
    const taxonomyIds = new Set(SPECIALTY_TAXONOMY.map(s => s.id))
    for (const opt of specialtyOptions()) {
      expect(taxonomyIds.has(opt.id)).toBe(true)
      expect(isRegisteredClinicalSpecialty(opt.id)).toBe(true)
      expect(opt.status).toBe('active')
    }
  })
  it('offers the physician specialties and excludes non-doctor ones', () => {
    const ids = specialtyOptions().map(s => s.id)
    for (const id of ['general_practice', 'cardiology', 'radiology', 'neurology', 'psychiatry', 'pediatrics', 'obgyn', 'emergency_medicine']) {
      expect(ids).toContain(id)
    }
    for (const id of ['pharmacy', 'nursing', 'midwifery']) {
      expect(ids).not.toContain(id)   // these belong to other professions
    }
  })
  it('isDoctorSpecialty gates correctly', () => {
    expect(isDoctorSpecialty('cardiology')).toBe(true)
    expect(isDoctorSpecialty('pharmacy')).toBe(false)
    expect(isDoctorSpecialty(null)).toBe(false)
  })
})

// ── Department registry (reused from workforce — organizational only) ──
describe('department registry', () => {
  it('reuses the existing workforce registry and covers the pilot departments', () => {
    const codes = new Set(listDepartments().map(d => d.code))
    for (const code of ['consultation', 'emergency', 'radiology', 'imaging', 'laboratory', 'pharmacy',
      'surgery', 'maternity', 'finance', 'administration']) {
      expect(codes.has(code)).toBe(true)
    }
    expect(listDepartments()).toBe(DEPARTMENT_REGISTRY)   // same single source
  })
  it('getDepartment / isDepartment / departmentLabelKey behave', () => {
    expect(getDepartment('radiology')?.labelKey).toBe('dept_radiology')
    expect(isDepartment('radiology')).toBe(true)
    expect(isDepartment('nope')).toBe(false)
    expect(departmentLabelKey('surgery')).toBe('dept_surgery')
    expect(departmentLabelKey('unknown')).toBe('dept_unassigned')
  })
})

// ── Rendering: labels resolve from i18n ───────────────────────────
describe('label rendering', () => {
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))
  const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))

  it('every department has an i18n label in both locales', () => {
    for (const d of DEPARTMENT_REGISTRY) {
      expect(en.workforce[d.labelKey]).toBeTruthy()
      expect(fr.workforce[d.labelKey]).toBeTruthy()
    }
  })
  it('every doctor specialty has an i18n label in both locales', () => {
    for (const s of specialtyOptions()) {
      expect(en.specialties[s.labelKey]).toBeTruthy()
      expect(fr.specialties[s.labelKey]).toBeTruthy()
      expect(getClinicalSpecialty(s.id)?.labelKey).toBe(s.labelKey)
    }
  })
  it('the identity card + adminUsers keys exist with fr/en parity', () => {
    for (const k of ['cardTitle', 'fieldRole', 'fieldDepartment', 'fieldSpecialty', 'fieldTitle', 'fieldLicense', 'fieldEmployeeId', 'fieldClinic', 'fieldStatus']) {
      expect(en.identity[k]).toBeTruthy()
    }
    for (const k of ['colDepartment', 'colSpecialty', 'labelDepartment', 'labelSpecialty', 'editTitle', 'toastUserUpdated', 'zodSpecialtyRequired']) {
      expect(en.adminUsers[k]).toBeTruthy()
    }
    expect(Object.keys(fr.identity).sort()).toEqual(Object.keys(en.identity).sort())
    expect(Object.keys(fr.adminUsers).sort()).toEqual(Object.keys(en.adminUsers).sort())
  })
})

// ── Filters (organizational only) ─────────────────────────────────
describe('department / specialty filters', () => {
  // The exact predicate the Users page applies.
  const match = (u: { department?: string | null; primary_specialty?: string | null }, deptFilter: string, specialtyFilter: string) =>
    (deptFilter === 'all' || u.department === deptFilter) &&
    (specialtyFilter === 'all' || u.primary_specialty === specialtyFilter)

  const users = [
    { department: 'radiology', primary_specialty: 'radiology' },
    { department: 'finance', primary_specialty: null },
    { department: 'laboratory', primary_specialty: null },
    { department: 'consultation', primary_specialty: 'cardiology' },
  ]

  it('filters by department', () => {
    expect(users.filter(u => match(u, 'finance', 'all'))).toHaveLength(1)
  })
  it('filters by specialty', () => {
    expect(users.filter(u => match(u, 'all', 'cardiology'))).toHaveLength(1)
  })
  it('"all" shows everyone', () => {
    expect(users.filter(u => match(u, 'all', 'all'))).toHaveLength(4)
  })
})

// ── Migration 069 — additive & safe ───────────────────────────────
describe('migration 069_identity.sql', () => {
  const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '069_identity.sql'), 'utf8')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

  it('additively adds department + primary_specialty to clinic_invitations', () => {
    expect(code).toMatch(/ALTER TABLE public\.clinic_invitations/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS department\s+TEXT/)
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS primary_specialty\s+TEXT/)
  })
  it('changes NO policy / RLS / auth.users and drops nothing', () => {
    expect(code).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY/i)
    expect(code).not.toMatch(/auth\.users/i)
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN/i)
  })
})

describe('user_profiles identity columns are nullable (existing users migrate safely)', () => {
  it('037 adds department/primary_specialty as nullable TEXT (no NOT NULL / DEFAULT)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '037_user_preferences.sql'), 'utf8')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS primary_specialty TEXT/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS department\s+TEXT/)
    expect(sql).not.toMatch(/primary_specialty TEXT NOT NULL/)
    expect(sql).not.toMatch(/department\s+TEXT NOT NULL/)
  })
})

// ── No authorization / RLS coupling ───────────────────────────────
describe('identity never touches Enterprise Authorization or RLS', () => {
  it('the identity model does not import the authz engine', () => {
    const src = readFileSync(join(__dirname, '..', 'identity', 'model.ts'), 'utf8')
    expect(src).not.toMatch(/@\/lib\/authz/)
    // never calls the authorization engine (can('module.action'))
    expect(src).not.toMatch(/\bcan\(\s*['"]/)
  })
  it('EditUserDialog updates ONLY department + primary_specialty (never role/clinic/permissions)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'admin', 'EditUserDialog.tsx'), 'utf8')
    // the update payload
    const updateCall = src.slice(src.indexOf('.update('))
    expect(updateCall).toMatch(/department:/)
    expect(updateCall).toMatch(/primary_specialty:/)
    expect(updateCall.slice(0, updateCall.indexOf(')'))).not.toMatch(/\brole:|\bclinic_id:|\bis_active:/)
  })
})
