// ── Administration Hub — pure logic ───────────────────────────────
//
// Role permissions, global search, unsaved-change detection and value merging
// for the settings hub. Pure and dependency-free (no React, no DB) so tenant
// isolation and permission rules are unit-testable. RLS is the real security
// boundary; these helpers only shape the client UI.

import {
  SETTINGS_SECTIONS, sectionDefaults,
  type SettingsSection, type SectionValues, type SettingValue,
} from './registry'

// ── Permissions ────────────────────────────────────────────────────
const EDIT_ROLES = ['admin', 'super_admin']

/** Only clinic admins and super admins may change configuration. */
export function canEditSettings(role: string | null | undefined): boolean {
  return !!role && EDIT_ROLES.includes(role)
}

/** Whether a role may VIEW a section (read-only when they can't edit). */
export function canViewSection(section: SettingsSection, role: string | null | undefined): boolean {
  if (!section.viewRoles) return true
  return !!role && section.viewRoles.includes(role)
}

/** Sections a role can see, in registry order. */
export function visibleSections(role: string | null | undefined): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(s => canViewSection(s, role))
}

// ── Global search ──────────────────────────────────────────────────
export interface SearchHit { section: SettingsSection; matchedFields: string[] }

/**
 * Search sections (respecting role visibility) by title/description keys,
 * search terms, field keys and field label keys. Case-insensitive substring.
 * e.g. "SMS" → the Communication section.
 */
export function searchSettings(query: string, role: string | null | undefined): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const section of visibleSections(role)) {
    const haystacks = [
      section.id, section.titleKey, section.descKey ?? '', section.category, ...section.searchTerms,
    ].map(s => s.toLowerCase())
    const titleMatch = haystacks.some(h => h.includes(q))
    const matchedFields = section.fields
      .filter(f => [f.key, f.labelKey, f.helpKey ?? ''].some(s => s.toLowerCase().includes(q)))
      .map(f => f.key)
    if (titleMatch || matchedFields.length > 0) hits.push({ section, matchedFields })
  }
  return hits
}

// ── Values: merge saved over defaults ──────────────────────────────
/** Effective values for a section: stored values layered over field defaults. */
export function mergeSectionValues(section: SettingsSection, stored: SectionValues | null | undefined): SectionValues {
  const defaults = sectionDefaults(section)
  if (!stored) return defaults
  const out: SectionValues = { ...defaults }
  for (const f of section.fields) {
    if (Object.prototype.hasOwnProperty.call(stored, f.key) && stored[f.key] != null) out[f.key] = stored[f.key]
  }
  return out
}

// ── Unsaved-change detection ───────────────────────────────────────
export function changedKeys(saved: SectionValues, current: SectionValues): string[] {
  const keys = new Set([...Object.keys(saved), ...Object.keys(current)])
  const out: string[] = []
  for (const k of keys) if (saved[k] !== current[k]) out.push(k)
  return out.sort()
}

export function hasUnsavedChanges(saved: SectionValues, current: SectionValues): boolean {
  return changedKeys(saved, current).length > 0
}

/** Keep only known field keys (defends the store against stray/legacy keys). */
export function pickSectionValues(section: SettingsSection, values: SectionValues): SectionValues {
  const out: SectionValues = {}
  for (const f of section.fields) {
    const v = values[f.key]
    if (v !== undefined) out[f.key] = v as SettingValue
  }
  return out
}
