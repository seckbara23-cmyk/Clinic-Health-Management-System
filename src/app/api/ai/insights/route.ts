import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AI_ENABLED } from '@/lib/ai/config'
import { runInsights } from '@/lib/ai/context'
import { buildAIContext, type AIChatBody } from '@/lib/ai/request'

export const dynamic = 'force-dynamic'

// POST /api/ai/insights — embedded page intelligence (read-only, Phase 2).
// body: { page?, patientId?, ... } (entity context only; role/clinic come from
// the session). Returns per-tool insight results + an aggregate confidence.
//
// Same guarantees as /api/ai/chat: inert unless AI_ENABLED; runs entirely under
// the caller's RLS session (no service role); no writes, no external calls.
export async function POST(req: NextRequest) {
  if (!AI_ENABLED) {
    return NextResponse.json({ error: 'AI disabled' }, { status: 404 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, role, clinic_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.clinic_id || !profile.role) {
    return NextResponse.json({ error: 'Profil ou clinique introuvable' }, { status: 403 })
  }

  const body = ((await req.json().catch(() => ({}))) ?? {}) as AIChatBody
  const ctx = buildAIContext(
    { id: profile.id, role: profile.role, clinic_id: profile.clinic_id },
    body,
  )

  const { results, response, meta } = await runInsights(ctx)
  return NextResponse.json({ results, response, meta })
}
