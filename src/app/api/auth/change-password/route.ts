import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// POST /api/auth/change-password
// Called immediately after supabase.auth.updateUser() succeeds on the client.
// Does two things in parallel via service role (no extra auth round-trip):
//   1. Clears must_change_password flag
//   2. Fetches role + onboarding status to determine where to redirect
// Returns { ok: true, redirect_to: '/onboarding' | '/dashboard' }
export async function POST() {
  const t0 = Date.now()

  // Validate the current session (one auth check, cannot skip — security boundary)
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  console.log(`[change-pw API] getUser: ${Date.now() - t0}ms`, userError?.message ?? 'ok')

  if (!user || userError) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  const service = createServiceClient()

  // Parallel: clear flag + fetch profile (both use service role — no auth overhead)
  const t1 = Date.now()
  const [flagResult, profileResult] = await Promise.all([
    service
      .from('user_profiles')
      .update({ must_change_password: false } as never)
      .eq('id', user.id),
    service
      .from('user_profiles')
      .select('role, clinic_id, clinic:clinics(onboarding_completed_at)')
      .eq('id', user.id)
      .single(),
  ])
  console.log(`[change-pw API] parallel DB ops: ${Date.now() - t1}ms`)

  if (flagResult.error) {
    console.error('[change-pw API] flag update error:', flagResult.error.message)
    return NextResponse.json({ error: flagResult.error.message }, { status: 400 })
  }

  // Determine where to send the user
  const profile = profileResult.data as {
    role: string
    clinic_id: string | null
    clinic: { onboarding_completed_at: string | null } | null
  } | null

  const needsOnboarding =
    profile?.role === 'admin' &&
    !!profile?.clinic_id &&
    !profile?.clinic?.onboarding_completed_at

  const redirect_to = needsOnboarding ? '/onboarding' : '/dashboard'
  console.log(`[change-pw API] total: ${Date.now() - t0}ms → ${redirect_to}`)

  return NextResponse.json({ ok: true, redirect_to })
}
