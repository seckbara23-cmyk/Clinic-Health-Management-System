import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rateLimit } from '@/lib/rate-limit'

// POST /api/auth/change-password
// Called immediately after supabase.auth.updateUser() succeeds on the client.
// Does three things in parallel via service role (no extra auth round-trip):
//   1. Clears must_change_password in user_profiles
//   2. Clears must_change_password in app_metadata (prevents stale middleware checks)
//   3. Fetches role + onboarding status to determine where to redirect
// Returns { ok: true, redirect_to: '/onboarding' | '/dashboard' }
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'change-password')
  if (limited) return limited

  // Validate the current session (cannot skip — this is the security boundary)
  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (!user || userError) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  const service = createServiceClient()

  // Run all three operations in parallel to minimise latency
  const [flagResult, metaResult, profileResult] = await Promise.all([
    // 1. Clear DB flag (covers users created before migration 019)
    service
      .from('user_profiles')
      .update({ must_change_password: false } as never)
      .eq('id', user.id),

    // 2. Clear app_metadata flag (covers users created after migration 019;
    //    prevents the middleware DB check from firing on every subsequent request)
    service.auth.admin.updateUserById(user.id, {
      app_metadata: { must_change_password: false },
    }),

    // 3. Fetch role + onboarding status for redirect routing
    service
      .from('user_profiles')
      .select('role, clinic_id, clinic:clinics(onboarding_completed_at)')
      .eq('id', user.id)
      .single(),
  ])

  if (flagResult.error) {
    console.error('[change-pw API] flag update error:', flagResult.error.message)
    return NextResponse.json({ error: flagResult.error.message }, { status: 400 })
  }

  if (metaResult.error) {
    // Non-fatal: the DB flag is already cleared; log and continue
    console.error('[change-pw API] app_metadata clear error:', metaResult.error.message)
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
