import { readFileSync } from 'fs'
import { join } from 'path'

// ── Enterprise Authorization framework tests (Phase 40) ───────────
// Covers the pure engine: registries, default matrix, can(), field-level
// security, AI permission inheritance, department/finance/HR/psychiatry/radiology
// ISOLATION, break-glass (design-only), custom grants, audit builders,
// backwards-compatibility with the previous Sidebar role gates, the additive
// migration 068, and the no-service-role / no-auth.users guarantees.

import {
  ACTIONS, isAction,
  MODULES, MODULE_IDS, SENSITIVE_FIELDS, allPermissionIds, isValidPermission, getModule,
  DEPARTMENTS, departmentsForRole,
  DEFAULT_MATRIX, ROLES, defaultGrantsFor,
  can, canAny, canAll, canField, maskField, canModule,
  visibleModules, permissionsFor, aiDomainsFor, canAiDomain, canRadiologySign,
  isCareTeam, isBreakGlassActive, AI_DOMAINS,
  type Principal,
} from '@/lib/authz'
import {
  buildModuleMatrix, buildFieldMatrix, buildAiMatrix, permissionCounts,
} from '@/lib/authz/view'
import {
  auditTypeFor, shouldAudit, buildAccessAudit, buildBreakGlassAudit,
} from '@/lib/authz/audit'
import type { Role } from '@/types/database'

const P = (role: Role | null, extra: Partial<Principal> = {}): Principal => ({ role, ...extra })

// ── Registries ────────────────────────────────────────────────────
describe('registries', () => {
  it('exposes the required action vocabulary', () => {
    for (const a of ['view', 'create', 'edit', 'delete', 'approve', 'sign', 'dispense',
      'export', 'refund', 'assign', 'schedule', 'cancel', 'verify', 'print', 'download', 'upload']) {
      expect(isAction(a)).toBe(true)
    }
    expect(isAction('nope')).toBe(false)
    expect(ACTIONS.length).toBeGreaterThanOrEqual(16)
  })

  it('registers every required platform module', () => {
    for (const id of ['patients', 'consultations', 'appointments', 'radiology', 'laboratory',
      'pharmacy', 'billing', 'finance', 'inventory', 'workforce', 'hr', 'reports', 'documents',
      'ai', 'settings', 'administration']) {
      expect(MODULE_IDS).toContain(id)
    }
  })

  it('allPermissionIds are all valid, and unknown perms are rejected', () => {
    for (const p of allPermissionIds()) expect(isValidPermission(p)).toBe(true)
    expect(isValidPermission('patients.view')).toBe(true)
    expect(isValidPermission('patients.*')).toBe(true)
    expect(isValidPermission('*')).toBe(true)
    expect(isValidPermission('field.salary')).toBe(true)
    expect(isValidPermission('field.unknown')).toBe(false)
    expect(isValidPermission('nope.view')).toBe(false)
    expect(isValidPermission('patients.frobnicate')).toBe(false)
    expect(isValidPermission('')).toBe(false)
    expect(isValidPermission(null)).toBe(false)
  })

  it('sensitive fields include the guarded set', () => {
    for (const f of ['salary', 'national_id', 'insurance_number', 'psychiatry_notes', 'financial', 'medical_history']) {
      expect(SENSITIVE_FIELDS).toContain(f)
    }
  })

  it('departments are organizational and map only to real roles', () => {
    expect(DEPARTMENTS.length).toBeGreaterThanOrEqual(13)
    for (const d of DEPARTMENTS) {
      for (const r of d.roles) expect(ROLES).toContain(r)
    }
    expect(departmentsForRole('doctor').length).toBeGreaterThan(0)
    // radiology department carries the specialty refinement
    expect(DEPARTMENTS.find(d => d.id === 'radiology')?.specialty).toBe('radiology')
  })
})

