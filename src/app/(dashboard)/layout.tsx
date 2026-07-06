import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { FloatingActionButton } from '@/components/layout/FloatingActionButton'
import { ConnectionBanner } from '@/components/offline/ConnectionBanner'
import { Copilot } from '@/components/ai/Copilot'
import { ReliabilityReporter } from '@/components/reliability/ReliabilityReporter'
import { TenantBoundary } from '@/components/layout/TenantBoundary'
import { SidebarProvider } from '@/context/SidebarContext'
import { classifyProfileAccess } from '@/lib/auth/access'
import type { Clinic, UserProfile } from '@/types/database'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error) {
    console.error('[DashboardLayout] auth.getUser error:', {
      message: error.message,
      status:  error.status,
    })
  }

  if (!user) redirect('/login')

  // Single query — the FULL profile + clinic. Resolves the tenant on the server
  // and seeds the client tenant context so authenticated users never render a
  // generic/null shell on refresh.
  //
  // The clinic embed is pinned to the DIRECT foreign key
  // (user_profiles_clinic_id_fkey). Migration 037 (user_preferences) made
  // user_profiles↔clinics ambiguous for PostgREST — without the hint this query
  // fails with PGRST201, which previously collapsed into reason=inactive (P0
  // lockout). maybeSingle() keeps "no row" distinct from "query error".
  const { data: full, error: profileError } = await supabase
    .from('user_profiles')
    .select('*, clinic:clinics!user_profiles_clinic_id_fkey(*)')
    .eq('id', user.id)
    .maybeSingle() as { data: (UserProfile & { clinic: Clinic | null }) | null; error: { code?: string; message?: string; details?: string; hint?: string } | null }

  if (profileError) {
    console.error('[DashboardLayout] profile query failed:', {
      code: profileError.code, message: profileError.message,
      details: profileError.details, hint: profileError.hint,
    })
  }

  const clinic: Clinic | null = full?.clinic ?? null

  // Distinct access states — a lookup error is never treated as "inactive".
  const decision = classifyProfileAccess({
    hasUser: true,
    hadQueryError: !!profileError,
    profile: full
      ? { is_active: full.is_active, must_change_password: full.must_change_password, clinic_id: full.clinic_id, role: full.role }
      : null,
    clinicStatus: clinic?.status ?? null,
  })
  if (!decision.allow) redirect(decision.redirect)

  // Safe here: decision.allow implies a fetched, active profile.
  const { clinic: _omit, ...profile } = full as UserProfile & { clinic: Clinic | null }
  void _omit

  return (
    <TenantBoundary initialProfile={profile as UserProfile} initialClinic={clinic ?? null}>
      <SidebarProvider>
        <ConnectionBanner />
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto min-w-0 pb-16 md:pb-0">
            {children}
          </main>
        </div>
        <BottomNav />
        <FloatingActionButton />
        <Copilot />
        {/* Invisible: captures uncaught client errors for platform reliability
            monitoring (Phase 15.0B). Renders nothing; never throws. */}
        <ReliabilityReporter />
      </SidebarProvider>
    </TenantBoundary>
  )
}
