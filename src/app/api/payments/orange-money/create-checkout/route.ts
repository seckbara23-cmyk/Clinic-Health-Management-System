import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const PAYMENTS_ENABLED       = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === 'true'
const ORANGE_MONEY_ENABLED   = PAYMENTS_ENABLED && process.env.NEXT_PUBLIC_ORANGE_MONEY_ENABLED === 'true'

// POST /api/payments/orange-money/create-checkout
// body: { invoice_id: string, phone: string }
export async function POST(req: NextRequest) {
  // ── Guard: payments disabled during pilot ──────────────────────
  if (!ORANGE_MONEY_ENABLED) {
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
  const phone: string | undefined     = body?.phone   // patient mobile number for OTP
  if (!invoiceId) return NextResponse.json({ error: 'invoice_id requis' }, { status: 400 })
  if (!phone)     return NextResponse.json({ error: 'Numéro de téléphone requis' }, { status: 400 })

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

  // ── Orange Money API (stub — not called until ORANGE_MONEY_ENABLED=true) ──
  //
  // Orange Money integration varies by country and aggregator.
  // For Senegal, integration typically goes through:
  //   - Orange Business Services API (direct merchant access)
  //   - An aggregator such as ECOBANK Pay, Intouch, or PayDunya
  //
  // When live, implement the OAuth 2.0 client credentials flow:
  //
  // Step 1 — Get access token:
  // const tokenRes = await fetch('https://api.orange.com/oauth/v3/token', {
  //   method: 'POST',
  //   headers: { 'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}` },
  //   body: 'grant_type=client_credentials',
  // })
  // const { access_token } = await tokenRes.json()
  //
  // Step 2 — Create payment request:
  // const payRes = await fetch(`https://api.orange.com/orange-money-webpay/dev/v1/webpayment`, {
  //   method: 'POST',
  //   headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     merchant_key: process.env.ORANGE_MONEY_MERCHANT_ID,
  //     currency: 'OUV',
  //     order_id: invoiceId,
  //     amount: Math.round(Number(invoice.total_amount)),
  //     return_url: process.env.WAVE_CHECKOUT_SUCCESS_URL,
  //     cancel_url: process.env.WAVE_CHECKOUT_CANCEL_URL,
  //     notif_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/payments/orange-money/webhook`,
  //     lang: 'fr',
  //     reference: invoiceId,
  //   }),
  // })
  //
  // Update invoice with provider_reference and payment_status = 'pending'.

  return NextResponse.json({ error: 'Orange Money non configuré' }, { status: 503 })
}
