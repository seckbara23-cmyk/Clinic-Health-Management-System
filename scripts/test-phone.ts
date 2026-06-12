import { normalizePhone, isValidPhone, toStoredPhone } from '../src/lib/phone'

const cases = [
  '77 123 45 67', '+221771234567', '00221 78-123-45-67', '221761234567',
  '33 821 00 00', '791234567', '12345', '+33612345678', '7712345',
  '+221 70 555 66 77', '77.123.45.67',
]
for (const c of cases) {
  console.log(JSON.stringify(c), '->', JSON.stringify(normalizePhone(c)), 'valid:', isValidPhone(c))
}
console.log('empty stored:', JSON.stringify(toStoredPhone('')), '| raw fallback:', JSON.stringify(toStoredPhone('abc')))
