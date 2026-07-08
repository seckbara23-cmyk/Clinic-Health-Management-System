import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// ── Phase 41 — Pilot role-access validation ───────────────────────
// Executable specification of what EACH role may and may NOT do, derived from the
// Enterprise Authorization engine (Phase 40). This encodes the pilot STOP
// conditions as tests so a regression can never silently reach a real clinic:
//   • no technician sees finance
//   • no cashier sees clinical notes
//   • no receptionist sees protected medical notes
//   • no super_admin sees confidential (psychiatry) content by default
//   • psychiatry data stays inside the care team
//   • radiology signing is limited to radiologist/admin
//   • AI data access never exceeds the user's own access
// It also forward-guards the "no auth.users in RLS policies" invariant for every
// migration authored after the 048 fix.

import { can, canField, aiDomainsFor, visibleModules, type Principal } from '@/lib/authz'
import type { Role } from '@/types/database'

const P = (role: Role, extra: Partial<Principal> = {}): Principal => ({ role, ...extra })

// Positive expectations: a representative permission each role MUST have.
const MUST_HAVE: Record<Role, string[]> = {
  super_admin:    ['dashboard.view', 'administration.view', 'reports.view'],
  admin:          ['dashboard.view', 'patients.view', 'finance.view', 'workforce.view'],
  doctor:         ['consultations.create', 'prescriptions.create', 'radiology.view', 'ai.view'],
  nurse:          ['patients.view', 'prescriptions.create', 'laboratory.view'],
  receptionist:   ['patients.create', 'appointments.create', 'billing.view'],
  cashier:        ['billing.payment'],
  lab_technician: ['laboratory.result_entry', 'laboratory.verify'],
  pharmacist:     ['pharmacy.dispense', 'pharmacy.inventory'],
}

// Negative expectations: permissions each role must NOT have (least privilege).
const MUST_NOT_HAVE: Record<Role, string[]> = {
  super_admin:    ['ai.view'],                                   // zero-tool for AI copilots
  admin:          [],
  doctor:         ['finance.view', 'hr.view', 'billing.refund'],
  nurse:          ['finance.view', 'hr.view', 'consultations.sign', 'billing.view'],
  receptionist:   ['consultations.view', 'prescriptions.view', 'finance.view', 'laboratory.view'],
  cashier:        ['consultations.view', 'prescriptions.view', 'laboratory.view', 'finance.view', 'hr.view'],
  lab_technician: ['finance.view', 'hr.view', 'billing.view', 'consultations.view', 'pharmacy.dispense'],
  pharmacist:     ['finance.view', 'hr.view', 'consultations.view', 'billing.view'],
}

describe('per-role permission profile', () => {
  for (const role of Object.keys(MUST_HAVE) as Role[]) {
    it(`${role}: has its required permissions`, () => {
      for (const perm of MUST_HAVE[role]) expect(can(P(role), perm)).toBe(true)
    })
    it(`${role}: is denied everything outside its remit`, () => {
      for (const perm of MUST_NOT_HAVE[role]) expect(can(P(role), perm)).toBe(false)
    })
  }
})

