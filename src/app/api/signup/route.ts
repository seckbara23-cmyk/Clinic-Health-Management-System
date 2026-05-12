import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { email, password, full_name, clinic_name, clinic_location } = await req.json()

  // 1. Sign up via the normal (anon) auth client so the session cookie is set
  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, role: 'admin' } },
  })

  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message ?? 'Signup failed' }, { status: 400 })
  }

  // 2. Use service-role client to bypass RLS for clinic creation
  const service = createServiceClient()

  const { data: clinic, error: clinicError } = await service
    .from('clinics')
    .insert({ name: clinic_name, location: clinic_location })
    .select()
    .single()

  if (clinicError) {
    return NextResponse.json({ error: clinicError.message }, { status: 400 })
  }

  // 3. Attach the new user to the clinic as admin
  const { error: profileError } = await service
    .from('user_profiles')
    .update({ clinic_id: clinic.id, role: 'admin', full_name })
    .eq('id', authData.user.id)

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
