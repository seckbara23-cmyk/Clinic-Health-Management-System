// Senegal phone validation & normalization (+221).
//
// Senegal numbering plan: 9 national digits.
//   Mobile: 70 / 75 / 76 / 77 / 78 (Orange, Free, Expresso, ProMobile)
//   Fixed:  33 / 30
// Foreign numbers are accepted when entered with an explicit "+<cc>"
// prefix (clinics near borders see Gambian/Malian/Mauritanian patients),
// but only Senegal numbers are strictly validated and formatted.

const SN_PREFIXES = /^(7[05678]|3[03])/

/** Strip spaces, dots, dashes and parentheses; keep digits and leading +. */
function stripFormatting(raw: string): string {
  const cleaned = raw.replace(/[\s.\-()]/g, '')
  return cleaned.startsWith('+') ? '+' + cleaned.slice(1).replace(/\D/g, '') : cleaned.replace(/\D/g, '')
}

/** Extract the 9 national digits from any accepted Senegal spelling, or null. */
function senegalNationalDigits(raw: string): string | null {
  const s = stripFormatting(raw)
  let digits: string | null = null
  if (s.startsWith('+221')) digits = s.slice(4)
  else if (s.startsWith('00221')) digits = s.slice(5)
  else if (s.startsWith('221') && s.length === 12) digits = s.slice(3)
  else if (/^\d{9}$/.test(s)) digits = s
  if (digits && /^\d{9}$/.test(digits) && SN_PREFIXES.test(digits)) return digits
  return null
}

/**
 * Normalize a phone number to canonical display form:
 *   Senegal  → "+221 77 123 45 67"
 *   Foreign  → "+<digits>" (must start with +, 8–15 digits)
 * Returns null when the input cannot be a valid number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  const national = senegalNationalDigits(raw)
  if (national) {
    return `+221 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5, 7)} ${national.slice(7, 9)}`
  }
  const s = stripFormatting(raw)
  if (s.startsWith('+') && !s.startsWith('+221') && /^\+\d{8,15}$/.test(s)) return s
  return null
}

/** True when empty (optional field) or normalizable. Use in Zod .refine(). */
export function isValidPhone(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return true
  return normalizePhone(raw) !== null
}

/**
 * Normalize for storage: empty → null, valid → canonical form, anything
 * else → trimmed input. Falling back to the raw value (instead of null)
 * means a caller that skipped validation can never silently lose data.
 */
export function toStoredPhone(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  return normalizePhone(trimmed) ?? trimmed
}