describe('pilot STOP conditions — data isolation', () => {
  it('no technician (lab/pharmacy) sees finance', () => {
    for (const r of ['lab_technician', 'pharmacist'] as Role[]) {
      expect(can(P(r), 'finance.view')).toBe(false)
      expect(canField(P(r), 'financial')).toBe(false)
    }
  })

  it('no cashier sees clinical notes', () => {
    expect(can(P('cashier'), 'consultations.view')).toBe(false)
    expect(canField(P('cashier'), 'medical_history')).toBe(false)
    expect(canField(P('cashier'), 'psychiatry_notes')).toBe(false)
  })

  it('no receptionist sees protected medical notes', () => {
    expect(can(P('receptionist'), 'consultations.view')).toBe(false)
    expect(canField(P('receptionist'), 'medical_history')).toBe(false)
    expect(canField(P('receptionist'), 'psychiatry_notes')).toBe(false)
  })

  it('no super_admin sees confidential (psychiatry) content by default', () => {
    expect(canField(P('super_admin'), 'psychiatry_notes')).toBe(false)
  })

  it('psychiatry notes stay inside the care team (doctor/nurse/admin only)', () => {
    const inside: Role[] = ['doctor', 'nurse', 'admin']
    const outside: Role[] = ['super_admin', 'receptionist', 'cashier', 'lab_technician', 'pharmacist']
    for (const r of inside) expect(canField(P(r), 'psychiatry_notes')).toBe(true)
    for (const r of outside) expect(canField(P(r), 'psychiatry_notes')).toBe(false)
  })

  it('salary/HR is admin/super_admin only', () => {
    for (const r of ['super_admin', 'admin'] as Role[]) expect(canField(P(r), 'salary')).toBe(true)
    for (const r of ['doctor', 'nurse', 'receptionist', 'cashier', 'lab_technician', 'pharmacist'] as Role[]) {
      expect(canField(P(r), 'salary')).toBe(false)
    }
  })

  it('radiology signing is radiologist (doctor+radiology) or admin only', () => {
    expect(can(P('doctor', { primarySpecialtyId: 'radiology' }), 'radiology.sign')).toBe(true)
    expect(can(P('admin'), 'radiology.sign')).toBe(true)
    expect(can(P('doctor', { primarySpecialtyId: 'cardiology' }), 'radiology.sign')).toBe(false)
    expect(can(P('lab_technician'), 'radiology.sign')).toBe(false)
  })
})

describe('pilot STOP conditions — AI inheritance never exceeds the user', () => {
  it('lab tech AI is confined to laboratory', () => {
    expect(aiDomainsFor(P('lab_technician'))).toEqual(['laboratory'])
  })
  it('executive AI is admin/super only; doctor & cashier are excluded', () => {
    expect(aiDomainsFor(P('doctor'))).not.toContain('executive')
    expect(aiDomainsFor(P('cashier'))).toEqual([])
  })
  it('confidential AI follows the care-team gate', () => {
    expect(aiDomainsFor(P('super_admin'))).not.toContain('confidential')
    expect(aiDomainsFor(P('doctor'))).toContain('confidential')
  })
})

describe('sidebar module visibility per role', () => {
  it('cashier sees billing but never clinical/finance modules', () => {
    const mods = visibleModules(P('cashier'))
    expect(mods).toContain('billing')
    expect(mods).not.toContain('consultations')
    expect(mods).not.toContain('finance')
    expect(mods).not.toContain('workforce')
  })
  it('lab tech sees laboratory but not pharmacy/billing', () => {
    const mods = visibleModules(P('lab_technician'))
    expect(mods).toContain('laboratory')
    expect(mods).not.toContain('pharmacy')
    expect(mods).not.toContain('billing')
  })
  it('doctor sees clinical modules but not finance/hr/administration', () => {
    const mods = visibleModules(P('doctor'))
    expect(mods).toEqual(expect.arrayContaining(['consultations', 'radiology', 'laboratory']))
    expect(mods).not.toContain('finance')
    expect(mods).not.toContain('hr')
    expect(mods).not.toContain('administration')
  })
})

// ── Forward guard: no unsafe auth.users read in policies authored after 048 ──
describe('RLS invariant: migrations after the 048 fix never read auth.users in a policy', () => {
  const dir = join(__dirname, '..', '..', '..', 'supabase')
  const laterMigrations = readdirSync(dir)
    .filter(f => /^\d+.*\.sql$/.test(f))
    .filter(f => {
      const n = parseInt(f.slice(0, 3), 10)
      return Number.isFinite(n) && n >= 49   // everything after 048_fix_invitations_auth_users
    })

  it('scans the later migrations', () => {
    expect(laterMigrations.length).toBeGreaterThan(0)
  })

  it('contains no "FROM/JOIN auth.users" (only auth.uid()/auth.jwt() are allowed)', () => {
    const offenders: string[] = []
    for (const f of laterMigrations) {
      const sql = readFileSync(join(dir, f), 'utf8')
      const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
      if (/\b(FROM|JOIN)\s+auth\.users\b/i.test(code)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})
