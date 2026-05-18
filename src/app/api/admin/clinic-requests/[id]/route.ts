import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/lib/audit'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from(randomBytes(12), b => chars[b % chars.length]).join('')
}

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, id, email')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'super_admin') return null
  return profile
}

// POST /api/admin/clinic-requests/[id]
// body: { action: 'approve' | 'reject', rejection_reason?: string, review_notes?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const admin = await getSuperAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { action, rejection_reason, review_notes } = await req.json()

  const service = createServiceClient()

  // Load the request
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: request, error: fetchError } = await (service as any)
    .from('clinic_requests')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .single()

  if (fetchError || !request) {
    return NextResponse.json({ error: 'Demande introuvable ou déjà traitée' }, { status: 404 })
  }

  if (action === 'reject') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any)
      .from('clinic_requests')
      .update({
        status:           'rejected',
        reviewed_by:      admin.id,
        reviewed_at:      new Date().toISOString(),
        rejection_reason: rejection_reason ?? null,
        review_notes:     review_notes ?? null,
      })
      .eq('id', id)

    await logAuditEvent({
      actorId:    admin.id,
      action:     'clinic_request.reject',
      targetType: 'clinic_request',
      targetId:   id,
      metadata: {
        actor_email:      admin.email ?? '',
        clinic_name:      request.clinic_name,
        admin_email:      request.admin_email,
        rejection_reason: rejection_reason ?? null,
      },
    })

    return NextResponse.json({ ok: true })
  }

  if (action === 'approve') {
    // 1. Create clinic
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: clinic, error: clinicError } = await (service as any)
      .from('clinics')
      .insert({
        name:              request.clinic_name,
        location:          request.location,
        phone:             request.phone ?? null,
        subscription_plan: 'free',
        status:            'active',
      })
      .select()
      .single()

    if (clinicError) {
      return NextResponse.json({ error: clinicError.message }, { status: 400 })
    }

    // 2. Create auth user with temporary password — never logged
    //    app_metadata.must_change_password is server-controlled and is read by
    //    the middleware to enforce password change before dashboard access.
    const tempPassword = generateTempPassword()
    const { data: authData, error: authError } = await service.auth.admin.createUser({
      email:         request.admin_email,
      password:      tempPassword,
      email_confirm: true,
      user_metadata: { full_name: request.admin_full_name },
      // app_metadata is server-only; middleware reads this to enforce must_change_password
      app_metadata:  { must_change_password: true },
    })

    if (authError || !authData.user) {
      await service.from('clinics').delete().eq('id', clinic.id)
      return NextResponse.json({ error: authError?.message ?? 'Échec de la création du compte' }, { status: 400 })
    }

    const adminUserId = authData.user.id

    // 3. Upsert user_profile — must_change_password forces change on first login
    const { error: profileError } = await service
      .from('user_profiles')
      .upsert({
        id:                   adminUserId,
        email:                request.admin_email,
        full_name:            request.admin_full_name,
        role:                 'admin',
        clinic_id:            clinic.id,
        is_active:            true,
        must_change_password: true,
      } as never)

    if (profileError) {
      await service.auth.admin.deleteUser(adminUserId)
      await service.from('clinics').delete().eq('id', clinic.id)
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    // 4. Mark request approved
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any)
      .from('clinic_requests')
      .update({
        status:          'approved',
        reviewed_by:     admin.id,
        reviewed_at:     new Date().toISOString(),
        clinic_id:       clinic.id,
        created_user_id: adminUserId,
        review_notes:    review_notes ?? null,
      })
      .eq('id', id)

    // 5. Write audit log — non-blocking
    await logAuditEvent({
      actorId:    admin.id,
      action:     'clinic_request.approve',
      targetType: 'clinic_request',
      targetId:   id,
      metadata: {
        actor_email:   admin.email ?? '',
        clinic_id:     clinic.id,
        clinic_name:   request.clinic_name,
        admin_email:   request.admin_email,
        admin_user_id: adminUserId,
      },
    })

    return NextResponse.json({
      ok: true,
      clinic,
      // temp_password returned once to caller — never logged server-side
      temp_password: tempPassword,
      admin_email: request.admin_email,
    })
  }

  return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
}