// ── Default matrix ────────────────────────────────────────────────
describe('default matrix', () => {
  it('covers all 8 roles', () => {
    expect(ROLES.sort()).toEqual(
      ['admin', 'cashier', 'doctor', 'lab_technician', 'nurse', 'pharmacist', 'receptionist', 'super_admin'].sort(),
    )
  })

  it('every granted permission is a valid registry permission', () => {
    for (const role of ROLES) {
      for (const perm of DEFAULT_MATRIX[role]) {
        expect(isValidPermission(perm)).toBe(true)
      }
    }
  })

  it('defaultGrantsFor is empty for unknown / null roles', () => {
    expect(defaultGrantsFor(null)).toEqual([])
    expect(defaultGrantsFor('ghost')).toEqual([])
  })
})

// ── Core can() ────────────────────────────────────────────────────
describe('can()', () => {
  it('grants concrete permissions from the matrix', () => {
    expect(can(P('doctor'), 'consultations.create')).toBe(true)
    expect(can(P('pharmacist'), 'pharmacy.dispense')).toBe(true)
    expect(can(P('cashier'), 'billing.payment')).toBe(true)
  })

  it('expands <module>.* wildcards', () => {
    expect(can(P('admin'), 'patients.delete')).toBe(true)   // admin has patients.*
    expect(can(P('super_admin'), 'pharmacy.scan')).toBe(true) // super has pharmacy.*
  })

  it('denies ungranted permissions', () => {
    expect(can(P('cashier'), 'consultations.view')).toBe(false)
    expect(can(P('receptionist'), 'prescriptions.create')).toBe(false)
    expect(can(P('lab_technician'), 'pharmacy.dispense')).toBe(false)
    expect(can(null, 'dashboard.view')).toBe(false)
    expect(can(P('doctor'), '')).toBe(false)
  })

  it('canAny / canAll behave', () => {
    expect(canAny(P('nurse'), ['finance.view', 'prescriptions.view'])).toBe(true)
    expect(canAll(P('nurse'), ['finance.view', 'prescriptions.view'])).toBe(false)
    expect(canAll(P('doctor'), ['consultations.view', 'consultations.create'])).toBe(true)
  })

  it('canModule mirrors <module>.view', () => {
    expect(canModule(P('doctor'), 'consultations')).toBe(true)
    expect(canModule(P('cashier'), 'consultations')).toBe(false)
  })
})

