import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rateLimit } from '@/lib/rate-limit'

// Password policy — mirrors the client-side RULES array so the admin
// API call is never attempted with a password Supabase would reject.
function validatePolicy(password: string): string | null {
  if (password.length < 8)              return 'Minimum 8 caractères requis.'
  if (!/[a-z]/.test(password))          return 'Au moins une lettre minuscule requise.'
  if (!/[A-Z]/.test(password))          return 'Au moins une lettre majuscule requise.'
  if (!/[0-9]/.test(password))          return 'Au moins un chiffre requis.'
  if (!/[^A-Za-z0-9]/.test(password))  return 'Au moins un caractère spécial requis.'
  return null
}

function translateSupabaseError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('weak') || m.includes('strength') || m.includes('policy') || m.includes('character')) {
    return 'Le mot de passe ne respecte pas la politique de sécurité.'
  }
  if (m.includes('same password') || m.includes('different from')) {
    return 'Le nouveau mot de passe doit être différent du mot de passe actuel.'
  }
  return 'Erreur lors de la mise à jour du mot de passe. Veuillez réessayer.'
}

// POST /api/auth/change-password
// Fully server-authoritative password change flow:
//   1. Authenticate current user via server-side session cookie
//   2. Validate password policy server-side
//   3. Update password via service-role admin API (avoids client-side session instability)
//   4. Clear must_change_password in user_profiles + app_metadata
//   5. Return { ok: true, redirect_to }
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'change-password')
  if (limited) return limited

  // Authenticate via server-side session (security boundary — cannot skip)
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (!user || userError) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  // Parse new password from request body
  let password: string
  try {
    const body = await req.json() as { password?: unknown }
    password = typeof body.password === 'string' ? body.password : ''
  } catch {
    return NextResponse.json({ error: 'Corps de la requête invalide.' }, { status: 400 })
  }

  // Server-side policy validation before hitting the admin API
  const policyErr = validatePolicy(password)
  if (policyErr) {
    return NextResponse.json({ error: policyErr }, { status: 422 })
  }

  const service = createServiceClient()

  // Update password via admin API — this bypasses the client JWT instability
  // that causes supabase.auth.updateUser() to hang in must_change_password sessions.
  const { error: pwError } = await service.auth.admin.updateUserById(user.id, { password })
  if (pwError) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[change-pw API] admin updateUser error:', pwError.message)
    }
    return NextResponse.json({ error: translateSupabaseError(pwError.message) }, { status: 400 })
  }

  // Clear must_change_password flags and fetch profile for redirect routing.
  // These run in parallel. Flag-clearing failures are non-fatal: the password
  // is already updated; flag cleanup is best-effort.
  const [flagResult, metaResult, profileResult] = await Promise.all([
    service
      .from('user_profiles')
      .update({ must_change_password: false } as never)
      .eq('id', user.id),

    service.auth.admin.updateUserById(user.id, {
      app_metadata: { must_change_password: false },
    }),

    service
      .from('user_profiles')
      .select('role, clinic_id, clinic:clinics!user_profiles_clinic_id_fkey(onboarding_completed_at)')
      .eq('id', user.id)
      .single(),
  ])

  if (process.env.NODE_ENV !== 'production') {
    if (flagResult.error) console.error('[change-pw API] flag clear error:', flagResult.error.message)
    if (metaResult.error) console.error('[change-pw API] app_metadata clear error:', metaResult.error.message)
  }

  const profile = profileResult.data as {
    role: string
    clinic_id: string | null
    clinic: { onboarding_completed_at: string | null } | null
  } | null

  const needsOnboarding =
    profile?.role === 'admin' &&
    !!profile?.clinic_id &&
    !profile?.clinic?.onboarding_completed_at

  return NextResponse.json({ ok: true, redirect_to: needsOnboarding ? '/onboarding' : '/dashboard' })
}
