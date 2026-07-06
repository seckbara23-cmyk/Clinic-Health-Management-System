import { readFileSync } from 'fs'
import { join } from 'path'
import {
  DEPARTMENT_REGISTRY, listDepartments, getDepartment, isDepartment, departmentLabelKey,
} from '../workforce/departments'
import {
  daysUntil, reminderTier, isExpired, credentialReminders, missingCredentialTypes, isHumanVerified,
} from '../workforce/credentials'
import {
  EMPLOYMENT_STATUSES, allowedTransitions, canTransition, transitionEvent,
  isTerminalStatus, isActiveWorkforce, INITIAL_EVENT,
} from '../workforce/lifecycle'
import { buildWorkforceDashboard } from '../workforce/dashboard'
import { filterWorkforce, distinctLanguages } from '../workforce/search'
import { buildProfessionalTimeline } from '../workforce/timeline'
import { workforceInsights, profileCompleteness } from '../workforce/insights'
import { WORKFORCE_DOCUMENTS, availableWorkforceDocuments, buildWorkforceInitialValues, getWorkforceDocument } from '../workforce/documents'
import type { Credential, EmployeeEvent, TrainingRecord, WorkforceMember } from '../workforce/types'

const NOW = new Date('2026-07-06T00:00:00Z')

// ── Test fixtures ───────────────────────────────────────────────────
function member(over: Partial<WorkforceMember> = {}): WorkforceMember {
  return {
    userId: 'u1', clinicId: 'clinic-A', fullName: 'Awa Diop', email: 'awa@x.sn',
    role: 'doctor', isActive: true, mustChangePassword: false, createdAt: '2026-01-01',
    primarySpecialty: null, languages: ['fr'],
    employee: {
      id: 'e1', userId: 'u1', clinicId: 'clinic-A', matricule: 'M1', nationalId: null,
      medicalLicenseNumber: 'L1', councilRegistration: null, department: 'general_practice',
      position: 'GP', employmentType: 'permanent', employmentStatus: 'active',
      hireDate: '2026-06-20', contractEndDate: null, primaryClinicId: 'clinic-A',
      biography: null, emergencyContact: {},
    },
    ...over,
  }
}
function cred(over: Partial<Credential> = {}): Credential {
  return {
    id: 'c1', employeeId: 'e1', clinicId: 'clinic-A', credentialType: 'license',
    number: '123', issuingAuthority: 'Ordre', issueDate: '2020-01-01', expiryDate: null,
    status: 'active', attachmentPath: null, verificationStatus: 'unverified', notes: null,
    ...over,
  }
}

// ── Department registry ─────────────────────────────────────────────
describe('department registry', () => {
  it('exposes the required departments with unique codes', () => {
    for (const code of ['administration', 'reception', 'emergency', 'general_practice',
      'pediatrics', 'obgyn', 'orl', 'laboratory', 'radiology', 'pharmacy', 'billing', 'it', 'management']) {
      expect(isDepartment(code)).toBe(true)
    }
    const codes = DEPARTMENT_REGISTRY.map(d => d.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(listDepartments().length).toBe(DEPARTMENT_REGISTRY.length)
  })
  it('resolves labels and unknown codes safely', () => {
    expect(getDepartment('pharmacy')?.labelKey).toBe('dept_pharmacy')
    expect(getDepartment('nope')).toBeNull()
    expect(departmentLabelKey(null)).toBe('dept_unassigned')
    expect(departmentLabelKey('xyz')).toBe('dept_unassigned')
  })
})

// ── Credential reminder engine (90/60/30/expired) ───────────────────
describe('credential reminders', () => {
  const d = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10)
  it('computes days until and tier boundaries', () => {
    expect(daysUntil(d(45), NOW)).toBe(45)
    expect(reminderTier(d(-1), NOW)).toBe('expired')
    expect(reminderTier(d(0), NOW)).toBe('due_30')
    expect(reminderTier(d(30), NOW)).toBe('due_30')
    expect(reminderTier(d(31), NOW)).toBe('due_60')
    expect(reminderTier(d(60), NOW)).toBe('due_60')
    expect(reminderTier(d(61), NOW)).toBe('due_90')
    expect(reminderTier(d(90), NOW)).toBe('due_90')
    expect(reminderTier(d(91), NOW)).toBeNull()
    expect(reminderTier(null, NOW)).toBeNull()
  })
  it('flags expired and sorts reminders most-urgent first', () => {
    expect(isExpired(d(-5), NOW)).toBe(true)
    const list = credentialReminders([cred({ id: 'a', expiryDate: d(80) }), cred({ id: 'b', expiryDate: d(-3) }), cred({ id: 'c', expiryDate: d(200) })], NOW)
    expect(list.map(r => r.credential.id)).toEqual(['b', 'a'])   // c (>90) excluded
    expect(list[0].tier).toBe('expired')
  })
  it('detects missing expected credential types', () => {
    expect(missingCredentialTypes([])).toEqual(['license'])
    expect(missingCredentialTypes([cred({ credentialType: 'license' })])).toEqual([])
  })
  it('verification is only ever human', () => {
    expect(isHumanVerified('verified')).toBe(true)
    expect(isHumanVerified('unverified')).toBe(false)
  })
})

