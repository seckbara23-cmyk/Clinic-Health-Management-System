import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createHmac, timingSafeEqual } from 'crypto'

const PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === 'true'
const WAVE_ENABLED     = PAYMENTS_ENABLED && process.env.NEXT_PUBLIC_WAVE_ENABLED === 'true'

// POST /api/payments/wave/webhook
// Called by Wave when a checkout session status changes.
export async function POST(req: NextRequest) {
  if (!WAVE_ENABLED) {
    // Acknowledge receipt so Wave doesn't retry, but take no action.
    return NextResponse.json({ received: true, active: false })
  }

  // ── Signature verification ─────────────────────────────────────
  // Wave signs payloads with HMAC-SHA256 using WAVE_WEBHOOK_SECRET.
  // Header format: X-Wave-Signature: sha256=<hex>
  const secret = process.env.WAVE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[wave/webhook] WAVE_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-wave-signature') ?? ''
  const [, receivedHex] = signature.split('=')

  if (!receivedHex) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expectedHex, 'hex')
  const receivedBuf = Buffer.from(receivedHex, 'hex')

  if (
    expectedBuf.length !== receivedBuf.length ||
    !timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // ── Parse event ────────────────────────────────────────────────
  let event: Record<string, unknown>
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType   = String(event.type ?? '')
  const sessionId   = String(event.id ?? '')
  const clientRef   = String(event.client_reference ?? '')

  if (!clientRef) {
    return NextResponse.json({ received: true })  // not our invoice
  }

  const service = createServiceClient()

  // ── Find invoice by client_reference (our invoice_id) ──────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoice } = await (service as any)
    .from('invoices')
    .select('id, clinic_id, total_amount, currency, status')
    .eq('id', clientRef)
    .eq('payment_provider_reference', sessionId)
    .single() as { data: { id: string; clinic_id: string; total_amount: number; currency: string; status: string } | null }

  if (!invoice) {
    console.warn('[wave/webhook] Invoice not found for ref:', clientRef)
    return NextResponse.json({ received: true })
  }

  // ── Log the raw event ──────────────────────────────────────────
  await (service as unknown as { from: (t: string) => unknown })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(service as any)
    .from('payment_events')
    .insert({
      clinic_id:    invoice.clinic_id,
      invoice_id:   invoice.id,
      provider:     'wave',
      event_type:   eventType,
      provider_ref: sessionId,
      amount:       Number(invoice.total_amount),
      currency:     invoice.currency ?? 'XOF',
      status:       String(event.payment_status ?? ''),
      payload:      event,
      received_at:  new Date().toISOString(),
    })

  // ── Handle payment completion ──────────────────────────────────
  if (eventType === 'checkout.session.completed' && event.payment_status === 'succeeded') {
    await service
      .from('invoices')
      .update({
        status:                    'paid',
        payment_status:            'paid',
        amount_paid:               Number(invoice.total_amount),
        paid_at:                   new Date().toISOString(),
        webhook_received_at:       new Date().toISOString(),
      } as never)
      .eq('id', invoice.id)
  }

  if (event.payment_status === 'failed' || eventType === 'checkout.session.expired') {
    await service
      .from('invoices')
      .update({
        payment_status:      'failed',
        webhook_received_at: new Date().toISOString(),
      } as never)
      .eq('id', invoice.id)
  }

  return NextResponse.json({ received: true })
}