// ── Backwards compatibility with the previous Sidebar role gates ──
describe('backwards-compat: nav visibility reproduces the legacy role map exactly', () => {
  // The exact role gates the Sidebar used before Phase 40, paired with the new perm.
  const LEGACY: Array<{ perm: string; roles?: Role[] }> = [
    { perm: 'dashboard.view' },
    { perm: 'patients.view', roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist', 'cashier'] },
    { perm: 'queue.view', roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'] },
    { perm: 'appointments.view', roles: ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'] },
    { perm: 'consultations.view', roles: ['super_admin', 'admin', 'doctor', 'nurse'] },
    { perm: 'prescriptions.view', roles: ['super_admin', 'admin', 'doctor', 'nurse'] },
    { perm: 'laboratory.view', roles: ['super_admin', 'admin', 'doctor', 'nurse', 'lab_technician'] },
    { perm: 'laboratory.catalog', roles: ['super_admin', 'admin'] },
    { perm: 'radiology.view', roles: ['super_admin', 'admin', 'doctor'] },
    { perm: 'pharmacy.view', roles: ['super_admin', 'admin', 'pharmacist'] },
    { perm: 'pharmacy.inventory', roles: ['super_admin', 'admin', 'pharmacist'] },
    { perm: 'pharmacy.reports', roles: ['super_admin', 'admin', 'pharmacist'] },
    { perm: 'pharmacy.catalog', roles: ['super_admin', 'admin', 'pharmacist', 'doctor', 'nurse'] },
    { perm: 'pharmacy.scan', roles: ['super_admin', 'admin', 'pharmacist'] },
    { perm: 'billing.view', roles: ['super_admin', 'admin', 'receptionist', 'cashier', 'doctor'] },
    { perm: 'reports.view', roles: ['super_admin', 'admin'] },
    { perm: 'settings.view' },
  ]

  it('can(perm) === legacy role gate for every (role, nav-item)', () => {
    for (const role of ROLES) {
      for (const item of LEGACY) {
        const legacy = item.roles ? item.roles.includes(role) : true
        expect({ role, perm: item.perm, allowed: can(P(role), item.perm) })
          .toEqual({ role, perm: item.perm, allowed: legacy })
      }
    }
  })
})

// ── Isolation guarantees ──────────────────────────────────────────
describe('finance isolation', () => {
  it('only admin & super_admin can view finance', () => {
    expect(can(P('super_admin'), 'finance.view')).toBe(true)
    expect(can(P('admin'), 'finance.view')).toBe(true)
    for (const r of ['doctor', 'nurse', 'receptionist', 'cashier', 'lab_technician', 'pharmacist'] as Role[]) {
      expect(can(P(r), 'finance.view')).toBe(false)
    }
  })
  it('cashier handles payments but never finance approval', () => {
    expect(can(P('cashier'), 'billing.payment')).toBe(true)
    expect(can(P('cashier'), 'finance.approve')).toBe(false)
  })
})

describe('HR / workforce isolation', () => {
  it('only admin & super_admin reach HR and workforce', () => {
    for (const perm of ['hr.view', 'workforce.view', 'hr.manage', 'workforce.manage']) {
      expect(can(P('super_admin'), perm)).toBe(true)
      expect(can(P('admin'), perm)).toBe(true)
      for (const r of ['doctor', 'nurse', 'receptionist', 'cashier', 'lab_technician', 'pharmacist'] as Role[]) {
        expect(can(P(r), perm)).toBe(false)
      }
    }
  })
  it('salary field is admin/super_admin only', () => {
    expect(canField(P('super_admin'), 'salary')).toBe(true)
    expect(canField(P('admin'), 'salary')).toBe(true)
    for (const r of ['doctor', 'nurse', 'receptionist', 'cashier', 'lab_technician', 'pharmacist'] as Role[]) {
      expect(canField(P(r), 'salary')).toBe(false)
    }
  })
})

describe('psychiatry-notes confidentiality isolation', () => {
  it('is readable by the care team only (doctor, nurse, admin) — NOT super_admin', () => {
    for (const r of ['doctor', 'nurse', 'admin'] as Role[]) {
      expect(canField(P(r), 'psychiatry_notes')).toBe(true)
      expect(isCareTeam(r)).toBe(true)
    }
    for (const r of ['super_admin', 'receptionist', 'cashier', 'lab_technician', 'pharmacist'] as Role[]) {
      expect(canField(P(r), 'psychiatry_notes')).toBe(false)
    }
    expect(isCareTeam('super_admin')).toBe(false)
  })

  it('cannot be granted to a non-care-team role even via a custom grant', () => {
    const superWithGrant = P('super_admin', { customGrants: ['field.psychiatry_notes'] })
    expect(can(superWithGrant, 'field.psychiatry_notes')).toBe(false) // care-team gate wins
  })
})

describe('radiology signing authority isolation', () => {
  it('radiologist (doctor + radiology), admin and super_admin may sign', () => {
    expect(canRadiologySign(P('doctor', { primarySpecialtyId: 'radiology' }))).toBe(true)
    expect(can(P('doctor', { primarySpecialtyId: 'radiology' }), 'radiology.sign')).toBe(true)
    expect(can(P('admin'), 'radiology.sign')).toBe(true)
    expect(can(P('super_admin'), 'radiology.sign')).toBe(true)
  })
  it('a non-radiology doctor, nurse and lab tech may NOT sign', () => {
    expect(can(P('doctor', { primarySpecialtyId: 'cardiology' }), 'radiology.sign')).toBe(false)
    expect(can(P('doctor'), 'radiology.sign')).toBe(false)
    expect(can(P('nurse'), 'radiology.sign')).toBe(false)
    expect(can(P('lab_technician'), 'radiology.sign')).toBe(false)
  })
  it('a custom grant cannot bypass the specialty gate for signing', () => {
    const forced = P('doctor', { primarySpecialtyId: 'cardiology', customGrants: ['radiology.sign', 'radiology.*'] })
    expect(can(forced, 'radiology.sign')).toBe(false)
  })
})

// ── Field-level security ──────────────────────────────────────────
describe('field-level security', () => {
  it('non-sensitive fields are always visible', () => {
    expect(canField(P('cashier'), 'first_name')).toBe(true)
    expect(canField(null, 'anything')).toBe(true)
  })
  it('maskField returns the value when permitted, a mask otherwise', () => {
    expect(maskField(P('admin'), 'salary', 500000)).toBe(500000)
    expect(maskField(P('doctor'), 'salary', 500000)).toBe('••••••')
    expect(maskField(P('doctor'), 'salary', 500000, 'HIDDEN')).toBe('HIDDEN')
  })
})

// ── AI permission inheritance ─────────────────────────────────────
describe('AI permission inheritance', () => {
  it('AI domains never exceed the user’s own module access', () => {
    for (const role of ROLES) {
      for (const domain of Object.keys(AI_DOMAINS)) {
        if (canAiDomain(P(role), domain)) {
          expect(can(P(role), AI_DOMAINS[domain])).toBe(true) // gated by a real permission
        }
      }
    }
  })
  it('doctor AI sees clinical/lab/radiology/confidential but not executive metrics', () => {
    const d = aiDomainsFor(P('doctor'))
    expect(d).toEqual(expect.arrayContaining(['clinical', 'laboratory', 'radiology', 'confidential']))
    expect(d).not.toContain('executive')
  })
  it('lab tech AI is limited to laboratory', () => {
    expect(aiDomainsFor(P('lab_technician'))).toEqual(['laboratory'])
  })
  it('executive metrics AI is admin/super_admin only', () => {
    expect(canAiDomain(P('super_admin'), 'executive')).toBe(true)
    expect(canAiDomain(P('admin'), 'executive')).toBe(true)
    expect(canAiDomain(P('doctor'), 'executive')).toBe(false)
    expect(canAiDomain(P('cashier'), 'executive')).toBe(false)
  })
  it('confidential (psychiatry) AI follows the care-team gate — not super_admin', () => {
    expect(canAiDomain(P('doctor'), 'confidential')).toBe(true)
    expect(canAiDomain(P('super_admin'), 'confidential')).toBe(false)
  })
  it('a role with no clinical access gets no AI data domains', () => {
    expect(aiDomainsFor(P('cashier'))).toEqual([])
    expect(aiDomainsFor(P('receptionist'))).toEqual([])
  })
})

// ── Break-glass (design-only) ─────────────────────────────────────
describe('break-glass is design-only and inert by default', () => {
  it('a principal without break-glass is unaffected', () => {
    expect(can(P('cashier'), 'consultations.view')).toBe(false)
  })
  it('isBreakGlassActive requires active + reason + non-expiry', () => {
    expect(isBreakGlassActive(null)).toBe(false)
    expect(isBreakGlassActive({ active: false, reason: 'x' })).toBe(false)
    expect(isBreakGlassActive({ active: true })).toBe(false)                 // no reason
    expect(isBreakGlassActive({ active: true, reason: '  ' })).toBe(false)   // blank reason
    expect(isBreakGlassActive({ active: true, reason: 'emergency' })).toBe(true)
    expect(isBreakGlassActive({ active: true, reason: 'e', expiresAt: '2026-01-01T00:00:00Z', now: '2026-02-01T00:00:00Z' })).toBe(false) // expired
    expect(isBreakGlassActive({ active: true, reason: 'e', expiresAt: '2026-12-01T00:00:00Z', now: '2026-06-01T00:00:00Z' })).toBe(true)  // valid window
  })
  it('an active, reasoned, unexpired break-glass may add grants — but never bypasses the radiology specialty gate', () => {
    // reports.view is NOT in the nurse default matrix, so any true result is the grant.
    expect(can(P('nurse'), 'reports.view')).toBe(false)
    const bg = P('nurse', { breakGlass: { active: true, reason: 'code blue', grants: ['reports.view'] } })
    expect(can(bg, 'reports.view')).toBe(true)
    const bgSign = P('nurse', { breakGlass: { active: true, reason: 'x', grants: ['radiology.sign'] } })
    expect(can(bgSign, 'radiology.sign')).toBe(false)
  })
  it('a reasonless break-glass grants nothing', () => {
    const bg = P('nurse', { breakGlass: { active: true, grants: ['reports.view'] } })
    expect(can(bg, 'reports.view')).toBe(false)
  })
})

// ── Custom grants ─────────────────────────────────────────────────
describe('custom grants', () => {
  it('extend access with valid permissions', () => {
    expect(can(P('nurse', { customGrants: ['reports.view'] }), 'reports.view')).toBe(true)
  })
  it('ignore invalid permission ids', () => {
    expect(can(P('nurse', { customGrants: ['nope.view', 'reports.frobnicate'] }), 'nope.view')).toBe(false)
  })
})

// ── Audit builders ────────────────────────────────────────────────
describe('audit builders', () => {
  it('classifies audit-worthy events', () => {
    expect(auditTypeFor('patients.view', 'deny')).toBe('access_denied')
    expect(auditTypeFor('field.salary', 'allow')).toBe('sensitive_field_access')
    expect(auditTypeFor('reports.export', 'allow')).toBe('export')
    expect(auditTypeFor('documents.print', 'allow')).toBe('print')
    expect(auditTypeFor('radiology.sign', 'allow')).toBe('signature')
    expect(auditTypeFor('billing.refund', 'allow')).toBe('financial_approval')
    expect(auditTypeFor('finance.approve', 'allow')).toBe('financial_approval')
    expect(auditTypeFor('patients.view', 'allow')).toBeNull()   // routine allow: not audited
  })
  it('shouldAudit follows the classification', () => {
    expect(shouldAudit('patients.view', 'deny')).toBe(true)
    expect(shouldAudit('patients.view', 'allow')).toBe(false)
    expect(shouldAudit('field.national_id', 'allow')).toBe(true)
  })
  it('buildAccessAudit produces a shaped entry or null', () => {
    expect(buildAccessAudit('patients.view', 'allow')).toBeNull()
    const denied = buildAccessAudit('finance.view', 'deny', { entityType: 'invoice', entityId: 'abc' })
    expect(denied).toMatchObject({ type: 'access_denied', decision: 'deny', sensitive: true, entityType: 'invoice' })
    const exp = buildAccessAudit('reports.export', 'allow')
    expect(exp).toMatchObject({ type: 'export', decision: 'allow' })
  })
  it('buildBreakGlassAudit requires a reason', () => {
    expect(buildBreakGlassAudit('')).toBeNull()
    expect(buildBreakGlassAudit(null)).toBeNull()
    const e = buildBreakGlassAudit('cardiac arrest', { grants: ['consultations.view'], expiresAt: '2026-12-01T00:00:00Z' })
    expect(e).toMatchObject({ type: 'break_glass', reason: 'cardiac arrest', sensitive: true })
    expect(e?.metadata.grants).toEqual(['consultations.view'])
  })
})

// ── View builders ─────────────────────────────────────────────────
describe('view builders', () => {
  it('module matrix has one row per module with a cell per role', () => {
    const rows = buildModuleMatrix()
    expect(rows.length).toBe(MODULES.length)
    for (const row of rows) {
      for (const r of ROLES) expect(typeof row.cells[r]).toBe('boolean')
    }
    const consult = rows.find(r => r.key === 'consultations')!
    expect(consult.cells['doctor']).toBe(true)
    expect(consult.cells['cashier']).toBe(false)
  })
  it('field matrix reflects field-level security', () => {
    const salary = buildFieldMatrix().find(r => r.key === 'salary')!
    expect(salary.cells['admin']).toBe(true)
    expect(salary.cells['doctor']).toBe(false)
  })
  it('AI matrix mirrors domain inheritance', () => {
    const exec = buildAiMatrix().find(r => r.key === 'executive')!
    expect(exec.cells['super_admin']).toBe(true)
    expect(exec.cells['doctor']).toBe(false)
  })
  it('permission counts are non-trivial for privileged roles', () => {
    const counts = permissionCounts()
    expect(counts['super_admin']).toBeGreaterThan(counts['cashier'])
    expect(counts['admin']).toBeGreaterThan(0)
  })
})

describe('visibleModules / permissionsFor', () => {
  it('visibleModules matches per-module view permission', () => {
    const mods = visibleModules(P('pharmacist'))
    expect(mods).toContain('pharmacy')
    expect(mods).not.toContain('consultations')
    expect(mods).not.toContain('finance')
  })
  it('permissionsFor returns only concrete, valid, sorted perms', () => {
    const perms = permissionsFor(P('doctor'))
    expect(perms.every(p => isValidPermission(p))).toBe(true)
    expect([...perms]).toEqual([...perms].sort())
    expect(perms).toContain('consultations.sign')
  })
})

// ── Migration 068 — additive & safe ───────────────────────────────
describe('migration 068_authz.sql', () => {
  const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '068_authz.sql'), 'utf8')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

  it('adds the three authz tables', () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.authz_custom_grants/)
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.authz_audit/)
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS public\.authz_break_glass/)
  })
  it('uses surrogate UUID PKs, never a composite-FK PK', () => {
    expect(code).toMatch(/id\s+UUID PRIMARY KEY/)
    expect(code).not.toMatch(/PRIMARY KEY \(clinic_id|PRIMARY KEY \(user_id/)
  })
  it('is tenant-scoped via get_clinic_id and never reads auth.users', () => {
    expect(code).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(code).not.toMatch(/FROM auth\.users/i)
    expect(code).not.toMatch(/REFERENCES auth\.users/i)   // FKs point at user_profiles
  })
  it('keeps authz_audit append-only (no update/delete policy)', () => {
    expect(code).not.toMatch(/ON public\.authz_audit FOR UPDATE/i)
    expect(code).not.toMatch(/ON public\.authz_audit FOR DELETE/i)
  })
  it('enforces break-glass reason + expiry at the database', () => {
    expect(code).toMatch(/reason\s+TEXT NOT NULL CHECK \(btrim\(reason\) <> ''\)/)
    expect(code).toMatch(/expires_at\s+TIMESTAMPTZ NOT NULL/)
  })
  it('does not ALTER or DROP any pre-existing table (purely additive)', () => {
    expect(code).not.toMatch(/ALTER TABLE public\.(patients|consultations|user_profiles|clinics|invoices)/i)
    expect(code).not.toMatch(/DROP TABLE/i)
  })
})

