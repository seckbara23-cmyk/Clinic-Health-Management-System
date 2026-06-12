import type { SmsProvider, SmsSendParams, SmsSendResult } from '../types'
import { estimateSegments } from '../templates'

// ── Orange SMS provider (primary) ─────────────────────────────────────────────
//
// Orange exposes SMS via the Orange Developer "SMS API" (Sonatel/Orange Senegal).
// Auth is OAuth2 client-credentials → Bearer token; sends are POSTs to the
// outbound-messages endpoint. Credentials come from env (never bundled):
//   ORANGE_SMS_CLIENT_ID
//   ORANGE_SMS_CLIENT_SECRET
//   ORANGE_SMS_SENDER_ADDRESS   e.g. "tel:+221770000000" or an approved sender
//   ORANGE_SMS_TOKEN_URL        (optional override; defaults below)
//   ORANGE_SMS_BASE_URL         (optional override; defaults below)
//
// Webhooks (delivery receipts) are Phase 2 — not implemented here.

const TOKEN_URL = process.env.ORANGE_SMS_TOKEN_URL ?? 'https://api.orange.com/oauth/v3/token'
const BASE_URL  = process.env.ORANGE_SMS_BASE_URL  ?? 'https://api.orange.com/smsmessaging/v1'
const TIMEOUT_MS = 15_000

function creds() {
  return {
    clientId:     process.env.ORANGE_SMS_CLIENT_ID,
    clientSecret: process.env.ORANGE_SMS_CLIENT_SECRET,
    sender:       process.env.ORANGE_SMS_SENDER_ADDRESS,
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`Orange token error ${res.status}`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('Orange token: no access_token in response')
  return json.access_token
}

export const orangeProvider: SmsProvider = {
  id: 'orange_sms',

  isConfigured() {
    const { clientId, clientSecret, sender } = creds()
    return Boolean(clientId && clientSecret && sender)
  },

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const { clientId, clientSecret, sender } = creds()
    if (!clientId || !clientSecret || !sender) {
      return {
        ok: false, providerId: 'orange_sms', status: 'not_configured',
        raw: null, error: 'Orange SMS credentials missing', retryable: false,
      }
    }

    try {
      const token = await getAccessToken(clientId, clientSecret)

      // The sender address is part of the path, URL-encoded.
      const senderAddress = sender.startsWith('tel:') ? sender : `tel:${sender}`
      const url = `${BASE_URL}/outbound/${encodeURIComponent(senderAddress)}/requests`

      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          outboundSMSMessageRequest: {
            address: `tel:${params.to}`,
            senderAddress,
            ...(params.senderId ? { senderName: params.senderId } : {}),
            outboundSMSTextMessage: { message: params.body },
          },
        }),
      })

      const raw = await res.json().catch(() => ({}))

      if (!res.ok) {
        return {
          ok: false, providerId: 'orange_sms', status: `http_${res.status}`,
          raw, error: `Orange send failed (${res.status})`,
          // 4xx = permanent (bad number/auth); 5xx & 429 = retry.
          retryable: res.status >= 500 || res.status === 429,
        }
      }

      // Orange returns the created resource; the message id is in the
      // resourceURL tail. Best-effort extraction for receipt correlation.
      const resourceUrl =
        (raw as { outboundSMSMessageRequest?: { resourceURL?: string } })
          ?.outboundSMSMessageRequest?.resourceURL ?? null
      const providerMessageId = resourceUrl ? resourceUrl.split('/').pop() ?? null : null

      return {
        ok: true,
        providerId: 'orange_sms',
        providerMessageId,
        status: 'accepted',
        segments: estimateSegments(params.body),
        costCurrency: 'XOF',
        raw,
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      return {
        ok: false, providerId: 'orange_sms',
        status: aborted ? 'timeout' : 'error',
        raw: null,
        error: err instanceof Error ? err.message : 'Unknown Orange error',
        retryable: true,  // transport-level failures are worth retrying
      }
    }
  },
}
