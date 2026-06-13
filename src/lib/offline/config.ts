// ── Offline / cache configuration ─────────────────────────────────────────────
//
// CACHE_VERSION gates ALL offline caches. Bump it whenever the offline data
// shape, persisted query set, or service-worker shell changes — old caches are
// then discarded on next load (SW activate purges old shell caches; the query
// persister `buster` discards a stale persisted client).
//
// IMPORTANT: public/sw.js keeps its OWN copy of this number (it can't import
// from src). Bump BOTH together.
export const CACHE_VERSION = 1

// How long persisted operational data may be served offline before it is
// considered too stale to restore (decision: 24h).
export const OFFLINE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

// React-Query persister buster — any change discards the persisted cache.
export const QUERY_CACHE_BUSTER = `chms-v${CACHE_VERSION}`

// ── Allowlists ────────────────────────────────────────────────────────────────
// ONLY these query-key roots are persisted to disk. Everything else stays
// memory-only, keeping medical/billing/audit/SMS data out of IndexedDB.
export const PERSISTED_QUERY_ROOTS = [
  'appointments',      // appointments list + today's queue (same key root)
  'dashboard-stats',   // dashboard shell counters
  'patient-identity',  // dedicated minimal identity query (no clinical fields)
] as const

// Mutation keys that may be QUEUED while offline and replayed on reconnect.
// Anything not listed here must fail fast offline (never silently queue).
export const QUEUEABLE_MUTATION_KEYS = [
  'appointment.create',
  'appointment.status',
  'patient.checkin',
  'patient.call',
  'patient.demographics',
] as const

export type QueueableMutationKey = (typeof QUEUEABLE_MUTATION_KEYS)[number]

export function isPersistedQueryKey(key: readonly unknown[]): boolean {
  return typeof key[0] === 'string' && (PERSISTED_QUERY_ROOTS as readonly string[]).includes(key[0])
}

export function isQueueableMutationKey(key: readonly unknown[] | undefined): boolean {
  return !!key && typeof key[0] === 'string' && (QUEUEABLE_MUTATION_KEYS as readonly string[]).includes(key[0])
}
