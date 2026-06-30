import { deterministicProvider } from '../providers/deterministic'
import type { AIContext, AIProviderCompleteInput, AIToolResult } from '../types'

const ctx: AIContext = {
  role: 'doctor',
  clinicId: 'clinic-1',
  userId: 'user-1',
  page: '/patients/p1',
  patientId: 'p1',
}

function input(over: Partial<AIProviderCompleteInput>): AIProviderCompleteInput {
  return { context: ctx, toolResults: [], ...over }
}

const consult: AIToolResult = {
  toolId: 'get_patient_history',
  category: 'patient',
  dataCategory: 'consultations',
  count: 2,
  rows: [{}, {}],
  citation: { source: 'Consultation', entity: 'consultations', date: '2026-06-10', detail: '2 rows' },
  summaryLine: '2 previous consultations',
}
const labs: AIToolResult = {
  toolId: 'get_lab_results',
  category: 'lab',
  dataCategory: 'labs',
  count: 1,
  rows: [{}],
  citation: { source: 'Laboratory', entity: 'lab_order_items', date: '2026-06-15' },
  summaryLine: '1 recent lab result',
  warnings: [{ level: 'critical', message: 'Critical result present' }],
}
const rx: AIToolResult = {
  toolId: 'get_prescriptions',
  category: 'patient',
  dataCategory: 'prescriptions',
  count: 3,
  rows: [{}, {}, {}],
  citation: { source: 'Prescription', entity: 'prescriptions', date: '2026-06-15' },
  summaryLine: '3 prescriptions',
}

describe('deterministicProvider', () => {
  it('is always configured and identifies itself', () => {
    expect(deterministicProvider.id).toBe('deterministic')
    expect(deterministicProvider.isConfigured()).toBe(true)
  })

  it('composes a summary and one citation per tool result', async () => {
    const res = await deterministicProvider.complete(input({ toolResults: [consult, labs] }))
    expect(res.summary).toContain('2 previous consultations')
    expect(res.summary).toContain('1 recent lab result')
    expect(res.citations).toHaveLength(2)
    expect(res.citations[0].source).toBe('Consultation')
  })

  it('aggregates warnings from tool results', async () => {
    const res = await deterministicProvider.complete(input({ toolResults: [consult, labs] }))
    expect(res.warnings).toEqual([{ level: 'critical', message: 'Critical result present' }])
  })

  it('reports HIGH confidence with >=3 data categories', async () => {
    const res = await deterministicProvider.complete(input({ toolResults: [consult, labs, rx] }))
    expect(res.confidence.level).toBe('high')
    expect(res.confidence.basedOn).toEqual(['consultations', 'labs', 'prescriptions'])
  })

  it('reports MEDIUM confidence with 1-2 categories', async () => {
    const res = await deterministicProvider.complete(input({ toolResults: [consult] }))
    expect(res.confidence.level).toBe('medium')
  })

  it('reports LOW confidence with no data and explains why', async () => {
    const res = await deterministicProvider.complete(input({ toolResults: [] }))
    expect(res.confidence.level).toBe('low')
    expect(res.confidence.note).toBeTruthy()
  })

  it('deduplicates data categories in basedOn', async () => {
    const res = await deterministicProvider.complete(input({ toolResults: [consult, rx] }))
    // both are category 'patient' but distinct dataCategory
    expect(res.confidence.basedOn).toEqual(['consultations', 'prescriptions'])
  })

  it('refuses diagnostic questions without touching data', async () => {
    for (const q of [
      'Can you diagnose this patient?',
      "What's wrong with the patient?",
      'What treatment for this fever?',
      'Should I prescribe antibiotics?',
    ]) {
      const res = await deterministicProvider.complete(input({ message: q, toolResults: [consult] }))
      expect(res.summary).toMatch(/can't provide clinical/i)
      expect(res.citations).toHaveLength(0)
      expect(res.confidence.level).toBe('low')
    }
  })

  it('does NOT refuse ordinary data questions', async () => {
    const res = await deterministicProvider.complete(
      input({ message: "Summarize this patient's history", toolResults: [consult] }),
    )
    expect(res.summary).not.toMatch(/can't provide clinical/i)
  })

  it('is deterministic (same input → same output)', async () => {
    const a = await deterministicProvider.complete(input({ message: 'queue?', toolResults: [consult, labs] }))
    const b = await deterministicProvider.complete(input({ message: 'queue?', toolResults: [consult, labs] }))
    expect(a).toEqual(b)
  })

  it('never emits actions in Phase 1', async () => {
    const res = await deterministicProvider.complete(input({ toolResults: [consult, labs, rx] }))
    expect(res.actions).toEqual([])
  })
})
