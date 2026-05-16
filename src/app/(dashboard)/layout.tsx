import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { BottomNav } from '@/components/layout/BottomNav'
import { FloatingActionButton } from '@/components/layout/FloatingActionButton'
import { SidebarProvider } from '@/context/SidebarContext'

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

  // Single query — join clinic status so we can check it without a second round-trip
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_active, role, must_change_password, clinic_id, clinic:clinics(status)')
    .eq('id', user.id)
    .single() as {
      data: {
        is_active: boolean
        role: string
        must_change_password: boolean
        clinic_id: string | null
        clinic: { status: string } | null
      } | null
    }

  if (!profile || !profile.is_active) redirect('/suspended?reason=inactive')
  if (profile.must_change_password) redirect('/change-password')

  // Clinic-level lifecycle guard (does not apply to super_admin — they have no clinic_id)
  if (profile.clinic_id && profile.role !== 'super_admin') {
    const blockedStatuses = ['suspended', 'inactive', 'archived', 'pending']
    const clinicStatus = profile.clinic?.status ?? 'active'
    if (blockedStatuses.includes(clinicStatus)) {
      redirect(`/suspended?reason=${clinicStatus}`)
    }
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto min-w-0 pb-16 md:pb-0">
          {children}
        </main>
      </div>
      <BottomNav />
      <FloatingActionButton />
    </SidebarProvider>
  )
}