// ── Employment lifecycle ────────────────────────────────────────────
describe('employment lifecycle', () => {
  it('defines the five steady states and the initial event', () => {
    expect(EMPLOYMENT_STATUSES).toEqual(['active', 'on_leave', 'suspended', 'retired', 'terminated'])
    expect(INITIAL_EVENT).toBe('hired')
  })
  it('allows valid transitions and blocks invalid / terminal ones', () => {
    expect(canTransition('active', 'on_leave')).toBe(true)
    expect(canTransition('active', 'active')).toBe(false)
    expect(canTransition('suspended', 'on_leave')).toBe(false)
    expect(canTransition('terminated', 'active')).toBe(false)
    expect(isTerminalStatus('retired')).toBe(true)
    expect(allowedTransitions('terminated')).toEqual([])
  })
  it('emits the correct lifecycle event (returned vs activated)', () => {
    expect(transitionEvent('active', 'on_leave')).toBe('leave_started')
    expect(transitionEvent('on_leave', 'active')).toBe('returned')
    expect(transitionEvent('suspended', 'active')).toBe('returned')
    expect(transitionEvent('active', 'terminated')).toBe('terminated')
    expect(transitionEvent('active', 'active')).toBeNull()
  })
  it('counts active + on_leave as active workforce', () => {
    expect(isActiveWorkforce('active')).toBe(true)
    expect(isActiveWorkforce('on_leave')).toBe(true)
    expect(isActiveWorkforce('terminated')).toBe(false)
  })
  it('employment status NEVER encodes a permission (organisational only)', () => {
    // Guard: the lifecycle CODE must not reference roles/permissions (comments,
    // which explain the separation, are stripped before scanning).
    const src = readFileSync(join(__dirname, '..', 'workforce', 'lifecycle.ts'), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).not.toMatch(/get_user_role|permission|\brole\b/i)
  })
})

// ── Dashboard aggregations ──────────────────────────────────────────
describe('workforce dashboard', () => {
  const d = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10)
  it('aggregates headcounts, expiries, distributions and renewals', () => {
    const members: WorkforceMember[] = [
      member({ userId: 'u1' }),
      member({ userId: 'u2', role: 'nurse', primarySpecialty: 'pediatrics',
        employee: { ...member().employee!, id: 'e2', userId: 'u2', department: 'pediatrics', employmentStatus: 'on_leave', hireDate: d(-5), contractEndDate: d(20) } }),
      member({ userId: 'u3', employee: { ...member().employee!, id: 'e3', userId: 'u3', employmentStatus: 'suspended' } }),
      member({ userId: 'u4', employee: null }),
    ]
    const credentials: Credential[] = [
      cred({ id: 'l1', employeeId: 'e1', credentialType: 'license', expiryDate: d(15) }),
      cred({ id: 'l2', employeeId: 'e3', credentialType: 'license', expiryDate: d(-2) }),
    ]
    const trainings: TrainingRecord[] = [
      { id: 't1', employeeId: 'e1', clinicId: 'clinic-A', title: 'BLS', provider: 'X', completedDate: d(-40), expiryDate: d(50), certificatePath: null },
    ]
    const db = buildWorkforceDashboard({ members, credentials, trainings, now: NOW })
    expect(db.totalMembers).toBe(4)
    expect(db.activeCount).toBe(1)      // only u1 is 'active' (u2 on_leave, u3 suspended, u4 no record)
    expect(db.onLeaveCount).toBe(1)
    expect(db.suspendedCount).toBe(1)
    expect(db.withoutEmploymentRecord).toBe(1)
    expect(db.expiringLicenses.length).toBe(2)
    expect(db.expiringLicenses[0].tier).toBe('expired')      // most urgent first
    expect(db.expiringContracts.length).toBe(1)              // u2's contract in 20 days
    expect(db.recentlyHired.map(m => m.userId)).toContain('u2') // hired 5 days ago
    expect(db.departmentDistribution.find(b => b.key === 'general_practice')?.count).toBeGreaterThan(0)
    expect(db.upcomingRenewals.length).toBeGreaterThanOrEqual(3) // 2 licenses + 1 contract + 1 training
    expect(db.upcomingRenewals[0].days).toBeLessThanOrEqual(db.upcomingRenewals[1].days) // sorted
  })
})

