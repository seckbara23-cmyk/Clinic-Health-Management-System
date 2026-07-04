// ── Professional Profile — pure logic (Phase 14.2.1) ───────────────
//
// Deterministic, framework-free helpers for the professional-profile foundation.
// No React, no Supabase, no I/O — so every branch is unit-testable and the hook
// (useProfessionalProfile) stays a thin, tolerant wrapper around these.
//
// Guarantees that keep the foundation invisible & non-blocking:
//   • a missing DB row / missing table always yields a safe FALLBACK profile;
//   • a partial/legacy row is normalised without throwing;
//   • credential reminders are operational only (never diagnostic, never block).

import type {
  Credential,
  CredentialReminder,
  ProfessionalMediaKind,
  ProfessionalProfile,
  ProfessionalProfileRow,
  ProfessionId,
} from './professions/types'
import { isRegisteredProfession, professionForRole } from './professions'

export const PROFESSIONAL_MEDIA_BUCKET = 'professional-media'

// ── Fallback / empty profile ───────────────────────────────────────
// Returned whenever no row exists, the table is absent, or a query fails. The app
// renders exactly as today — the profile simply carries no professional metadata.
export function fallbackProfile(
  userId: string,
  clinicId: string,
  opts?: { role?: string | null; displayName?: string | null },
): ProfessionalProfile {
  return {
    userId,
    clinicId,
    profession: opts?.role ? professionForRole(opts.role).id : null,
    displayName: opts?.displayName ?? null,
    professionalTitle: null,
    department: null,
    position: null,
    yearsExperience: null,
    languages: [],
    photoPath: null,
    signaturePath: null,
    credentials: [],
    onboardingCompleted: false,
    isFallback: true,
  }
}

// ── Normalise a DB row → domain model (tolerant) ───────────────────
// Accepts a possibly-partial row (un-migrated DB, nullable columns, malformed
// JSONB) and never throws. Anything unparseable degrades to the fallback value.
export function normalizeProfile(
  row: ProfessionalProfileRow | null | undefined,
  userId: string,
  clinicId: string,
  opts?: { role?: string | null; displayName?: string | null },
): ProfessionalProfile {
  if (!row) return fallbackProfile(userId, clinicId, opts)
  return {
    userId: row.user_id ?? userId,
    clinicId: row.clinic_id ?? clinicId,
    profession: normalizeProfession(row.profession, opts?.role),
    displayName: nonEmpty(row.display_name) ?? opts?.displayName ?? null,
    professionalTitle: nonEmpty(row.professional_title),
    department: nonEmpty(row.department),
    position: nonEmpty(row.position),
    yearsExperience: typeof row.years_experience === 'number' ? row.years_experience : null,
    languages: Array.isArray(row.languages) ? row.languages.filter(l => typeof l === 'string') : [],
    photoPath: nonEmpty(row.photo_path),
    signaturePath: nonEmpty(row.signature_path),
    credentials: parseCredentials(row.credentials),
    onboardingCompleted: row.onboarding_completed === true,
    isFallback: false,
  }
}

function normalizeProfession(value?: string | null, role?: string | null): ProfessionId | null {
  if (isRegisteredProfession(value)) return value as ProfessionId
  if (role) return professionForRole(role).id
  return null
}

function nonEmpty(v?: string | null): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length ? t : null
}

// Tolerant credential parsing — accepts an array of objects or JSON string;
// silently drops anything that isn't a recognisable credential object.
export function parseCredentials(input: unknown): Credential[] {
  let raw: unknown = input
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(raw)) return []
  const out: Credential[] = []
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as { kind?: unknown }).kind === 'string') {
      out.push(item as Credential)
    }
  }
  return out
}

// ── Display name resolution ────────────────────────────────────────
// Profile display name wins; otherwise the auth full name; otherwise a neutral
// placeholder. Never returns an empty string.
export function displayNameFor(
  profile: Pick<ProfessionalProfile, 'displayName'> | null | undefined,
  fallbackFullName?: string | null,
): string {
  return nonEmpty(profile?.displayName) ?? nonEmpty(fallbackFullName) ?? '—'
}

// ── Credential expiry reminders (operational only) ─────────────────
// Deterministic given `now`. Surfaces expired + soon-to-expire credentials so a
// later UI can nudge the professional. Never blocks, never verifies externally.
export function credentialReminders(
  credentials: Credential[] | null | undefined,
  now: Date,
  withinDays = 60,
): CredentialReminder[] {
  if (!Array.isArray(credentials)) return []
  const today = startOfDay(now).getTime()
  const reminders: CredentialReminder[] = []
  for (const c of credentials) {
    const at = parseIsoDate(c?.expiresAt)
    if (!at) continue
    const days = Math.round((startOfDay(at).getTime() - today) / 86_400_000)
    if (days > withinDays) continue
    reminders.push({
      kind: c.kind,
      title: nonEmpty(c.title) ?? nonEmpty(c.identifier) ?? c.kind,
      severity: days < 0 ? 'expired' : 'expiring_soon',
      expiresAt: c.expiresAt as string,
      daysUntilExpiry: days,
    })
  }
  // Most urgent first (soonest / most overdue).
  return reminders.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
}

function parseIsoDate(v?: string | null): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// ── Storage path convention (must mirror migration 038 RLS) ────────
// professional-media/{clinicId}/{userId}/{kind}-{safeName}
//   folder[1] = clinicId   folder[2] = userId
// This is what scopes media to (clinic, user); RLS enforces the same predicate,
// so a path built here for the current user is always the user's own object.
export function mediaPath(
  clinicId: string,
  userId: string,
  kind: ProfessionalMediaKind,
  fileName: string,
): string {
  const safe = sanitizeFileName(fileName) || `${kind}.bin`
  return `${clinicId}/${userId}/${kind}-${safe}`
}

function sanitizeFileName(name: string): string {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

/** App-layer mirror of the RLS predicate: does this path belong to (clinic, user)?
 *  Used to defend against ever building or trusting a cross-tenant media path. */
export function isMediaPathOwnedBy(path: string, clinicId: string, userId: string): boolean {
  const parts = String(path).split('/')
  return parts.length >= 3 && parts[0] === clinicId && parts[1] === userId
}
