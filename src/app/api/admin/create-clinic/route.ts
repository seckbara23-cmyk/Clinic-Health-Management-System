import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

function generateTempPassword(): string {
  // Excludes visually ambiguous chars (0/O, 1/l/I) so it's safe to read aloud or copy by hand
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from(randomBytes(12), b => chars[b % chars.length]).join('')
}

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

  // 2. Create auth user with a temporary password the super admin will share out-of-band.
  //    must_change_password = true ensures they are forced to set their own password on first login.
  //    The temp password is returned to the caller and NEVER logged.
  const tempPassword = generateTempPassword()
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email:         admin_email.toLowerCase().trim(),
    password:      tempPassword,
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

  // 3. Upsert user_profile linked to the new clinic — flag forces password change on first login
  const { error: profileError } = await service
    .from('user_profiles')
    .upsert({
      id:                   adminUserId,
      email:                admin_email.toLowerCase().trim(),
      full_name:            admin_full_name.trim(),
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

  return NextResponse.json({
    clinic,
    adminUserId,
    // temp_password is shown once in the UI — never logged server-side
    temp_password: tempPassword,
    note: 'Communiquez ce mot de passe temporaire à l\'administrateur de la clinique. Il devra le changer à la première connexion.',
  })
}
