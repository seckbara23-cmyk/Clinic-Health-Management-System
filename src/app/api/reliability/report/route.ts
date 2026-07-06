import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rateLimit } from '@/lib/rate-limit'
import {
  sanitizeErrorMessage, sanitizeRoute, sanitizeClientInfo, hashString,
  computeFingerprint, classifySeverity, isReliabilityModule, isReliabilityErrorType,
} from '@/lib/reliability'

export const dynamic = 'force-dynamic'

// POST /api/reliability/report — ingest ONE operational error report.
//
// PRIVACY: this route captures only an error's TYPE, LOCATION (sanitized route),
// a PII-sanitized message, and a stack HASH — never a request/response body,
// form value, or DB row. `clinic_id` is derived from the caller's OWN session
// (never from the body), so a tenant can never write another tenant's events.
// Writes use the service-role client (the table has no client INSERT policy),
// gated behind authentication + rate limiting + strict input validation.
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'reliability-report')
  if (limited) return limited

  // Must be an authenticated session — anonymous reporting is not accepted.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  // Server-derived clinic + role — the body's clinic_id (if any) is IGNORED.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('clinic_id, role')
    .eq('id', user.id)
    .maybeSingle()

  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>

  // `moduleName` (not `module` — Next reserves that identifier).
  const moduleName = isReliabilityModule(body.module) ? body.module : 'client'
  const errorType = isReliabilityErrorType(body.errorType) ? body.errorType : 'unknown'
  const route = sanitizeRoute(body.route)
  const message = sanitizeErrorMessage(body.message)
  // A client may send a precomputed stack hash; if it sent raw text, hash it
  // here so a raw stack never persists.
  const stackHash = body.stackHash ? hashString(body.stackHash) : null
  const statusCode = typeof body.statusCode === 'number' ? body.statusCode : null
  const severity = classifySeverity(errorType, statusCode)
  const clientInfo = sanitizeClientInfo(req.headers.get('user-agent'))
  const clinicId = (profile?.clinic_id as string | null) ?? null
  const affectedRole = (profile?.role as string | null) ?? null
  const fingerprint = computeFingerprint({ clinicId, module: moduleName, route, errorType, stackHash })

  const service = createServiceClient()
  const nowIso = new Date().toISOString()

  try {
    // Dedup: an identical (clinic, fingerprint) event increments its count and
    // reopens if it had been resolved (a recurrence is news). Explicit
    // select-then-write handles NULL clinic_id (platform errors) cleanly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = service as any
    let existingQuery = svc.from('reliability_events').select('id, occurrence_count').eq('fingerprint', fingerprint)
    existingQuery = clinicId ? existingQuery.eq('clinic_id', clinicId) : existingQuery.is('clinic_id', null)
    const { data: existing } = await existingQuery.maybeSingle()

    if (existing?.id) {
      await svc.from('reliability_events').update({
        occurrence_count: Number(existing.occurrence_count ?? 1) + 1,
        last_seen: nowIso,
        severity,
        message,
        client_info: clientInfo,
        resolved: false,
        resolved_at: null,
        resolved_by: null,
      }).eq('id', existing.id)
    } else {
      await svc.from('reliability_events').insert({
        clinic_id: clinicId,
        fingerprint,
        module: moduleName,
        route,
        error_type: errorType,
        severity,
        message,
        stack_hash: stackHash,
        affected_role: affectedRole,
        client_info: clientInfo,
        occurrence_count: 1,
        first_seen: nowIso,
        last_seen: nowIso,
      })
    }
  } catch {
    // Monitoring must never break the app. Swallow (the table may be absent
    // until migration 043 is applied) and return success either way.
  }

  return new NextResponse(null, { status: 204 })
}
