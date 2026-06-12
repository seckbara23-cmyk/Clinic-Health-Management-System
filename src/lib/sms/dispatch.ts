import type { SmsProvider, SmsSendParams, SmsSendResult } from './types'
import {
  ORANGE_SMS_ENABLED, TWILIO_ENABLED, SMS_USE_MOCK, SMS_PROVIDER_ORDER,
} from './config'
import { mockProvider } from './providers/mock'
import { orangeProvider } from './providers/orange'
import { twilioProvider } from './providers/twilio'
import type { SmsProviderId } from '@/types/database'

const REGISTRY: Record<SmsProviderId, { provider: SmsProvider; enabled: boolean }> = {
  orange_sms: { provider: orangeProvider, enabled: ORANGE_SMS_ENABLED },
  twilio:     { provider: twilioProvider, enabled: TWILIO_ENABLED },
}

/**
 * Ordered list of providers to attempt: enabled AND configured, in
 * SMS_PROVIDER_ORDER (primary first, fallbacks after). When SMS_USE_MOCK is on,
 * the chain is just the mock provider so the pipeline runs without credentials.
 */
export function getProviderChain(): SmsProvider[] {
  if (SMS_USE_MOCK) return [mockProvider]
  return SMS_PROVIDER_ORDER
    .map(id => REGISTRY[id])
    .filter(entry => entry.enabled && entry.provider.isConfigured())
    .map(entry => entry.provider)
}

export interface DispatchOutcome {
  /** The result that decided the outcome (last success, or last failure). */
  final: SmsSendResult
  /** Every attempt in order — persist each as an sms_delivery_events row. */
  attempts: SmsSendResult[]
}

/**
 * Send through the provider chain, stopping at the first success. A failure that
 * is retryable falls through to the next provider; a non-retryable failure also
 * falls through (a different provider may accept the number) but is recorded.
 *
 * Returns the full attempt list so the caller can write the audit ledger and
 * decide retry scheduling. Throws only if there are no usable providers — the
 * caller treats that as a transient (retryable) condition.
 */
export async function sendWithFallback(params: SmsSendParams): Promise<DispatchOutcome> {
  const chain = getProviderChain()
  if (chain.length === 0) {
    throw new Error('No SMS provider configured')
  }

  const attempts: SmsSendResult[] = []
  for (const provider of chain) {
    const result = await provider.send(params)
    attempts.push(result)
    if (result.ok) return { final: result, attempts }
  }

  // All providers failed — final is the last attempt.
  return { final: attempts[attempts.length - 1], attempts }
}