// ── Search & filtering ──────────────────────────────────────────────
describe('workforce search', () => {
  const members: WorkforceMember[] = [
    member({ userId: 'u1', fullName: 'Awa Diop', email: 'awa@x.sn', role: 'doctor', languages: ['fr', 'wo'],
      employee: { ...member().employee!, department: 'general_practice', employmentStatus: 'active' } }),
    member({ userId: 'u2', fullName: 'Bob Sarr', email: 'bob@x.sn', role: 'nurse', primarySpecialty: 'pediatrics', languages: ['en'],
      employee: { ...member().employee!, id: 'e2', department: 'pediatrics', employmentStatus: 'suspended' } }),
  ]
  it('filters by each dimension', () => {
    expect(filterWorkforce(members, { query: 'awa' }).map(m => m.userId)).toEqual(['u1'])
    expect(filterWorkforce(members, { department: 'pediatrics' }).map(m => m.userId)).toEqual(['u2'])
    expect(filterWorkforce(members, { role: 'nurse' }).map(m => m.userId)).toEqual(['u2'])
    expect(filterWorkforce(members, { employmentStatus: 'suspended' }).map(m => m.userId)).toEqual(['u2'])
    expect(filterWorkforce(members, { language: 'WO' }).map(m => m.userId)).toEqual(['u1'])
    expect(filterWorkforce(members, {}).length).toBe(2) // no filters → all
  })
  it('filters by credential expiry', () => {
    const creds = [cred({ employeeId: 'e1', expiryDate: new Date(NOW.getTime() + 10 * 86_400_000).toISOString().slice(0, 10) })]
    expect(filterWorkforce(members, { credentialExpiry: 'expiring' }, { credentials: creds, now: NOW }).map(m => m.userId)).toEqual(['u1'])
  })
  it('lists distinct languages', () => {
    expect(distinctLanguages(members)).toEqual(['en', 'fr', 'wo'])
  })
})

// ── Professional timeline (never patient) ───────────────────────────
describe('professional timeline', () => {
  it('merges events + credentials + trainings, newest first', () => {
    const events: EmployeeEvent[] = [
      { id: 'ev1', employeeId: 'e1', clinicId: 'clinic-A', eventType: 'hired', fromValue: null, toValue: null, note: null, effectiveDate: '2026-06-20', createdAt: '2026-06-20T00:00:00Z' },
      { id: 'ev2', employeeId: 'e1', clinicId: 'clinic-A', eventType: 'suspended', fromValue: 'active', toValue: 'suspended', note: 'x', effectiveDate: '2026-07-01', createdAt: '2026-07-01T00:00:00Z' },
    ]
    const timeline = buildProfessionalTimeline({
      events,
      credentials: [cred({ id: 'c9', issueDate: '2026-06-25' })],
      trainings: [{ id: 't9', employeeId: 'e1', clinicId: 'clinic-A', title: 'BLS', provider: null, completedDate: '2026-06-28', expiryDate: null, certificatePath: null }],
    })
    expect(timeline).toHaveLength(4)
    expect(timeline[0].type).toBe('suspended')     // 2026-07-01 newest
    expect(timeline[timeline.length - 1].type).toBe('hired') // 2026-06-20 oldest
    expect(timeline.some(e => e.type === 'credential_added')).toBe(true)
    expect(timeline.some(e => e.type === 'training_completed')).toBe(true)
  })
  it('reads only workforce entities — never patient sources', () => {
    // Scan CODE only; the header comment explains it never mixes the patient timeline.
    const src = readFileSync(join(__dirname, '..', 'workforce', 'timeline.ts'), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).not.toMatch(/patient|consultation|prescription|invoice|lab_/i)
  })
})

