// ── Platform Reliability & Bug Monitoring — pure logic (Phase 15.0B) ─
//
// Deterministic, framework-free core for the reliability layer. No React, no
// Supabase, no I/O — every branch is unit-testable.
//
// PRIVACY CORE: super_admin may see operational FAILURES, never clinical data.
// The sanitizers here strip structured PII (emails, phones, ids, long numbers)
// from any error text, and the ingestion path (report route) NEVER captures
// request/response bodies, form values, or DB rows — only an error's TYPE,
// LOCATION, and a sanitized/truncated message. This module imports nothing from
// the clinical / Healthcare-OS modules.

// ── Controlled vocabularies ─────────────────────────────────────────
export const RELIABILITY_MODULES = [
  'client', 'api', 'cron', 'sms', 'ai', 'storage', 'database', 'auth',
  'pharmacy', 'lab', 'billing', 'consultations', 'unknown',
] as const
export type ReliabilityModule = (typeof RELIABILITY_MODULES)[number]

export const RELIABILITY_ERROR_TYPES = [
  'client_error', 'unhandled_rejection', 'api_failure', 'slow_page',
  'failed_job', 'sms_failure', 'ai_failure', 'postgrest_error',
  'storage_error', 'auth_failure', 'unknown',
] as const
export type ReliabilityErrorType = (typeof RELIABILITY_ERROR_TYPES)[number]

export type ReliabilitySeverity = 'info' | 'warning' | 'error' | 'critical'
export type HealthLevel = 'green' | 'yellow' | 'orange' | 'red'

export function isReliabilityModule(v: unknown): v is ReliabilityModule {
  return typeof v === 'string' && (RELIABILITY_MODULES as readonly string[]).includes(v)
}
export function isReliabilityErrorType(v: unknown): v is ReliabilityErrorType {
  return typeof v === 'string' && (RELIABILITY_ERROR_TYPES as readonly string[]).includes(v)
}

// ── Sanitizers (the privacy boundary) ───────────────────────────────
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
// A phone-ish run: an optional +, then 7+ digits possibly split by space/dash/dot/parens.
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g
const LONG_NUM_RE = /\d{6,}/g

export const MAX_MESSAGE_LEN = 500

/**
 * Strip structured PII from an error message and truncate. Order matters:
 * emails and UUIDs first, then phone-like runs, then any remaining long number.
 * Never throws; always returns a string.
 */
export function sanitizeErrorMessage(input: unknown): string {
  let s = typeof input === 'string' ? input : String(input ?? '')
  s = s.replace(EMAIL_RE, '[email]')
  s = s.replace(UUID_RE, '[id]')
  s = s.replace(PHONE_RE, '[phone]')
  s = s.replace(LONG_NUM_RE, '[num]')
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > MAX_MESSAGE_LEN ? s.slice(0, MAX_MESSAGE_LEN) + '…' : s
}

/**
 * Normalise a route/path for grouping: drop the query string and replace any
 * id-like segment (UUID or numeric) with ':id' so /patients/<uuid> collapses to
 * /patients/:id. This both groups recurring errors AND removes a record id from
 * the stored route.
 */
export function sanitizeRoute(input: unknown): string {
  let s = typeof input === 'string' ? input : String(input ?? '')
  s = s.split('?')[0].split('#')[0].trim()
  if (!s) return '/'
  const segments = s.split('/').map(seg => {
    if (!seg) return seg
    if (UUID_RE.test(seg)) return ':id'
    if (/^\d+$/.test(seg)) return ':id'
    return seg
  })
  const out = segments.join('/')
  return out.length > 200 ? out.slice(0, 200) : out
}

/** Reduce a raw User-Agent to a coarse browser/OS family — never the full UA
 *  (which is a fingerprinting/PII vector). */
export function sanitizeClientInfo(ua: unknown): string {
  const s = typeof ua === 'string' ? ua : ''
  if (!s) return 'unknown'
  const browser =
    /Edg\//.test(s) ? 'Edge' :
    /OPR\/|Opera/.test(s) ? 'Opera' :
    /Chrome\//.test(s) ? 'Chrome' :
    /Firefox\//.test(s) ? 'Firefox' :
    /Safari\//.test(s) ? 'Safari' : 'Other'
  const os =
    /Windows/.test(s) ? 'Windows' :
    /Android/.test(s) ? 'Android' :
    /iPhone|iPad|iOS/.test(s) ? 'iOS' :
    /Mac OS X|Macintosh/.test(s) ? 'macOS' :
    /Linux/.test(s) ? 'Linux' : 'Other'
  return `${browser} / ${os}`
}

// ── Hashing / fingerprinting (deterministic) ───────────────────────
/** FNV-1a 32-bit hex hash — deterministic, no crypto dependency, non-reversible
 *  enough for grouping. Used for stack hashes and event fingerprints. */
