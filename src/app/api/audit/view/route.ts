import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requestClientInfo, isAuditableEntity, isUuid } from '@/lib/audit-helpers'

// POST /api/audit/view  body: { entity_type, entity_id }
// Records a 'viewed' audit event for a record detail-view open. Uses the
// caller's session so auth.uid()/get_clinic_id() resolve correctly inside the
// RPC; captures IP + user-agent from request headers. Fire-and-forget from the
// client — failures must never block the UI.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const entity = body?.entity_type
  const id = body?.entity_id
  if (!isAuditableEntity(entity) || !isUuid(id)) {
    return NextResponse.json({ error: 'Invalid entity' }, { status: 400 })
  }

  const { ip, ua } = requestClientInfo(req)
  const { error } = await supabase.rpc('log_record_view', {
    p_entity: entity, p_id: id, p_ip: ip, p_ua: ua,
  })
  if (error) {
    console.error('[audit/view] log failed', error.message)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
