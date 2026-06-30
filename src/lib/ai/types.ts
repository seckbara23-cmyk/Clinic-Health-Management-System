// ════════════════════════════════════════════════════════════════
// CHMS Intelligence Platform — core types
// ════════════════════════════════════════════════════════════════
//
// This is the foundation for the Intelligence Platform, not just "AI chat".
// Roadmap layers (only Layer 1 is implemented):
//   L1 Read-only Copilot   ← Phase 1 (this code)
//   L2 AI Drafting
//   L3 Assisted Actions
//   L4 Predictive Analytics
//   L5 Workflow Automation (human approval required)
//
// Hard rules carried in the type system:
//   • Providers return a STRUCTURED response (not raw markdown) so the UI can
//     render cards/warnings/actions/citations/confidence.
//   • Every tool declares metadata (roles, writesData, required context) so the
//     same registry powers future Assisted Actions — but in Phase 1 no tool
//     writes and no action executes.
//   • Data access is never the model's authority; tools run under the user's
//     RLS session. See context-builder (Milestone 2).

import type { Role } from '@/types/database'

// ── Providers (revision #7: fully interchangeable) ────────────────
export type AIProviderId =
  | 'deterministic'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'azure_openai'
  | 'ollama'

// ── Structured response (revisions #4, #5, #8) ────────────────────
export type AIConfidenceLevel = 'high' | 'medium' | 'low'
export type AIWarningLevel = 'info' | 'warning' | 'critical'

/** Explainability: where a piece of information came from (revision #8). */
export interface Citation {
  /** Human-readable label, e.g. 'Consultation', 'Queue'. */
  source: string
  /** Internal entity/table key, e.g. 'consultations'. */
  entity?: string
  entityId?: string
  /** ISO date the data is from, or the as-of timestamp of the read. */
  date?: string
  /** Short scope note, e.g. '5 rows · clinic-scoped'. */
  detail?: string
}

export interface AIWarning {
  level: AIWarningLevel
  message: string
}

/** A suggested next prompt/action surfaced before the user types (revision #1). */
export interface AISuggestion {
  id: string
  label: string
  /** Prompt sent to the Copilot when the suggestion is chosen. */
  prompt?: string
  /** Optional skill this suggestion belongs to. */
  skillId?: string
}

/**
 * A proposed action (revision #9, future workflow engine). In Phase 1 actions
 * are descriptive only: writesData is always false and requiresConfirmation is
 * always true — nothing executes, ever, without an explicit human step in a
 * later layer.
 */
export interface AIAction {
  id: string
  label: string
  toolId?: string
  writesData: boolean
  requiresConfirmation: boolean
  status: 'draft'
  payload?: Record<string, unknown>
}

/** Confidence metadata (revision #5). */
export interface AIConfidence {
  level: AIConfidenceLevel
  /** Data categories the answer is based on, e.g. ['consultations','labs']. */
  basedOn: string[]
  note?: string
}

/** The single response shape every provider must return (revision #4). */
export interface StructuredAIResponse {
  summary: string
  warnings: AIWarning[]
  suggestions: AISuggestion[]
  actions: AIAction[]
  citations: Citation[]
  confidence: AIConfidence
}

// ── Context (revision #2: page-first + entity-aware) ──────────────
export interface AIContext {
  role: Role
  clinicId: string
  userId: string
  locale?: string
  /** Current route, e.g. '/queue', '/patients/[id]'. */
  page?: string
  // Entity context — so the user never re-explains what they're looking at.
  patientId?: string
  consultationId?: string
  appointmentId?: string
  invoiceId?: string
  prescriptionId?: string
  labOrderId?: string
  pharmacyOrderId?: string
  /** Active list filters on the current page. */
  filters?: Record<string, unknown>
  /** Dashboard widgets currently visible. */
  widgets?: string[]
}

// ── Tool registry metadata (revision #6) ──────────────────────────
export type AIToolCategory =
  | 'queue'
  | 'appointments'
  | 'patient'
  | 'lab'
  | 'pharmacy'
  | 'billing'
  | 'analytics'

/**
 * Static description of a tool. The framework already models write actions and
 * required context so Layer 3 (Assisted Actions) can reuse this exact registry;
 * Phase 1 only ever registers tools with writesData = false.
 */
export interface AIToolMetadata {
  id: string
  category: AIToolCategory
  roles: Role[]
  writesData: boolean
  requiresPatientContext: boolean
  requiresAppointmentContext: boolean
  requiresConsultationContext: boolean
  description: string
}

/** Output of a tool run — already RLS-filtered and minimized. */
export interface AIToolResult {
  toolId: string
  category: AIToolCategory
  /** Category label used for audit logging and confidence.basedOn. */
  dataCategory: string
  count: number
  rows: unknown[]
  citation: Citation
  /** Optional one-line human summary the provider can stitch together. */
  summaryLine?: string
  /** Warnings derived from the data (e.g. critical lab result present). */
  warnings?: AIWarning[]
}

// ── Skills (revision #3: independent role copilots) ───────────────
export interface AISkill {
  id: string
  label: string
  roles: Role[]
  /** Tool ids this skill is permitted to use. */
  toolIds: string[]
  /** Page-first suggested prompts for this skill. */
  suggestedPrompts: AISuggestion[]
}

// ── Provider contract ─────────────────────────────────────────────
export interface AIProviderCompleteInput {
  context: AIContext
  /** The user's free-text message, if any (page-first flows may omit it). */
  message?: string
  /** Results of the read-only tools selected for this turn. */
  toolResults: AIToolResult[]
}

export interface AIProvider {
  readonly id: AIProviderId
  /** True when required credentials/config are present. */
  isConfigured(): boolean
  /** Compose a structured response from already-authorized tool results. */
  complete(input: AIProviderCompleteInput): Promise<StructuredAIResponse>
}

// ── Tools ─────────────────────────────────────────────────────────
// A tool is metadata + a run() that executes a single read-only query. The
// client is INJECTED by the context builder (the user's RLS session) — tools
// never import a Supabase client themselves, so RLS is always in force and the
// tools stay unit-testable with a stub. Importing the service-role client
// anywhere under src/lib/ai is forbidden and guard-tested.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/** Anon-key client bound to the caller's cookies → all queries run under RLS. */
export type RlsClient = SupabaseClient<Database>

export interface AITool extends AIToolMetadata {
  run(db: RlsClient, ctx: AIContext): Promise<AIToolResult>
}
