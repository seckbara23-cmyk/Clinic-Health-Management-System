import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { FloatingActionButton } from '@/components/layout/FloatingActionButton'
import { ConnectionBanner } from '@/components/offline/ConnectionBanner'
import { Copilot } from '@/components/ai/Copilot'
import { TenantBoundary } from '@/components/layout/TenantBoundary'
import { SidebarProvider } from '@/context/SidebarContext'
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

  // Single query — the FULL profile + clinic. This resolves the tenant on the
  // server (we already redirect if it's missing), then seeds the client tenant
  // context so authenticated users never render a generic/null shell on refresh.
  const { data: full } = await supabase
    .from('user_profiles')
    .select('*, clinic:clinics(*)')
    .eq('id', user.id)
    .single() as { data: (UserProfile & { clinic: Clinic | null }) | null }

  if (!full || !full.is_active) redirect('/suspended?reason=inactive')
  if (full.must_change_password) redirect('/change-password')

  const { clinic, ...profile } = full as UserProfile & { clinic: Clinic | null }

  // Clinic-level lifecycle guard (does not apply to super_admin — no clinic_id)
  if (profile.clinic_id && profile.role !== 'super_admin') {
    const blockedStatuses = ['suspended', 'inactive', 'archived', 'pending']
    const clinicStatus = clinic?.status ?? 'active'
    if (blockedStatuses.includes(clinicStatus)) {
      redirect(`/suspended?reason=${clinicStatus}`)
    }
  }

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
      </SidebarProvider>
    </TenantBoundary>
  )
}