// ── Security-source guard for the new authz surface ───────────────
describe('authz source never smuggles the service role or auth.users', () => {
  const files = [
    join(__dirname, '..', 'authz', 'engine.ts'),
    join(__dirname, '..', 'authz', 'matrix.ts'),
    join(__dirname, '..', 'authz', 'modules.ts'),
    join(__dirname, '..', 'authz', 'view.ts'),
    join(__dirname, '..', 'authz', 'audit.ts'),
    join(__dirname, '..', '..', 'hooks', 'usePermissions.ts'),
    join(__dirname, '..', '..', 'components', 'authz', 'Can.tsx'),
  ]
  it('contains no service-role client / service key / auth.users reference', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
      expect(src).not.toMatch(/createServiceClient|SUPABASE_SERVICE_ROLE|service_role/)
      expect(src).not.toMatch(/auth\.users/)
    }
  })
})

// ── i18n ──────────────────────────────────────────────────────────
describe('i18n authz namespace', () => {
  const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))
  const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))

  it('exposes the authz namespace with fr/en key parity', () => {
    expect(en.authz).toBeTruthy()
    expect(fr.authz).toBeTruthy()
    expect(Object.keys(fr.authz).sort()).toEqual(Object.keys(en.authz).sort())
  })
  it('has a label for every module, field and AI domain used by the page', () => {
    for (const m of MODULE_IDS) expect(en.authz[`mod_${m}`]).toBeTruthy()
    for (const f of SENSITIVE_FIELDS) expect(en.authz[`field_${f}`]).toBeTruthy()
    for (const d of Object.keys(AI_DOMAINS)) expect(en.authz[`ai_${d}`]).toBeTruthy()
    for (const r of ROLES) expect(en.authz[`role_${r}`]).toBeTruthy()
  })
  it('registers the nav entry for the authorization page', () => {
    expect(en.nav.adminAuthorization).toBeTruthy()
    expect(fr.nav.adminAuthorization).toBeTruthy()
  })
})

// keep getModule referenced (public API smoke)
describe('getModule', () => {
  it('resolves a known module and rejects unknown', () => {
    expect(getModule('patients')?.id).toBe('patients')
    expect(getModule('nope')).toBeNull()
  })
})
