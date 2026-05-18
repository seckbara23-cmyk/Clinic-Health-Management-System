import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from(randomBytes(12), b => chars[b % chars.length]).join('')
}

// POST /api/admin/reset-password
// body: { user_id: string }
// Super admin only. Generates a new temporary password, sets must_change_password = true.
// Returns temp_password — never logged server-side.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('user_profiles')
    .select('role, email')
    .eq('id', user.id)
    .single()

  if (callerProfile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Accès réservé aux super admins' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const targetUserId: string | undefined = body?.user_id
  if (!targetUserId) return NextResponse.json({ error: 'user_id requis' }, { status: 400 })

  const service = createServiceClient()

  // Verify target user exists and is not a super_admin (cannot reset another super admin's password)
  const { data: targetProfile } = await service
    .from('user_profiles')
    .select('id, role, email, full_name')
    .eq('id', targetUserId)
    .single()

  if (!targetProfile) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
  if (targetProfile.role === 'super_admin') {
    return NextResponse.json({ error: 'Impossible de réinitialiser le mot de passe d\'un super admin' }, { status: 403 })
  }

  const tempPassword = generateTempPassword()

  // Update auth password + set app_metadata flag in one admin API call.
  // app_metadata is server-controlled (user cannot modify it) and is read
  // by the middleware to enforce password change before dashboard access.
  const { error: authError } = await service.auth.admin.updateUserById(targetUserId, {
    password:     tempPassword,
    app_metadata: { must_change_password: true },
  })
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  // Mirror flag in user_profiles for backward-compat DB checks
  const { error: profileError } = await service
    .from('user_profiles')
    .update({ must_change_password: true } as never)
    .eq('id', targetUserId)

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  // Write audit log — non-blocking
  await logAuditEvent({
    actorId:    user.id,
    action:     'user.password_reset',
    targetType: 'user',
    targetId:   targetUserId,
    metadata: {
      actor_email:      callerProfile?.email ?? '',
      target_email:     targetProfile.email,
      target_full_name: targetProfile.full_name,
      target_role:      targetProfile.role,
    },
  })

  return NextResponse.json({
    // temp_password shown once in the UI — never logged server-side
    temp_password: tempPassword,
    user: { id: targetProfile.id, email: targetProfile.email, full_name: targetProfile.full_name },
  })
}
