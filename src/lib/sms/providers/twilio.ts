import type { SmsProvider, SmsSendParams, SmsSendResult } from '../types'

// ── Twilio SMS provider (fallback) ────────────────────────────────────────────
//
// Disabled by default (TWILIO_ENABLED stays false). Kept fully implemented so
// enabling it is a credentials + flag change, no code change. Auth is HTTP Basic
// (AccountSID:AuthToken); sends are form-encoded POSTs to the Messages resource.
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER        e.g. "+1..." or a messaging-service-backed sender
//
// Webhooks (status callbacks) are Phase 2 — not implemented here.

const TIMEOUT_MS = 15_000

function creds() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken:  process.env.TWILIO_AUTH_TOKEN,
    from:       process.env.TWILIO_FROM_NUMBER,
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

export const twilioProvider: SmsProvider = {
  id: 'twilio',

  isConfigured() {
    const { accountSid, authToken, from } = creds()
    return Boolean(accountSid && authToken && from)
  },

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const { accountSid, authToken, from } = creds()
    if (!accountSid || !authToken || !from) {
      return {
        ok: false, providerId: 'twilio', status: 'not_configured',
        raw: null, error: 'Twilio credentials missing', retryable: false,
      }
    }

    try {
      const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
      const form = new URLSearchParams({ To: params.to, From: from, Body: params.body })

      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      })

      const raw = await res.json().catch(() => ({}))

      if (!res.ok) {
        return {
          ok: false, providerId: 'twilio', status: `http_${res.status}`,
          raw, error: `Twilio send failed (${res.status})`,
          retryable: res.status >= 500 || res.status === 429,
        }
      }

      const r = raw as { sid?: string; num_segments?: string; price?: string; price_unit?: string; status?: string }
      return {
        ok: true,
        providerId: 'twilio',
        providerMessageId: r.sid ?? null,
        status: r.status ?? 'queued',
        segments: r.num_segments ? Number(r.num_segments) : null,
        // Twilio reports price as a negative string once known (often null at send).
        costAmount: r.price != null ? Math.abs(Number(r.price)) : null,
        costCurrency: r.price_unit ?? 'USD',
        raw,
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      return {
        ok: false, providerId: 'twilio',
        status: aborted ? 'timeout' : 'error',
        raw: null,
        error: err instanceof Error ? err.message : 'Unknown Twilio error',
        retryable: true,
      }
    }
  },
}
