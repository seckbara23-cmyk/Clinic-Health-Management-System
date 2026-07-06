import { readFileSync } from 'fs'
import { join } from 'path'
import {
  sanitizeErrorMessage, sanitizeRoute, sanitizeClientInfo, hashString,
  computeFingerprint, classifySeverity, computeHealthScore, parseReliabilityEvent,
  sortIncidents, incidentRank, suggestedAction, isReliabilityModule, isReliabilityErrorType,
  RELIABILITY_MODULES, RELIABILITY_ERROR_TYPES, MAX_MESSAGE_LEN, type ReliabilityEvent,
} from '../reliability'

// ── Sanitization = the privacy boundary ─────────────────────────────
describe('sanitizeErrorMessage — strips structured PII', () => {
  it('masks emails', () => {
    expect(sanitizeErrorMessage('failed for jean.dupont@example.com')).toBe('failed for [email]')
  })
  it('masks UUIDs (record ids)', () => {
    expect(sanitizeErrorMessage('patient a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found')).toBe('patient [id] not found')
  })
  it('masks phone numbers', () => {
    expect(sanitizeErrorMessage('sms to +221 77 123 45 67 failed')).toContain('[phone]')
    expect(sanitizeErrorMessage('sms to +221 77 123 45 67 failed')).not.toMatch(/77 123 45 67/)
  })
  it('masks long numbers (patient numbers, amounts, ids)', () => {
    expect(sanitizeErrorMessage('record 1234567 rejected')).toBe('record [num] rejected')
  })
  it('leaves ordinary technical text intact', () => {
    expect(sanitizeErrorMessage('TypeError: cannot read property foo of undefined')).toBe('TypeError: cannot read property foo of undefined')
  })
  it('truncates very long messages', () => {
    const long = 'x'.repeat(MAX_MESSAGE_LEN + 200)
    const out = sanitizeErrorMessage(long)
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE_LEN + 1)
    expect(out.endsWith('…')).toBe(true)
  })
  it('never throws on non-strings', () => {
    expect(sanitizeErrorMessage(null)).toBe('')
    expect(sanitizeErrorMessage(undefined)).toBe('')
    expect(sanitizeErrorMessage({ a: 1 })).toBeTruthy()
  })
  it('the CRITICAL guarantee: no email/uuid/long-number survives sanitization', () => {
    const dirty = 'save consultation a1b2c3d4-e5f6-7890-abcd-ef1234567890 for patient@clinic.sn phone 771234567 amount 4500000'
    const clean = sanitizeErrorMessage(dirty)
    expect(clean).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i)
    expect(clean).not.toMatch(/@/)
    expect(clean).not.toMatch(/\d{6,}/)
  })
})

