import { readFileSync } from 'fs'
import { join } from 'path'

// ── clinic_invitations RLS regression (migration 048) ──────────────
//
// Migration 048 fixed the production bug "permission denied for table users":
// the invitations_select / invitations_update policies read auth.users directly
// via (SELECT email FROM auth.users WHERE id = auth.uid()), an uncorrelated
// subquery Postgres evaluates as an InitPlan regardless of OR short-circuit,
// which the `authenticated` role cannot execute. The fix sources the caller's
// email from the verified JWT claim (auth.jwt() ->> 'email') instead.
//
// jest runs in node (no live DB), so we prove the fix two ways:
//  (A) a SQL guard on 048 — the actual policy no longer touches auth.users and
//      preserves every access branch (no RLS weakening);
//  (B) a pure predicate MODEL mirroring the 048 policies, exercised through the
//      exact scenarios the fix must satisfy.

const SQL = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '048_fix_invitations_auth_users.sql'), 'utf8')
// Executable SQL only (strip comment lines that describe the old auth.users bug).
const CODE = SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

// ── (A) SQL guard — the real migration ─────────────────────────────
describe('migration 048 — the policies no longer read auth.users', () => {
  it('replaces the auth.users subquery with the JWT email claim', () => {
    expect(CODE).not.toMatch(/FROM auth\.users/i)       // the footgun is gone
    // Present in SELECT USING, UPDATE USING, UPDATE WITH CHECK (3 occurrences).
    expect((CODE.match(/auth\.jwt\(\)\s*->>\s*'email'/g) ?? []).length).toBe(3)
  })

  it('recreates ONLY invitations_select + invitations_update (insert/delete untouched)', () => {
    expect(CODE).toMatch(/CREATE POLICY "invitations_select" ON public\.clinic_invitations FOR SELECT/)
    expect(CODE).toMatch(/CREATE POLICY "invitations_update" ON public\.clinic_invitations FOR UPDATE/)
    expect(CODE).not.toMatch(/invitations_insert|invitations_delete/)
  })

  it('preserves every access branch — no RLS weakening', () => {
    expect(CODE).toMatch(/public\.is_super_admin\(\)/)
    expect(CODE).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    expect(CODE).toMatch(/public\.get_user_role\(\) = 'admin'/)
    // Never opened up to everyone.
    expect(CODE).not.toMatch(/USING \(\s*true\s*\)/i)
    expect(CODE).not.toMatch(/WITH CHECK \(\s*true\s*\)/i)
  })

  it('documents the pre-fix footgun really existed (002 read auth.users)', () => {
    const old = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '002_rls.sql'), 'utf8')
    expect(old).toMatch(/invitations_select/)
    expect(old).toMatch(/SELECT email FROM auth\.users/)
  })
})

// ── (B) Predicate model — mirrors migration 048 exactly ────────────
interface InvitationRow { clinic_id: string; email: string }
interface Caller { isSuperAdmin: boolean; role: string | null; clinicId: string | null; email: string | null }

/** invitations_select USING / invitations_update USING (048). */
function canReadOrAccept(row: InvitationRow, c: Caller): boolean {
  return c.isSuperAdmin
    || (row.clinic_id === c.clinicId && c.role === 'admin')
    || (!!c.email && row.email === c.email)
}
/** invitations_insert WITH CHECK (002 — unchanged by 048). */
function canInsert(row: InvitationRow, c: Caller): boolean {
  return c.isSuperAdmin || (row.clinic_id === c.clinicId && c.role === 'admin')
}
/** invitations_update WITH CHECK (048). */
function canAcceptWithCheck(row: InvitationRow, c: Caller): boolean {
  return c.isSuperAdmin || row.clinic_id === c.clinicId || (!!c.email && row.email === c.email)
}

const inviteA: InvitationRow = { clinic_id: 'clinic-A', email: 'newdoc@x.sn' }
const otherInviteA: InvitationRow = { clinic_id: 'clinic-A', email: 'someone-else@x.sn' }

const adminA: Caller = { isSuperAdmin: false, role: 'admin', clinicId: 'clinic-A', email: 'admin@a.sn' }
const adminB: Caller = { isSuperAdmin: false, role: 'admin', clinicId: 'clinic-B', email: 'admin@b.sn' }
const invitedUser: Caller = { isSuperAdmin: false, role: null, clinicId: null, email: 'newdoc@x.sn' } // matches invite, not yet a member
const unrelated: Caller = { isSuperAdmin: false, role: 'doctor', clinicId: 'clinic-B', email: 'other@b.sn' }
const superAdmin: Caller = { isSuperAdmin: true, role: 'super_admin', clinicId: null, email: 'root@platform.sn' }

describe('invitation access (mirrors migration 048)', () => {
  it('an admin CAN invite a user into their own clinic (INSERT WITH CHECK passes)', () => {
    expect(canInsert(inviteA, adminA)).toBe(true)
  })

  it('INSERT ... RETURNING no longer fails: the SELECT policy authorizes the returned row for the inviting admin', () => {
    // The returning row is visible to the admin via the clinic-admin branch —
    // and (SQL guard above) that branch no longer touches auth.users, so
    // evaluating it can never raise "permission denied for table users".
    expect(canReadOrAccept(inviteA, adminA)).toBe(true)
  })

  it('the invited email CAN read and accept their own invite', () => {
    expect(canReadOrAccept(inviteA, invitedUser)).toBe(true)   // read
    expect(canAcceptWithCheck(inviteA, invitedUser)).toBe(true) // accept (update WITH CHECK)
  })

  it('unrelated users CANNOT read or accept someone else\'s invite', () => {
    expect(canReadOrAccept(inviteA, unrelated)).toBe(false)
    expect(canAcceptWithCheck(inviteA, unrelated)).toBe(false)
    // The invited user cannot read a DIFFERENT email's invite in the same clinic.
    expect(canReadOrAccept(otherInviteA, invitedUser)).toBe(false)
  })

  it('tenant isolation preserved: an admin of another clinic cannot read clinic-A invites', () => {
    expect(canReadOrAccept(inviteA, adminB)).toBe(false)
    expect(canInsert(inviteA, adminB)).toBe(false) // nor invite into a clinic they don't admin
  })

  it('super_admin retains platform oversight', () => {
    expect(canReadOrAccept(inviteA, superAdmin)).toBe(true)
    expect(canInsert(inviteA, superAdmin)).toBe(true)
  })

  it('a caller with no email never matches the self-email branch (no accidental widening)', () => {
    const noEmail: Caller = { isSuperAdmin: false, role: 'doctor', clinicId: 'clinic-B', email: null }
    expect(canReadOrAccept(inviteA, noEmail)).toBe(false)
  })
})
