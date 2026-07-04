// ── Workspace resolver (pure engine) ──────────────────────────────
//
// resolveWorkspace(ctx) composes the effective WorkspaceSpec from the four
// layers (role → specialty → clinic → prefs). Pure and deterministic — no I/O,
// no React, no DB — so governance rules and the zero-regression baseline are
// unit-testable. The single governance rule is: registry(specialty) ∩
// clinic.enabled, clinic-locked items forced in, then user-ordered.

import { getWidget } from '@/lib/widgets/registry'
import { getAction } from '@/lib/actions/registry'
import { getTemplate } from '@/lib/templates/registry'
import { getSpecialty } from '@/lib/specialties'
import type {
  WorkspaceContext, WorkspaceSpec, WidgetRef, QuickActionRef,
  ResolvedWidget, ResolvedAction, ModuleId,
} from './types'
import type { Role } from '@/types/database'

function hasModules(required: ModuleId[] | undefined, enabled: ModuleId[]): boolean {
  return !required || required.every(m => enabled.includes(m))
}

/** Reorder items so those named in `order` come first (in that order), the rest
 *  keep their original relative order. Stable and pure. */
function applyOrder<T extends { id: string }>(items: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return items
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.id) - rank(b.item.id) || a.i - b.i)
    .map(x => x.item)
}

/** Filter + lock + hide + order dashboard widgets for the context. Exported for
 *  focused testing of the governance rule. */
export function composeWidgets(refs: WidgetRef[], ctx: WorkspaceContext): ResolvedWidget[] {
  const locked = new Set(ctx.clinic.lockedWidgets)
  const hidden = new Set(ctx.prefs?.hiddenWidgets ?? [])

  const resolved: ResolvedWidget[] = []
  for (const ref of refs) {
    const def = getWidget(ref.id)
    if (!def) continue                                   // unknown → skip (tolerant)
    if (!def.roles.includes(ctx.role)) continue          // role gate
    if (!hasModules(def.requiresModules, ctx.clinic.enabledModules)) continue // module gate
    const isLocked = locked.has(ref.id) || !!ref.locked
    if (!isLocked && hidden.has(ref.id)) continue        // user hid an optional widget
    resolved.push({ id: ref.id, def, locked: isLocked })
  }
  return applyOrder(resolved, ctx.prefs?.widgetOrder)
}

/** Filter + order quick actions for the context. */
export function composeActions(refs: QuickActionRef[], ctx: WorkspaceContext): ResolvedAction[] {
  const resolved: ResolvedAction[] = []
  for (const ref of refs) {
    const def = getAction(ref.id)
    if (!def) continue
    if (!def.roles.includes(ctx.role)) continue
    if (!hasModules(def.requiresModules, ctx.clinic.enabledModules)) continue
    resolved.push({ id: ref.id, def })
  }
  // Favorites float to the front (still within the allowed set).
  return applyOrder(resolved, ctx.prefs?.favoriteActions)
}

/** Compose the full personalized workspace. Never throws; unknown specialty →
 *  general_practice (zero-regression default). */
export function resolveWorkspace(ctx: WorkspaceContext): WorkspaceSpec {
  const specialty = getSpecialty(ctx.specialty)

  const dashboardWidgets = composeWidgets(specialty.defaultWidgets, ctx)
  const quickActions = composeActions(specialty.quickActions, ctx)

  // Prefer a template matching the user's note style, else the first available.
  const templates = specialty.consultationTemplates.map(r => getTemplate(r.id)).filter(Boolean)
  const consultationTemplate =
    templates.find(t => t!.noteStyle === ctx.prefs?.noteStyle) ?? templates[0] ?? null

  return {
    specialty: specialty.id,
    dashboardWidgets,
    quickActions,
    consultationTemplate: consultationTemplate ?? null,
    timelineEventTypes: specialty.timelineEventTypes,
    aiBriefingTools: specialty.aiTools,
  }
}

/** Convenience: default clinic config with all modules enabled (used as a safe
 *  baseline before real clinic settings are read). */
export function allModulesConfig(role: Role): WorkspaceContext['clinic'] {
  void role
  return {
    enabledModules: ['lab', 'pharmacy', 'radiology', 'vaccination', 'growth', 'pregnancy', 'ecg', 'procedures', 'wound_photos', 'nutrition'],
    allowedSpecialties: ['general_practice'],
    lockedWidgets: [],
    hospitalMode: false,
  }
}
