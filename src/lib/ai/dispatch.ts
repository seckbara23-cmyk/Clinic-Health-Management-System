// ── Provider registry + selection ─────────────────────────────────
//
// Mirrors src/lib/sms/dispatch.ts. The deterministic provider is always present
// and is the safe fallback. Cloud adapters (Anthropic, OpenAI, Gemini, Azure,
// Ollama) register here in later layers; selecting one requires AI_USE_MOCK to
// be turned off AND the adapter to report isConfigured().

import type { AIProvider, AIProviderId } from './types'
import { AI_PROVIDER, AI_USE_MOCK } from './config'
import { deterministicProvider } from './providers/deterministic'

const REGISTRY: Partial<Record<AIProviderId, AIProvider>> = {
  deterministic: deterministicProvider,
  // anthropic / openai / gemini / azure_openai / ollama — added in later layers.
}

/**
 * Resolve the active provider. Returns the deterministic provider when mock mode
 * is on (the Phase 1 default) or when the selected provider is missing/unconfigured,
 * so the Copilot always has a working, no-external-call engine.
 */
export function getProvider(): AIProvider {
  if (AI_USE_MOCK) return deterministicProvider
  const selected = REGISTRY[AI_PROVIDER]
  if (selected && selected.isConfigured()) return selected
  return deterministicProvider
}

/** Exposed for diagnostics/tests. */
export function registeredProviderIds(): AIProviderId[] {
  return Object.keys(REGISTRY) as AIProviderId[]
}
