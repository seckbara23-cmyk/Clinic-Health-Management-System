import type { SmsProvider, SmsSendParams, SmsSendResult } from '../types'
import { estimateSegments } from '../templates'

// Mock provider — never touches the network. Used when SMS_USE_MOCK=true
// (local dev / CI) so the full enqueue → dispatch → audit pipeline can be
// exercised without provider credentials. It reports the provider id 'orange_sms'
// so downstream code paths are identical to production.
export const mockProvider: SmsProvider = {
  id: 'orange_sms',

  isConfigured() {
    return true
  },

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const segments = estimateSegments(params.body)
    return {
      ok: true,
      providerId: 'orange_sms',
      providerMessageId: `mock_${params.messageId}`,
      status: 'accepted',
      segments,
      costAmount: 0,
      costCurrency: 'XOF',
      raw: { mock: true, to: params.to, segments },
    }
  },
}
