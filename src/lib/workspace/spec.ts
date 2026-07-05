// ── Workspace Spec adapter — pure (Phase 14.2.6) ───────────────────
//
// Bridges the NEW-world inputs (resolved professional identity, specialty
// selection, user preferences) into the EXISTING pure resolveWorkspace(ctx)
// engine (Phase 14.1) — WITHOUT changing that engine or its golden behaviour.
// No React, no DB, no I/O: every branch is unit-testable in isolation, and the
// hook that consumes this (useWorkspaceSpec) stays a thin, tolerant wrapper.
//
// ZERO REGRESSION GUARANTEE: when identity/specialty/preferences are absent
// (today's common case — nothing has been onboarded yet), this adapter produces
// EXACTLY the same WorkspaceContext the 14.1 golden test already pins
// (`doctorCtx()` in workspace.test.ts) — so the resolved spec is byte-identical
// to today's dashboard baseline. Foundation only: this file does not render
// anything, and nothing currently swaps the live dashboard to use it.

import { resolveWorkspace, allModulesConfig } from './resolve'
import { DEFAULT_SPECIALTY } from '@/lib/specialties'
import type {
  WorkspaceContext, WorkspaceSpec, UserWorkspacePrefs, NoteStyle, SpecialtyId,
} from './types'
import type { Role } from '@/types/database'

const NOTE_STYLES: NoteStyle[] = ['soap', 'narrative', 'structured', 'voice_first']
/** The safe fallback role when none is known yet (extremely defensive — an
 *  authenticated session always carries a role in practice). Matches the
 *  documented zero-regression baseline (general_practice's primary role). */
const FALLBACK_ROLE: Role = 'doctor'

export interface WorkspaceSpecInput {
  role?: Role | null
  /** The professional's resolved primary specialty id (new Clinical Specialty
   *  Registry, Phase 14.2.3) — a bare string. Unregistered/unknown ids (every
   *  specialty except general_practice, today) safely fall back inside
   *  resolveWorkspace/getSpecialty — this is deliberate: no specialty-specific
   *  workspace exists yet (Phase 14.2.6 scope). */
  specialtyId?: string | null
  prefs?: Partial<UserWorkspacePrefs> | null
  /** Overrides layered onto the always-safe allModulesConfig() baseline. */
  clinic?: Partial<WorkspaceContext['clinic']> | null
}

/** Tolerant normaliser for a raw user_preferences.preferences JSONB blob.
 *  Never throws; drops anything malformed instead of failing. */
export function parseUserPreferences(raw: unknown): Partial<UserWorkspacePrefs> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const out: Partial<UserWorkspacePrefs> = {}
  if (Array.isArray(r.widgetOrder)) out.widgetOrder = r.widgetOrder.filter((x): x is string => typeof x === 'string')
  if (Array.isArray(r.hiddenWidgets)) out.hiddenWidgets = r.hiddenWidgets.filter((x): x is string => typeof x === 'string')
  if (Array.isArray(r.favoriteActions)) out.favoriteActions = r.favoriteActions.filter((x): x is string => typeof x === 'string')
  if (NOTE_STYLES.includes(r.noteStyle as NoteStyle)) out.noteStyle = r.noteStyle as NoteStyle
  return out
}

/** Assemble a full WorkspaceContext from tolerant, possibly-partial inputs.
 *  Never throws — every field has a safe, documented fallback. */
export function buildWorkspaceContext(input: WorkspaceSpecInput = {}): WorkspaceContext {
  const role: Role = input.role ?? FALLBACK_ROLE
  return {
    role,
    specialty: (input.specialtyId as SpecialtyId | undefined) ?? DEFAULT_SPECIALTY,
    clinic: { ...allModulesConfig(role), ...(input.clinic ?? {}) },
    prefs: input.prefs ?? undefined,
  }
}

/** Resolve the effective WorkspaceSpec directly from tolerant, high-level
 *  inputs — the single entry point the hook (and its tests) use. */
export function resolveEffectiveWorkspace(input: WorkspaceSpecInput = {}): WorkspaceSpec {
  return resolveWorkspace(buildWorkspaceContext(input))
}
