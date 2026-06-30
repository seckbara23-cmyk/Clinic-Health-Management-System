import { buildAIContext, extractMessage } from '../request'
import type { CallerProfile } from '../request'

const profile: CallerProfile = { id: 'u1', role: 'doctor', clinic_id: 'c1', locale: 'fr' }

describe('buildAIContext', () => {
  it('maps profile identity and string entity ids', () => {
    const ctx = buildAIContext(profile, { page: '/patients/p1', patientId: 'p1' })
    expect(ctx).toMatchObject({
      role: 'doctor',
      clinicId: 'c1',
      userId: 'u1',
      locale: 'fr',
      page: '/patients/p1',
      patientId: 'p1',
    })
  })

  it('drops non-string entity ids (no garbage forwarded to tools)', () => {
    const ctx = buildAIContext(profile, {
      patientId: 123 as unknown,
      consultationId: { x: 1 } as unknown,
      appointmentId: '',
    })
    expect(ctx.patientId).toBeUndefined()
    expect(ctx.consultationId).toBeUndefined()
    expect(ctx.appointmentId).toBeUndefined()
  })

  it('keeps only string widgets and object filters', () => {
    const ctx = buildAIContext(profile, { widgets: ['a', 2, 'b'], filters: { status: 'waiting' } })
    expect(ctx.widgets).toEqual(['a', 'b'])
    expect(ctx.filters).toEqual({ status: 'waiting' })
  })

  it('ignores non-object filters', () => {
    const ctx = buildAIContext(profile, { filters: 'nope' })
    expect(ctx.filters).toBeUndefined()
  })

  it('never trusts client role/clinic — always from the profile', () => {
    const ctx = buildAIContext(profile, { ...({ role: 'admin', clinicId: 'evil' } as object) })
    expect(ctx.role).toBe('doctor')
    expect(ctx.clinicId).toBe('c1')
  })
})

describe('extractMessage', () => {
  it('returns a non-empty string message', () => {
    expect(extractMessage({ message: 'hello' })).toBe('hello')
  })
  it('returns undefined for empty/invalid messages', () => {
    expect(extractMessage({ message: '' })).toBeUndefined()
    expect(extractMessage({ message: 42 })).toBeUndefined()
    expect(extractMessage({})).toBeUndefined()
  })
})
