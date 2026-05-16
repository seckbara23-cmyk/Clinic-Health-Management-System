import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'super_admin') return null
  return profile
}

// POST /api/admin/clinic-requests/[id]
// body: { action: 'approve' | 'reject', rejection_reason?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const admin = await getSuperAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { action, rejection_reason } = await req.json()

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
      })
      .eq('id', id)

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

    // 2. Create auth user
    const { data: authData, error: authError } = await service.auth.admin.createUser({
      email:         request.admin_email,
      email_confirm: true,
      user_metadata: {
        full_name: request.admin_full_name,
        role:      'admin',
      },
    })

    if (authError || !authData.user) {
      await service.from('clinics').delete().eq('id', clinic.id)
      return NextResponse.json({ error: authError?.message ?? 'Échec de la création du compte' }, { status: 400 })
    }

    const adminUserId = authData.user.id

    // 3. Upsert user_profile
    const { error: profileError } = await service
      .from('user_profiles')
      .upsert({
        id:        adminUserId,
        email:     request.admin_email,
        full_name: request.admin_full_name,
        role:      'admin',
        clinic_id: clinic.id,
        is_active: true,
      })

    if (profileError) {
      await service.auth.admin.deleteUser(adminUserId)
      await service.from('clinics').delete().eq('id', clinic.id)
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    // 4. Generate magic link for first login
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const { data: linkData } = await service.auth.admin.generateLink({
      type:    'magiclink',
      email:   request.admin_email,
      options: { redirectTo: `${appUrl}/reset-password` },
    })

    const setupLink = linkData?.properties?.action_link ?? null

    // 5. Mark request approved
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any)
      .from('clinic_requests')
      .update({
        status:      'approved',
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString(),
        clinic_id:   clinic.id,
      })
      .eq('id', id)

    return NextResponse.json({ ok: true, clinic, setupLink })
  }

  return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
}