describe('sanitizeRoute — removes ids and query strings', () => {
  it('collapses UUID/numeric segments to :id', () => {
    expect(sanitizeRoute('/patients/a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('/patients/:id')
    expect(sanitizeRoute('/consultations/12345')).toBe('/consultations/:id')
  })
  it('drops the query string and hash', () => {
    expect(sanitizeRoute('/patients?name=Jean%20Dupont&id=42#tab')).toBe('/patients')
  })
  it('keeps a normal route', () => {
    expect(sanitizeRoute('/pharmacy/inventory')).toBe('/pharmacy/inventory')
  })
  it('never throws', () => {
    expect(sanitizeRoute(null)).toBe('/')
    expect(sanitizeRoute('')).toBe('/')
  })
})

describe('sanitizeClientInfo — coarse family only, never the full UA', () => {
  it('reduces a UA to browser / OS', () => {
    expect(sanitizeClientInfo('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0')).toBe('Chrome / Windows')
    expect(sanitizeClientInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604')).toBe('Safari / iOS')
  })
  it('never echoes the raw UA', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537 Chrome/120 Safari/537'
    expect(sanitizeClientInfo(ua)).not.toContain('AppleWebKit')
  })
  it('unknown → "unknown"', () => {
    expect(sanitizeClientInfo('')).toBe('unknown')
    expect(sanitizeClientInfo(null)).toBe('unknown')
  })
})

// ── Hashing / fingerprint (deterministic grouping) ──────────────────
describe('hashString / computeFingerprint', () => {
  it('is deterministic', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
  it('fingerprint groups the same error regardless of the id in the route', () => {
    const a = computeFingerprint({ clinicId: 'c1', module: 'client', route: '/patients/111', errorType: 'client_error', stackHash: 'h' })
    const b = computeFingerprint({ clinicId: 'c1', module: 'client', route: '/patients/999', errorType: 'client_error', stackHash: 'h' })
    expect(a).toBe(b) // numeric ids normalise to :id → same group
  })
  it('fingerprint separates different clinics', () => {
    const a = computeFingerprint({ clinicId: 'c1', module: 'api', route: '/x', errorType: 'api_failure' })
    const b = computeFingerprint({ clinicId: 'c2', module: 'api', route: '/x', errorType: 'api_failure' })
    expect(a).not.toBe(b)
  })
})

// ── Severity classification ─────────────────────────────────────────
describe('classifySeverity', () => {
  it('maps HTTP status first', () => {
    expect(classifySeverity('api_failure', 500)).toBe('critical')
    expect(classifySeverity('api_failure', 404)).toBe('error')
    expect(classifySeverity('api_failure', 429)).toBe('warning')
  })
  it('falls back to type-based classification', () => {
    expect(classifySeverity('postgrest_error')).toBe('critical')
    expect(classifySeverity('storage_error')).toBe('critical')
    expect(classifySeverity('failed_job')).toBe('critical')
    expect(classifySeverity('client_error')).toBe('error')
    expect(classifySeverity('sms_failure')).toBe('warning')
    expect(classifySeverity('ai_failure')).toBe('warning')
    expect(classifySeverity('anything_else')).toBe('error')
  })
})

// ── Health score (from FAILURE signals only) ────────────────────────
describe('computeHealthScore', () => {
  it('no signals → green, 100', () => {
    const h = computeHealthScore({})
    expect(h.level).toBe('green')
    expect(h.score).toBe(100)
    expect(h.signals).toEqual(['healthy'])
  })
  it('any unresolved critical → red regardless of score arithmetic', () => {
    expect(computeHealthScore({ criticalCount: 1 }).level).toBe('red')
  })
  it('escalates green → yellow → orange → red as errors accumulate', () => {
    expect(computeHealthScore({ errorCount: 1 }).level).toBe('green')    // 94 (≥90)
    expect(computeHealthScore({ errorCount: 3 }).level).toBe('yellow')   // 82 (65..89)
    expect(computeHealthScore({ errorCount: 7 }).level).toBe('orange')   // 58 (40..64)
    expect(computeHealthScore({ errorCount: 11 }).level).toBe('red')     // 34 (<40)
  })
  it('sms failures and warnings debit the score', () => {
    expect(computeHealthScore({ smsFailedCount: 10 }).score).toBe(80)
    expect(computeHealthScore({ warningCount: 4 }).score).toBe(94)
  })
  it('score is clamped to 0..100 and never negative', () => {
    expect(computeHealthScore({ criticalCount: 100, errorCount: 100 }).score).toBe(0)
  })
  it('ignores negative/garbage inputs', () => {
    expect(computeHealthScore({ errorCount: -5, warningCount: NaN as unknown as number }).score).toBe(100)
  })
  it('lists signals most-severe first', () => {
    const h = computeHealthScore({ criticalCount: 1, errorCount: 2, smsFailedCount: 1, warningCount: 1 })
    expect(h.signals[0]).toMatch(/^critical:/)
  })
})

// ── Incident sorting ────────────────────────────────────────────────
describe('incident ranking', () => {
  const ev = (over: Partial<ReliabilityEvent>): ReliabilityEvent => ({
    id: over.id ?? 'x', clinicId: null, clinicName: null, module: 'client', route: '/', errorType: 'client_error',
    severity: 'error', message: '', affectedRole: null, clientInfo: null, occurrenceCount: 1,
    firstSeen: null, lastSeen: null, resolved: false, ...over,
  })
  it('open before resolved; critical before error; frequent first', () => {
    const resolved = ev({ id: 'r', resolved: true, severity: 'critical' })
    const critical = ev({ id: 'c', severity: 'critical', occurrenceCount: 5 })
    const error = ev({ id: 'e', severity: 'error' })
    const sorted = sortIncidents([resolved, error, critical]).map(x => x.id)
    expect(sorted[0]).toBe('c')          // open critical, frequent
    expect(sorted[sorted.length - 1]).toBe('r') // resolved sinks to the bottom
  })
  it('incidentRank is a pure number', () => {
    expect(typeof incidentRank(ev({}))).toBe('number')
  })
})

describe('suggestedAction', () => {
  it('maps each error type to an ops action', () => {
    expect(suggestedAction('postgrest_error')).toBe('check_rls_migration')
    expect(suggestedAction('sms_failure')).toBe('check_sms_provider')
    expect(suggestedAction('mystery')).toBe('review_error')
  })
})

describe('validators + parser', () => {
  it('module / error type validators', () => {
    expect(isReliabilityModule('client')).toBe(true)
    expect(isReliabilityModule('nope')).toBe(false)
    expect(isReliabilityErrorType('api_failure')).toBe(true)
    expect(isReliabilityErrorType('nope')).toBe(false)
    expect(RELIABILITY_MODULES.length).toBeGreaterThan(5)
    expect(RELIABILITY_ERROR_TYPES).toContain('unhandled_rejection')
  })
  it('parseReliabilityEvent maps a row, dropping rows with no id', () => {
    expect(parseReliabilityEvent(null)).toBeNull()
    expect(parseReliabilityEvent({ notid: 1 })).toBeNull()
    const e = parseReliabilityEvent({ id: 'x', clinic_id: 'c1', severity: 'critical', occurrence_count: 3, resolved: true })
    expect(e?.severity).toBe('critical')
    expect(e?.occurrenceCount).toBe(3)
    expect(e?.resolved).toBe(true)
  })
})

// ── Privacy & security invariants across the whole feature ──────────
describe('reliability privacy & security invariants', () => {
  const LIB = readFileSync(join(__dirname, '..', 'reliability.ts'), 'utf8')
  const HOOK = readFileSync(join(__dirname, '..', '..', 'hooks', 'useReliability.ts'), 'utf8')
  const ROUTE = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'reliability', 'report', 'route.ts'), 'utf8')
  const REPORTER = readFileSync(join(__dirname, '..', '..', 'components', 'reliability', 'ReliabilityReporter.tsx'), 'utf8')
  const PAGE = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'admin', 'reliability', 'page.tsx'), 'utf8')
  const SQL = readFileSync(join(__dirname, '..', '..', '..', 'supabase', '043_reliability_events.sql'), 'utf8')

  it('the pure lib touches no DB / service role / clinical module', () => {
    expect(LIB).not.toMatch(/import[^\n]*supabase/i)
    expect(LIB).not.toMatch(/createClient|service_role/)
    expect(LIB).not.toMatch(/from '@\/(lib|hooks)\/(copilot-packs|workspace|specialties|professions|pathways|ai)/)
  })

  it('the super_admin hook never reads a clinical table and never writes directly (RPC-only)', () => {
    const forbidden = ["from('patients')", "from('prescriptions')", "from('consultations')", "from('invoices')", "from('lab_orders')", "from('sms_messages')", "from('ai_messages')", "from('reliability_events')"]
    for (const f of forbidden) expect(HOOK).not.toContain(f)
    expect(HOOK).not.toMatch(/service_role|createServiceClient/)
    expect(HOOK).not.toMatch(/clinics\(/)
  })

  it('the client reporter never sends a raw stack, only a hash, and calls no service role', () => {
    expect(REPORTER).not.toMatch(/service_role|createServiceClient/)
    // It must hash the stack, not post it raw.
    expect(REPORTER).toMatch(/hashString/)
    expect(REPORTER).not.toMatch(/body:\s*JSON\.stringify\([^)]*stack:/)
  })

  it('the ingestion route derives clinic_id from the session, never from the body', () => {
    // The body's clinic_id is explicitly ignored; clinic comes from the profile.
    expect(ROUTE).toMatch(/from\('user_profiles'\)/)
    expect(ROUTE).toMatch(/profile\?\.clinic_id/)
    expect(ROUTE).not.toMatch(/body\.clinic_id|body\?\.clinic_id/)
    // It sanitizes before persisting.
    expect(ROUTE).toMatch(/sanitizeErrorMessage/)
    expect(ROUTE).toMatch(/sanitizeRoute/)
  })

  it('the reliability page reads no clinical table and performs no clinical action', () => {
    const forbidden = ["from('patients')", "from('prescriptions')", "from('consultations')", "from('sms_messages')", "from('ai_messages')"]
    for (const f of forbidden) expect(PAGE).not.toContain(f)
    expect(PAGE).not.toMatch(/service_role/)
  })

  it('every reliability RPC is is_super_admin()-gated; RLS scopes tenant reads; no client writes', () => {
    const code = SQL.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    const fnCount = (code.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length
    const gateCount = (code.match(/IF NOT public\.is_super_admin\(\) THEN/g) ?? []).length
    expect(fnCount).toBe(4)          // resolve + overview + health + incidents
    expect(gateCount).toBe(4)
    // Tenant isolation: a clinic admin sees only their own clinic (get_clinic_id()).
    expect(code).toMatch(/clinic_id = public\.get_clinic_id\(\)/)
    // No client INSERT/UPDATE/DELETE — writes are service-role/definer only.
    expect(code).toMatch(/FOR INSERT WITH CHECK \(false\)/)
    expect(code).toMatch(/FOR UPDATE USING \(false\)/)
    // No raw clinical column is stored/returned.
    for (const c of ['patient_name', 'diagnosis', 'clinical_notes', 'stack_trace']) {
      expect(code).not.toMatch(new RegExp(c))
    }
  })
})
