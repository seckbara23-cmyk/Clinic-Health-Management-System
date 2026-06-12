import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { sendWithFallback } from './dispatch'
import { SMS_RETRY_BACKOFF_MIN } from './config'
import type { SmsSendResult } from './types'

type Service = SupabaseClient<Database>
type SmsRow = Database['public']['Tables']['sms_messages']['Row']

export interface DispatchSummary {
  claimed: number
  sent: number
  retried: number
  failed: number
}

/**
 * Claim a batch of due messages (atomic, lock-protected) and attempt delivery.
 * Safe to run concurrently — claim_sms_batch uses FOR UPDATE SKIP LOCKED so two
 * overlapping ticks never process the same row.
 */
export async function dispatchQueued(service: Service, now: Date, limit = 50): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0 }

  const { data: claimed, error } = await service.rpc('claim_sms_batch', { p_limit: limit })
  if (error) throw error
  const messages = (claimed ?? []) as SmsRow[]
  summary.claimed = messages.length
  if (messages.length === 0) return summary

  // Resolve clinic sender ids once for the batch.
  const clinicIds = [...new Set(messages.map(m => m.clinic_id))]
  const senderById = new Map<string, string | null>()
  const { data: clinics } = await service
    .from('clinics')
    .select('id, sms_sender_id')
    .in('id', clinicIds)
  for (const c of clinics ?? []) senderById.set(c.id, c.sms_sender_id)

  for (const m of messages) {
    const outcome = await processOne(service, m, senderById.get(m.clinic_id) ?? null, now)
    summary[outcome] += 1
  }
  return summary
}

async function processOne(
  service: Service,
  m: SmsRow,
  senderId: string | null,
  now: Date,
): Promise<'sent' | 'retried' | 'failed'> {
  let attempts: SmsSendResult[]
  let final: SmsSendResult

  try {
    const outcome = await sendWithFallback({
      to: m.to_phone, body: m.body, senderId, messageId: m.id, clinicId: m.clinic_id,
    })
    attempts = outcome.attempts
    final = outcome.final
  } catch (err) {
    // No provider configured / unavailable — transient. Requeue with backoff.
    const transient: SmsSendResult = {
      ok: false, providerId: 'orange_sms', status: 'no_provider',
      raw: null, error: err instanceof Error ? err.message : 'No provider', retryable: true,
    }
    attempts = []
    final = transient
  }

  // Append every attempt to the immutable ledger.
  for (const a of attempts) {
    await logEvent(service, m, a.ok ? 'accepted' : 'dispatch_attempt', a, now)
  }

  if (final.ok) {
    await service.from('sms_messages').update({
      status: 'sent',
      provider: final.providerId,
      provider_message_id: final.providerMessageId ?? null,
      segments: final.segments ?? m.segments,
      cost_amount: final.costAmount ?? null,
      cost_currency: final.costCurrency ?? m.cost_currency ?? 'XOF',
      sent_at: now.toISOString(),
      updated_at: now.toISOString(),
    }).eq('id', m.id)

    if (m.appointment_id) {
      await service.from('appointments')
        .update({ last_reminder_sent_at: now.toISOString() })
        .eq('id', m.appointment_id)
    }
    return 'sent'
  }

  // Failure path — retry with backoff or give up.
  const attemptsUsed = m.attempts + 1
  const retryable = final.retryable !== false
  if (retryable && attemptsUsed < m.max_attempts) {
    const idx = Math.min(attemptsUsed - 1, SMS_RETRY_BACKOFF_MIN.length - 1)
    const backoffMs = SMS_RETRY_BACKOFF_MIN[idx] * 60_000
    await service.from('sms_messages').update({
      status: 'queued',
      attempts: attemptsUsed,
      last_error: final.error ?? final.status,
      next_attempt_at: new Date(now.getTime() + backoffMs).toISOString(),
      updated_at: now.toISOString(),
    }).eq('id', m.id)
    return 'retried'
  }

  await service.from('sms_messages').update({
    status: 'failed',
    attempts: attemptsUsed,
    last_error: final.error ?? final.status,
    failed_at: now.toISOString(),
    updated_at: now.toISOString(),
  }).eq('id', m.id)
  await logEvent(service, m, 'failed', final, now)
  return 'failed'
}

async function logEvent(
  service: Service,
  m: SmsRow,
  eventType: string,
  result: SmsSendResult,
  now: Date,
): Promise<void> {
  await service.from('sms_delivery_events').insert({
    clinic_id: m.clinic_id,
    sms_message_id: m.id,
    provider: result.providerId,
    event_type: eventType,
    provider_ref: result.providerMessageId ?? null,
    status: result.status,
    payload: (result.raw ?? { error: result.error ?? null }) as Json,
    received_at: now.toISOString(),
  })
}
