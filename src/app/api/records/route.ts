import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requestClientInfo, isAuditableEntity, isUuid } from '@/lib/audit-helpers'

// POST /api/records  body: { action: 'soft_delete' | 'restore', entity, id, reason? }
// Soft-deletes or restores a medical/billing record. Authorization (admin only,
// own clinic) and the cascade are enforced inside the SECURITY DEFINER RPCs;
// this route adds IP + user-agent to the audit metadata.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const action = body?.action
  const entity = body?.entity
  const id = body?.id
  const reason: string | null = typeof body?.reason === 'string' ? body.reason : null

  if (!isAuditableEntity(entity) || !isUuid(id)) {
    return NextResponse.json({ error: 'Entité invalide' }, { status: 400 })
  }

  const { ip, ua } = requestClientInfo(req)

  if (action === 'soft_delete') {
    const { error } = await supabase.rpc('soft_delete_record', {
      p_entity: entity, p_id: id, p_reason: reason, p_ip: ip, p_ua: ua,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 403 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'restore') {
    const { error } = await supabase.rpc('restore_record', {
      p_entity: entity, p_id: id, p_ip: ip, p_ua: ua,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 403 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
}
