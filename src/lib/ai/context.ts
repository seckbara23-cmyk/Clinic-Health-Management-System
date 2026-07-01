// ── Context builder / orchestrator ────────────────────────────────
//
// Ties the read path together for one Copilot turn:
//   1. create the RLS client (anon key + the caller's cookies) — NEVER service,
//   2. select role + context-permitted read-only tools,
//   3. run them under RLS (per-tool try/catch so one failure can't break the turn),
//   4. let the provider compose a structured response,
//   5. attach the role skill's page-first suggestions,
//   6. return the response + audit metadata (tools used, data categories).
//
// This module imports the server client and therefore runs only in a request
// context (API route). Pure selection logic lives in ./tools and ./skills and
// is unit-tested separately.

import { createClient } from '@/lib/supabase/server'
import type {
  AIContext,
  AIToolCategory,
  AIToolResult,
  DraftData,
  DraftType,
  StructuredAIResponse,
  StructuredDraft,
} from './types'
import { selectToolsForContext } from './tools'
import { skillForRole } from './skills'
import { getProvider } from './dispatch'
import { buildDraft } from './drafts'

export interface CopilotResult {
  response: StructuredAIResponse
  meta: {
    toolsUsed: string[]
    dataCategories: string[]
    provider: string
  }
}

export async function runCopilot(ctx: AIContext, message?: string): Promise<CopilotResult> {
  const db = await createClient()

  const tools = selectToolsForContext(ctx)
  const toolResults: AIToolResult[] = []
  for (const tool of tools) {
    try {
      toolResults.push(await tool.run(db, ctx))
    } catch (err) {
      // A single tool failing (e.g. a missing optional table) must not break the
      // turn; it simply contributes no data. Never surfaces raw errors to the model.
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[ai] tool ${tool.id} failed`, err)
      }
    }
  }

  const provider = getProvider()
  const response = await provider.complete({ context: ctx, message, toolResults })

  // Page-first suggestions come from the role skill, not the model.
  const skill = skillForRole(ctx.role)
  response.suggestions = skill?.suggestedPrompts ?? []

  return {
    response,
    meta: {
      toolsUsed: toolResults.map((r) => r.toolId),
      dataCategories: [...new Set(toolResults.map((r) => r.dataCategory))],
      provider: provider.id,
    },
  }
}

export interface InsightsResult {
  /** Per-tool results so the UI can render one insight card each (with its own
      citation + warnings). */
  results: AIToolResult[]
  /** Aggregate response — used for the panel's overall confidence/warnings. */
  response: StructuredAIResponse
  meta: {
    toolsUsed: string[]
    dataCategories: string[]
    provider: string
  }
}

/**
 * Embedded page intelligence (Phase 2). Same read-only, RLS-scoped, role-gated
 * path as runCopilot but message-less and returns the per-tool results so each
 * page can render compact insight cards. No writes, no external calls.
 */
export async function runInsights(
  ctx: AIContext,
  categories?: AIToolCategory[],
): Promise<InsightsResult> {
  const db = await createClient()

  // Role + entity-context gated, then optionally narrowed to a page's categories
  // (e.g. the pharmacy panel only runs pharmacy tools). RLS remains the backstop.
  let tools = selectToolsForContext(ctx)
  if (categories && categories.length > 0) {
    tools = tools.filter((t) => categories.includes(t.category))
  }
  const results: AIToolResult[] = []
  for (const tool of tools) {
    try {
      results.push(await tool.run(db, ctx))
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[ai] insight tool ${tool.id} failed`, err)
      }
    }
  }

  const provider = getProvider()
  const response = await provider.complete({ context: ctx, toolResults: results })

  return {
    results,
    response,
    meta: {
      toolsUsed: results.map((r) => r.toolId),
      dataCategories: [...new Set(results.map((r) => r.dataCategory))],
      provider: provider.id,
    },
  }
}

// ── Assisted drafting (Layer 3) ───────────────────────────────────
export interface DraftResult {
  draft: StructuredDraft
  meta: { dataCategories: string[]; provider: string }
}

/**
 * Gather existing structured data (under RLS) and compose a deterministic draft.
 * READ-ONLY: performs only SELECTs — no insert/update/delete/rpc. The clinician
 * reviews, edits and saves via the normal flows; nothing is persisted here.
 * Role gating (doctor/admin) is enforced by the route before calling this.
 */
export async function runDraft(
  ctx: AIContext,
  type: DraftType,
  opts: { diagnosis?: string; appointmentReason?: string } = {},
): Promise<DraftResult> {
  const db = await createClient()
  const patientId = ctx.patientId!

  const [patientRes, rxRes, consultRes, labRes, clinicRes, doctorRes] = await Promise.all([
    db.from('patients').select('full_name, patient_number, date_of_birth, gender, allergies, blood_type').eq('id', patientId).eq('clinic_id', ctx.clinicId).is('deleted_at', null).maybeSingle(),
    db.from('prescriptions').select('medications').eq('patient_id', patientId).eq('clinic_id', ctx.clinicId).eq('status', 'active').is('deleted_at', null),
    db.from('consultations').select('created_at').eq('patient_id', patientId).eq('clinic_id', ctx.clinicId).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
    db.from('lab_orders').select('id').eq('patient_id', patientId).eq('clinic_id', ctx.clinicId).is('deleted_at', null).in('status', ['ordered', 'sample_collected', 'in_progress']),
    db.from('clinics').select('name').eq('id', ctx.clinicId).maybeSingle(),
    db.from('user_profiles').select('full_name').eq('id', ctx.userId).maybeSingle(),
  ])

  const p = patientRes.data as {
    full_name: string; patient_number: string | null; date_of_birth: string | null
    gender: string | null; allergies: string | null; blood_type: string | null
  } | null

  const meds = new Set<string>()
  for (const rx of (rxRes.data ?? []) as { medications: unknown }[]) {
    const arr = Array.isArray(rx.medications) ? rx.medications : []
    for (const m of arr) {
      const item = m as { name?: unknown; medication_name?: unknown; medication?: unknown }
      const name = item?.name ?? item?.medication_name ?? item?.medication
      if (typeof name === 'string' && name.trim()) meds.add(name.trim())
    }
  }

  const consults = (consultRes.data ?? []) as { created_at: string }[]
  const lastConsult = consults[0]?.created_at?.slice(0, 10)

  const data: DraftData = {
    patient: p
      ? {
          fullName: p.full_name,
          patientNumber: p.patient_number,
          dateOfBirth: p.date_of_birth,
          gender: p.gender,
          allergies: p.allergies,
          bloodType: p.blood_type,
        }
      : undefined,
    activeMedications: [...meds],
    recentConsultationCount: consults.length,
    lastConsultationDate: lastConsult,
    pendingLabCount: (labRes.data ?? []).length,
    clinicName: (clinicRes.data as { name?: string } | null)?.name,
    doctorName: (doctorRes.data as { full_name?: string } | null)?.full_name,
    diagnosis: opts.diagnosis,
    appointmentReason: opts.appointmentReason,
  }

  // Stamp the generation time server-side.
  const generatedAt = new Date().toISOString()
  const draft = buildDraft(type, data, generatedAt)

  return {
    draft,
    meta: {
      dataCategories: draft.citations.map((c) => c.entity ?? c.source),
      provider: getProvider().id,
    },
  }
}
