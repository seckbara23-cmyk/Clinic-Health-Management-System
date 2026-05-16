import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === 'true'
const WAVE_ENABLED     = PAYMENTS_ENABLED && process.env.NEXT_PUBLIC_WAVE_ENABLED === 'true'

// POST /api/payments/wave/create-checkout
// body: { invoice_id: string }
export async function POST(req: NextRequest) {
  // ── Guard: payments disabled during pilot ──────────────────────
  if (!WAVE_ENABLED) {
    return NextResponse.json(
      { error: 'Les paiements en ligne ne sont pas encore activés. Ils seront disponibles après le programme pilote.' },
      { status: 503 }
    )
  }

  // ── Auth ───────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('clinic_id, role, is_active')
    .eq('id', user.id)
    .single()

  if (!profile?.is_active || !profile.clinic_id) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // ── Parse body ─────────────────────────────────────────────────
  const body = await req.json().catch(() => null)
  const invoiceId: string | undefined = body?.invoice_id
  if (!invoiceId) return NextResponse.json({ error: 'invoice_id requis' }, { status: 400 })

  // ── Verify invoice ownership ───────────────────────────────────
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoice } = await (service as any)
    .from('invoices')
    .select('id, total_amount, currency, status, clinic_id, payment_provider_reference')
    .eq('id', invoiceId)
    .eq('clinic_id', profile.clinic_id)
    .single() as { data: { id: string; total_amount: number; currency: string; status: string; clinic_id: string; payment_provider_reference: string | null } | null }

  if (!invoice) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })
  if (invoice.status === 'paid' || invoice.status === 'cancelled') {
    return NextResponse.json({ error: 'Facture déjà réglée ou annulée' }, { status: 409 })
  }
  if (invoice.payment_provider_reference) {
    return NextResponse.json({ error: 'Un paiement est déjà en cours pour cette facture' }, { status: 409 })
  }

  // ── Wave Checkout API (stub — not called until WAVE_ENABLED=true) ─
  // When live, replace with:
  //
  // const response = await fetch('https://api.wave.com/v1/checkout/sessions', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${process.env.WAVE_API_KEY}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     amount: Math.round(Number(invoice.total_amount)),
  //     currency: invoice.currency ?? 'XOF',
  //     error_url: process.env.WAVE_CHECKOUT_CANCEL_URL,
  //     success_url: `${process.env.WAVE_CHECKOUT_SUCCESS_URL}&invoice=${invoiceId}`,
  //     client_reference: invoiceId,
  //   }),
  // })
  // const session = await response.json()
  // if (!response.ok) throw new Error(session.message ?? 'Wave error')
  //
  // await service.from('invoices').update({
  //   payment_provider_reference: session.id,
  //   payment_status: 'pending',
  //   payment_method: 'wave',
  // }).eq('id', invoiceId)
  //
  // return NextResponse.json({ checkout_url: session.wave_launch_url })

  return NextResponse.json({ error: 'Wave non configuré' }, { status: 503 })
}