// ── Operational insights (never hiring/perf/discipline) ─────────────
describe('workforce insights', () => {
  it('computes profile completeness structurally', () => {
    const full = profileCompleteness(member())
    expect(full.score).toBeGreaterThan(0)
    const empty = profileCompleteness(member({ employee: null, languages: [] }))
    expect(empty.score).toBeLessThan(full.score)
    expect(empty.missing).toContain('employment_record')
  })
  it('emits only operational codes derived from the dashboard', () => {
    const members = [member({ employee: { ...member().employee!, contractEndDate: new Date(NOW.getTime() + 10 * 86_400_000).toISOString().slice(0, 10) } })]
    const credentials = [cred({ employeeId: 'e1', expiryDate: new Date(NOW.getTime() - 1 * 86_400_000).toISOString().slice(0, 10) })]
    const db = buildWorkforceDashboard({ members, credentials, now: NOW })
    const ins = workforceInsights({ dashboard: db, members })
    const codes = new Set(ins.map(i => i.code))
    expect(codes.has('license_expired')).toBe(true)
    expect(codes.has('contract_expiring')).toBe(true)
    // Only operational codes exist — no evaluative ones.
    for (const i of ins) expect(['license_expired', 'license_expiring', 'contract_expiring', 'credential_missing', 'profile_incomplete']).toContain(i.code)
  })
  it('the insights module contains no hiring / performance / disciplinary logic', () => {
    const src = readFileSync(join(__dirname, '..', 'workforce', 'insights.ts'), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).not.toMatch(/\b(hire|hiring|fire|terminate recommend|performance score|disciplin|promote|salary|recommend)\b/i)
  })
  it('no workforce i18n string suggests hiring/performance/disciplinary action', () => {
    const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))
    const BANNED = /\b(should hire|recommend hiring|fire them|disciplinary|reprimand|underperform|poor performance)\b/i
    for (const [k, v] of Object.entries(en.workforce as Record<string, string>)) {
      expect(`${k}:${BANNED.test(v)}`).toBe(`${k}:false`)
    }
  })
})

// ── Workforce documents (registry only; no patient) ─────────────────
describe('workforce documents', () => {
  it('registers the required HR documents, admin-scoped', () => {
    for (const id of ['employment_contract', 'appointment_letter', 'license_copy', 'board_certificate',
      'diploma', 'training_certificate', 'performance_review']) {
      expect(getWorkforceDocument(id)).toBeTruthy()
    }
    expect(availableWorkforceDocuments('admin').length).toBe(WORKFORCE_DOCUMENTS.length)
    expect(availableWorkforceDocuments('doctor')).toEqual([])   // HR docs are admin-tier only
    expect(availableWorkforceDocuments(null)).toEqual([])
  })
  it('never renders patient identity and prefills employee/clinic only', () => {
    for (const d of WORKFORCE_DOCUMENTS) expect(d.print.showPatientIdentity).toBe(false)
    const def = getWorkforceDocument('employment_contract')!
    const v = buildWorkforceInitialValues(def, {
      employee: { full_name: 'Awa Diop', position: 'GP', matricule: 'M1' },
      clinic: { name: 'Clinique' }, now: NOW,
    })
    expect(v.employee_name).toBe('Awa Diop')
    expect(v.position).toBe('GP')
    expect(v.terms).toBe('')   // no generated content
  })
  it('every document label key exists in fr and en', () => {
    const fr = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'fr.json'), 'utf8'))
    const en = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'messages', 'en.json'), 'utf8'))
    for (const d of WORKFORCE_DOCUMENTS) {
      expect(fr.workforce[d.titleKey]).toBeTruthy()
      expect(en.workforce[d.titleKey]).toBeTruthy()
      for (const f of d.fields) expect(en.workforce[f.labelKey]).toBeTruthy()
    }
  })
})

// ── (B) Migration 049 SQL guard — additive, RLS, no P0 junction ─────
const SQL = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '049_workforce.sql'), 'utf8')
const CODE = SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

