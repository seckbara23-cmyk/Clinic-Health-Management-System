// Public surface of the SMS provider abstraction.
// Phase 1: provider chain, dispatch with fallback, templates, config.
// Phase 2 will add the cron enqueue/dispatch routes and delivery webhooks.

export * from './types'
export * from './config'
export * from './templates'
export { getProviderChain, sendWithFallback } from './dispatch'
export type { DispatchOutcome } from './dispatch'
