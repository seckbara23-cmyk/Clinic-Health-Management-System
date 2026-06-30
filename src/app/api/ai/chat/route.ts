import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { AI_ENABLED, AI_LOG_RAW } from '@/lib/ai/config'
import { runCopilot } from '@/lib/ai/context'
import { buildAIContext, extractMessage, type AIChatBody } from '@/lib/ai/request'

export const dynamic = 'force-dynamic'

// POST /api/ai/chat — Clinic Copilot (read-only, Layer 1).
// body: { message?, page?, patientId?, consultationId?, appointmentId?, ... }
//
// Guarantees: inert unless AI_ENABLED; rate-limited; runs entirely under the
// caller's RLS session (no service role). Audit persistence is best-effort and
// degrades silently if migration 031 has not been applied.
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

  const body = ((await req.json().catch(() => ({}))) ?? {}) as AIChatBody
  const ctx = buildAIContext(
    { id: profile.id, role: profile.role, clinic_id: profile.clinic_id },
    body,
  )
  const message = extractMessage(body)

  const { response, meta } = await runCopilot(ctx, message)

  // Best-effort audit. The ai_* tables are not in the generated types and may
  // not exist yet (migration 031), so cast and swallow errors — logging must
  // never block the Copilot.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data: conv } = await db
      .from('ai_conversations')
      .insert({
        clinic_id: ctx.clinicId,
        user_id: ctx.userId,
        page_context: ctx.page ?? null,
        role_snapshot: ctx.role,
      })
      .select('id')
      .maybeSingle()

    if (conv?.id) {
      await db.from('ai_messages').insert([
        {
          conversation_id: conv.id,
          clinic_id: ctx.clinicId,
          turn_role: 'user',
          content: AI_LOG_RAW ? (message ?? null) : null,
          content_redacted: !AI_LOG_RAW,
        },
        {
          conversation_id: conv.id,
          clinic_id: ctx.clinicId,
          turn_role: 'assistant',
          content: AI_LOG_RAW ? response.summary : null,
          content_redacted: !AI_LOG_RAW,
          tools_used: meta.toolsUsed,
          data_categories: meta.dataCategories,
          provider: meta.provider,
          confidence: response.confidence.level,
        },
      ])
    }
  } catch {
    // ai_* tables absent or insert failed — non-fatal.
  }

  return NextResponse.json({ response, meta })
}
