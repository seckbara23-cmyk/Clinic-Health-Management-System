import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createHmac, timingSafeEqual } from 'crypto'

const PAYMENTS_ENABLED      = process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === 'true'
const ORANGE_MONEY_ENABLED  = PAYMENTS_ENABLED && process.env.NEXT_PUBLIC_ORANGE_MONEY_ENABLED === 'true'

// POST /api/payments/orange-money/webhook
// Called by Orange Money (or aggregator) when a payment status changes.
export async function POST(req: NextRequest) {
  if (!ORANGE_MONEY_ENABLED) {
    // Acknowledge receipt so the provider doesn't retry, but take no action.
    return NextResponse.json({ received: true, active: false })
  }

  // ── Signature verification ─────────────────────────────────────
  // Orange Money aggregators (e.g. PayDunya, Intouch) use HMAC-SHA256.
  // Header format varies by aggregator — adjust when integrating live.
  // Common patterns:
  //   PayDunya: X-PayDunya-Signature: <hex>
  //   Intouch:  X-Intouch-Signature: sha256=<hex>
  //
  // Using a generic ORANGE_MONEY_WEBHOOK_SECRET here.
  const secret = process.env.ORANGE_MONEY_WEBHOOK_SECRET
  if (!secret) {
    console.error('[orange-money/webhook] ORANGE_MONEY_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const rawBody = await req.text()

  // Try X-Orange-Signature first, fall back to X-Signature
  const signatureHeader =
    req.headers.get('x-orange-signature') ??
    req.headers.get('x-signature') ??
    ''

  // Support both bare hex and "sha256=<hex>" formats
  const receivedHex = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader

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

  // Aggregator-specific field mapping:
  //   Orange Business Services: { status, order_id, pay_token, ... }
  //   PayDunya: { status, invoice.token, invoice.custom_data.invoice_id, ... }
  // Using a normalized approach — adjust field names when integrating.
  const eventType  = String(event.type ?? event.status ?? '')
  const providerRef = String(event.pay_token ?? event.id ?? '')
  const invoiceId   = String(event.order_id ?? event.reference ?? event.client_reference ?? '')
  const payStatus   = String(event.status ?? '')

  if (!invoiceId) {
    return NextResponse.json({ received: true })  // not our invoice
  }

  const service = createServiceClient()

  // ── Find invoice by order_id / reference ───────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoice } = await (service as any)
    .from('invoices')
    .select('id, clinic_id, total_amount, currency, status')
    .eq('id', invoiceId)
    .single() as { data: { id: string; clinic_id: string; total_amount: number; currency: string; status: string } | null }

  if (!invoice) {
    console.warn('[orange-money/webhook] Invoice not found for ref:', invoiceId)
    return NextResponse.json({ received: true })
  }

  // ── Log the raw event ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from('payment_events')
    .insert({
      clinic_id:    invoice.clinic_id,
      invoice_id:   invoice.id,
      provider:     'orange_money',
      event_type:   eventType,
      provider_ref: providerRef || null,
      amount:       Number(invoice.total_amount),
      currency:     invoice.currency ?? 'XOF',
      status:       payStatus,
      payload:      event,
      received_at:  new Date().toISOString(),
    })

  // ── Handle payment completion ──────────────────────────────────
  // Orange Money success statuses vary by aggregator:
  //   Orange Business Services: status = 'SUCCESS'
  //   PayDunya: status = 'completed'
  const isSuccess =
    payStatus === 'SUCCESS' ||
    payStatus === 'success' ||
    payStatus === 'completed' ||
    eventType === 'payment.completed'

  if (isSuccess) {
    await service
      .from('invoices')
      .update({
        status:              'paid',
        payment_status:      'paid',
        amount_paid:         Number(invoice.total_amount),
        paid_at:             new Date().toISOString(),
        webhook_received_at: new Date().toISOString(),
      } as never)
      .eq('id', invoice.id)
  }

  const isFailure =
    payStatus === 'FAILED' ||
    payStatus === 'failed' ||
    payStatus === 'cancelled' ||
    payStatus === 'CANCELLED' ||
    eventType === 'payment.failed' ||
    eventType === 'payment.cancelled'

  if (isFailure) {
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
