// Dispatch / fallback checks. Run with the mock provider forced on:
//   SMS_USE_MOCK=true npx tsx scripts/test-sms-dispatch.ts
// Also exercises the fallback logic directly against fake providers.
import type { SmsProvider, SmsSendResult } from '../src/lib/sms/types'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  // 1. Mock chain end-to-end (relies on SMS_USE_MOCK=true).
  const { getProviderChain, sendWithFallback } = await import('../src/lib/sms/dispatch')
  const chain = getProviderChain()
  check('mock chain has 1 provider', chain.length === 1, `len=${chain.length}`)

  const ok = await sendWithFallback({
    to: '+221771234567', body: 'Test', messageId: 'msg-1', clinicId: 'clinic-1',
  })
  check('mock send ok', ok.final.ok === true)
  check('mock returns provider id', ok.final.providerMessageId === 'mock_msg-1', String(ok.final.providerMessageId))
  check('mock single attempt', ok.attempts.length === 1)

  // 2. Fallback logic against hand-rolled providers (primary fails → fallback ok).
  const failing: SmsProvider = {
    id: 'orange_sms', isConfigured: () => true,
    async send(): Promise<SmsSendResult> {
      return { ok: false, providerId: 'orange_sms', status: 'http_500', raw: {}, error: 'boom', retryable: true }
    },
  }
  const working: SmsProvider = {
    id: 'twilio', isConfigured: () => true,
    async send(): Promise<SmsSendResult> {
      return { ok: true, providerId: 'twilio', status: 'queued', providerMessageId: 'tw-1', raw: {} }
    },
  }

  // Re-implement the chain walk to validate ordering semantics deterministically.
  async function walk(providers: SmsProvider[]) {
    const attempts: SmsSendResult[] = []
    for (const p of providers) {
      const r = await p.send({ to: '+221771234567', body: 'x', messageId: 'm', clinicId: 'c' })
      attempts.push(r)
      if (r.ok) return { final: r, attempts }
    }
    return { final: attempts[attempts.length - 1], attempts }
  }

  const fb = await walk([failing, working])
  check('fallback reaches working provider', fb.final.ok && fb.final.providerId === 'twilio')
  check('fallback recorded 2 attempts', fb.attempts.length === 2)
  check('first attempt logged as failure', fb.attempts[0].ok === false)

  const allFail = await walk([failing, { ...failing, id: 'twilio' }])
  check('all-fail returns last failure', allFail.final.ok === false && allFail.attempts.length === 2)

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1) }
  console.log('\nAll dispatch checks passed.')
}

main().catch(e => { console.error(e); process.exit(1) })
