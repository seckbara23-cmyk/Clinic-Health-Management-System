import type { SmsProviderId } from '@/types/database'

export type { SmsProviderId }

export interface SmsSendParams {
  /** Destination number in E.164 form, e.g. "+221771234567". */
  to: string
  /** Rendered message body. */
  body: string
  /** Clinic-configured alphanumeric sender / short code, if any. */
  senderId?: string | null
  /** Our sms_messages.id — passed to providers for correlation/idempotency. */
  messageId: string
  /** Owning clinic, for logging/scoping. */
  clinicId: string
}

export interface SmsSendResult {
  ok: boolean
  providerId: SmsProviderId
  /** Provider-side message id (for delivery-receipt correlation in Phase 2). */
  providerMessageId?: string | null
  /** Raw provider status string. */
  status: string
  /** Billable SMS segments, when the provider reports it. */
  segments?: number | null
  /** Cost charged by the provider, when reported. */
  costAmount?: number | null
  costCurrency?: string | null
  /** Full provider response, persisted to sms_delivery_events.payload for audit. */
  raw: unknown
  /** Present when ok = false. */
  error?: string | null
  /**
   * Whether a failure is worth retrying. Transport errors / 5xx / timeouts =
   * true; permanent rejections (invalid number, blocked, 4xx) = false.
   * Defaults to true for unknown failures so we don't silently drop messages.
   */
  retryable?: boolean
}

export interface SmsProvider {
  readonly id: SmsProviderId
  /** True when all required env credentials are present. */
  isConfigured(): boolean
  send(params: SmsSendParams): Promise<SmsSendResult>
}
