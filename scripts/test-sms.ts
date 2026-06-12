// Phase-1 SMS unit checks. Run: npx tsx scripts/test-sms.ts
// Exits non-zero on any failure so it can gate CI.
import { toE164 } from '../src/lib/phone'
import { buildReminderBody, estimateSegments } from '../src/lib/sms/templates'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  if (!cond) failures++
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── toE164 ───────────────────────────────────────────────────────────────────
check('toE164 spaced SN mobile', toE164('77 123 45 67') === '+221771234567', String(toE164('77 123 45 67')))
check('toE164 already +221',     toE164('+221771234567') === '+221771234567')
check('toE164 fixed line',       toE164('33 821 00 00') === '+221338210000', String(toE164('33 821 00 00')))
check('toE164 00221 prefix',     toE164('00221 78-123-45-67') === '+221781234567')
check('toE164 foreign kept',     toE164('+33612345678') === '+33612345678')
check('toE164 invalid → null',   toE164('79 123 45 67') === null)   // 79 not a valid SN prefix
check('toE164 too short → null', toE164('7712345') === null)
check('toE164 empty → null',     toE164('') === null)

// ── template body ────────────────────────────────────────────────────────────
const at = '2026-06-13T14:30:00.000Z' // UTC == Africa/Dakar
const fr24 = buildReminderBody({ reminderType: 'appointment_24h', clinicName: 'Clinique Dakar', patientName: 'Awa Diop', scheduledAt: at })
const frSame = buildReminderBody({ reminderType: 'appointment_same_day', clinicName: 'Clinique Dakar', patientName: 'Awa Diop', scheduledAt: at })
const en24 = buildReminderBody({ locale: 'en', reminderType: 'appointment_24h', clinicName: 'Dakar Clinic', patientName: 'Awa Diop', scheduledAt: at })

console.log('  FR 24h   :', fr24)
console.log('  FR same  :', frSame)
console.log('  EN 24h   :', en24)
check('FR body has date 13/06', fr24.includes('13/06'))
check('FR body has time 14:30', fr24.includes('14:30'))
check('FR body first name only', fr24.startsWith('Awa,') && !fr24.includes('Diop'))
check('FR same-day says aujourd', frSame.includes("aujourd'hui"))
check('EN body present',         en24.includes('13/06') && en24.includes('14:30'))

// ── segment estimation ───────────────────────────────────────────────────────
check('segments empty = 0',  estimateSegments('') === 0)
check('segments short = 1',  estimateSegments('Bonjour') === 1)
check('segments 160 = 1',    estimateSegments('a'.repeat(160)) === 1)
check('segments 161 = 2',    estimateSegments('a'.repeat(161)) === 2)
check('segments unicode',    estimateSegments('😀'.repeat(40)) >= 2)  // UCS-2 path
check('real FR body 1 seg',  estimateSegments(fr24) === 1, `len=${fr24.length} seg=${estimateSegments(fr24)}`)

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll SMS Phase-1 checks passed.')