describe('migration 049 — additive, isolated, RLS-correct', () => {
  it('creates only the four new workforce tables (no ALTER/DROP of existing objects)', () => {
    for (const tbl of ['employee_profiles', 'employee_credentials', 'employee_events', 'training_records']) {
      expect(CODE).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${tbl}`))
    }
    // No mutation of existing tables — additive only.
    expect(CODE).not.toMatch(/ALTER TABLE public\.(user_profiles|clinics|professional_profiles|patients)/)
    expect(CODE).not.toMatch(/DROP TABLE/)
  })
  it('every table has a surrogate PK and NO composite-FK primary key (the P0 rule)', () => {
    expect((CODE.match(/id\s+UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/g) ?? []).length).toBe(4)
    expect(CODE).not.toMatch(/PRIMARY KEY \((user_id|clinic_id|employee_id)/)
    // the (user_id, clinic_id) uniqueness is a CONSTRAINT, never the PK.
    expect(CODE).toMatch(/CONSTRAINT employee_profiles_user_clinic_key UNIQUE \(user_id, clinic_id\)/)
  })
  it('enables RLS and scopes writes to clinic admins — never widened to everyone', () => {
    expect((CODE.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length).toBe(4)
    expect(CODE).toMatch(/public\.get_clinic_id\(\)/)
    expect(CODE).toMatch(/public\.get_user_role\(\) = 'admin'/)
    expect(CODE).toMatch(/public\.is_super_admin\(\)/)
    expect(CODE).not.toMatch(/USING \(\s*true\s*\)/)
    expect(CODE).not.toMatch(/WITH CHECK \(\s*true\s*\)/)
  })
  it('never reads auth.users directly in a policy (the migration-048 rule)', () => {
    expect(CODE).not.toMatch(/FROM auth\.users/i)
  })
  it('employment history is append-only (events cannot be updated or deleted)', () => {
    expect(CODE).toMatch(/CREATE POLICY "employee_events_update" ON public\.employee_events FOR UPDATE USING \(false\)/)
    expect(CODE).toMatch(/CREATE POLICY "employee_events_delete" ON public\.employee_events FOR DELETE USING \(false\)/)
  })
  it('permissions are NEVER department- or status-based (RLS reads role, not this tier)', () => {
    // No policy predicate keys off department or employment_status.
    const policyText = CODE.split('CREATE POLICY').slice(1).join('CREATE POLICY')
    expect(policyText).not.toMatch(/department\s*=/)
    expect(policyText).not.toMatch(/employment_status\s*=/)
  })
  it('credential verification is never auto-set (defaults unverified; no trigger to verified)', () => {
    expect(CODE).toMatch(/verification_status\s+TEXT NOT NULL DEFAULT 'unverified'/)
    expect(CODE).not.toMatch(/verification_status\s*(=|:=)\s*'verified'/)
  })
})

// ── (B) RLS predicate model — tenant isolation & role scoping ───────
interface Row { clinicId: string }
interface Caller { isSuperAdmin: boolean; role: string | null; clinicId: string | null }

/** employee_credentials/_events/training_records SELECT/write (admin-scoped). */
function adminScoped(row: Row, c: Caller): boolean {
  return c.isSuperAdmin || (row.clinicId === c.clinicId && c.role === 'admin')
}

describe('workforce RLS model — tenant isolation', () => {
  const rowA: Row = { clinicId: 'clinic-A' }
  const adminA: Caller = { isSuperAdmin: false, role: 'admin', clinicId: 'clinic-A' }
  const adminB: Caller = { isSuperAdmin: false, role: 'admin', clinicId: 'clinic-B' }
  const doctorA: Caller = { isSuperAdmin: false, role: 'doctor', clinicId: 'clinic-A' }
  const superAdmin: Caller = { isSuperAdmin: true, role: 'super_admin', clinicId: null }

  it('an admin manages only their own clinic', () => {
    expect(adminScoped(rowA, adminA)).toBe(true)
    expect(adminScoped(rowA, adminB)).toBe(false)   // cross-tenant denied
  })
  it('a non-admin clinic member cannot manage workforce data', () => {
    expect(adminScoped(rowA, doctorA)).toBe(false)
  })
  it('a super_admin has platform oversight', () => {
    expect(adminScoped(rowA, superAdmin)).toBe(true)
  })
})
