'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signIn(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signUp(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const full_name = formData.get('full_name') as string
  const clinic_name = formData.get('clinic_name') as string
  const clinic_location = formData.get('clinic_location') as string

  // 1. Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, role: 'admin' } },
  })

  if (authError || !authData.user) return { error: authError?.message ?? 'Signup failed' }

  // 2. Create clinic
  const { data: clinic, error: clinicError } = await supabase
    .from('clinics')
    .insert({ name: clinic_name, location: clinic_location })
    .select()
    .single()

  if (clinicError) return { error: clinicError.message }

  // 3. Attach user to clinic as admin
  const { error: profileError } = await supabase
    .from('user_profiles')
    .update({ clinic_id: clinic.id, role: 'admin' })
    .eq('id', authData.user.id)

  if (profileError) return { error: profileError.message }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

export async function resetPassword(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
  })

  if (error) return { error: error.message }
  return { success: true }
}

export async function updatePassword(formData: FormData) {
  const supabase = await createClient()
  const password = formData.get('password') as string

  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { error: error.message }

  redirect('/dashboard')
}

export async function acceptInvite(token: string, formData: FormData) {
  const supabase = await createClient()
  const password = formData.get('password') as string
  const full_name = formData.get('full_name') as string

  // Verify invitation
  const { data: invite, error: inviteError } = await supabase
    .from('clinic_invitations')
    .select('*')
    .eq('token', token)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (inviteError || !invite) return { error: 'Invalid or expired invitation' }

  // Sign up user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: invite.email,
    password,
    options: { data: { full_name, role: invite.role } },
  })

  if (authError || !authData.user) return { error: authError?.message ?? 'Signup failed' }

  // Attach to clinic
  await supabase
    .from('user_profiles')
    .update({ clinic_id: invite.clinic_id, role: invite.role })
    .eq('id', authData.user.id)

  // Mark invitation accepted
  await supabase
    .from('clinic_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  redirect('/dashboard')
}