export function hashString(input: unknown): string {
  const s = typeof input === 'string' ? input : String(input ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export interface FingerprintParts {
  clinicId?: string | null
  module: string
  route: string
  errorType: string
  stackHash?: string | null
}

/** Stable dedup key for "the same error recurring". Groups by clinic + module +
 *  normalised route + type + stack hash. */
export function computeFingerprint(parts: FingerprintParts): string {
  return hashString([
    parts.clinicId ?? 'platform',
    parts.module,
    sanitizeRoute(parts.route),
    parts.errorType,
    parts.stackHash ?? '',
  ].join('|'))
}

// ── Severity classification (server-authoritative) ──────────────────
/** Deterministically classify severity from the error type (+ optional HTTP
 *  status). The server always recomputes this — a client hint is never trusted. */
export function classifySeverity(errorType: string, statusCode?: number | null): ReliabilitySeverity {
  if (typeof statusCode === 'number') {
    if (statusCode >= 500) return 'critical'
    if (statusCode === 408 || statusCode === 429) return 'warning'
    if (statusCode >= 400) return 'error'
  }
  switch (errorType) {
    case 'postgrest_error':
    case 'storage_error':
    case 'failed_job':
      return 'critical'
    case 'client_error':
    case 'unhandled_rejection':
    case 'api_failure':
    case 'auth_failure':
      return 'error'
    case 'sms_failure':
    case 'ai_failure':
    case 'slow_page':
      return 'warning'
    default:
      return 'error'
  }
}

// ── Health score (per clinic) ───────────────────────────────────────
export interface HealthInputs {
  criticalCount: number
  errorCount: number
  warningCount: number
  smsFailedCount: number
}

export interface HealthScore {
  level: HealthLevel
  score: number          // 0–100 (100 = healthy)
  signals: string[]      // human-readable reasons, most severe first
}

/**
 * Compute a clinic's operational health from FAILURE signals only — never from
 * patient/clinical data. Deterministic thresholds:
 *   • any unresolved critical → red
 *   • else score < 40 → red, < 65 → orange, < 90 → yellow, else green
 * The 0–100 score starts at 100 and is debited per signal.
 */
export function computeHealthScore(inputs: Partial<HealthInputs>): HealthScore {
  const critical = nonNeg(inputs.criticalCount)
  const error = nonNeg(inputs.errorCount)
  const warning = nonNeg(inputs.warningCount)
  const smsFailed = nonNeg(inputs.smsFailedCount)

  let raw = 100 - critical * 30 - error * 6 - warning * 1.5 - smsFailed * 2
  raw = Math.max(0, Math.min(100, raw))
  const score = Math.round(raw)

  let level: HealthLevel
  if (critical > 0 || score < 40) level = 'red'
  else if (score < 65) level = 'orange'
  else if (score < 90) level = 'yellow'
  else level = 'green'

  const signals: string[] = []
  if (critical > 0) signals.push(`critical:${critical}`)
  if (error > 0) signals.push(`error:${error}`)
  if (smsFailed > 0) signals.push(`sms_failed:${smsFailed}`)
  if (warning > 0) signals.push(`warning:${warning}`)
  if (signals.length === 0) signals.push('healthy')

  return { level, score, signals }
}

function nonNeg(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

// ── Domain models + tolerant parsing ────────────────────────────────
export interface ReliabilityEvent {
  id: string
  clinicId: string | null
  clinicName: string | null
  module: string
  route: string
  errorType: string
  severity: ReliabilitySeverity
  message: string
  affectedRole: string | null
  clientInfo: string | null
  occurrenceCount: number
  firstSeen: string | null
  lastSeen: string | null
  resolved: boolean
}

export function parseReliabilityEvent(row: Record<string, unknown> | null | undefined): ReliabilityEvent | null {
  if (!row || typeof row.id !== 'string') return null
  return {
    id: row.id,
    clinicId: (row.clinic_id as string | null) ?? null,
    clinicName: (row.clinic_name as string | null) ?? null,
    module: String(row.module ?? 'unknown'),
    route: String(row.route ?? ''),
    errorType: String(row.error_type ?? 'unknown'),
    severity: (row.severity as ReliabilitySeverity) ?? 'error',
    message: String(row.message ?? ''),
    affectedRole: (row.affected_role as string | null) ?? null,
    clientInfo: (row.client_info as string | null) ?? null,
    occurrenceCount: Number(row.occurrence_count ?? 1),
    firstSeen: (row.first_seen as string | null) ?? null,
    lastSeen: (row.last_seen as string | null) ?? null,
    resolved: row.resolved === true,
  }
}

// ── Aggregation helpers (dashboard) ─────────────────────────────────
export const SEVERITY_ORDER: ReliabilitySeverity[] = ['critical', 'error', 'warning', 'info']

/** Rank for sorting an incident list: unresolved-critical-recurring first. */
export function incidentRank(e: Pick<ReliabilityEvent, 'severity' | 'resolved' | 'occurrenceCount'>): number {
  const sev = SEVERITY_ORDER.indexOf(e.severity)
  const sevRank = sev === -1 ? SEVERITY_ORDER.length : sev
  return (e.resolved ? 1000 : 0) + sevRank * 100 - Math.min(99, e.occurrenceCount)
}

export function sortIncidents(events: ReliabilityEvent[]): ReliabilityEvent[] {
  return [...events].sort((a, b) => incidentRank(a) - incidentRank(b) || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
}

/** A short, deterministic suggested-action string per error type (ops guidance,
 *  no clinical content). */
export function suggestedAction(errorType: string): string {
  switch (errorType) {
    case 'postgrest_error': return 'check_rls_migration'
    case 'storage_error': return 'check_storage_bucket'
    case 'failed_job': return 'check_cron_logs'
    case 'sms_failure': return 'check_sms_provider'
    case 'ai_failure': return 'check_ai_provider'
    case 'slow_page': return 'check_query_performance'
    case 'api_failure': return 'check_api_route'
    case 'auth_failure': return 'check_auth_config'
    default: return 'review_error'
  }
}
