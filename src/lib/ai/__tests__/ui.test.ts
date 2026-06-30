import { confidenceVariant, warningVariant, parsePageContext, summarizeInsights, AI_UI_ENABLED } from '../ui'
import type { AIToolResult } from '../types'

describe('AI UI helpers', () => {
  it('AI_UI_ENABLED is off by default', () => {
    expect(AI_UI_ENABLED).toBe(false)
  })

  it('maps confidence levels to badge variants', () => {
    expect(confidenceVariant('high')).toBe('success')
    expect(confidenceVariant('medium')).toBe('info')
    expect(confidenceVariant('low')).toBe('secondary')
  })

  it('maps warning levels to badge variants', () => {
    expect(warningVariant('critical')).toBe('destructive')
    expect(warningVariant('warning')).toBe('warning')
    expect(warningVariant('info')).toBe('info')
  })

  it('extracts patientId from a patient detail route', () => {
    const id = '11111111-1111-1111-1111-111111111111'
    const ctx = parsePageContext(`/patients/${id}`)
    expect(ctx.page).toBe(`/patients/${id}`)
    expect(ctx.patientId).toBe(id)
  })

  it('extracts consultationId from a consultation detail route', () => {
    const id = '22222222-2222-2222-2222-222222222222'
    expect(parsePageContext(`/consultations/${id}`).consultationId).toBe(id)
  })

  it('ignores non-uuid segments (e.g. /patients without id, /patients/new)', () => {
    expect(parsePageContext('/patients').patientId).toBeUndefined()
    expect(parsePageContext('/patients/new').patientId).toBeUndefined()
    expect(parsePageContext('/queue').page).toBe('/queue')
  })

  it('summarizeInsights counts cards and flags criticals', () => {
    const base = (warnings: AIToolResult['warnings']): AIToolResult => ({
      toolId: 't', category: 'lab', dataCategory: 'labs', count: 1, rows: [],
      citation: { source: 'Lab' }, warnings,
    })
    expect(summarizeInsights([])).toEqual({ count: 0, hasCritical: false })
    expect(summarizeInsights([base([]), base([{ level: 'warning', message: 'x' }])]))
      .toEqual({ count: 2, hasCritical: false })
    expect(summarizeInsights([base([{ level: 'critical', message: 'x' }])]))
      .toEqual({ count: 1, hasCritical: true })
  })
})
