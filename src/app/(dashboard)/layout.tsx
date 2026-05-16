import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'

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

  // Enforce is_active — inactive users (pending approval, suspended, etc.) cannot use dashboard
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_active, role')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) redirect('/suspended')

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
