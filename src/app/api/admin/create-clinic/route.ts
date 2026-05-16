import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  // Verify caller is super_admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const {
    name, location, phone, email, subscription_plan,
    admin_full_name, admin_email,
  } = body

  if (!name || !location || !admin_full_name || !admin_email) {
    return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
  }

  const service = createServiceClient()

  // 1. Create clinic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: clinic, error: clinicError } = await (service as any)
    .from('clinics')
    .insert({
      name:              name.trim(),
      location:          location.trim(),
      phone:             phone?.trim() || null,
      email:             email?.trim() || null,
      subscription_plan: subscription_plan ?? 'free',
      status:            'active',
    })
    .select()
    .single()

  if (clinicError) {
    return NextResponse.json({ error: clinicError.message }, { status: 400 })
  }

  // 2. Create auth user (no password — they set it via the setup link)
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email:         admin_email.toLowerCase().trim(),
    email_confirm: true,
    user_metadata: {
      full_name: admin_full_name.trim(),
      role:      'admin',
    },
  })

  if (authError || !authData.user) {
    await service.from('clinics').delete().eq('id', clinic.id)
    return NextResponse.json({ error: authError?.message ?? 'Échec de la création du compte admin' }, { status: 400 })
  }

  const adminUserId = authData.user.id

  // 3. Upsert user_profile linked to the new clinic
  const { error: profileError } = await service
    .from('user_profiles')
    .upsert({
      id:        adminUserId,
      email:     admin_email.toLowerCase().trim(),
      full_name: admin_full_name.trim(),
      role:      'admin',
      clinic_id: clinic.id,
      is_active: true,
    })

  if (profileError) {
    await service.auth.admin.deleteUser(adminUserId)
    await service.from('clinics').delete().eq('id', clinic.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  // 4. Generate a magic link — clinic admin clicks it, lands on /reset-password, sets password.
  //    The redirectTo URL must be listed in Supabase Auth > URL Configuration > Redirect URLs.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
    type:    'magiclink',
    email:   admin_email.toLowerCase().trim(),
    options: { redirectTo: `${appUrl}/reset-password` },
  })

  const setupLink = linkError ? null : linkData?.properties?.action_link ?? null

  return NextResponse.json({
    clinic,
    setupLink,
    adminUserId,
    note: setupLink
      ? 'Partagez ce lien une seule fois avec l\'administrateur de la clinique.'
      : 'Génération du lien échouée — utilisez Supabase Auth Dashboard pour en créer un manuellement.',
  })
}
