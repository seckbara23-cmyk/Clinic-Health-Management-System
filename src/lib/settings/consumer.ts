// ── Settings consumption (pure) ───────────────────────────────────
//
// Read typed values out of the loaded clinic_settings map with a guaranteed
// fallback. Modules call these instead of hardcoding, so the Administration Hub
// is the single source of truth — but they NEVER break when a setting (or the
// whole store) is absent: the fallback is the module's existing default, which
// keeps behaviour identical pre-migration (zero regression).

import type { SectionValues, SettingValue } from './registry'

export type SettingsMap = Record<string, SectionValues>

function raw(map: SettingsMap | null | undefined, section: string, key: string): SettingValue | undefined {
  const v = map?.[section]?.[key]
  return v === null ? undefined : v
}

export function settingBool(map: SettingsMap | null | undefined, section: string, key: string, fallback: boolean): boolean {
  const v = raw(map, section, key)
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

export function settingNumber(map: SettingsMap | null | undefined, section: string, key: string, fallback: number): number {
  const v = raw(map, section, key)
  const n = typeof v === 'number' ? v : v != null ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

export function settingString(map: SettingsMap | null | undefined, section: string, key: string, fallback: string): string {
  const v = raw(map, section, key)
  return typeof v === 'string' && v.trim() !== '' ? v : fallback
}

/**
 * Is an AI feature enabled for this clinic? True unless the admin has turned AI
 * off globally or disabled that specific feature. Defaults to enabled (matching
 * today's behaviour) when nothing is configured.
 */
export function aiFeatureEnabled(map: SettingsMap | null | undefined, feature: string): boolean {
  if (!settingBool(map, 'ai', 'ai_enabled', true)) return false
  return settingBool(map, 'ai', feature, true)
}
