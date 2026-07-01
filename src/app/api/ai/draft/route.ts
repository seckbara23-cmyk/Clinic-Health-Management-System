import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { AI_ENABLED } from '@/lib/ai/config'
import { runDraft } from '@/lib/ai/context'
import { canGenerateDraft, DRAFT_TYPES } from '@/lib/ai/drafts'
import type { AIContext, DraftType } from '@/lib/ai/types'
import type { Role } from '@/types/database'

export const dynamic = 'force-dynamic'

// POST /api/ai/draft — Assisted drafting (Layer 3, read-only).
// body: { draftType, patientId, diagnosis?, appointmentReason? }
//
// Guarantees: inert unless AI_ENABLED; rate-limited; DOCTOR/ADMIN only; runs
// entirely under the caller's RLS session (no service role); performs only
// SELECTs — it NEVER writes. Returns a StructuredDraft for the clinician to
// review, edit and save through the normal flows.
export async function POST(req: NextRequest) {
  if (!AI_ENABLED) {
    return NextResponse.json({ error: 'AI disabled' }, { status: 404 })
  }

  const limited = await rateLimit(req, 'ai-chat')
  if (limited) return limited

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

  // Only doctors and admins (authorised clinicians) may generate drafts.
  if (!canGenerateDraft(profile.role as Role)) {
    return NextResponse.json({ error: 'Seuls les cliniciens autorisés peuvent générer des brouillons' }, { status: 403 })
  }

  const body = ((await req.json().catch(() => ({}))) ?? {}) as {
    draftType?: unknown
    patientId?: unknown
    diagnosis?: unknown
    appointmentReason?: unknown
  }

  const draftType = body.draftType
  if (typeof draftType !== 'string' || !DRAFT_TYPES.includes(draftType as DraftType)) {
    return NextResponse.json({ error: 'Type de brouillon invalide' }, { status: 400 })
  }
  const patientId = typeof body.patientId === 'string' ? body.patientId : ''
  if (!patientId) {
    return NextResponse.json({ error: 'patientId requis' }, { status: 400 })
  }

  const ctx: AIContext = {
    role: profile.role as Role,
    clinicId: profile.clinic_id,
    userId: profile.id,
    patientId,
  }

  const { draft, meta } = await runDraft(ctx, draftType as DraftType, {
    diagnosis: typeof body.diagnosis === 'string' ? body.diagnosis : undefined,
    appointmentReason: typeof body.appointmentReason === 'string' ? body.appointmentReason : undefined,
  })

  return NextResponse.json({ draft, meta })
}
