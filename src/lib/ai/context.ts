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
import type { AIContext, AIToolResult, StructuredAIResponse } from './types'
import { selectToolsForContext } from './tools'
import { skillForRole } from './skills'
import { getProvider } from './dispatch'

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
