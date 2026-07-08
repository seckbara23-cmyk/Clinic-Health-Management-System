import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit'
import {
  generateTempPassword,
  canCreateUser,
  resolveTargetClinicId,
  isOnboardableRole,
} from '@/lib/admin/user-onboarding'
import { normalizeIdentity } from '@/lib/identity/model'

// POST /api/admin/create-user
// body: { email, full_name, role, clinic_id }
//
// Server-only staff onboarding with a temporary password. This is the ONLY path
// that creates an auth user for a clinic — the browser never calls the Admin API
// and never generates a password. Authorisation:
//   • admin       → their own clinic only (client-supplied clinic_id is ignored)
//   • super_admin → any clinic
// The temporary password is returned once in the response and is never stored,
// never logged, and never written to the audit trail.
export async function POST(req: NextRequest) {
  // 1. Authenticate the caller via the server-side session (security boundary).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { data: caller } = await supabase
    .from('user_profiles')
    .select('role, clinic_id, email')
    .eq('id', user.id)
    .single()

  if (caller?.role !== 'admin' && caller?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs' }, { status: 403 })
  }

  // 2. Validate input.
  const body = await req.json().catch(() => null)
  const email    = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : ''
  const role     = body?.role
  const reqClinic = typeof body?.clinic_id === 'string' ? body.clinic_id : null
  // Identity metadata (organizational only — never a permission). normalizeIdentity
  // strips a specialty from any non-doctor role, so the rule is enforced server-side.
  const { department, primary_specialty } = normalizeIdentity({
    role,
    department:        typeof body?.department === 'string' ? body.department : null,
    primary_specialty: typeof body?.primary_specialty === 'string' ? body.primary_specialty : null,
  })

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
  }
  if (!fullName) {
    return NextResponse.json({ error: 'Nom complet requis' }, { status: 400 })
  }
  if (!isOnboardableRole(role)) {
    return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 })
  }

  // 3. Resolve + authorise the target clinic (server-authoritative — admins are
  //    pinned to their own clinic, so they can never onboard into another tenant).
  const callerCtx = { role: caller.role, clinicId: caller.clinic_id }
  const targetClinicId = resolveTargetClinicId(callerCtx, reqClinic)
  if (!canCreateUser(callerCtx, targetClinicId)) {
    return NextResponse.json(
      { error: 'Vous ne pouvez créer un utilisateur que dans votre clinique' },
      { status: 403 },
    )
  }

  const service = createServiceClient()

  // 4. super_admin picks the clinic → verify it exists. (admin is pinned to a
  //    clinic they already belong to, so no extra check is needed.)
  if (caller.role === 'super_admin') {
    const { data: clinic } = await service
      .from('clinics').select('id').eq('id', targetClinicId!).maybeSingle()
    if (!clinic) return NextResponse.json({ error: 'Clinique introuvable' }, { status: 404 })
  }

  // 5. Reject duplicates up front for a clean message.
  const { data: existing } = await service
    .from('user_profiles').select('id').eq('email', email).maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'Un utilisateur avec cet email existe déjà' }, { status: 409 })
  }

  // 6. Create the auth user via the Admin API. app_metadata is server-controlled
  //    (the user cannot alter it) and is read by the middleware to force a
  //    password change before any dashboard access.
  const tempPassword = generateTempPassword()
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email,
    password:      tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata:  { must_change_password: true },
  })

  if (authError || !authData.user) {
    const dup = /registered|already/i.test(authError?.message ?? '')
    return NextResponse.json(
      { error: dup ? 'Un utilisateur avec cet email existe déjà' : (authError?.message ?? 'Échec de la création du compte') },
      { status: dup ? 409 : 400 },
    )
  }

  const newUserId = authData.user.id

  // 7. Upsert the profile (a handle_new_user trigger may pre-create a partial
  //    row on auth insert — upsert on the id primary key reconciles it).
  const { error: profileError } = await service
    .from('user_profiles')
    .upsert({
      id:                   newUserId,
      email,
      full_name:            fullName,
      role,
      clinic_id:            targetClinicId,
      is_active:            true,
      must_change_password: true,
      department,
      primary_specialty,
    } as never)

  if (profileError) {
    // Roll back the orphaned auth user so a retry can succeed.
    await service.auth.admin.deleteUser(newUserId)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  // 8. Audit — metadata only. The password is NEVER included.
  await logAuditEvent({
    actorId:    user.id,
    action:     'user.create_with_temp_password',
    targetType: 'user',
    targetId:   newUserId,
    metadata: {
      actor_email:  caller.email ?? '',
      target_email: email,
      target_role:  role,
      clinic_id:    targetClinicId,
      method:       'temp',
    },
  })

  return NextResponse.json({
    // temp_password is shown once in the UI — never logged or stored server-side.
    temp_password: tempPassword,
    user: { id: newUserId, email, full_name: fullName, role },
  })
}
