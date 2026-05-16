import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, id')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'super_admin') return null
  return profile
}

// POST /api/admin/clinics/[id]
// body: { action: 'suspend' | 'reactivate' | 'archive' | 'set_inactive' }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clinicId } = await params
  const admin = await getSuperAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { action } = await req.json()
  const service = createServiceClient()

  // Verify clinic exists
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: clinic } = await (service as any)
    .from('clinics')
    .select('id, status, name')
    .eq('id', clinicId)
    .single()

  if (!clinic) return NextResponse.json({ error: 'Clinique introuvable' }, { status: 404 })

  if (action === 'suspend') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).from('clinics').update({ status: 'suspended' } as never).eq('id', clinicId)
    return NextResponse.json({ ok: true, status: 'suspended' })
  }

  if (action === 'set_inactive') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).from('clinics').update({ status: 'inactive' } as never).eq('id', clinicId)
    return NextResponse.json({ ok: true, status: 'inactive' })
  }

  if (action === 'reactivate') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).from('clinics').update({ status: 'active' } as never).eq('id', clinicId)
    // Reactivate all non-super_admin users in this clinic that were deactivated
    await service
      .from('user_profiles')
      .update({ is_active: true } as never)
      .eq('clinic_id', clinicId)
      .neq('role', 'super_admin')
    return NextResponse.json({ ok: true, status: 'active' })
  }

  if (action === 'archive') {
    // Soft-delete: set status=archived and deactivate all clinic users.
    // Historical data (patients, invoices, etc.) is preserved under clinic_id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).from('clinics').update({ status: 'archived' } as never).eq('id', clinicId)

    // Deactivate all clinic users so they cannot log in
    await service
      .from('user_profiles')
      .update({ is_active: false } as never)
      .eq('clinic_id', clinicId)

    return NextResponse.json({ ok: true, status: 'archived' })
  }

  return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
}
