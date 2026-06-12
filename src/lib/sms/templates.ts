import type { SmsReminderType } from '@/types/database'

type Locale = 'fr' | 'en'

export interface ReminderTemplateInput {
  locale?: Locale
  reminderType: SmsReminderType
  clinicName: string
  patientName: string
  /** Appointment time, ISO string. */
  scheduledAt: string
}

// Senegal runs on UTC+0 (Africa/Dakar, no DST) — formatting in this zone is
// correct and stable. Kept explicit so a future multi-country move is a
// one-line change rather than a hunt for implicit local-time assumptions.
const TZ = 'Africa/Dakar'

function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-SN' : 'en-GB', {
    day: '2-digit', month: '2-digit', timeZone: TZ,
  }).format(new Date(iso))
}

function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-SN' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
  }).format(new Date(iso))
}

/**
 * Build a short appointment-reminder body. Kept terse and accent-free where
 * practical to favour single-segment GSM-7 messages (lower cost). The first
 * name only is used to keep length down and avoid over-sharing on SMS.
 */
export function buildReminderBody(input: ReminderTemplateInput): string {
  const locale = input.locale ?? 'fr'
  const date = formatDate(input.scheduledAt, locale)
  const time = formatTime(input.scheduledAt, locale)
  const firstName = input.patientName.trim().split(/\s+/)[0] ?? input.patientName

  if (locale === 'en') {
    const lead = input.reminderType === 'appointment_same_day'
      ? `Reminder: your appointment is today ${date} at ${time}`
      : `Reminder: your appointment is on ${date} at ${time}`
    return `${firstName}, ${lead} at ${input.clinicName}. To cancel, call the clinic.`
  }

  // French (default for Senegal)
  const lead = input.reminderType === 'appointment_same_day'
    ? `rappel: votre RDV est aujourd'hui ${date} a ${time}`
    : `rappel: votre RDV est le ${date} a ${time}`
  return `${firstName}, ${lead} a ${input.clinicName}. Pour annuler, appelez la clinique.`
}

/**
 * Estimate billable SMS segments for cost reporting / pre-send sanity checks.
 * GSM-7: 160 chars single, 153 per segment when concatenated. If the body
 * contains non-GSM characters we fall back to UCS-2 (70 / 67). This is an
 * estimate; the provider's reported segment count is authoritative when present.
 */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXT = '^{}\\[~]|€'

export function estimateSegments(body: string): number {
  if (body.length === 0) return 0
  let isGsm = true
  let gsmUnits = 0
  for (const ch of body) {
    if (GSM7_BASIC.includes(ch)) gsmUnits += 1
    else if (GSM7_EXT.includes(ch)) gsmUnits += 2  // escape + char
    else { isGsm = false; break }
  }
  if (isGsm) {
    return gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153)
  }
  // UCS-2 counts UTF-16 code units
  const units = [...body].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0)
  return units <= 70 ? 1 : Math.ceil(units / 67)
}
