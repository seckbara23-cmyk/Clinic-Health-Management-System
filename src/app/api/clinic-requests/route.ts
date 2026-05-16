import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { clinic_name, location, phone, admin_full_name, admin_email, message } = body

  // Basic server-side validation
  if (!clinic_name || !location || !admin_full_name || !admin_email) {
    return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin_email)) {
    return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
  }

  const service = createServiceClient()

  // Guard: reject duplicate pending request for same email
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from('clinic_requests')
    .select('id, status')
    .eq('admin_email', admin_email.toLowerCase().trim())
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'Une demande est déjà en attente pour cet email. Notre équipe vous contactera bientôt.' },
      { status: 409 }
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from('clinic_requests').insert({
    clinic_name:     clinic_name.trim(),
    location:        location.trim(),
    phone:           phone?.trim() || null,
    admin_full_name: admin_full_name.trim(),
    admin_email:     admin_email.toLowerCase().trim(),
    message:         message?.trim() || null,
    status:          'pending',
  })

  if (error) {
    console.error('[clinic-requests] insert error:', error.message)
    return NextResponse.json({ error: 'Erreur serveur. Réessayez.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
