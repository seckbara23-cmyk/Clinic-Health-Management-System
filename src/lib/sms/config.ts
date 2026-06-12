import type { SmsProviderId } from '@/types/database'

// ── SMS feature flags (server-only — no NEXT_PUBLIC_ prefix; never bundled) ──
//
// Master switch plus per-provider switches. Orange is the primary provider and
// the one to enable first; Twilio is the fallback and stays off until its
// credentials are provisioned. SMS_USE_MOCK forces the mock provider for local
// dev / CI regardless of the others.
//
// Required env per provider (see deployment checklist):
//   Orange : ORANGE_SMS_CLIENT_ID, ORANGE_SMS_CLIENT_SECRET, ORANGE_SMS_SENDER_ADDRESS
//   Twilio : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
//   Cron   : CRON_SECRET (used by the Phase-2 cron route, listed here for reference)

export const SMS_ENABLED        = process.env.SMS_ENABLED === 'true'
export const ORANGE_SMS_ENABLED = SMS_ENABLED && process.env.ORANGE_SMS_ENABLED === 'true'
export const TWILIO_ENABLED     = SMS_ENABLED && process.env.TWILIO_ENABLED === 'true'

// Dev/CI: use the no-op mock provider instead of calling a real API.
export const SMS_USE_MOCK = process.env.SMS_USE_MOCK === 'true'

// Try providers in this order; the first configured+enabled one is primary,
// the rest are fallbacks attempted in sequence within a single dispatch.
export const SMS_PROVIDER_ORDER: SmsProviderId[] = ['orange_sms', 'twilio']

// Retry backoff schedule (minutes) indexed by attempt number. After the last
// entry is exhausted the message is marked failed.
export const SMS_RETRY_BACKOFF_MIN = [2, 10, 30]

// Provider metadata for UI / reporting (no secrets — safe to surface).
export interface SmsProviderMeta {
  id: SmsProviderId
  label: string
  enabled: boolean
}

export const SMS_PROVIDERS_META: SmsProviderMeta[] = [
  { id: 'orange_sms', label: 'Orange SMS', enabled: ORANGE_SMS_ENABLED },
  { id: 'twilio',     label: 'Twilio',     enabled: TWILIO_ENABLED },
]
