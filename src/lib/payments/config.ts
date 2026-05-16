// ── Payment feature flags ─────────────────────────────────────────────────────
// NEXT_PUBLIC_ prefix means these are safe in both client and server bundles.
// They are set to false until explicit post-pilot go-live approval.

export const PAYMENTS_ENABLED =
  process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === 'true'

export const WAVE_ENABLED =
  PAYMENTS_ENABLED && process.env.NEXT_PUBLIC_WAVE_ENABLED === 'true'

export const ORANGE_MONEY_ENABLED =
  PAYMENTS_ENABLED && process.env.NEXT_PUBLIC_ORANGE_MONEY_ENABLED === 'true'

// ── Provider metadata (safe to read client-side — no secrets) ─────────────────
export interface PaymentProvider {
  id: 'wave' | 'orange_money'
  label: string
  description: string
  icon: string          // emoji or short code — real SVG handled in UI
  enabled: boolean
  color: string
}

export const PAYMENT_PROVIDERS: PaymentProvider[] = [
  {
    id: 'wave',
    label: 'Wave',
    description: 'Paiement mobile via Wave',
    icon: 'W',
    enabled: WAVE_ENABLED,
    color: 'bg-blue-500',
  },
  {
    id: 'orange_money',
    label: 'Orange Money',
    description: 'Paiement mobile via Orange Money',
    icon: 'OM',
    enabled: ORANGE_MONEY_ENABLED,
    color: 'bg-orange-500',
  },
]

// ── Server-only helpers (access inline in API routes, not from this module) ───
// WAVE_API_KEY            → process.env.WAVE_API_KEY
// WAVE_WEBHOOK_SECRET     → process.env.WAVE_WEBHOOK_SECRET
// ORANGE_MONEY_CLIENT_ID  → process.env.ORANGE_MONEY_CLIENT_ID
// etc.
// These are listed here as a reference only — import them directly in route handlers.
