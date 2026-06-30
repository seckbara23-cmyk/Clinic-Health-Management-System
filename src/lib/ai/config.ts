// ── CHMS Intelligence Platform — feature flags (server-only) ──────
//
// No NEXT_PUBLIC_ prefix: these gate server behavior and must never be bundled
// to the client. The Copilot stays fully dormant until AI_ENABLED is set, so
// shipping this code changes nothing in production by default.
//
// Provider selection mirrors the SMS abstraction: a master switch plus a
// selected provider, with the deterministic provider as the always-available
// fallback that needs no credentials and makes no external calls.

import type { AIProviderId } from './types'

/** Master switch. When false, the Copilot UI and API are inert. */
export const AI_ENABLED = process.env.AI_ENABLED === 'true'

/**
 * Force the local deterministic provider regardless of AI_PROVIDER. Defaults to
 * TRUE so Phase 1 runs with zero external LLM calls (no data leaves CHMS) until
 * a cloud adapter is explicitly provisioned and this is set to 'false'.
 */
export const AI_USE_MOCK = process.env.AI_USE_MOCK !== 'false'

/** Selected provider for when AI_USE_MOCK is disabled (later layers). */
export const AI_PROVIDER = (process.env.AI_PROVIDER ?? 'deterministic') as AIProviderId

/**
 * Whether to persist raw prompt/response text in ai_messages. Defaults to false
 * — only redacted metadata + data categories are stored unless explicitly
 * enabled for debugging.
 */
export const AI_LOG_RAW = process.env.AI_LOG_RAW === 'true'

/** Fallback order when a selected cloud provider is unconfigured (future). */
export const AI_PROVIDER_ORDER: AIProviderId[] = [
  'anthropic',
  'openai',
  'gemini',
  'azure_openai',
  'ollama',
]
