// ── Deterministic provider ────────────────────────────────────────
//
// The default, always-available Intelligence provider. It makes NO external
// calls and applies NO clinical judgment — it deterministically composes a
// StructuredAIResponse from tool results that were already fetched under the
// user's RLS session. Because it only restates authorized, minimized data, it:
//   • can never leak unauthorized rows (it has none),
//   • produces exact citations (one per tool result),
//   • refuses diagnostic/treatment questions (revision #10, no clinical advice),
//   • is fully reproducible (same input → same output) — easy to unit test.

import type {
  AIProvider,
  AIProviderCompleteInput,
  AIWarning,
  Citation,
  StructuredAIResponse,
} from '../types'

// Questions that would require clinical judgment are out of scope and refused.
const DIAGNOSIS_PATTERNS: RegExp[] = [
  /\bdiagnos(e|is|ing)\b/i,
  /what('?s| is) wrong with\b/i,
  /what (disease|condition|illness)\b/i,
  /should i (prescribe|treat|give)\b/i,
  /\b(treatment|cure|remedy) for\b/i,
  /is (this|it) (cancer|malaria|covid|tuberculosis|diabetes)\b/i,
  /what should (the patient|they) take\b/i,
]

function looksDiagnostic(message?: string): boolean {
  if (!message) return false
  return DIAGNOSIS_PATTERNS.some((re) => re.test(message))
}

function refusal(): StructuredAIResponse {
  return {
    summary:
      "I can't provide clinical diagnoses or treatment decisions. I can summarize the records you have access to — for example a patient's history, recent results, or today's queue.",
    warnings: [
      { level: 'info', message: 'Diagnostic and treatment questions are out of scope for the Copilot.' },
    ],
    suggestions: [],
    actions: [],
    citations: [],
    confidence: { level: 'low', basedOn: [], note: 'No clinical judgment is performed by the Copilot.' },
  }
}

function confidenceFrom(basedOn: string[]): StructuredAIResponse['confidence'] {
  if (basedOn.length >= 3) return { level: 'high', basedOn }
  if (basedOn.length >= 1) return { level: 'medium', basedOn }
  return { level: 'low', basedOn, note: 'Limited data available for this request.' }
}

export const deterministicProvider: AIProvider = {
  id: 'deterministic',
  isConfigured: () => true,

  async complete(input: AIProviderCompleteInput): Promise<StructuredAIResponse> {
    const { message, toolResults } = input

    if (looksDiagnostic(message)) return refusal()

    // Distinct data categories drive both confidence and the "based on" list.
    const basedOn = [...new Set(toolResults.map((r) => r.dataCategory))]

    const citations: Citation[] = toolResults.map((r) => r.citation)
    const warnings: AIWarning[] = toolResults.flatMap((r) => r.warnings ?? [])

    let summary: string
    if (toolResults.length === 0) {
      summary =
        'I can only answer using clinic data you have access to. Try one of the suggested actions for this page.'
    } else {
      summary = toolResults
        .map((r) => r.summaryLine ?? `${r.dataCategory}: ${r.count}`)
        .join('\n')
    }

    return {
      summary,
      warnings,
      // Page-first suggestions and proposed actions are supplied by the skill
      // layer / API, not invented by the provider.
      suggestions: [],
      actions: [],
      citations,
      confidence: confidenceFrom(basedOn),
    }
  },
}
